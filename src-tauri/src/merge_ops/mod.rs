use anyhow::Context;
use git2::{BranchType, Index, IndexEntry, ObjectType, Repository};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    NormalEdit,
    AddAdd,
    DeleteModify,
    ModifyDelete,
    BinaryOrUnmergeable,
}

/// Which side of a conflict to keep when resolving via `resolve_with_side` —
/// used for conflicts that can't be resolved by editing text (binary files,
/// add/add, and the surviving side of a delete/modify or modify/delete).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictBlock {
    pub start_line: usize,
    pub mid_line: usize,
    pub end_line: usize,
    pub ours_text: String,
    pub theirs_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictedFile {
    pub path: String,
    pub kind: ConflictKind,
    pub ours_content: Option<String>,
    pub theirs_content: Option<String>,
    pub base_content: Option<String>,
    pub seeded_result: Option<String>,
    pub conflict_blocks: Vec<ConflictBlock>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum MergeOutcome {
    Clean,
    Conflicts { conflicts: Vec<ConflictedFile> },
}

/// Starts a merge of `branch_name` into the current branch. Mirrors `git
/// merge <branch>`: performs the merge analysis and applies it to the
/// working tree and index. If the merge produces conflicts, collects and
/// returns them; otherwise reports a clean merge so the caller can decide
/// whether to auto-commit.
pub fn start_merge(repo: &mut Repository, branch_name: &str) -> anyhow::Result<MergeOutcome> {
    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .or_else(|_| repo.find_branch(branch_name, BranchType::Remote))
        .with_context(|| format!("branch not found: {branch_name}"))?;
    let target_oid = branch
        .get()
        .peel(ObjectType::Commit)
        .context("could not resolve branch to a commit")?
        .id();
    let annotated = repo
        .find_annotated_commit(target_oid)
        .context("could not annotate target commit")?;

    repo.merge(&[&annotated], None, None)
        .context("merge failed")?;

    if repo.index().context("failed to get index")?.has_conflicts() {
        let conflicts = collect_conflicts(repo)?;
        Ok(MergeOutcome::Conflicts { conflicts })
    } else {
        Ok(MergeOutcome::Clean)
    }
}

/// Reads the index's current conflict entries and builds a rich
/// `ConflictedFile` for each — loading blob contents for ours/theirs/base,
/// classifying the conflict kind, and (for plain text edit/edit conflicts)
/// seeding the result buffer with `merge_file_from_index`'s conflict-marker
/// output, parsed into structured `ConflictBlock`s.
pub fn collect_conflicts(repo: &Repository) -> anyhow::Result<Vec<ConflictedFile>> {
    let index = repo.index().context("failed to get index")?;
    let mut out = Vec::new();
    for conflict in index
        .conflicts()
        .context("failed to read index conflicts")?
    {
        let conflict = conflict.context("invalid conflict entry")?;
        out.push(build_conflicted_file(repo, &index, &conflict)?);
    }
    Ok(out)
}

fn build_conflicted_file(
    repo: &Repository,
    index: &Index,
    conflict: &git2::IndexConflict,
) -> anyhow::Result<ConflictedFile> {
    let path = conflict_path(conflict)?;

    let ours_blob = load_blob(repo, conflict.our.as_ref())?;
    let theirs_blob = load_blob(repo, conflict.their.as_ref())?;
    let base_blob = load_blob(repo, conflict.ancestor.as_ref())?;

    let any_binary = [&ours_blob, &theirs_blob, &base_blob]
        .iter()
        .any(|b| b.as_ref().is_some_and(|blob| blob.is_binary()));

    let structural = classify_structure(&conflict.ancestor, &conflict.our, &conflict.their);
    let kind = if structural == ConflictKind::NormalEdit && any_binary {
        ConflictKind::BinaryOrUnmergeable
    } else {
        structural
    };

    let ours_content = ours_blob.as_ref().and_then(blob_text);
    let theirs_content = theirs_blob.as_ref().and_then(blob_text);
    let base_content = base_blob.as_ref().and_then(blob_text);

    let (seeded_result, conflict_blocks) = if kind == ConflictKind::NormalEdit {
        seed_merge_result(repo, index, conflict)
    } else {
        (None, Vec::new())
    };

    Ok(ConflictedFile {
        path,
        kind,
        ours_content,
        theirs_content,
        base_content,
        seeded_result,
        conflict_blocks,
    })
}

fn conflict_path(conflict: &git2::IndexConflict) -> anyhow::Result<String> {
    let entry = conflict
        .our
        .as_ref()
        .or(conflict.their.as_ref())
        .or(conflict.ancestor.as_ref())
        .ok_or_else(|| anyhow::anyhow!("conflict entry has no associated path"))?;
    Ok(String::from_utf8_lossy(&entry.path).into_owned())
}

fn classify_structure(
    ancestor: &Option<IndexEntry>,
    our: &Option<IndexEntry>,
    their: &Option<IndexEntry>,
) -> ConflictKind {
    match (ancestor.is_some(), our.is_some(), their.is_some()) {
        (true, true, true) => ConflictKind::NormalEdit,
        (false, true, true) => ConflictKind::AddAdd,
        (true, false, true) => ConflictKind::DeleteModify,
        (true, true, false) => ConflictKind::ModifyDelete,
        _ => ConflictKind::BinaryOrUnmergeable,
    }
}

fn load_blob<'repo>(
    repo: &'repo Repository,
    entry: Option<&IndexEntry>,
) -> anyhow::Result<Option<git2::Blob<'repo>>> {
    match entry {
        Some(e) => Ok(Some(
            repo.find_blob(e.id)
                .context("failed to load conflict blob")?,
        )),
        None => Ok(None),
    }
}

