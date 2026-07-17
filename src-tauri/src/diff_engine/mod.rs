use crate::working_tree::FileDiffHunks;
use anyhow::Context;
use git2::{DiffOptions, Repository};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub oid: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub author_timestamp: i64,
    pub committer_name: String,
    pub committer_timestamp: i64,
    pub parent_oids: Vec<String>,
    pub changed_files: Vec<ChangedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Serialize)]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
}

pub fn get_commit_detail(repo: &Repository, oid_str: &str) -> anyhow::Result<CommitDetail> {
    let oid = git2::Oid::from_str(oid_str).context("invalid OID")?;
    let commit = repo.find_commit(oid).context("commit not found")?;

    let parent_tree = commit.parent(0).ok().map(|p| p.tree().ok()).flatten();
    let commit_tree = commit.tree().context("commit has no tree")?;

    let mut opts = DiffOptions::new();
    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), Some(&mut opts))
        .context("failed to compute diff")?;

    let delta_count = diff.deltas().len();
    // One foreach pass over the whole diff instead of one Patch::from_diff
    // per file (each of which re-parses that file's hunks/lines on its own)
    // — see compute_line_stats.
    let line_stats = compute_line_stats(&diff)?;
    let mut changed_files = Vec::new();
    for idx in 0..delta_count {
        let delta = diff.get_delta(idx).context("missing delta")?;
        let new_file = delta.new_file();
        let old_file = delta.old_file();
        let path = new_file
            .path()
            .or_else(|| old_file.path())
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();
        let old_path = if delta.status() == git2::Delta::Renamed {
            old_file
                .path()
                .and_then(|p| p.to_str())
                .map(|s| s.to_string())
        } else {
            None
        };
        let status = match delta.status() {
            git2::Delta::Added => FileStatus::Added,
            git2::Delta::Deleted => FileStatus::Deleted,
            git2::Delta::Renamed => FileStatus::Renamed,
            git2::Delta::Copied => FileStatus::Copied,
            _ => FileStatus::Modified,
        };
        let (additions, deletions) = line_stats[idx];
        changed_files.push(ChangedFile {
            path,
            old_path,
            status,
            additions,
            deletions,
        });
    }

    let message = commit.message().unwrap_or("").to_string();
    let author_name = commit.author().name().unwrap_or("").to_string();
    let author_email = commit.author().email().unwrap_or("").to_string();
    let author_timestamp = commit.author().when().seconds();
    let committer_name = commit.committer().name().unwrap_or("").to_string();
    let committer_timestamp = commit.committer().when().seconds();
    let parent_oids = commit.parent_ids().map(|p| p.to_string()).collect();

    Ok(CommitDetail {
        oid: oid_str.to_string(),
        message,
        author_name,
        author_email,
        author_timestamp,
        committer_name,
        committer_timestamp,
        parent_oids,
        changed_files,
    })
}

/// Per-file added/deleted line counts for every delta in `diff`, in delta
/// order (`result[i]` answers `diff.get_delta(i)`) — one `diff.foreach` pass
/// over the whole diff instead of one `Patch::from_diff` (and its own
/// hunk/line re-parse) per file. Binary files get `(0, 0)`: the file
/// callback fires for them but no line callback follows, matching
/// `Patch::line_stats`'s own behaviour (binary files have no line-level
/// patch — `(0, 0)` is correct there, not a fallback).
fn compute_line_stats(diff: &git2::Diff<'_>) -> anyhow::Result<Vec<(usize, usize)>> {
    use std::cell::RefCell;
    let stats: RefCell<Vec<(usize, usize)>> = RefCell::new(vec![(0, 0); diff.deltas().len()]);
    // Index into `stats` of the delta currently being visited. Relies on the
    // same libgit2 `diff_foreach` ordering guarantee `collect_hunks` already
    // does: the file callback fires exactly once per delta, in order, before
    // that delta's own hunk/line callbacks.
    let current: RefCell<Option<usize>> = RefCell::new(None);

    diff.foreach(
        &mut |_delta, _progress| {
            let mut cur = current.borrow_mut();
            *cur = Some(cur.map_or(0, |i| i + 1));
            true
        },
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            let Some(idx) = *current.borrow() else {
                return true;
            };
            match line.origin() {
                '+' => stats.borrow_mut()[idx].0 += 1,
                '-' => stats.borrow_mut()[idx].1 += 1,
                _ => {} // context/no-newline/file-header/hunk-header lines don't count
            }
            true
        }),
    )
    .context("failed to compute per-file diff stats")?;

    Ok(stats.into_inner())
}

