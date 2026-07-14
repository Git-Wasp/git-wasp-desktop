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
        // Per-file stats: Diff::stats() only aggregates across the whole diff,
        // so pull each file's counts from its own Patch (binary files have no
        // line-level patch — 0/0 is correct there, not a fallback).
        let (additions, deletions) = match git2::Patch::from_diff(&diff, idx) {
            Ok(Some(patch)) => patch
                .line_stats()
                .map(|(_, add, del)| (add, del))
                .unwrap_or((0, 0)),
            _ => (0, 0),
        };
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
