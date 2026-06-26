use anyhow::Context;
use git2::{Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeStatus {
    pub staged: Vec<StatusEntry>,
    pub unstaged: Vec<StatusEntry>,
    pub untracked: Vec<StatusEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub original_path: Option<String>,
    pub status: StatusCode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StatusCode {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub index: usize,
    pub header: String,
    pub content: String,
    pub old_start: u32,
    pub new_start: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffHunks {
    pub path: String,
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: String,
    pub email: String,
}

/// The two sides of a file's pending change, for the line-level staging editor:
/// `head_content` is the committed (HEAD) version, `worktree_content` is the
/// file on disk. The frontend computes the line alignment between them and lets
/// the user pick which changes land in the staged result. `is_binary` signals
/// the frontend to fall back to whole-file staging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageFileContents {
    pub head_content: String,
    pub worktree_content: String,
    pub is_binary: bool,
    /// Whether the file still exists on disk. False means a deletion (the editor
    /// falls back to whole-file staging rather than writing an empty blob).
    pub worktree_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadCommitInfo {
    pub oid: String,
    pub message: String,
    /// Whether HEAD is already contained in a remote-tracking branch — i.e. it
    /// has been pushed. Amending a pushed commit rewrites shared history, so the
    /// UI guards the amend affordance behind this flag.
    pub pushed: bool,
}

pub fn get_working_tree_status(repo: &Repository) -> anyhow::Result<WorkingTreeStatus> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    let statuses = repo.statuses(Some(&mut opts)).context("failed to get repository status")?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        // Staged changes (index)
        if s.is_index_new() {
            staged.push(StatusEntry { path: path.clone(), original_path: None, status: StatusCode::Added });
        } else if s.is_index_modified() {
            staged.push(StatusEntry { path: path.clone(), original_path: None, status: StatusCode::Modified });
        } else if s.is_index_deleted() {
            staged.push(StatusEntry { path: path.clone(), original_path: None, status: StatusCode::Deleted });
        } else if s.is_index_renamed() {
            let old = entry.head_to_index()
                .and_then(|d| d.old_file().path().and_then(|p| p.to_str()).map(|s| s.to_string()));
            staged.push(StatusEntry { path: path.clone(), original_path: old, status: StatusCode::Renamed });
        }

        // Unstaged / untracked changes (working tree)
        if s.is_wt_new() {
            untracked.push(StatusEntry { path: path.clone(), original_path: None, status: StatusCode::Added });
        } else if s.is_wt_modified() {
            unstaged.push(StatusEntry { path: path.clone(), original_path: None, status: StatusCode::Modified });
        } else if s.is_wt_deleted() {
            unstaged.push(StatusEntry { path: path.clone(), original_path: None, status: StatusCode::Deleted });
        } else if s.is_wt_renamed() {
            unstaged.push(StatusEntry { path: path.clone(), original_path: None, status: StatusCode::Renamed });
        }
    }

    Ok(WorkingTreeStatus { staged, unstaged, untracked })
}

pub fn stage_file(repo: &Repository, path: &str) -> anyhow::Result<WorkingTreeStatus> {
    let mut index = repo.index().context("failed to get index")?;
    let workdir = repo.workdir().context("bare repository has no working directory")?;
    if workdir.join(path).exists() {
        index.add_path(Path::new(path))
            .with_context(|| format!("failed to stage: {path}"))?;
    } else {
        // The file is gone from the working tree: stage its deletion. add_path
        // can't do this (there's nothing on disk to add), so remove the index
        // entry instead.
        index.remove_path(Path::new(path))
            .with_context(|| format!("failed to stage deletion: {path}"))?;
    }
    index.write().context("failed to write index")?;
    get_working_tree_status(repo)
}

pub fn unstage_file(repo: &Repository, path: &str) -> anyhow::Result<WorkingTreeStatus> {
    let in_head = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().context("HEAD is not a commit")?;
            let tree = commit.tree().context("HEAD commit has no tree")?;
            tree.get_path(Path::new(path)).is_ok()
        }
        Err(_) => false, // no HEAD yet (initial repo)
    };

    if in_head {
        // Modified or deleted: reset the index entry back to HEAD
        let head = repo.head()?.peel_to_commit().context("HEAD is not a commit")?;
        repo.reset_default(Some(head.as_object()), std::iter::once(path))
            .with_context(|| format!("failed to unstage: {path}"))?;
    } else {
        // New file: just remove from index
        let mut index = repo.index().context("failed to get index")?;
        index.remove_path(Path::new(path))
            .with_context(|| format!("failed to remove from index: {path}"))?;
        index.write().context("failed to write index")?;
    }

    get_working_tree_status(repo)
}