fn blob_text(blob: &git2::Blob) -> Option<String> {
    if blob.is_binary() {
        return None;
    }
    String::from_utf8(blob.content().to_vec()).ok()
}

/// Runs libgit2's textual three-way merge for a normal edit/edit conflict
/// and parses the resulting conflict-marker text into `ConflictBlock`s. Only
/// called when ancestor/ours/theirs are all present and text — the only case
/// `merge_file_from_index` can produce a meaningful textual result for.
fn seed_merge_result(
    repo: &Repository,
    index: &Index,
    conflict: &git2::IndexConflict,
) -> (Option<String>, Vec<ConflictBlock>) {
    let _ = index;
    let (Some(ancestor), Some(our), Some(their)) =
        (&conflict.ancestor, &conflict.our, &conflict.their)
    else {
        return (None, Vec::new());
    };

    let Ok(result) = repo.merge_file_from_index(ancestor, our, their, None) else {
        return (None, Vec::new());
    };
    let Ok(text) = std::str::from_utf8(result.content()) else {
        return (None, Vec::new());
    };

    let blocks = parse_conflict_blocks(text);
    (Some(text.to_string()), blocks)
}

/// Parses `<<<<<<<` / `=======` / `>>>>>>>` conflict-marker text into
/// structured blocks with 1-based line numbers and the ours/theirs text each
/// side contributed. Pure function — the frontend uses the line numbers to
/// splice "accept ours/theirs" replacements into the result-pane document,
/// so this is the single source of truth for where blocks start and end.
pub fn parse_conflict_blocks(text: &str) -> Vec<ConflictBlock> {
    let lines: Vec<&str> = text.lines().collect();
    let mut blocks = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        if !lines[i].starts_with("<<<<<<<") {
            i += 1;
            continue;
        }

        let start_line = i + 1;
        let mut mid_line = None;
        let mut end_line = None;
        let mut ours_lines: Vec<&str> = Vec::new();
        let mut theirs_lines: Vec<&str> = Vec::new();
        let mut j = i + 1;

        while j < lines.len() {
            if mid_line.is_none() && lines[j].starts_with("=======") {
                mid_line = Some(j + 1);
            } else if lines[j].starts_with(">>>>>>>") {
                end_line = Some(j + 1);
                break;
            } else if mid_line.is_some() {
                theirs_lines.push(lines[j]);
            } else {
                ours_lines.push(lines[j]);
            }
            j += 1;
        }

        match (mid_line, end_line) {
            (Some(mid_line), Some(end_line)) => {
                blocks.push(ConflictBlock {
                    start_line,
                    mid_line,
                    end_line,
                    ours_text: join_lines(&ours_lines),
                    theirs_text: join_lines(&theirs_lines),
                });
                i = j + 1;
            }
            // Unterminated marker triple — not a real conflict block; move on.
            _ => i += 1,
        }
    }

    blocks
}

fn join_lines(lines: &[&str]) -> String {
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

/// Writes the user's resolution for `path` to the working tree and stages it
/// — staging *is* "resolved" in git's data model, there's no separate bit.
/// Operates on raw bytes so CRLF content round-trips exactly as the user
/// edited it.
pub fn write_resolution(repo: &Repository, path: &str, content: &str) -> anyhow::Result<()> {
    {
        let index = repo.index().context("failed to get index")?;
        find_conflict(&index, path)?;
    }

    let workdir = repo
        .workdir()
        .context("repository has no working directory")?;
    let full_path = workdir.join(path);
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&full_path, content)
        .with_context(|| format!("failed to write resolution for {path}"))?;

    let mut index = repo.index().context("failed to get index")?;
    index
        .add_path(Path::new(path))
        .with_context(|| format!("failed to stage resolved file: {path}"))?;
    index.write().context("failed to write index")?;
    Ok(())
}