fn collect_hunks(diff: git2::Diff<'_>) -> anyhow::Result<Vec<crate::working_tree::Hunk>> {
    use std::cell::RefCell;
    let hunks: RefCell<Vec<crate::working_tree::Hunk>> = RefCell::new(Vec::new());
    let current_hunk: RefCell<Option<(crate::working_tree::Hunk, String)>> = RefCell::new(None);

    diff.foreach(
        &mut |_, _| true,
        None,
        Some(&mut |_, raw_hunk| {
            // Flush any in-progress hunk
            if let Some((mut h, content)) = current_hunk.borrow_mut().take() {
                h.content = content;
                hunks.borrow_mut().push(h);
            }
            let idx = hunks.borrow().len();
            let header = std::str::from_utf8(raw_hunk.header())
                .unwrap_or("")
                .trim_end()
                .to_string();
            let new_hunk = crate::working_tree::Hunk {
                index: idx,
                header: header.clone(),
                content: String::new(),
                old_start: raw_hunk.old_start(),
                new_start: raw_hunk.new_start(),
            };
            *current_hunk.borrow_mut() = Some((new_hunk, header + "\n"));
            true
        }),
        Some(&mut |_, _, line| {
            use git2::DiffLineType::*;
            let prefix = match line.origin_value() {
                Addition => "+",
                Deletion => "-",
                Context => " ",
                _ => return true,
            };
            let content = std::str::from_utf8(line.content()).unwrap_or("");
            if let Some((_, ref mut body)) = *current_hunk.borrow_mut() {
                body.push_str(prefix);
                body.push_str(content);
                if !content.ends_with('\n') {
                    body.push('\n');
                }
            }
            true
        }),
    )?;

    // Flush final hunk
    if let Some((mut h, content)) = current_hunk.into_inner() {
        h.content = content;
        hunks.borrow_mut().push(h);
    }

    Ok(hunks.into_inner())
}

pub fn get_unstaged_diff(repo: &Repository, path: &str) -> anyhow::Result<FileDiffHunks> {
    let index = repo.index().context("failed to get index")?;
    let mut opts = DiffOptions::new();
    opts.pathspec(path);
    opts.disable_pathspec_match(true);
    let diff = repo
        .diff_index_to_workdir(Some(&index), Some(&mut opts))
        .context("failed to compute unstaged diff")?;
    let hunks = collect_hunks(diff)?;
    Ok(FileDiffHunks {
        path: path.to_string(),
        hunks,
    })
}