/// Read the HEAD-blob and working-tree content for `path`, for the line-level
/// staging editor. `head_content` is empty when the path isn't in HEAD (a newly
/// added file). Marks `is_binary` when either side contains a NUL byte so the
/// frontend can fall back to whole-file staging.
pub fn get_stage_file_contents(repo: &Repository, path: &str) -> anyhow::Result<StageFileContents> {
    let workdir = repo.workdir().context("bare repository has no working directory")?;
    let full_path = workdir.join(path);
    let worktree_exists = full_path.is_file();
    let worktree_bytes = std::fs::read(&full_path).unwrap_or_default();

    let head_bytes = match repo.head() {
        Ok(head) => {
            let tree = head.peel_to_tree().context("HEAD has no tree")?;
            match tree.get_path(Path::new(path)) {
                Ok(entry) => repo
                    .find_blob(entry.id())
                    .context("HEAD entry is not a blob")?
                    .content()
                    .to_vec(),
                Err(_) => Vec::new(),
            }
        }
        Err(_) => Vec::new(),
    };

    let is_binary = head_bytes.contains(&0) || worktree_bytes.contains(&0);

    Ok(StageFileContents {
        head_content: String::from_utf8_lossy(&head_bytes).into_owned(),
        worktree_content: String::from_utf8_lossy(&worktree_bytes).into_owned(),
        is_binary,
        worktree_exists,
    })
}

/// Read the parent-blob and commit-blob content for `path` at commit `oid_str`,
/// for the read-only commit diff viewer — the same surface as the line-level
/// staging editor, so this reuses `StageFileContents`: `head_content` carries the
/// parent (before) version and `worktree_content` the version in this commit
/// (after). For a rename, `old_path` names the file in the parent. The diff is
/// against the first parent; a root commit has no parent, so its files read as
/// all-added. `worktree_exists` is false when the
/// commit deletes the file. `is_binary` marks a NUL on either side so the
/// frontend skips line rendering.
pub fn get_commit_file_contents(
    repo: &Repository,
    oid_str: &str,
    path: &str,
    old_path: Option<&str>,
) -> anyhow::Result<StageFileContents> {
    let oid = git2::Oid::from_str(oid_str).context("invalid OID")?;
    let commit = repo.find_commit(oid).context("commit not found")?;
    let commit_tree = commit.tree().context("commit has no tree")?;
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let read_blob = |tree: Option<&git2::Tree>, p: &str| -> Vec<u8> {
        let Some(tree) = tree else { return Vec::new() };
        match tree.get_path(Path::new(p)) {
            Ok(entry) => repo
                .find_blob(entry.id())
                .map(|b| b.content().to_vec())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };

    let parent_bytes = read_blob(parent_tree.as_ref(), old_path.unwrap_or(path));
    let commit_bytes = read_blob(Some(&commit_tree), path);

    let worktree_exists = commit_tree.get_path(Path::new(path)).is_ok();
    let is_binary = parent_bytes.contains(&0) || commit_bytes.contains(&0);

    Ok(StageFileContents {
        head_content: String::from_utf8_lossy(&parent_bytes).into_owned(),
        worktree_content: String::from_utf8_lossy(&commit_bytes).into_owned(),
        is_binary,
        worktree_exists,
    })
}

/// Stage exactly `content` for `path`: write it as a blob and point the index
/// entry at it, preserving the existing file mode. This is how the line-level
/// staging editor persists its (possibly hand-edited) result buffer — the buffer
/// is the source of truth, mirroring the merge editor's result pane.
///
/// NOTE: writing the blob directly bypasses git's clean filters (autocrlf,
/// `.gitattributes` filters). Acceptable for v1; revisit if it causes trouble.
pub fn stage_file_content(repo: &Repository, path: &str, content: &str) -> anyhow::Result<WorkingTreeStatus> {
    let mut index = repo.index().context("failed to get index")?;

    // Preserve the current index entry's mode where present; otherwise use a
    // regular non-executable blob mode.
    let mode = index.get_path(Path::new(path), 0).map(|e| e.mode).unwrap_or(0o100644);

    let entry = git2::IndexEntry {
        ctime: git2::IndexTime::new(0, 0),
        mtime: git2::IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: 0,
        id: git2::Oid::zero(),
        flags: 0,
        flags_extended: 0,
        path: path.as_bytes().to_vec(),
    };
    index
        .add_frombuffer(&entry, content.as_bytes())
        .with_context(|| format!("failed to stage content for {path}"))?;
    index.write().context("failed to write index")?;

    get_working_tree_status(repo)
}

pub fn discard_file(repo: &Repository, path: &str) -> anyhow::Result<WorkingTreeStatus> {
    let workdir = repo.workdir().context("bare repository has no working directory")?;
    let full_path = workdir.join(path);

    // Check if file is tracked (exists in HEAD)
    let in_head = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit()?;
            let tree = commit.tree()?;
            tree.get_path(Path::new(path)).is_ok()
        }
        Err(_) => false,
    };

    if in_head {
        let mut co = git2::build::CheckoutBuilder::new();
        co.force().path(path);
        repo.checkout_head(Some(&mut co))
            .with_context(|| format!("failed to discard: {path}"))?;
    } else {
        // Untracked: delete from disk
        std::fs::remove_file(&full_path)
            .with_context(|| format!("failed to delete untracked file: {path}"))?;
    }

    get_working_tree_status(repo)
}