/// Resolves a conflict by keeping one side's version of the file verbatim:
/// copies the chosen side's blob bytes into the working tree and stages the
/// result. Unlike `write_resolution` (which takes UTF-8 text), this operates
/// on raw bytes loaded straight from the blob — the only correct way to
/// resolve binary files, whose content can't be represented in
/// `ConflictedFile::ours_content`/`theirs_content` (always `None` for binary
/// blobs). Also covers add/add conflicts and the surviving side of a
/// delete/modify or modify/delete conflict.
pub fn resolve_with_side(repo: &Repository, path: &str, side: ConflictSide) -> anyhow::Result<()> {
    let entry = {
        let index = repo.index().context("failed to get index")?;
        let conflict = find_conflict(&index, path)?;
        let chosen = match side {
            ConflictSide::Ours => conflict.our,
            ConflictSide::Theirs => conflict.their,
        };
        chosen.with_context(|| {
            format!("{path}: chosen side does not exist in this conflict (it was deleted) — resolve with deletion instead")
        })?
    };

    let blob = repo
        .find_blob(entry.id)
        .context("failed to load conflict blob")?;

    let workdir = repo
        .workdir()
        .context("repository has no working directory")?;
    let full_path = workdir.join(path);
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&full_path, blob.content())
        .with_context(|| format!("failed to write resolution for {path}"))?;

    let mut index = repo.index().context("failed to get index")?;
    index
        .add_path(Path::new(path))
        .with_context(|| format!("failed to stage resolved file: {path}"))?;
    index.write().context("failed to write index")?;
    Ok(())
}

/// Resolves a conflict by keeping the deletion: removes the file from the
/// working tree (if present) and the index, then stages the removal.
pub fn resolve_with_deletion(repo: &Repository, path: &str) -> anyhow::Result<()> {
    {
        let index = repo.index().context("failed to get index")?;
        find_conflict(&index, path)?;
    }

    let workdir = repo
        .workdir()
        .context("repository has no working directory")?;
    let full_path = workdir.join(path);
    if full_path.exists() {
        std::fs::remove_file(&full_path).with_context(|| format!("failed to remove {path}"))?;
    }

    let mut index = repo.index().context("failed to get index")?;
    index
        .remove_path(Path::new(path))
        .with_context(|| format!("failed to stage deletion of {path}"))?;
    index.write().context("failed to write index")?;
    Ok(())
}

fn find_conflict(index: &Index, path: &str) -> anyhow::Result<git2::IndexConflict> {
    for conflict in index
        .conflicts()
        .context("failed to read index conflicts")?
    {
        let conflict = conflict.context("invalid conflict entry")?;
        if conflict_path(&conflict)? == path {
            return Ok(conflict);
        }
    }
    anyhow::bail!("no conflict found for path: {path}")
}

/// Completes an in-progress merge: verifies every conflict is resolved
/// (staged), writes the index tree, and creates a merge commit with both
/// `HEAD` and `MERGE_HEAD` as parents — exactly what `git merge --continue`
/// does once conflicts are resolved. Cleans up merge state on success.
pub fn complete_merge(repo: &mut Repository, message: &str) -> anyhow::Result<String> {
    if repo.index().context("failed to get index")?.has_conflicts() {
        anyhow::bail!("cannot complete merge: unresolved conflicts remain");
    }

    let sig = repo.signature().context("no git identity configured")?;
    let tree_oid = {
        let mut index = repo.index().context("failed to get index")?;
        index.write_tree().context("failed to write merged tree")?
    };
    let tree = repo
        .find_tree(tree_oid)
        .context("failed to load merged tree")?;
    let head_commit = repo
        .head()?
        .peel_to_commit()
        .context("HEAD is not a commit")?;
    let merge_head_commit = repo
        .find_reference("MERGE_HEAD")
        .context("no merge in progress (MERGE_HEAD missing)")?
        .peel_to_commit()
        .context("MERGE_HEAD does not point to a commit")?;

    let oid = repo
        .commit(
            Some("HEAD"),
            &sig,
            &sig,
            message,
            &tree,
            &[&head_commit, &merge_head_commit],
        )
        .context("failed to create merge commit")?;

    repo.cleanup_state()
        .context("failed to clean up merge state")?;
    Ok(oid.to_string())
}