pub fn get_staged_diff(repo: &Repository, path: &str) -> anyhow::Result<FileDiffHunks> {
    let index = repo.index().context("failed to get index")?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(path);
    opts.disable_pathspec_match(true);
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut opts))
        .context("failed to compute staged diff")?;
    let hunks = collect_hunks(diff)?;
    Ok(FileDiffHunks {
        path: path.to_string(),
        hunks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;
    use tempfile::TempDir;

    fn sig() -> Signature<'static> {
        Signature::now("Test", "test@test.com").unwrap()
    }

    fn init_repo_with_file(name: &str, content: &str) -> (TempDir, Repository, git2::Oid) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let file_path = dir.path().join(name);
        fs::write(&file_path, content).unwrap();
        let oid = {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new(name)).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let sig = sig();
            let oid = repo
                .commit(Some("HEAD"), &sig, &sig, "add file", &tree, &[])
                .unwrap();
            drop(tree);
            oid
        };
        (dir, repo, oid)
    }

    /// Perf harness (Phase 0 of docs/superpowers/perf-baseline.md): times
    /// `get_commit_detail` on the bench repo's root ("seed") commit, which
    /// touches every generated file in one commit — the "opening commit
    /// detail for a large changeset" scenario. Ignored by default; run with:
    /// `BENCH_REPO_PATH=/path/to/bench-repo cargo test --release -- --ignored --nocapture bench_`
    #[test]
    #[ignore = "perf harness: requires BENCH_REPO_PATH"]
    fn bench_commit_detail_large_changeset() {
        let path = std::env::var("BENCH_REPO_PATH").expect("set BENCH_REPO_PATH to the bench repo");
        let repo = Repository::open(&path).unwrap();
        let mut revwalk = repo.revwalk().unwrap();
        revwalk.push_head().unwrap();
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL).unwrap();
        let root = revwalk.filter_map(|o| o.ok()).last().unwrap();

        let t0 = std::time::Instant::now();
        let detail = get_commit_detail(&repo, &root.to_string()).unwrap();
        println!(
            "get_commit_detail (seed commit, {} files changed): {:?}",
            detail.changed_files.len(),
            t0.elapsed()
        );
    }

    #[test]
    fn get_commit_diff_returns_changed_files() {
        let (_dir, repo, oid) = init_repo_with_file("hello.txt", "hello\n");
        let detail = get_commit_detail(&repo, &oid.to_string()).unwrap();
        assert_eq!(detail.changed_files.len(), 1);
        assert_eq!(detail.changed_files[0].path, "hello.txt");
    }

    #[test]
    fn get_commit_detail_reports_real_per_file_addition_deletion_counts() {
        let (dir, repo, _first_oid) = init_repo_with_file("hello.txt", "line1\nline2\n");
        fs::write(dir.path().join("hello.txt"), "line1\nline2\nline3\nline4\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("hello.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let s = sig();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let oid = repo
            .commit(Some("HEAD"), &s, &s, "add two lines", &tree, &[&parent])
            .unwrap();

        let detail = get_commit_detail(&repo, &oid.to_string()).unwrap();

        assert_eq!(detail.changed_files.len(), 1);
        assert_eq!(detail.changed_files[0].additions, 2);
        assert_eq!(detail.changed_files[0].deletions, 0);
    }

    #[test]
    fn compute_line_stats_attributes_counts_to_the_correct_file_not_a_neighbour() {
        // The regression this guards against: a single accumulating
        // diff.foreach pass must reset "which file am I counting for" at
        // each file callback, or one file's lines could leak into another's
        // total. Three files in one commit, each with a distinct, known
        // shape, so a mix-up would show up as a wrong count on some file.
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let s = sig();
        fs::write(dir.path().join("a.txt"), "a1\na2\na3\n").unwrap();
        fs::write(dir.path().join("b.txt"), "b1\nb2\n").unwrap();
        let base_oid = {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("a.txt")).unwrap();
            index.add_path(std::path::Path::new("b.txt")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &s, &s, "base", &tree, &[])
                .unwrap()
        };
        let base = repo.find_commit(base_oid).unwrap();

        // a.txt: +2 (a4, a5), b.txt: -1 (drop b2) +1 (b2-edited), c.txt: new, +4.
        fs::write(dir.path().join("a.txt"), "a1\na2\na3\na4\na5\n").unwrap();
        fs::write(dir.path().join("b.txt"), "b1\nb2-edited\n").unwrap();
        fs::write(dir.path().join("c.txt"), "c1\nc2\nc3\nc4\n").unwrap();
        let oid = {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("a.txt")).unwrap();
            index.add_path(std::path::Path::new("b.txt")).unwrap();
            index.add_path(std::path::Path::new("c.txt")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &s, &s, "change three files", &tree, &[&base])
                .unwrap()
        };

        let commit = repo.find_commit(oid).unwrap();
        let parent_tree = commit.parent(0).unwrap().tree().unwrap();
        let commit_tree = commit.tree().unwrap();
        let diff = repo
            .diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None)
            .unwrap();

        let stats = compute_line_stats(&diff).unwrap();
        assert_eq!(stats.len(), 3);

        let by_path: std::collections::HashMap<String, (usize, usize)> = (0..diff.deltas().len())
            .map(|i| {
                let delta = diff.get_delta(i).unwrap();
                let path = delta
                    .new_file()
                    .path()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string();
                (path, stats[i])
            })
            .collect();

        assert_eq!(by_path["a.txt"], (2, 0));
        assert_eq!(by_path["b.txt"], (1, 1));
        assert_eq!(by_path["c.txt"], (4, 0));
    }

    #[test]
    fn get_commit_detail_attributes_multi_file_counts_correctly() {
        // End-to-end pin at the get_commit_detail level (not just the
        // internal compute_line_stats helper): same fixture, asserting the
        // public changed_files output carries the right count per file.
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let s = sig();
        fs::write(dir.path().join("a.txt"), "a1\na2\na3\n").unwrap();
        fs::write(dir.path().join("b.txt"), "b1\nb2\n").unwrap();
        let base_oid = {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("a.txt")).unwrap();
            index.add_path(std::path::Path::new("b.txt")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &s, &s, "base", &tree, &[])
                .unwrap()
        };
        let base = repo.find_commit(base_oid).unwrap();

        fs::write(dir.path().join("a.txt"), "a1\na2\na3\na4\na5\n").unwrap();
        fs::write(dir.path().join("b.txt"), "b1\nb2-edited\n").unwrap();
        fs::write(dir.path().join("c.txt"), "c1\nc2\nc3\nc4\n").unwrap();
        let oid = {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("a.txt")).unwrap();
            index.add_path(std::path::Path::new("b.txt")).unwrap();
            index.add_path(std::path::Path::new("c.txt")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &s, &s, "change three files", &tree, &[&base])
                .unwrap()
        };

        let detail = get_commit_detail(&repo, &oid.to_string()).unwrap();
        assert_eq!(detail.changed_files.len(), 3);

        let by_path: std::collections::HashMap<&str, (usize, usize)> = detail
            .changed_files
            .iter()
            .map(|f| (f.path.as_str(), (f.additions, f.deletions)))
            .collect();
        assert_eq!(by_path["a.txt"], (2, 0));
        assert_eq!(by_path["b.txt"], (1, 1));
        assert_eq!(by_path["c.txt"], (4, 0));
    }

    #[test]
    fn unstaged_diff_for_a_bracketed_filename_does_not_cross_match_another_file() {
        // "[id].tsx" is a routine Next.js/SvelteKit filename. `[id]` parses as
        // an fnmatch character class matching a single 'i' or 'd', so a glob
        // pathspec of "[id].tsx" can incorrectly match an unrelated file like
        // "i.tsx" — dangerous for discard_hunk, which builds a fabricated diff
        // header from whichever file the pathspec resolves to.
        let (dir, repo, _oid) = init_repo_with_file("i.tsx", "orig\n");
        {
            let mut index = repo.index().unwrap();
            fs::write(dir.path().join("[id].tsx"), "orig\n").unwrap();
            index.add_path(std::path::Path::new("[id].tsx")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let s = sig();
            let parent = repo.head().unwrap().peel_to_commit().unwrap();
            repo.commit(Some("HEAD"), &s, &s, "add bracket file", &tree, &[&parent])
                .unwrap();
        }
        // Modify only "i.tsx"; "[id].tsx" is untouched.
        fs::write(dir.path().join("i.tsx"), "orig\nmodified\n").unwrap();

        let diff = get_unstaged_diff(&repo, "[id].tsx").unwrap();

        assert_eq!(
            diff.hunks.len(),
            0,
            "a pathspec of '[id].tsx' must not match the unrelated file 'i.tsx'"
        );
    }

    #[test]
    fn stash_commit_diffs_against_its_base_ancestor() {
        // A stash's `oid` is a real commit whose first parent is the commit it was
        // created on. Selecting the stash in the graph reuses the commit-detail
        // path, so it must show the stashed changes (stash vs base), exactly like
        // any other commit diffed against its first parent.
        let (dir, mut repo, _base) = init_repo_with_file("a.txt", "one\n");
        // Dirty the working tree, then stash it.
        fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
        let stash_oid = repo
            .stash_save2(&sig(), Some("WIP experiment"), None)
            .unwrap();

        let detail = get_commit_detail(&repo, &stash_oid.to_string()).unwrap();

        assert_eq!(detail.changed_files.len(), 1);
        assert_eq!(detail.changed_files[0].path, "a.txt");
        assert!(matches!(
            detail.changed_files[0].status,
            FileStatus::Modified
        ));
    }

    #[test]
    fn root_commit_diff_against_empty_tree() {
        let (_dir, repo, oid) = init_repo_with_file("file.txt", "content\n");
        let detail = get_commit_detail(&repo, &oid.to_string()).unwrap();
        assert!(matches!(detail.changed_files[0].status, FileStatus::Added));
    }

    #[test]
    fn invalid_oid_returns_error() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let result = get_commit_detail(&repo, "not-an-oid");
        assert!(result.is_err());
    }
}