/// Discard every working-tree change: reset tracked files (staged and unstaged)
/// back to HEAD and remove all untracked files. Destructive — the frontend
/// guards this behind a confirmation dialog.
pub fn discard_all(repo: &Repository) -> anyhow::Result<WorkingTreeStatus> {
    match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().context("HEAD is not a commit")?;
            repo.reset(commit.as_object(), git2::ResetType::Hard, None)
                .context("failed to reset working tree to HEAD")?;
        }
        Err(_) => {
            // Unborn branch (no commits yet): clear the index entirely.
            let mut index = repo.index().context("failed to get index")?;
            index.clear().context("failed to clear index")?;
            index.write().context("failed to write index")?;
        }
    }

    // A hard reset leaves untracked files in place, so remove them explicitly.
    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?
        .to_path_buf();
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).context("failed to get repository status")?;
    for entry in statuses.iter() {
        if entry.status().is_wt_new() {
            if let Some(path) = entry.path() {
                let full = workdir.join(path);
                if full.is_file() {
                    std::fs::remove_file(&full)
                        .with_context(|| format!("failed to delete untracked file: {path}"))?;
                }
            }
        }
    }

    get_working_tree_status(repo)
}

enum DiffKind { Unstaged, Staged }

fn build_hunk_patch(repo: &Repository, path: &str, hunk_index: usize, kind: DiffKind) -> anyhow::Result<String> {
    let hunks = match kind {
        DiffKind::Unstaged => crate::diff_engine::get_unstaged_diff(repo, path)?.hunks,
        DiffKind::Staged => crate::diff_engine::get_staged_diff(repo, path)?.hunks,
    };
    let hunk = hunks.into_iter().find(|h| h.index == hunk_index)
        .ok_or_else(|| anyhow::anyhow!("hunk index {hunk_index} out of range"))?;

    // Build minimal unified diff patch: file header + single hunk
    let patch = format!(
        "--- a/{path}\n+++ b/{path}\n{}",
        hunk.content
    );
    Ok(patch)
}

fn git_apply(workdir: &std::path::Path, patch: &str, flags: &[&str]) -> anyhow::Result<()> {
    use std::io::Write;
    let mut child = std::process::Command::new("git")
        .arg("apply")
        .args(flags)
        .current_dir(workdir)
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("failed to spawn git apply")?;
    child.stdin.take().unwrap().write_all(patch.as_bytes())
        .context("failed to write patch to git apply stdin")?;
    let output = child.wait_with_output().context("git apply failed to run")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git apply failed: {stderr}");
    }
    Ok(())
}

pub fn stage_hunk(repo: &Repository, path: &str, hunk_index: usize) -> anyhow::Result<()> {
    let workdir = repo.workdir().context("bare repository has no working directory")?;
    let patch = build_hunk_patch(repo, path, hunk_index, DiffKind::Unstaged)?;
    git_apply(workdir, &patch, &["--cached"])
}

pub fn unstage_hunk(repo: &Repository, path: &str, hunk_index: usize) -> anyhow::Result<()> {
    let workdir = repo.workdir().context("bare repository has no working directory")?;
    let patch = build_hunk_patch(repo, path, hunk_index, DiffKind::Staged)?;
    git_apply(workdir, &patch, &["--cached", "--reverse"])
}

pub fn discard_hunk(repo: &Repository, path: &str, hunk_index: usize) -> anyhow::Result<()> {
    let workdir = repo.workdir().context("bare repository has no working directory")?;
    let patch = build_hunk_patch(repo, path, hunk_index, DiffKind::Unstaged)?;
    git_apply(workdir, &patch, &["--reverse"])
}

pub fn create_commit(repo: &Repository, message: &str) -> anyhow::Result<String> {
    let sig = repo.signature().context(
        "Git user identity not configured. Set user.name and user.email in your .gitconfig."
    )?;
    let mut index = repo.index().context("failed to get index")?;
    let tree_id = index.write_tree().context("failed to write tree — nothing staged to commit")?;
    let tree = repo.find_tree(tree_id).context("failed to find tree")?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .context("failed to create commit")?;
    // The message is user content, so it's not logged — just the identity of the
    // new commit and whether it had a parent.
    log::info!(
        target: "git",
        "commit: created {oid} ({} parent)",
        parents.len()
    );
    Ok(oid.to_string())
}