/// Aborts an in-progress merge: restores the working tree and index to HEAD
/// for files the merge actually touched (conflicted or already staged as part
/// of the merge), leaving unrelated dirty files untouched — matching `git
/// merge --abort` (`git reset --merge`), not a blanket hard reset.
pub fn abort_merge(repo: &mut Repository) -> anyhow::Result<()> {
    let head_commit = repo
        .head()?
        .peel_to_commit()
        .context("HEAD is not a commit")?;

    // Paths the merge actually put its hands on: anything currently
    // conflicted, plus anything staged with a blob that differs from HEAD's
    // (the merge's clean auto-merges). Everything else is left alone, so an
    // unrelated dirty file survives the abort.
    let touched_paths: Vec<String> = {
        let index = repo.index().context("failed to get index")?;
        let head_tree = head_commit.tree().context("HEAD commit has no tree")?;
        let mut paths = std::collections::HashSet::new();
        for conflict in index
            .conflicts()
            .context("failed to read index conflicts")?
        {
            let conflict = conflict.context("invalid conflict entry")?;
            for entry in [conflict.our, conflict.their, conflict.ancestor]
                .into_iter()
                .flatten()
            {
                if let Ok(p) = std::str::from_utf8(&entry.path) {
                    paths.insert(p.to_string());
                }
            }
        }
        for entry in index.iter() {
            if let Ok(p) = std::str::from_utf8(&entry.path) {
                let differs_from_head = head_tree
                    .get_path(Path::new(p))
                    .map(|e| e.id() != entry.id)
                    .unwrap_or(true);
                if differs_from_head {
                    paths.insert(p.to_string());
                }
            }
        }
        paths.into_iter().collect()
    };

    if !touched_paths.is_empty() {
        // Hard is required for `reset()` to touch the working directory at
        // all — Mixed only updates HEAD/the index. Scoping the checkout to
        // `touched_paths` (rather than a full-tree force-checkout) is what
        // keeps this from clobbering unrelated dirty files.
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.force();
        for p in &touched_paths {
            checkout.path(p);
        }
        repo.reset(
            head_commit.as_object(),
            git2::ResetType::Hard,
            Some(&mut checkout),
        )
        .context("failed to reset to HEAD")?;
    } else {
        repo.reset(head_commit.as_object(), git2::ResetType::Mixed, None)
            .context("failed to reset to HEAD")?;
    }
    repo.cleanup_state()
        .context("failed to clean up merge state")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Commit, Signature};
    use std::fs;
    use tempfile::TempDir;

    fn init_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        // Pin line-ending handling regardless of the host's global git config —
        // on Windows, a global `core.autocrlf=true` (Git for Windows' default)
        // would have libgit2 rewrite CRLF<->LF on add/checkout, corrupting the
        // exact-byte assertions these tests make.
        config.set_str("core.autocrlf", "false").unwrap();
        (dir, repo)
    }

    fn commit_file(
        repo: &Repository,
        dir: &TempDir,
        name: &str,
        content: impl AsRef<[u8]>,
        message: &str,
        parents: &[&Commit],
    ) -> git2::Oid {
        fs::write(dir.path().join(name), content.as_ref()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, parents)
            .unwrap()
    }

    fn delete_file_commit(
        repo: &Repository,
        dir: &TempDir,
        name: &str,
        message: &str,
        parents: &[&Commit],
    ) -> git2::Oid {
        fs::remove_file(dir.path().join(name)).unwrap();
        let mut index = repo.index().unwrap();
        index.remove_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, parents)
            .unwrap()
    }

    fn checkout_branch(repo: &Repository, name: &str) {
        repo.set_head(&format!("refs/heads/{name}")).unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
    }

    /// Base commit + diverging branches that both edit the same line of
    /// file.txt — guaranteed NormalEdit conflict on merge. Returns the name
    /// of the branch to merge into the (still-checked-out) original branch.
    fn make_conflicting_branches(dir: &TempDir, repo: &Repository) -> String {
        let base_oid = commit_file(repo, dir, "file.txt", "line1\nshared\nline3\n", "base", &[]);
        let base = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("theirs", &base, false).unwrap();
        checkout_branch(repo, "theirs");
        commit_file(
            repo,
            dir,
            "file.txt",
            "line1\ntheir change\nline3\n",
            "their change",
            &[&base],
        );

        checkout_branch(repo, &current_branch);
        commit_file(
            repo,
            dir,
            "file.txt",
            "line1\nour change\nline3\n",
            "our change",
            &[&base],
        );

        "theirs".to_string()
    }

    /// Both branches add a brand-new file at the same path with different
    /// content — no common ancestor entry, so this is an AddAdd conflict.
    fn make_add_add_conflict(dir: &TempDir, repo: &Repository) -> String {
        let base_oid = commit_file(repo, dir, "base.txt", "base\n", "base", &[]);
        let base = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("theirs", &base, false).unwrap();
        checkout_branch(repo, "theirs");
        commit_file(
            repo,
            dir,
            "new.txt",
            "their version\n",
            "their add",
            &[&base],
        );

        checkout_branch(repo, &current_branch);
        commit_file(repo, dir, "new.txt", "our version\n", "our add", &[&base]);

        "theirs".to_string()
    }

    /// We delete file.txt, they modify it — DeleteModify conflict
    /// (ancestor present, ours missing, theirs present).
    fn make_delete_modify_conflict(dir: &TempDir, repo: &Repository) -> String {
        let base_oid = commit_file(repo, dir, "file.txt", "content\n", "base", &[]);
        let base = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("theirs", &base, false).unwrap();
        checkout_branch(repo, "theirs");
        commit_file(
            repo,
            dir,
            "file.txt",
            "their modification\n",
            "their modify",
            &[&base],
        );

        checkout_branch(repo, &current_branch);
        delete_file_commit(repo, dir, "file.txt", "our delete", &[&base]);

        "theirs".to_string()
    }

    /// We modify file.txt, they delete it — ModifyDelete conflict
    /// (ancestor present, ours present, theirs missing).
    fn make_modify_delete_conflict(dir: &TempDir, repo: &Repository) -> String {
        let base_oid = commit_file(repo, dir, "file.txt", "content\n", "base", &[]);
        let base = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("theirs", &base, false).unwrap();
        checkout_branch(repo, "theirs");
        delete_file_commit(repo, dir, "file.txt", "their delete", &[&base]);

        checkout_branch(repo, &current_branch);
        commit_file(
            repo,
            dir,
            "file.txt",
            "our modification\n",
            "our modify",
            &[&base],
        );

        "theirs".to_string()
    }

    /// Both branches modify the same binary file (content includes a NUL
    /// byte so `Blob::is_binary()` reliably detects it) — should be
    /// classified as BinaryOrUnmergeable, not NormalEdit.
    fn make_binary_conflict(dir: &TempDir, repo: &Repository) -> String {
        let base: &[u8] = &[0u8, 1, 2, 3, 0, 5];
        let ours: &[u8] = &[0u8, 1, 9, 9, 0, 5];
        let theirs: &[u8] = &[0u8, 8, 8, 3, 0, 5];

        let base_oid = commit_file(repo, dir, "image.bin", base, "base", &[]);
        let base_commit = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("theirs", &base_commit, false).unwrap();
        checkout_branch(repo, "theirs");
        commit_file(
            repo,
            dir,
            "image.bin",
            theirs,
            "their change",
            &[&base_commit],
        );

        checkout_branch(repo, &current_branch);
        commit_file(repo, dir, "image.bin", ours, "our change", &[&base_commit]);

        "theirs".to_string()
    }

    /// Same shape as `make_conflicting_branches` but with CRLF line endings
    /// throughout — pins down the known CRLF round-tripping risk noted in
    /// other modules' tests (see `working_tree`/`stash` `normalise` helpers).
    fn make_crlf_conflict(dir: &TempDir, repo: &Repository) -> String {
        let base_oid = commit_file(
            repo,
            dir,
            "file.txt",
            "line1\r\nshared\r\nline3\r\n",
            "base",
            &[],
        );
        let base = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("theirs", &base, false).unwrap();
        checkout_branch(repo, "theirs");
        commit_file(
            repo,
            dir,
            "file.txt",
            "line1\r\ntheir change\r\nline3\r\n",
            "their change",
            &[&base],
        );

        checkout_branch(repo, &current_branch);
        commit_file(
            repo,
            dir,
            "file.txt",
            "line1\r\nour change\r\nline3\r\n",
            "our change",
            &[&base],
        );

        "theirs".to_string()
    }

    // ---- start_merge ----

    #[test]
    fn start_merge_with_conflicting_changes_returns_conflicts() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);

        let outcome = start_merge(&mut repo, &branch).unwrap();

        match outcome {
            MergeOutcome::Conflicts { conflicts } => {
                assert_eq!(conflicts.len(), 1);
                assert_eq!(conflicts[0].path, "file.txt");
                assert_eq!(conflicts[0].kind, ConflictKind::NormalEdit);
            }
            MergeOutcome::Clean => panic!("expected conflicts, got a clean merge"),
        }
    }

    #[test]
    fn start_merge_with_independent_changes_returns_clean() {
        let (dir, mut repo) = init_repo();
        let base_oid = commit_file(&repo, &dir, "a.txt", "a\n", "base", &[]);
        let base = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("feature", &base, false).unwrap();
        checkout_branch(&repo, "feature");
        commit_file(&repo, &dir, "b.txt", "b\n", "add b", &[&base]);
        drop(base);
        checkout_branch(&repo, &current_branch);

        let outcome = start_merge(&mut repo, "feature").unwrap();
        assert!(matches!(outcome, MergeOutcome::Clean));
    }

    #[test]
    fn start_merge_unknown_branch_returns_error() {
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "a.txt", "a\n", "base", &[]);

        let result = start_merge(&mut repo, "does-not-exist");
        assert!(result.is_err());
    }

    // ---- collect_conflicts / classification / seeding ----

    #[test]
    fn collect_conflicts_normal_edit_includes_blobs_seed_and_blocks() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let conflicts = collect_conflicts(&repo).unwrap();
        assert_eq!(conflicts.len(), 1);
        let file = &conflicts[0];

        assert_eq!(file.kind, ConflictKind::NormalEdit);
        assert_eq!(
            file.ours_content.as_deref(),
            Some("line1\nour change\nline3\n")
        );
        assert_eq!(
            file.theirs_content.as_deref(),
            Some("line1\ntheir change\nline3\n")
        );
        assert_eq!(file.base_content.as_deref(), Some("line1\nshared\nline3\n"));

        let seeded = file
            .seeded_result
            .as_ref()
            .expect("seeded result for text conflict");
        assert!(seeded.contains("<<<<<<<"));
        assert!(seeded.contains("======="));
        assert!(seeded.contains(">>>>>>>"));

        assert_eq!(file.conflict_blocks.len(), 1);
        let block = &file.conflict_blocks[0];
        assert_eq!(block.ours_text.trim(), "our change");
        assert_eq!(block.theirs_text.trim(), "their change");
        assert!(block.start_line < block.mid_line);
        assert!(block.mid_line < block.end_line);
    }

    #[test]
    fn collect_conflicts_classifies_add_add() {
        let (dir, mut repo) = init_repo();
        let branch = make_add_add_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let conflicts = collect_conflicts(&repo).unwrap();
        let file = conflicts
            .iter()
            .find(|f| f.path == "new.txt")
            .expect("new.txt conflict");

        assert_eq!(file.kind, ConflictKind::AddAdd);
        assert!(file.base_content.is_none());
        assert!(file.ours_content.is_some());
        assert!(file.theirs_content.is_some());
        assert!(file.seeded_result.is_none());
        assert!(file.conflict_blocks.is_empty());
    }

    #[test]
    fn collect_conflicts_classifies_delete_modify() {
        let (dir, mut repo) = init_repo();
        let branch = make_delete_modify_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let conflicts = collect_conflicts(&repo).unwrap();
        let file = &conflicts[0];

        assert_eq!(file.kind, ConflictKind::DeleteModify);
        assert!(file.ours_content.is_none());
        assert!(file.theirs_content.is_some());
        assert!(file.base_content.is_some());
        assert!(file.seeded_result.is_none());
    }

    #[test]
    fn collect_conflicts_classifies_modify_delete() {
        let (dir, mut repo) = init_repo();
        let branch = make_modify_delete_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let conflicts = collect_conflicts(&repo).unwrap();
        let file = &conflicts[0];

        assert_eq!(file.kind, ConflictKind::ModifyDelete);
        assert!(file.ours_content.is_some());
        assert!(file.theirs_content.is_none());
        assert!(file.base_content.is_some());
        assert!(file.seeded_result.is_none());
    }

    #[test]
    fn collect_conflicts_classifies_binary_as_unmergeable() {
        let (dir, mut repo) = init_repo();
        let branch = make_binary_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let conflicts = collect_conflicts(&repo).unwrap();
        let file = &conflicts[0];

        assert_eq!(file.kind, ConflictKind::BinaryOrUnmergeable);
        assert!(
            file.ours_content.is_none(),
            "binary content should not be surfaced as text"
        );
        assert!(file.theirs_content.is_none());
        assert!(file.seeded_result.is_none());
        assert!(file.conflict_blocks.is_empty());
    }

    #[test]
    fn collect_conflicts_preserves_crlf_line_endings() {
        let (dir, mut repo) = init_repo();
        let branch = make_crlf_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let conflicts = collect_conflicts(&repo).unwrap();
        let file = &conflicts[0];

        assert_eq!(
            file.ours_content.as_deref(),
            Some("line1\r\nour change\r\nline3\r\n")
        );
        assert_eq!(
            file.theirs_content.as_deref(),
            Some("line1\r\ntheir change\r\nline3\r\n")
        );
        assert_eq!(
            file.base_content.as_deref(),
            Some("line1\r\nshared\r\nline3\r\n")
        );
    }

    // ---- parse_conflict_blocks ----

    #[test]
    fn parse_conflict_blocks_finds_single_block_with_correct_line_numbers() {
        let text =
            "line1\n<<<<<<< ours\nour change\n=======\ntheir change\n>>>>>>> theirs\nline3\n";

        let blocks = parse_conflict_blocks(text);

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].start_line, 2);
        assert_eq!(blocks[0].mid_line, 4);
        assert_eq!(blocks[0].end_line, 6);
        assert_eq!(blocks[0].ours_text, "our change\n");
        assert_eq!(blocks[0].theirs_text, "their change\n");
    }

    #[test]
    fn parse_conflict_blocks_finds_multiple_blocks_in_one_file() {
        let text = "<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\nmiddle\n<<<<<<< ours\nc\n=======\nd\n>>>>>>> theirs\n";

        let blocks = parse_conflict_blocks(text);

        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].ours_text, "a\n");
        assert_eq!(blocks[0].theirs_text, "b\n");
        assert_eq!(blocks[1].ours_text, "c\n");
        assert_eq!(blocks[1].theirs_text, "d\n");
        assert!(blocks[0].end_line < blocks[1].start_line);
    }

    #[test]
    fn parse_conflict_blocks_ignores_unterminated_markers() {
        let text = "<<<<<<< ours\nincomplete, no closing markers\n";

        assert!(parse_conflict_blocks(text).is_empty());
    }

    #[test]
    fn parse_conflict_blocks_returns_empty_for_clean_text() {
        let text = "no markers here\njust ordinary text\n";

        assert!(parse_conflict_blocks(text).is_empty());
    }

    // ---- write_resolution ----

    #[test]
    fn write_resolution_stages_content_and_clears_the_conflict() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();
        assert!(repo.index().unwrap().has_conflicts());

        write_resolution(&repo, "file.txt", "line1\nresolved\nline3\n").unwrap();

        assert!(!repo.index().unwrap().has_conflicts());
        let content = fs::read_to_string(dir.path().join("file.txt")).unwrap();
        assert_eq!(content, "line1\nresolved\nline3\n");
    }

    #[test]
    fn write_resolution_round_trips_crlf_bytes_exactly() {
        let (dir, mut repo) = init_repo();
        let branch = make_crlf_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        write_resolution(&repo, "file.txt", "line1\r\nresolved\r\nline3\r\n").unwrap();

        let bytes = fs::read(dir.path().join("file.txt")).unwrap();
        assert_eq!(bytes, b"line1\r\nresolved\r\nline3\r\n");
        assert!(!repo.index().unwrap().has_conflicts());
    }

    #[test]
    fn write_resolution_rejects_a_path_with_no_conflict() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        // "file.txt" is the only real conflict; a path outside the repo (or
        // any path not in the conflict set) must be rejected before anything
        // is written to disk.
        let outside = TempDir::new().unwrap();
        let evil = outside.path().join("evil.txt");

        let result = write_resolution(&repo, evil.to_str().unwrap(), "pwned");

        assert!(result.is_err());
        assert!(
            !evil.exists(),
            "no file should have been written outside the repo"
        );
    }

    // ---- resolve_with_side / resolve_with_deletion ----

    #[test]
    fn resolve_with_side_keeps_ours_for_an_add_add_conflict() {
        let (dir, mut repo) = init_repo();
        let branch = make_add_add_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();
        assert!(repo.index().unwrap().has_conflicts());

        resolve_with_side(&repo, "new.txt", ConflictSide::Ours).unwrap();

        assert!(!repo.index().unwrap().has_conflicts());
        let content = fs::read_to_string(dir.path().join("new.txt")).unwrap();
        assert_eq!(content, "our version\n");
    }

    #[test]
    fn resolve_with_side_keeps_theirs_for_an_add_add_conflict() {
        let (dir, mut repo) = init_repo();
        let branch = make_add_add_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        resolve_with_side(&repo, "new.txt", ConflictSide::Theirs).unwrap();

        assert!(!repo.index().unwrap().has_conflicts());
        let content = fs::read_to_string(dir.path().join("new.txt")).unwrap();
        assert_eq!(content, "their version\n");
    }

    /// Binary content can't round-trip through `write_resolution` (which takes
    /// `&str`) — `resolve_with_side` must copy the chosen side's blob bytes
    /// verbatim instead of relying on `ConflictedFile::*_content` (which is
    /// `None` for binary blobs).
    #[test]
    fn resolve_with_side_writes_raw_bytes_for_a_binary_conflict() {
        let (dir, mut repo) = init_repo();
        let branch = make_binary_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        resolve_with_side(&repo, "image.bin", ConflictSide::Theirs).unwrap();

        assert!(!repo.index().unwrap().has_conflicts());
        let bytes = fs::read(dir.path().join("image.bin")).unwrap();
        assert_eq!(bytes, vec![0u8, 8, 8, 3, 0, 5]);
    }

    #[test]
    fn resolve_with_side_fails_when_the_chosen_side_does_not_exist() {
        let (dir, mut repo) = init_repo();
        let branch = make_delete_modify_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let result = resolve_with_side(&repo, "file.txt", ConflictSide::Ours);
        assert!(result.is_err());
    }

    #[test]
    fn resolve_with_deletion_removes_the_file_and_clears_the_conflict() {
        let (dir, mut repo) = init_repo();
        let branch = make_modify_delete_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();
        assert!(repo.index().unwrap().has_conflicts());

        resolve_with_deletion(&repo, "file.txt").unwrap();

        assert!(!repo.index().unwrap().has_conflicts());
        assert!(!dir.path().join("file.txt").exists());
        assert!(repo
            .index()
            .unwrap()
            .get_path(Path::new("file.txt"), 0)
            .is_none());
    }

    #[test]
    fn resolve_with_deletion_fails_for_a_path_with_no_conflict() {
        let (dir, mut repo) = init_repo();
        let branch = make_modify_delete_conflict(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let result = resolve_with_deletion(&repo, "does-not-exist.txt");
        assert!(result.is_err());
    }

    // ---- complete_merge ----

    #[test]
    fn complete_merge_fails_while_conflicts_remain() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        start_merge(&mut repo, &branch).unwrap();

        let result = complete_merge(&mut repo, "merge theirs into current");
        assert!(result.is_err());
    }

    #[test]
    fn complete_merge_creates_two_parent_commit_and_cleans_up_state() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let head_before = repo.head().unwrap().peel_to_commit().unwrap().id();
        start_merge(&mut repo, &branch).unwrap();
        write_resolution(&repo, "file.txt", "line1\nresolved\nline3\n").unwrap();

        let oid_str = complete_merge(&mut repo, "merge theirs into current").unwrap();

        let commit = repo
            .find_commit(git2::Oid::from_str(&oid_str).unwrap())
            .unwrap();
        assert_eq!(commit.parent_count(), 2);
        assert_eq!(commit.parent_id(0).unwrap(), head_before);
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert!(repo.find_reference("MERGE_HEAD").is_err());
        assert!(!repo.index().unwrap().has_conflicts());
    }

    // ---- abort_merge ----

    #[test]
    fn abort_merge_restores_pre_merge_head_and_working_tree() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let head_before = repo.head().unwrap().peel_to_commit().unwrap().id();
        start_merge(&mut repo, &branch).unwrap();

        abort_merge(&mut repo).unwrap();

        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert_eq!(
            repo.head().unwrap().peel_to_commit().unwrap().id(),
            head_before
        );
        assert!(!repo.index().unwrap().has_conflicts());
        let content = fs::read_to_string(dir.path().join("file.txt")).unwrap();
        assert_eq!(content, "line1\nour change\nline3\n");
    }

    #[test]
    fn abort_merge_preserves_uncommitted_edits_to_files_the_merge_did_not_touch() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        // Add "other.txt" as a further commit on the current branch, after the
        // branches diverge — present on our side, absent from "theirs" and the
        // base, so the merge doesn't touch it at all. "file.txt" is the file
        // that actually conflicts.
        {
            let head_before = repo.head().unwrap().peel_to_commit().unwrap();
            commit_file(
                &repo,
                &dir,
                "other.txt",
                "untouched\n",
                "add other",
                &[&head_before],
            );
        }

        start_merge(&mut repo, &branch).unwrap();
        assert!(repo.index().unwrap().has_conflicts());

        // Dirty an unrelated, non-conflicting file mid-merge — libgit2's
        // merge() allows this (it only refuses when the dirty file collides
        // with the merge itself), so this is a reachable state, not a
        // contrived one.
        fs::write(dir.path().join("other.txt"), "local edit\n").unwrap();

        abort_merge(&mut repo).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("other.txt")).unwrap(),
            "local edit\n",
            "git merge --abort (reset --merge) must not touch files the merge didn't touch"
        );
        assert!(!repo.index().unwrap().has_conflicts());
    }
}