/// True if HEAD is reachable from any remote-tracking branch, meaning the commit
/// has already been pushed. Returns false for an unborn branch (no HEAD yet).
pub fn head_commit_is_pushed(repo: &Repository) -> anyhow::Result<bool> {
    let head_oid = match repo.head() {
        Ok(head) => head.peel_to_commit().context("HEAD is not a commit")?.id(),
        Err(_) => return Ok(false),
    };

    for branch in repo.branches(Some(git2::BranchType::Remote))? {
        let (branch, _) = branch?;
        if let Some(target) = branch.get().target() {
            // The remote contains HEAD if its tip *is* HEAD or descends from it.
            if target == head_oid || repo.graph_descendant_of(target, head_oid)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Details of the tip commit, or `None` on an unborn branch. Used to prefill and
/// gate the "amend last commit" affordance.
pub fn head_commit_info(repo: &Repository) -> anyhow::Result<Option<HeadCommitInfo>> {
    let commit = match repo.head() {
        Ok(head) => head.peel_to_commit().context("HEAD is not a commit")?,
        Err(_) => return Ok(None),
    };
    Ok(Some(HeadCommitInfo {
        oid: commit.id().to_string(),
        message: commit.message().unwrap_or_default().to_string(),
        pushed: head_commit_is_pushed(repo)?,
    }))
}

/// Rewrite the tip commit's message, keeping its tree, parents and author
/// intact. Refuses if the commit has already been pushed (would rewrite shared
/// history). Staged changes are deliberately *not* folded in — this amends the
/// message only. Returns the new commit's oid.
pub fn amend_commit_message(repo: &Repository, message: &str) -> anyhow::Result<String> {
    if head_commit_is_pushed(repo)? {
        anyhow::bail!("Cannot amend a commit that has already been pushed to a remote.");
    }
    let head = repo
        .head()
        .context("no commit to amend")?
        .peel_to_commit()
        .context("HEAD is not a commit")?;
    let oid = head
        .amend(Some("HEAD"), None, None, None, Some(message), None)
        .context("failed to amend commit message")?;
    Ok(oid.to_string())
}

pub fn get_commit_identity(repo: &Repository) -> anyhow::Result<Identity> {
    let config = repo.config().context("failed to read git config")?;
    Ok(Identity {
        name: config.get_string("user.name").unwrap_or_default(),
        email: config.get_string("user.email").unwrap_or_default(),
    })
}

/// The git identity at each relevant level: the `effective` identity (what a
/// commit here would use), plus the repo-`local` and `global` overrides when set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityConfig {
    pub effective: Identity,
    pub local: Option<Identity>,
    pub global: Option<Identity>,
}

/// Read `user.name`/`user.email` from a single config level. Returns `None` when
/// neither is set at that level (so the UI can show "not set" rather than blanks).
fn read_level_identity(config: &git2::Config, level: git2::ConfigLevel) -> Option<Identity> {
    let snapshot = config.open_level(level).ok()?;
    let name = snapshot.get_string("user.name").ok();
    let email = snapshot.get_string("user.email").ok();
    if name.is_none() && email.is_none() {
        return None;
    }
    Some(Identity { name: name.unwrap_or_default(), email: email.unwrap_or_default() })
}

pub fn get_identity_config(repo: &Repository) -> anyhow::Result<IdentityConfig> {
    let config = repo.config().context("failed to read git config")?;
    let effective = Identity {
        name: config.get_string("user.name").unwrap_or_default(),
        email: config.get_string("user.email").unwrap_or_default(),
    };
    let local = read_level_identity(&config, git2::ConfigLevel::Local);
    // git's "global" is XDG (~/.config/git/config) overlaid by ~/.gitconfig.
    let global = read_level_identity(&config, git2::ConfigLevel::Global)
        .or_else(|| read_level_identity(&config, git2::ConfigLevel::XDG));
    Ok(IdentityConfig { effective, local, global })
}

/// Write `user.name`/`user.email` into the given config (a single level).
fn write_identity(config: &mut git2::Config, name: &str, email: &str) -> anyhow::Result<()> {
    config.set_str("user.name", name).context("failed to set user.name")?;
    config.set_str("user.email", email).context("failed to set user.email")?;
    Ok(())
}

/// Open the writable global git config, creating `~/.gitconfig` if no global
/// config file exists yet (so a first-time "set global identity" doesn't fail).
fn open_writable_global() -> anyhow::Result<git2::Config> {
    if let Ok(cfg) = git2::Config::open_default() {
        if let Ok(global) = cfg.open_level(git2::ConfigLevel::Global) {
            return Ok(global);
        }
    }
    let home = dirs::home_dir().context("could not determine home directory")?;
    let path = home.join(".gitconfig");
    if !path.exists() {
        std::fs::File::create(&path).context("failed to create global git config")?;
    }
    git2::Config::open(&path).context("failed to open global git config")
}

/// Set the commit identity at the repo-local (`global = false`) or global level,
/// then return the refreshed config.
pub fn set_identity(
    repo: &Repository,
    name: &str,
    email: &str,
    global: bool,
) -> anyhow::Result<IdentityConfig> {
    log::info!(target: "git", "identity: set ({} scope)", if global { "global" } else { "local" });
    if global {
        let mut cfg = open_writable_global()?;
        write_identity(&mut cfg, name, email)?;
    } else {
        let cfg = repo.config().context("failed to read git config")?;
        let mut local = cfg
            .open_level(git2::ConfigLevel::Local)
            .context("repository has no local config")?;
        write_identity(&mut local, name, email)?;
    }
    get_identity_config(repo)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;
    use tempfile::TempDir;

    fn normalise(s: &str) -> String {
        s.replace("\r\n", "\n")
    }

    fn init_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        // Configure identity so commits work
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        (dir, repo)
    }

    fn make_initial_commit(repo: &Repository) -> git2::Oid {
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        let oid = repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();
        drop(tree);
        oid
    }

    fn write_and_stage(repo: &Repository, dir: &TempDir, name: &str, content: &str) {
        let path = dir.path().join(name);
        fs::write(&path, content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
    }

    #[test]
    fn clean_repo_returns_empty_status() {
        let (_dir, repo) = init_repo();
        make_initial_commit(&repo);
        let status = get_working_tree_status(&repo).unwrap();
        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        assert!(status.untracked.is_empty());
    }

    #[test]
    fn status_shows_untracked_file() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("new.txt"), "hello").unwrap();
        let status = get_working_tree_status(&repo).unwrap();
        assert!(status.untracked.iter().any(|e| e.path == "new.txt"));
    }

    #[test]
    fn status_shows_staged_new_file() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        write_and_stage(&repo, &dir, "staged.txt", "content");
        let status = get_working_tree_status(&repo).unwrap();
        assert!(status.staged.iter().any(|e| e.path == "staged.txt"));
        assert!(status.untracked.iter().all(|e| e.path != "staged.txt"));
    }

    #[test]
    fn status_shows_modified_unstaged() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original");
        make_initial_commit(&repo);
        // Now modify without staging
        fs::write(dir.path().join("file.txt"), "modified").unwrap();
        let status = get_working_tree_status(&repo).unwrap();
        assert!(status.unstaged.iter().any(|e| e.path == "file.txt"));
        assert!(status.staged.iter().all(|e| e.path != "file.txt"));
    }

    #[test]
    fn status_shows_both_staged_and_unstaged_for_same_file() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original");
        make_initial_commit(&repo);
        // Stage a change
        write_and_stage(&repo, &dir, "file.txt", "staged change");
        // Then modify again without staging
        fs::write(dir.path().join("file.txt"), "unstaged change").unwrap();
        let status = get_working_tree_status(&repo).unwrap();
        assert!(status.staged.iter().any(|e| e.path == "file.txt"));
        assert!(status.unstaged.iter().any(|e| e.path == "file.txt"));
    }

    #[test]
    fn stage_new_file_moves_to_staged() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("new.txt"), "content").unwrap();
        let status = stage_file(&repo, "new.txt").unwrap();
        assert!(status.staged.iter().any(|e| e.path == "new.txt"));
        assert!(status.untracked.iter().all(|e| e.path != "new.txt"));
    }

    #[test]
    fn stage_modified_file_moves_to_staged() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original");
        make_initial_commit(&repo);
        fs::write(dir.path().join("file.txt"), "modified").unwrap();
        let status = stage_file(&repo, "file.txt").unwrap();
        assert!(status.staged.iter().any(|e| e.path == "file.txt"));
        assert!(status.unstaged.iter().all(|e| e.path != "file.txt"));
    }

    #[test]
    fn stage_deleted_file_stages_the_deletion() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        make_initial_commit(&repo);
        // Delete the file from the working tree.
        fs::remove_file(dir.path().join("file.txt")).unwrap();

        let status = stage_file(&repo, "file.txt").unwrap();

        let staged = status.staged.iter().find(|e| e.path == "file.txt").expect("staged");
        assert!(matches!(staged.status, StatusCode::Deleted));
        assert!(status.unstaged.iter().all(|e| e.path != "file.txt"));
    }

    #[test]
    fn unstage_deleted_file_returns_it_to_unstaged() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        make_initial_commit(&repo);
        fs::remove_file(dir.path().join("file.txt")).unwrap();
        stage_file(&repo, "file.txt").unwrap();

        let status = unstage_file(&repo, "file.txt").unwrap();

        let unstaged = status.unstaged.iter().find(|e| e.path == "file.txt").expect("unstaged");
        assert!(matches!(unstaged.status, StatusCode::Deleted));
        assert!(status.staged.iter().all(|e| e.path != "file.txt"));
    }

    #[test]
    fn unstage_new_file_removes_from_index() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        write_and_stage(&repo, &dir, "new.txt", "content");
        let status_before = get_working_tree_status(&repo).unwrap();
        assert!(status_before.staged.iter().any(|e| e.path == "new.txt"));
        let status = unstage_file(&repo, "new.txt").unwrap();
        assert!(status.staged.iter().all(|e| e.path != "new.txt"));
        assert!(status.untracked.iter().any(|e| e.path == "new.txt"));
    }

    #[test]
    fn unstage_modified_file_restores_head_version() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original");
        make_initial_commit(&repo);
        write_and_stage(&repo, &dir, "file.txt", "modified");
        let status = unstage_file(&repo, "file.txt").unwrap();
        assert!(status.staged.iter().all(|e| e.path != "file.txt"));
        assert!(status.unstaged.iter().any(|e| e.path == "file.txt"));
    }

    #[test]
    fn discard_modified_file_restores_head_content() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original\n");
        make_initial_commit(&repo);
        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        discard_file(&repo, "file.txt").unwrap();
        let content = fs::read_to_string(dir.path().join("file.txt")).unwrap();
        assert_eq!(normalise(&content), "original\n");
    }

    #[test]
    fn discard_untracked_file_removes_it() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        let path = dir.path().join("untracked.txt");
        fs::write(&path, "content").unwrap();
        assert!(path.exists());
        discard_file(&repo, "untracked.txt").unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn discard_all_restores_modified_and_clears_staged() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original\n");
        make_initial_commit(&repo);
        // Stage one change and leave another unstaged.
        write_and_stage(&repo, &dir, "file.txt", "staged\n");
        fs::write(dir.path().join("file.txt"), "unstaged\n").unwrap();

        let status = discard_all(&repo).unwrap();

        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        let content = fs::read_to_string(dir.path().join("file.txt")).unwrap();
        assert_eq!(normalise(&content), "original\n");
    }

    #[test]
    fn discard_all_removes_untracked_files() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        let untracked = dir.path().join("untracked.txt");
        fs::write(&untracked, "junk").unwrap();
        // Also a staged-new file, which discard should drop too.
        write_and_stage(&repo, &dir, "added.txt", "new");

        let status = discard_all(&repo).unwrap();

        assert!(!untracked.exists());
        assert!(!dir.path().join("added.txt").exists());
        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        assert!(status.untracked.is_empty());
    }

    #[test]
    fn create_commit_with_staged_files_succeeds() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        let oid = create_commit(&repo, "test commit").unwrap();
        assert!(!oid.is_empty());
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), oid);
        assert_eq!(head.message().unwrap().trim(), "test commit");
    }

    #[test]
    fn create_commit_on_initial_repo_has_no_parent() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        let oid = create_commit(&repo, "initial commit").unwrap();
        assert!(!oid.is_empty());
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 0);
    }

    /// Point a remote-tracking ref (refs/remotes/origin/main) at `oid` to
    /// simulate that commit having been pushed.
    fn mark_pushed(repo: &Repository, oid: git2::Oid) {
        repo.reference("refs/remotes/origin/main", oid, true, "test push")
            .unwrap();
    }

    #[test]
    fn amend_changes_head_message_and_oid() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        let original = create_commit(&repo, "original message").unwrap();

        let new_oid = amend_commit_message(&repo, "amended message").unwrap();

        assert_ne!(new_oid, original);
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), new_oid);
        assert_eq!(head.message().unwrap(), "amended message");
    }

    #[test]
    fn amend_preserves_tree_parents_and_author() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "first.txt", "one");
        create_commit(&repo, "first").unwrap();
        write_and_stage(&repo, &dir, "second.txt", "two");
        let original_oid = create_commit(&repo, "second").unwrap();
        let original = repo.find_commit(original_oid.parse().unwrap()).unwrap();
        let original_tree = original.tree_id();
        let original_parent = original.parent_id(0).unwrap();
        let original_author = original.author().name().unwrap().to_string();

        amend_commit_message(&repo, "second (reworded)").unwrap();

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.tree_id(), original_tree);
        assert_eq!(head.parent_id(0).unwrap(), original_parent);
        assert_eq!(head.author().name().unwrap(), original_author);
    }

    #[test]
    fn amend_refuses_when_commit_is_pushed() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        let oid = create_commit(&repo, "pushed commit").unwrap();
        mark_pushed(&repo, oid.parse().unwrap());

        let err = amend_commit_message(&repo, "should fail").unwrap_err();
        assert!(err.to_string().contains("pushed"));
        // Message unchanged.
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.message().unwrap(), "pushed commit");
    }

    #[test]
    fn head_is_pushed_reflects_remote_tracking_branch() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        let oid = create_commit(&repo, "commit").unwrap();

        assert!(!head_commit_is_pushed(&repo).unwrap());
        mark_pushed(&repo, oid.parse().unwrap());
        assert!(head_commit_is_pushed(&repo).unwrap());
    }

    #[test]
    fn head_is_pushed_when_remote_is_ahead() {
        // A remote ref that descends from HEAD still contains HEAD.
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "one");
        let first = create_commit(&repo, "first").unwrap();
        write_and_stage(&repo, &dir, "file2.txt", "two");
        let second = create_commit(&repo, "second").unwrap();
        // Pretend the remote is at `second`, then reset local HEAD back to `first`.
        mark_pushed(&repo, second.parse().unwrap());
        let first_commit = repo.find_commit(first.parse().unwrap()).unwrap();
        repo.reset(first_commit.as_object(), git2::ResetType::Soft, None).unwrap();

        assert!(head_commit_is_pushed(&repo).unwrap());
    }

    #[test]
    fn head_commit_info_returns_message_and_pushed_flag() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "content");
        let oid = create_commit(&repo, "subject\n\nbody").unwrap();

        let info = head_commit_info(&repo).unwrap().expect("head commit");
        assert_eq!(info.oid, oid);
        assert_eq!(info.message, "subject\n\nbody");
        assert!(!info.pushed);
    }

    #[test]
    fn head_commit_info_is_none_on_unborn_branch() {
        let (_dir, repo) = init_repo();
        assert!(head_commit_info(&repo).unwrap().is_none());
    }

    #[test]
    fn get_commit_identity_reads_from_config() {
        let (_dir, repo) = init_repo();
        let identity = get_commit_identity(&repo).unwrap();
        assert_eq!(identity.name, "Test User");
        assert_eq!(identity.email, "test@test.com");
    }

    #[test]
    fn get_identity_config_reports_effective_and_local() {
        let (_dir, repo) = init_repo(); // sets a repo-local identity
        let cfg = get_identity_config(&repo).unwrap();
        assert_eq!(cfg.effective.name, "Test User");
        let local = cfg.local.expect("local identity should be present");
        assert_eq!(local.name, "Test User");
        assert_eq!(local.email, "test@test.com");
    }

    #[test]
    fn set_identity_local_persists_and_updates_effective() {
        let (_dir, repo) = init_repo();
        let cfg = set_identity(&repo, "New Name", "new@example.com", false).unwrap();

        assert_eq!(cfg.effective.name, "New Name");
        let local = cfg.local.expect("local identity");
        assert_eq!(local.name, "New Name");
        assert_eq!(local.email, "new@example.com");
        // Persisted: a fresh read sees it too.
        assert_eq!(get_commit_identity(&repo).unwrap().name, "New Name");
    }

    #[test]
    fn write_identity_sets_both_keys() {
        // Mechanism test against a throwaway config file — avoids touching the
        // real global config that the `global` scope would write to.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("standalone.gitconfig");
        std::fs::File::create(&path).unwrap();

        let mut cfg = git2::Config::open(&path).unwrap();
        write_identity(&mut cfg, "Solo Dev", "solo@example.com").unwrap();
        drop(cfg);

        let reopened = git2::Config::open(&path).unwrap();
        assert_eq!(reopened.get_string("user.name").unwrap(), "Solo Dev");
        assert_eq!(reopened.get_string("user.email").unwrap(), "solo@example.com");
    }

    /// The content of the index (staged) blob for a path, or None if absent.
    fn staged_blob(repo: &Repository, path: &str) -> Option<String> {
        let index = repo.index().unwrap();
        let entry = index.get_path(Path::new(path), 0)?;
        let blob = repo.find_blob(entry.id).unwrap();
        Some(String::from_utf8_lossy(blob.content()).into_owned())
    }

    #[test]
    fn get_stage_file_contents_returns_head_and_worktree() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\nc\n");
        make_initial_commit(&repo);
        fs::write(dir.path().join("f.txt"), "a\nB\nc\n").unwrap();

        let c = get_stage_file_contents(&repo, "f.txt").unwrap();
        assert_eq!(c.head_content, "a\nb\nc\n");
        assert_eq!(c.worktree_content, "a\nB\nc\n");
        assert!(!c.is_binary);
    }

    #[test]
    fn get_stage_file_contents_empty_head_for_new_file() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("new.txt"), "hello\n").unwrap();

        let c = get_stage_file_contents(&repo, "new.txt").unwrap();
        assert_eq!(c.head_content, "");
        assert_eq!(c.worktree_content, "hello\n");
    }

    #[test]
    fn get_stage_file_contents_flags_a_deletion() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\n");
        make_initial_commit(&repo);
        fs::remove_file(dir.path().join("f.txt")).unwrap();

        let c = get_stage_file_contents(&repo, "f.txt").unwrap();
        assert!(!c.worktree_exists);
        assert_eq!(c.head_content, "a\nb\n");
    }

    #[test]
    fn get_stage_file_contents_flags_binary() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("bin"), b"a\0b").unwrap();

        let c = get_stage_file_contents(&repo, "bin").unwrap();
        assert!(c.is_binary);
    }

    #[test]
    fn get_commit_file_contents_returns_parent_and_commit_sides() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\nc\n");
        create_commit(&repo, "first").unwrap();
        fs::write(dir.path().join("f.txt"), "a\nB\nc\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("f.txt")).unwrap();
        index.write().unwrap();
        let second = create_commit(&repo, "second").unwrap();

        let c = get_commit_file_contents(&repo, &second, "f.txt", None).unwrap();
        assert_eq!(c.head_content, "a\nb\nc\n");
        assert_eq!(c.worktree_content, "a\nB\nc\n");
        assert!(!c.is_binary);
        assert!(c.worktree_exists);
    }

    #[test]
    fn get_commit_file_contents_root_commit_has_empty_parent_side() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "hello\n");
        let root = create_commit(&repo, "root").unwrap();

        let c = get_commit_file_contents(&repo, &root, "f.txt", None).unwrap();
        assert_eq!(c.head_content, "");
        assert_eq!(c.worktree_content, "hello\n");
        assert!(c.worktree_exists);
    }

    #[test]
    fn get_commit_file_contents_flags_a_deletion() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\n");
        create_commit(&repo, "add").unwrap();
        fs::remove_file(dir.path().join("f.txt")).unwrap();
        let mut index = repo.index().unwrap();
        index.remove_path(Path::new("f.txt")).unwrap();
        index.write().unwrap();
        let del = create_commit(&repo, "delete").unwrap();

        let c = get_commit_file_contents(&repo, &del, "f.txt", None).unwrap();
        assert!(!c.worktree_exists);
        assert_eq!(c.head_content, "a\nb\n");
        assert_eq!(c.worktree_content, "");
    }

    #[test]
    fn get_commit_file_contents_reads_parent_side_from_old_path_on_rename() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "old.txt", "a\nb\n");
        create_commit(&repo, "add old").unwrap();
        fs::remove_file(dir.path().join("old.txt")).unwrap();
        fs::write(dir.path().join("new.txt"), "a\nB\n").unwrap();
        let mut index = repo.index().unwrap();
        index.remove_path(Path::new("old.txt")).unwrap();
        index.add_path(Path::new("new.txt")).unwrap();
        index.write().unwrap();
        let renamed = create_commit(&repo, "rename").unwrap();

        let c = get_commit_file_contents(&repo, &renamed, "new.txt", Some("old.txt")).unwrap();
        assert_eq!(c.head_content, "a\nb\n");
        assert_eq!(c.worktree_content, "a\nB\n");
    }

    #[test]
    fn get_stage_file_contents_preserves_missing_trailing_newline() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\n");
        make_initial_commit(&repo);
        fs::write(dir.path().join("f.txt"), "a\nb").unwrap(); // dropped final newline

        let c = get_stage_file_contents(&repo, "f.txt").unwrap();
        assert_eq!(c.head_content, "a\nb\n");
        assert_eq!(c.worktree_content, "a\nb");
    }

    #[test]
    fn stage_file_content_stages_the_exact_buffer() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\nc\n");
        make_initial_commit(&repo);
        fs::write(dir.path().join("f.txt"), "a\nB\nc\n").unwrap();

        let status = stage_file_content(&repo, "f.txt", "a\nB\nc\n").unwrap();

        assert_eq!(staged_blob(&repo, "f.txt").as_deref(), Some("a\nB\nc\n"));
        assert!(status.staged.iter().any(|e| e.path == "f.txt"));
        assert!(status.unstaged.iter().all(|e| e.path != "f.txt"));
    }

    #[test]
    fn stage_file_content_can_stage_a_partial_buffer() {
        // Two changed lines in the worktree; stage a buffer that keeps only one
        // of the changes (the other line reverted to its HEAD version).
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\nc\n");
        make_initial_commit(&repo);
        fs::write(dir.path().join("f.txt"), "A\nb\nC\n").unwrap();

        // Stage only the first line's change.
        let status = stage_file_content(&repo, "f.txt", "A\nb\nc\n").unwrap();

        assert_eq!(staged_blob(&repo, "f.txt").as_deref(), Some("A\nb\nc\n"));
        // Still has both a staged change (vs HEAD) and an unstaged change (vs worktree).
        assert!(status.staged.iter().any(|e| e.path == "f.txt"));
        assert!(status.unstaged.iter().any(|e| e.path == "f.txt"));
    }

    #[test]
    fn stage_file_content_with_head_content_leaves_nothing_staged() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\nc\n");
        make_initial_commit(&repo);
        fs::write(dir.path().join("f.txt"), "a\nB\nc\n").unwrap();

        let status = stage_file_content(&repo, "f.txt", "a\nb\nc\n").unwrap();

        assert!(status.staged.iter().all(|e| e.path != "f.txt"));
        assert!(status.unstaged.iter().any(|e| e.path == "f.txt"));
    }

    #[test]
    fn stage_file_content_preserves_file_mode() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\n");
        make_initial_commit(&repo);
        let mode_before = repo.index().unwrap().get_path(Path::new("f.txt"), 0).unwrap().mode;

        stage_file_content(&repo, "f.txt", "a\nb\n").unwrap();

        let mode_after = repo.index().unwrap().get_path(Path::new("f.txt"), 0).unwrap().mode;
        assert_eq!(mode_before, mode_after);
    }
}
