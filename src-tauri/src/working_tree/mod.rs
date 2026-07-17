use anyhow::Context;
use git2::{Object, Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Sentinel error message returned when a checkout (or fast-forward) is refused
/// purely because tracked, uncommitted changes would be lost — and those changes
/// are stashable. The command layer surfaces it verbatim so the frontend can
/// recognise it (see `AUTO_STASH_SENTINEL` in `src/lib/autoStash.ts`) and offer
/// to stash-and-retry rather than showing a raw error. Only produced when the
/// working tree actually has something to stash, so the retry can succeed.
pub const AUTO_STASH_SENTINEL: &str = "AUTO_STASH_REQUIRED";

/// Whether the working tree has tracked changes that `git stash` would capture —
/// staged or unstaged modifications, deletions, renames, or type changes.
/// Untracked and ignored files are excluded (a plain stash leaves them, and
/// checkout doesn't clobber untracked files), so this answers "is there work an
/// auto-stash could park?".
pub fn has_stashable_changes(repo: &Repository) -> anyhow::Result<bool> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut opts))
        .context("failed to get repository status")?;
    let tracked = Status::INDEX_NEW
        | Status::INDEX_MODIFIED
        | Status::INDEX_DELETED
        | Status::INDEX_RENAMED
        | Status::INDEX_TYPECHANGE
        | Status::WT_MODIFIED
        | Status::WT_DELETED
        | Status::WT_RENAMED
        | Status::WT_TYPECHANGE;
    Ok(statuses.iter().any(|e| e.status().intersects(tracked)))
}

/// A "safe" checkout of `target`'s tree (libgit2 refuses to overwrite local
/// changes). When it's refused *because* tracked changes would be lost, and
/// those changes are stashable, this returns the `AUTO_STASH_SENTINEL` error so
/// the caller/frontend can offer an auto-stash. Every other failure — including
/// a conflict with only untracked files, which a stash wouldn't resolve — keeps
/// the original, actionable message.
pub fn safe_checkout_tree(repo: &Repository, target: &Object) -> anyhow::Result<()> {
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(target, Some(&mut checkout)).map_err(|e| {
        let would_overwrite =
            e.code() == git2::ErrorCode::Conflict || e.class() == git2::ErrorClass::Checkout;
        if would_overwrite && has_stashable_changes(repo).unwrap_or(false) {
            anyhow::anyhow!(AUTO_STASH_SENTINEL)
        } else {
            anyhow::Error::new(e).context(
                "can't switch — you have uncommitted changes that would be overwritten. Commit or stash them first.",
            )
        }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeStatus {
    pub staged: Vec<StatusEntry>,
    pub unstaged: Vec<StatusEntry>,
    pub untracked: Vec<StatusEntry>,
}

impl WorkingTreeStatus {
    /// Number of distinct changed files — the figure shown on the graph's
    /// working-tree node ("N uncommitted changes"). A file that is both staged
    /// and has unstaged edits appears in two lists but counts once, so this
    /// unions paths rather than summing lengths. Lets the graph's dirty count be
    /// derived from an existing status scan instead of a second `repo.statuses()`.
    pub fn distinct_change_count(&self) -> u32 {
        let mut paths = std::collections::HashSet::new();
        for e in self
            .staged
            .iter()
            .chain(&self.unstaged)
            .chain(&self.untracked)
        {
            paths.insert(e.path.as_str());
        }
        paths.len() as u32
    }
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
    /// A `data:` URI preview of each side when the path is a recognised image
    /// type (`None` otherwise, or when that side is absent — an add/delete). The
    /// frontend renders these as `<img>` instead of attempting a text diff.
    pub head_image: Option<String>,
    pub worktree_image: Option<String>,
}

/// The image MIME for a path by extension, or `None` if it isn't a previewable
/// image. Kept to common raster formats (the ones worth an inline preview).
fn image_mime_from_path(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

/// Base64 `data:` URI for `bytes` under `mime`, or `None` for an empty side (a
/// file added on one side / deleted on the other).
fn image_data_url(bytes: &[u8], mime: &str) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{b64}"))
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

    let statuses = repo
        .statuses(Some(&mut opts))
        .context("failed to get repository status")?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        // Staged changes (index)
        if s.is_index_new() {
            staged.push(StatusEntry {
                path: path.clone(),
                original_path: None,
                status: StatusCode::Added,
            });
        } else if s.is_index_modified() {
            staged.push(StatusEntry {
                path: path.clone(),
                original_path: None,
                status: StatusCode::Modified,
            });
        } else if s.is_index_deleted() {
            staged.push(StatusEntry {
                path: path.clone(),
                original_path: None,
                status: StatusCode::Deleted,
            });
        } else if s.is_index_renamed() {
            let old = entry.head_to_index().and_then(|d| {
                d.old_file()
                    .path()
                    .and_then(|p| p.to_str())
                    .map(|s| s.to_string())
            });
            staged.push(StatusEntry {
                path: path.clone(),
                original_path: old,
                status: StatusCode::Renamed,
            });
        }

        // Unstaged / untracked changes (working tree)
        if s.is_wt_new() {
            untracked.push(StatusEntry {
                path: path.clone(),
                original_path: None,
                status: StatusCode::Added,
            });
        } else if s.is_wt_modified() {
            unstaged.push(StatusEntry {
                path: path.clone(),
                original_path: None,
                status: StatusCode::Modified,
            });
        } else if s.is_wt_deleted() {
            unstaged.push(StatusEntry {
                path: path.clone(),
                original_path: None,
                status: StatusCode::Deleted,
            });
        } else if s.is_wt_renamed() {
            unstaged.push(StatusEntry {
                path: path.clone(),
                original_path: None,
                status: StatusCode::Renamed,
            });
        }
    }

    Ok(WorkingTreeStatus {
        staged,
        unstaged,
        untracked,
    })
}

pub fn stage_file(repo: &Repository, path: &str) -> anyhow::Result<WorkingTreeStatus> {
    let mut index = repo.index().context("failed to get index")?;
    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?;
    if workdir.join(path).exists() {
        index
            .add_path(Path::new(path))
            .with_context(|| format!("failed to stage: {path}"))?;
    } else {
        // The file is gone from the working tree: stage its deletion. add_path
        // can't do this (there's nothing on disk to add), so remove the index
        // entry instead.
        index
            .remove_path(Path::new(path))
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
        let head = repo
            .head()?
            .peel_to_commit()
            .context("HEAD is not a commit")?;
        repo.reset_default(Some(head.as_object()), std::iter::once(path))
            .with_context(|| format!("failed to unstage: {path}"))?;
    } else {
        // New file: just remove from index
        let mut index = repo.index().context("failed to get index")?;
        index
            .remove_path(Path::new(path))
            .with_context(|| format!("failed to remove from index: {path}"))?;
        index.write().context("failed to write index")?;
    }

    get_working_tree_status(repo)
}

/// The blob bytes for `path` in HEAD's tree, or empty when the path isn't in
/// HEAD (an unborn HEAD, or a newly added file).
fn read_head_blob(repo: &Repository, path: &str) -> Vec<u8> {
    let Ok(head) = repo.head() else {
        return Vec::new();
    };
    let Ok(tree) = head.peel_to_tree() else {
        return Vec::new();
    };
    match tree.get_path(Path::new(path)) {
        Ok(entry) => repo
            .find_blob(entry.id())
            .map(|b| b.content().to_vec())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// The staged (index) blob bytes for `path`, or `None` when the index has no
/// entry for it (unstaged untracked file, or a staged deletion).
fn read_index_blob(repo: &Repository, path: &str) -> Option<Vec<u8>> {
    let index = repo.index().ok()?;
    let entry = index.get_path(Path::new(path), 0)?;
    Some(
        repo.find_blob(entry.id)
            .map(|b| b.content().to_vec())
            .unwrap_or_default(),
    )
}

/// Read the two sides to diff in the line-level staging editor. The editor is
/// split by which panel opened the file, so the two sides are the git-native
/// pair for that direction:
///
/// * `staged = false` (opened from **Changes**): index → working tree, i.e. the
///   *unstaged* edits. `head_content` is the staged (index) blob and
///   `worktree_content` the file on disk; staging a line writes it into the index.
/// * `staged = true` (opened from **Staged**): HEAD → index, i.e. the *staged*
///   edits. `head_content` is the HEAD blob and `worktree_content` the index blob;
///   unstaging a line reverts it in the index.
///
/// Marks `is_binary` when either side contains a NUL byte so the frontend can
/// fall back to whole-file staging.
pub fn get_stage_file_contents(
    repo: &Repository,
    path: &str,
    staged: bool,
) -> anyhow::Result<StageFileContents> {
    crate::path_guard::validate_repo_relative(path)?;
    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?;
    let full_path = workdir.join(path);

    let head_bytes = read_head_blob(repo, path);
    let index_entry = read_index_blob(repo, path);

    let (left_bytes, right_bytes, right_exists) = if staged {
        // HEAD → index (staged edits). The right side "exists" when the index
        // still tracks the file (a staged deletion has no index entry).
        (
            head_bytes,
            index_entry.clone().unwrap_or_default(),
            index_entry.is_some(),
        )
    } else {
        // index → working tree (unstaged edits). The left side is the staged
        // blob, the right side the file on disk.
        (
            index_entry.unwrap_or_default(),
            std::fs::read(&full_path).unwrap_or_default(),
            full_path.is_file(),
        )
    };

    let is_binary = left_bytes.contains(&0) || right_bytes.contains(&0);
    let (head_image, worktree_image) = match image_mime_from_path(path) {
        Some(mime) => (
            image_data_url(&left_bytes, mime),
            image_data_url(&right_bytes, mime),
        ),
        None => (None, None),
    };

    Ok(StageFileContents {
        head_content: String::from_utf8_lossy(&left_bytes).into_owned(),
        worktree_content: String::from_utf8_lossy(&right_bytes).into_owned(),
        is_binary,
        worktree_exists: right_exists,
        head_image,
        worktree_image,
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
    // The parent side is named by old_path on a rename; use its own extension.
    let head_image = image_mime_from_path(old_path.unwrap_or(path))
        .and_then(|mime| image_data_url(&parent_bytes, mime));
    let worktree_image =
        image_mime_from_path(path).and_then(|mime| image_data_url(&commit_bytes, mime));

    Ok(StageFileContents {
        head_content: String::from_utf8_lossy(&parent_bytes).into_owned(),
        worktree_content: String::from_utf8_lossy(&commit_bytes).into_owned(),
        is_binary,
        worktree_exists,
        head_image,
        worktree_image,
    })
}

/// Stage exactly `content` for `path`: write it as a blob and point the index
/// entry at it, preserving the existing file mode. This is how the line-level
/// staging editor persists its (possibly hand-edited) result buffer — the buffer
/// is the source of truth, mirroring the merge editor's result pane.
///
/// NOTE: writing the blob directly bypasses git's clean filters (autocrlf,
/// `.gitattributes` filters). Acceptable for v1; revisit if it causes trouble.
pub fn stage_file_content(
    repo: &Repository,
    path: &str,
    content: &str,
) -> anyhow::Result<WorkingTreeStatus> {
    let mut index = repo.index().context("failed to get index")?;

    // Preserve the current index entry's mode where present; otherwise use a
    // regular non-executable blob mode.
    let mode = index
        .get_path(Path::new(path), 0)
        .map(|e| e.mode)
        .unwrap_or(0o100644);

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
    crate::path_guard::validate_repo_relative(path)?;
    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?;
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
        repo.checkout_index(None, Some(&mut co))
            .with_context(|| format!("failed to discard: {path}"))?;
    } else {
        // Untracked: delete from disk
        std::fs::remove_file(&full_path)
            .with_context(|| format!("failed to delete untracked file: {path}"))?;
    }

    get_working_tree_status(repo)
}

/// Delete a file from the working tree. Removes it from disk and, when it isn't
/// committed in HEAD (an untracked or staged-new file), drops its index entry so
/// it disappears entirely; a committed file becomes a pending (unstaged)
/// deletion the user can then stage/commit or discard to restore. Destructive —
/// the frontend guards this behind a confirmation dialog.
pub fn delete_file(repo: &Repository, path: &str) -> anyhow::Result<WorkingTreeStatus> {
    // Reject paths that try to escape the working directory. Status-derived paths
    // are always safe repo-relative paths, but never trust one blindly with `rm`.
    crate::path_guard::validate_repo_relative(path)?;
    let rel = Path::new(path);

    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?;
    let full_path = workdir.join(rel);
    if full_path.exists() {
        std::fs::remove_file(&full_path)
            .with_context(|| format!("failed to delete file: {path}"))?;
    }

    let in_head = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .and_then(|c| c.tree().ok())
        .map(|t| t.get_path(rel).is_ok())
        .unwrap_or(false);

    if !in_head {
        // Not committed: drop any index entry so a staged-new file fully vanishes.
        let mut index = repo.index().context("failed to open index")?;
        if index.get_path(rel, 0).is_some() {
            index
                .remove_path(rel)
                .with_context(|| format!("failed to remove {path} from index"))?;
            index.write().context("failed to write index")?;
        }
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
    let statuses = repo
        .statuses(Some(&mut opts))
        .context("failed to get repository status")?;
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

enum DiffKind {
    Unstaged,
    Staged,
}

fn build_hunk_patch(
    repo: &Repository,
    path: &str,
    hunk_index: usize,
    kind: DiffKind,
) -> anyhow::Result<String> {
    let (hunks, old_side_is_new_file) = match kind {
        DiffKind::Unstaged => (
            crate::diff_engine::get_unstaged_diff(repo, path)?.hunks,
            false,
        ),
        DiffKind::Staged => {
            let no_head_entry = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_tree().ok())
                .map(|t| t.get_path(Path::new(path)).is_err())
                .unwrap_or(true);
            (
                crate::diff_engine::get_staged_diff(repo, path)?.hunks,
                no_head_entry,
            )
        }
    };
    let hunk = hunks
        .into_iter()
        .find(|h| h.index == hunk_index)
        .ok_or_else(|| anyhow::anyhow!("hunk index {hunk_index} out of range"))?;

    // Build minimal unified diff patch: file header + single hunk. A staged
    // diff whose file has no HEAD entry is an add — the "old" side is
    // /dev/null, matching real `git diff --cached` output, so a reversing
    // `git apply --cached --reverse` removes the index entry instead of
    // leaving a staged empty blob.
    let old_header = if old_side_is_new_file {
        "--- /dev/null".to_string()
    } else {
        format!("--- a/{path}")
    };
    let patch = format!("{old_header}\n+++ b/{path}\n{}", hunk.content);
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
    child
        .stdin
        .take()
        .unwrap()
        .write_all(patch.as_bytes())
        .context("failed to write patch to git apply stdin")?;
    let output = child
        .wait_with_output()
        .context("git apply failed to run")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git apply failed: {stderr}");
    }
    Ok(())
}

pub fn stage_hunk(repo: &Repository, path: &str, hunk_index: usize) -> anyhow::Result<()> {
    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?;
    let patch = build_hunk_patch(repo, path, hunk_index, DiffKind::Unstaged)?;
    git_apply(workdir, &patch, &["--cached"])
}

pub fn unstage_hunk(repo: &Repository, path: &str, hunk_index: usize) -> anyhow::Result<()> {
    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?;
    let patch = build_hunk_patch(repo, path, hunk_index, DiffKind::Staged)?;
    git_apply(workdir, &patch, &["--cached", "--reverse"])
}

pub fn discard_hunk(repo: &Repository, path: &str, hunk_index: usize) -> anyhow::Result<()> {
    let workdir = repo
        .workdir()
        .context("bare repository has no working directory")?;
    let patch = build_hunk_patch(repo, path, hunk_index, DiffKind::Unstaged)?;
    git_apply(workdir, &patch, &["--reverse"])
}

pub fn create_commit(repo: &Repository, message: &str) -> anyhow::Result<String> {
    let sig = repo.signature().context(
        "Git user identity not configured. Set user.name and user.email in your .gitconfig.",
    )?;
    let mut index = repo.index().context("failed to get index")?;
    let tree_id = index
        .write_tree()
        .context("failed to write tree — nothing staged to commit")?;
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

/// Revert `oid` by applying its inverse on the current branch. With
/// `auto_commit` it creates the revert commit and returns its oid; otherwise it
/// leaves the inverse as ordinary *unstaged* working-tree changes (no commit, no
/// in-progress revert state) for the user to stage and commit as they choose,
/// returning `None`. Refuses merge commits and a dirty working tree (so the
/// abort-on-conflict path can hard-reset without losing edits); on conflict it
/// aborts cleanly and errors rather than leaving a half-applied revert.
pub fn revert_commit(
    repo: &Repository,
    oid_str: &str,
    auto_commit: bool,
) -> anyhow::Result<Option<String>> {
    let oid = git2::Oid::from_str(oid_str).context("invalid commit oid")?;
    let commit = repo.find_commit(oid).context("commit not found")?;
    if commit.parent_count() > 1 {
        anyhow::bail!("reverting a merge commit isn't supported yet");
    }

    // Require a clean tree: revert touches the working tree, and the conflict
    // abort below hard-resets to HEAD — which would discard any local edits.
    let status = get_working_tree_status(repo)?;
    if !status.staged.is_empty() || !status.unstaged.is_empty() {
        anyhow::bail!("commit or stash your changes before reverting");
    }

    let head = repo
        .head()?
        .peel_to_commit()
        .context("HEAD is not a commit")?;

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.safe();
    let mut opts = git2::RevertOptions::new();
    opts.checkout_builder(checkout);
    repo.revert(&commit, Some(&mut opts))
        .context("revert failed")?;

    let mut index = repo.index().context("failed to read index")?;
    if index.has_conflicts() {
        let _ = repo.reset(head.as_object(), git2::ResetType::Hard, None);
        let _ = repo.cleanup_state();
        anyhow::bail!("revert would conflict with later history — revert it manually");
    }

    let tree_id = index.write_tree().context("failed to write tree")?;
    if tree_id == head.tree_id() {
        let _ = repo.reset(head.as_object(), git2::ResetType::Hard, None);
        let _ = repo.cleanup_state();
        anyhow::bail!("nothing to revert — the commit's changes aren't present");
    }

    if !auto_commit {
        // Leave the inverse as plain unstaged changes: reset the index back to
        // HEAD (un-staging) while keeping the reverted working tree, and clear the
        // in-progress revert state so it's not "mid-revert".
        repo.reset(head.as_object(), git2::ResetType::Mixed, None)
            .context("failed to unstage revert")?;
        repo.cleanup_state()
            .context("failed to clean up revert state")?;
        log::info!(target: "git", "revert: {oid} applied as uncommitted changes");
        return Ok(None);
    }

    let tree = repo.find_tree(tree_id).context("failed to find tree")?;
    let sig = repo.signature().context(
        "Git user identity not configured. Set user.name and user.email in your .gitconfig.",
    )?;
    let subject = commit.summary().unwrap_or("commit");
    let message = format!("Revert \"{subject}\"\n\nThis reverts commit {oid}.");
    let new_oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&head])
        .context("failed to create revert commit")?;
    repo.cleanup_state()
        .context("failed to clean up revert state")?;
    log::info!(target: "git", "revert: {oid} -> {new_oid}");
    Ok(Some(new_oid.to_string()))
}

/// True if `oid` is reachable from any remote-tracking branch, meaning the
/// commit has already been pushed (so rewriting it would rewrite shared history).
pub fn commit_is_pushed(repo: &Repository, oid: git2::Oid) -> anyhow::Result<bool> {
    for branch in repo.branches(Some(git2::BranchType::Remote))? {
        let (branch, _) = branch?;
        if let Some(target) = branch.get().target() {
            // The remote contains `oid` if its tip *is* `oid` or descends from it.
            if target == oid || repo.graph_descendant_of(target, oid)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// True if HEAD is reachable from any remote-tracking branch, meaning the commit
/// has already been pushed. Returns false for an unborn branch (no HEAD yet).
pub fn head_commit_is_pushed(repo: &Repository) -> anyhow::Result<bool> {
    let head_oid = match repo.head() {
        Ok(head) => head.peel_to_commit().context("HEAD is not a commit")?.id(),
        Err(_) => return Ok(false),
    };
    commit_is_pushed(repo, head_oid)
}

/// Squash a contiguous run of unpushed commits at the tip of the current branch
/// into a single commit. The selection must include the branch tip (HEAD) and
/// form an unbroken first-parent chain down from it; none may be a merge commit
/// and none may have been pushed. The squashed commit keeps the tip's tree — so
/// the working tree and index are left untouched (nothing is checked out) — and
/// the oldest commit's author, while the committer is the current identity.
/// The current branch ref is moved to the new commit. Returns its oid.
pub fn squash_commits(repo: &Repository, oids: &[String], message: &str) -> anyhow::Result<String> {
    if oids.len() < 2 {
        anyhow::bail!("Select at least two commits to squash.");
    }

    let mut ids = Vec::with_capacity(oids.len());
    for s in oids {
        ids.push(git2::Oid::from_str(s).context("invalid commit oid")?);
    }
    let selected: std::collections::HashSet<git2::Oid> = ids.iter().copied().collect();
    if selected.len() != ids.len() {
        anyhow::bail!("Duplicate commits in selection.");
    }

    // None of the selected commits may be a merge or already pushed.
    for &id in &ids {
        let commit = repo.find_commit(id).context("commit not found")?;
        if commit.parent_count() > 1 {
            anyhow::bail!("Cannot squash a merge commit.");
        }
        if commit_is_pushed(repo, id)? {
            anyhow::bail!("Cannot squash commits that have already been pushed to a remote.");
        }
    }

    // Tip-anchored: the newest selected commit must be the branch tip (HEAD).
    let head_ref = repo.head().context("no commit to squash")?;
    let tip = head_ref.peel_to_commit().context("HEAD is not a commit")?;
    if !selected.contains(&tip.id()) {
        anyhow::bail!(
            "Squash must include the latest commit on the branch — select down from the branch tip."
        );
    }

    // Walk first-parent from the tip, consuming the selection. Every step must
    // stay within the set until all are consumed; that proves the selection is a
    // contiguous, linear run. The last commit reached is the oldest.
    let mut remaining = selected.clone();
    remaining.remove(&tip.id());
    let mut oldest = tip.id();
    let mut cur = tip.clone();
    while !remaining.is_empty() {
        let parent = cur.parent(0).map_err(|_| {
            anyhow::anyhow!("Selected commits must be consecutive on the same branch.")
        })?;
        if !remaining.remove(&parent.id()) {
            anyhow::bail!("Selected commits must be consecutive on the same branch.");
        }
        oldest = parent.id();
        cur = parent;
    }

    // The parent of the oldest selected commit becomes the squash's parent (None
    // when the run reaches the root commit, producing a new root commit).
    let oldest_commit = repo.find_commit(oldest).context("commit not found")?;
    let base = oldest_commit.parent(0).ok();
    let parents: Vec<&git2::Commit> = base.iter().collect();

    let tree = tip.tree().context("failed to read tip tree")?;
    let author = oldest_commit.author();
    let committer = repo.signature().context(
        "Git user identity not configured. Set user.name and user.email in your .gitconfig.",
    )?;

    // Create the squashed commit detached from any ref, then move the branch onto
    // it. Its tree matches the old tip, so the working tree and index are left
    // exactly as they were.
    let new_oid = repo
        .commit(None, &author, &committer, message, &tree, &parents)
        .context("failed to create squashed commit")?;

    let reflog = format!("squash: {} commits", ids.len());
    if head_ref.is_branch() {
        let name = head_ref.name().context("branch reference has no name")?;
        repo.reference(name, new_oid, true, &reflog)
            .context("failed to update branch to squashed commit")?;
    } else {
        repo.set_head_detached(new_oid)
            .context("failed to move HEAD to squashed commit")?;
    }

    log::info!(
        target: "git",
        "squash: {} commits -> {new_oid}",
        ids.len()
    );
    Ok(new_oid.to_string())
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
    Some(Identity {
        name: name.unwrap_or_default(),
        email: email.unwrap_or_default(),
    })
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
    Ok(IdentityConfig {
        effective,
        local,
        global,
    })
}

/// Write `user.name`/`user.email` into the given config (a single level).
fn write_identity(config: &mut git2::Config, name: &str, email: &str) -> anyhow::Result<()> {
    config
        .set_str("user.name", name)
        .context("failed to set user.name")?;
    config
        .set_str("user.email", email)
        .context("failed to set user.email")?;
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
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
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

    /// Perf harness (Phase 0 of docs/superpowers/perf-baseline.md): dirties
    /// every generated file in the bench repo, then times a status scan and
    /// the current per-file `stage_file` loop (one index write + one full
    /// status rescan per file) — the "before" number Task A3's batched
    /// `stage_all` is meant to beat. Ignored by default; run with:
    /// `BENCH_REPO_PATH=/path/to/bench-repo cargo test --release -- --ignored --nocapture bench_`
    #[test]
    #[ignore = "perf harness: requires BENCH_REPO_PATH"]
    fn bench_stage_all_files() {
        let path = std::env::var("BENCH_REPO_PATH").expect("set BENCH_REPO_PATH to the bench repo");
        let repo = Repository::open(&path).unwrap();
        let workdir = repo.workdir().unwrap().to_path_buf();
        let src_dir = workdir.join("src");
        let paths: Vec<String> = fs::read_dir(&src_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| format!("src/{}", e.file_name().to_string_lossy()))
            .collect();
        for rel in &paths {
            let full = workdir.join(rel);
            let mut content = fs::read_to_string(&full).unwrap();
            content.push_str("bench touch\n");
            fs::write(&full, content).unwrap();
        }

        let t_status = std::time::Instant::now();
        let status = get_working_tree_status(&repo).unwrap();
        println!(
            "get_working_tree_status ({} unstaged): {:?}",
            status.unstaged.len(),
            t_status.elapsed()
        );

        let t_loop = std::time::Instant::now();
        for rel in &paths {
            stage_file(&repo, rel).unwrap();
        }
        println!(
            "stage_file loop, {} files, one index-write + one status rescan each: {:?}",
            paths.len(),
            t_loop.elapsed()
        );
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
    fn has_stashable_changes_false_on_clean_tree() {
        let (_dir, repo) = init_repo();
        make_initial_commit(&repo);
        assert!(!has_stashable_changes(&repo).unwrap());
    }

    #[test]
    fn has_stashable_changes_false_for_untracked_only() {
        // An untracked file is not something a plain stash captures (and checkout
        // won't clobber it), so it must not trigger an auto-stash.
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("new.txt"), "hi\n").unwrap();
        assert!(!has_stashable_changes(&repo).unwrap());
    }

    #[test]
    fn has_stashable_changes_true_for_staged_and_unstaged() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\n");
        make_initial_commit(&repo);
        // Unstaged modification.
        fs::write(dir.path().join("f.txt"), "b\n").unwrap();
        assert!(has_stashable_changes(&repo).unwrap());
        // Staged modification.
        write_and_stage(&repo, &dir, "f.txt", "c\n");
        assert!(has_stashable_changes(&repo).unwrap());
    }

    #[test]
    fn delete_file_removes_an_untracked_file_entirely() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("junk.txt"), "x\n").unwrap();

        let status = delete_file(&repo, "junk.txt").unwrap();

        assert!(
            !dir.path().join("junk.txt").exists(),
            "file should be gone from disk"
        );
        assert!(status.untracked.iter().all(|e| e.path != "junk.txt"));
        assert!(status.unstaged.iter().all(|e| e.path != "junk.txt"));
        assert!(status.staged.iter().all(|e| e.path != "junk.txt"));
    }

    #[test]
    fn delete_file_makes_a_staged_new_file_vanish() {
        // A brand-new file that was staged (in the index, not HEAD) should fully
        // disappear — index entry dropped, not left as a staged add + wt delete.
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        write_and_stage(&repo, &dir, "added.txt", "new\n");

        let status = delete_file(&repo, "added.txt").unwrap();

        assert!(!dir.path().join("added.txt").exists());
        assert!(status.staged.iter().all(|e| e.path != "added.txt"));
        assert!(status.unstaged.iter().all(|e| e.path != "added.txt"));
        assert!(status.untracked.iter().all(|e| e.path != "added.txt"));
    }

    #[test]
    fn delete_file_leaves_a_committed_file_as_a_pending_deletion() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "tracked.txt", "v1\n");
        make_initial_commit(&repo);

        let status = delete_file(&repo, "tracked.txt").unwrap();

        assert!(!dir.path().join("tracked.txt").exists());
        // Committed file → shows as an unstaged deletion (index still holds HEAD's
        // copy), which the user can stage/commit or discard to restore.
        assert!(
            status.unstaged.iter().any(|e| e.path == "tracked.txt"),
            "committed file should become a pending deletion"
        );
    }

    #[test]
    fn delete_file_rejects_paths_escaping_the_repo() {
        let (_dir, repo) = init_repo();
        make_initial_commit(&repo);
        assert!(delete_file(&repo, "../secret.txt").is_err());
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
    fn distinct_change_count_counts_a_staged_and_unstaged_file_once() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original");
        make_initial_commit(&repo);
        // file.txt is both staged and unstaged (in two lists); an untracked file
        // adds a second distinct path.
        write_and_stage(&repo, &dir, "file.txt", "staged change");
        fs::write(dir.path().join("file.txt"), "unstaged change").unwrap();
        fs::write(dir.path().join("new.txt"), "hi").unwrap();

        let status = get_working_tree_status(&repo).unwrap();
        // Two distinct files despite three status-list entries (file.txt ×2 + new.txt).
        assert_eq!(status.distinct_change_count(), 2);
    }

    #[test]
    fn distinct_change_count_is_zero_on_a_clean_tree() {
        let (_dir, repo) = init_repo();
        make_initial_commit(&repo);
        assert_eq!(
            get_working_tree_status(&repo)
                .unwrap()
                .distinct_change_count(),
            0
        );
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

        let staged = status
            .staged
            .iter()
            .find(|e| e.path == "file.txt")
            .expect("staged");
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

        let unstaged = status
            .unstaged
            .iter()
            .find(|e| e.path == "file.txt")
            .expect("unstaged");
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
    fn discard_file_preserves_staged_content_when_discarding_unstaged_edits() {
        // Stage a careful partial change, then make a further *unstaged* edit
        // on top, then discard. Only the unstaged edit should be lost — the
        // staged version must survive (this is what `git checkout -- <path>`
        // does: restore the working tree from the index, not from HEAD).
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "file.txt", "original\n");
        make_initial_commit(&repo);

        write_and_stage(&repo, &dir, "file.txt", "staged change\n");
        fs::write(dir.path().join("file.txt"), "unstaged scribble\n").unwrap();

        discard_file(&repo, "file.txt").unwrap();

        assert_eq!(
            normalise(&fs::read_to_string(dir.path().join("file.txt")).unwrap()),
            "staged change\n",
            "discard must restore from the index, not wipe staged work back to HEAD"
        );
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
    fn discard_file_rejects_paths_escaping_the_repo() {
        let (_dir, repo) = init_repo();
        make_initial_commit(&repo);
        assert!(discard_file(&repo, "../secret.txt").is_err());
    }

    #[test]
    fn discard_file_does_not_delete_a_file_outside_the_repo() {
        // An absolute path resolves to an existing file outside the repo and
        // must not be deleted, even though it "isn't in HEAD" (the untracked
        // branch) — this is the shape of the P0-1 arbitrary-delete bug.
        let (_dir, repo) = init_repo();
        make_initial_commit(&repo);
        let outside = TempDir::new().unwrap();
        let victim = outside.path().join("victim.txt");
        fs::write(&victim, "do not delete me").unwrap();

        assert!(discard_file(&repo, victim.to_str().unwrap()).is_err());
        assert!(victim.exists(), "file outside the repo must survive");
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

    #[test]
    fn revert_commit_creates_inverse_commit() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "a.txt", "1\n");
        let c1 = create_commit(&repo, "add a").unwrap();
        write_and_stage(&repo, &dir, "b.txt", "2\n");
        let c2 = create_commit(&repo, "add b").unwrap();

        let new_oid = revert_commit(&repo, &c2, true)
            .unwrap()
            .expect("committed revert");

        // b.txt is gone from the working tree, and HEAD is the revert commit whose
        // tree matches the pre-c2 state.
        assert!(!dir.path().join("b.txt").exists());
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), new_oid);
        assert!(head.message().unwrap().starts_with("Revert \"add b\""));
        assert_eq!(
            head.tree_id(),
            repo.find_commit(c1.parse().unwrap()).unwrap().tree_id()
        );
        // Working tree is clean afterwards.
        let status = get_working_tree_status(&repo).unwrap();
        assert!(status.staged.is_empty() && status.unstaged.is_empty());
    }

    #[test]
    fn revert_commit_without_auto_commit_leaves_unstaged_changes() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "a.txt", "1\n");
        create_commit(&repo, "add a").unwrap();
        write_and_stage(&repo, &dir, "b.txt", "2\n");
        let c2 = create_commit(&repo, "add b").unwrap();

        let result = revert_commit(&repo, &c2, false).unwrap();

        // No commit was created, HEAD is unchanged...
        assert!(result.is_none());
        assert_eq!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
            c2
        );
        // ...and the revert shows as an ordinary *unstaged* change (b removed).
        assert!(!dir.path().join("b.txt").exists());
        let status = get_working_tree_status(&repo).unwrap();
        assert!(
            status.staged.is_empty(),
            "should not be staged: {:?}",
            status.staged
        );
        assert!(status.unstaged.iter().any(|e| e.path == "b.txt"));
        // No in-progress revert state left behind.
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    #[test]
    fn revert_commit_refuses_a_dirty_tree() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "a.txt", "1\n");
        create_commit(&repo, "add a").unwrap();
        write_and_stage(&repo, &dir, "b.txt", "2\n");
        let c2 = create_commit(&repo, "add b").unwrap();
        fs::write(dir.path().join("a.txt"), "dirty\n").unwrap(); // uncommitted edit

        let err = revert_commit(&repo, &c2, true).unwrap_err();
        assert!(err.to_string().contains("stash"), "got: {err}");
        // The dirty edit is untouched.
        assert_eq!(
            fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "dirty\n"
        );
    }

    #[test]
    fn revert_commit_refuses_a_merge_commit() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "a.txt", "1\n");
        let c1 = create_commit(&repo, "c1").unwrap();
        write_and_stage(&repo, &dir, "b.txt", "2\n");
        create_commit(&repo, "c2").unwrap();

        // Fabricate a 2-parent (merge) commit at HEAD.
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let other = repo.find_commit(c1.parse().unwrap()).unwrap();
        let tree = head.tree().unwrap();
        let merge = repo
            .commit(Some("HEAD"), &sig, &sig, "merge", &tree, &[&head, &other])
            .unwrap();

        let err = revert_commit(&repo, &merge.to_string(), true).unwrap_err();
        assert!(err.to_string().contains("merge"), "got: {err}");
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

    /// Write, stage and commit a file, returning the new commit oid.
    fn commit_file(repo: &Repository, dir: &TempDir, name: &str, content: &str) -> String {
        write_and_stage(repo, dir, name, content);
        create_commit(repo, name).unwrap()
    }

    /// Build a base commit plus three tip commits c1 -> c2 -> c3 (HEAD). Returns
    /// (base, c1, c2, c3).
    fn repo_with_chain(dir: &TempDir, repo: &Repository) -> (String, String, String, String) {
        let base = commit_file(repo, dir, "base.txt", "base\n");
        let c1 = commit_file(repo, dir, "a.txt", "a\n");
        let c2 = commit_file(repo, dir, "b.txt", "b\n");
        let c3 = commit_file(repo, dir, "c.txt", "c\n");
        (base, c1, c2, c3)
    }

    #[test]
    fn squash_combines_tip_commits_into_one() {
        let (dir, repo) = init_repo();
        let (base, c1, c2, c3) = repo_with_chain(&dir, &repo);
        let tip_tree = repo.find_commit(c3.parse().unwrap()).unwrap().tree_id();

        let new_oid = squash_commits(&repo, &[c3, c2, c1], "squashed").unwrap();

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), new_oid);
        assert_eq!(head.message().unwrap(), "squashed");
        // Sits directly on the base, keeps the tip's tree, and is the only commit
        // above the base now.
        assert_eq!(head.parent_id(0).unwrap().to_string(), base);
        assert_eq!(head.tree_id(), tip_tree);
    }

    #[test]
    fn squash_keeps_the_oldest_commits_author() {
        let (dir, repo) = init_repo();
        let base = commit_file(&repo, &dir, "base.txt", "base\n");
        let _ = base;

        // Oldest of the run authored by Alice; the rest by the default identity.
        write_and_stage(&repo, &dir, "a.txt", "a\n");
        let alice = Signature::now("Alice", "alice@example.com").unwrap();
        let tree = {
            let tree_id = repo.index().unwrap().write_tree().unwrap();
            repo.find_tree(tree_id).unwrap()
        };
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let c1 = repo
            .commit(Some("HEAD"), &alice, &alice, "a", &tree, &[&parent])
            .unwrap()
            .to_string();
        let c2 = commit_file(&repo, &dir, "b.txt", "b\n");

        squash_commits(&repo, &[c2, c1], "squashed").unwrap();

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.author().name().unwrap(), "Alice");
    }

    #[test]
    fn squash_refuses_when_any_commit_is_pushed() {
        let (dir, repo) = init_repo();
        let (_base, c1, c2, c3) = repo_with_chain(&dir, &repo);
        // The oldest of the run is on the remote.
        mark_pushed(&repo, c1.parse().unwrap());

        let err = squash_commits(&repo, &[c3, c2, c1], "squashed").unwrap_err();
        assert!(err.to_string().contains("pushed"), "got: {err}");
    }

    #[test]
    fn squash_refuses_a_non_contiguous_selection() {
        let (dir, repo) = init_repo();
        let (_base, c1, _c2, c3) = repo_with_chain(&dir, &repo);
        // c3 (tip) and c1, skipping c2 — not consecutive.
        let err = squash_commits(&repo, &[c3, c1], "squashed").unwrap_err();
        assert!(err.to_string().contains("consecutive"), "got: {err}");
    }

    #[test]
    fn squash_refuses_when_tip_not_selected() {
        let (dir, repo) = init_repo();
        let (_base, c1, c2, _c3) = repo_with_chain(&dir, &repo);
        // c1 and c2 are contiguous but exclude the branch tip c3.
        let err = squash_commits(&repo, &[c2, c1], "squashed").unwrap_err();
        assert!(err.to_string().contains("latest commit"), "got: {err}");
    }

    #[test]
    fn squash_refuses_a_merge_commit() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "a.txt", "1\n");
        let c1 = create_commit(&repo, "c1").unwrap();
        write_and_stage(&repo, &dir, "b.txt", "2\n");
        create_commit(&repo, "c2").unwrap();

        // Fabricate a 2-parent (merge) commit at HEAD.
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let other = repo.find_commit(c1.parse().unwrap()).unwrap();
        let tree = head.tree().unwrap();
        let merge = repo
            .commit(Some("HEAD"), &sig, &sig, "merge", &tree, &[&head, &other])
            .unwrap()
            .to_string();

        let err = squash_commits(&repo, &[merge, c1], "squashed").unwrap_err();
        assert!(err.to_string().contains("merge"), "got: {err}");
    }

    #[test]
    fn squash_refuses_fewer_than_two_commits() {
        let (dir, repo) = init_repo();
        let (_base, _c1, _c2, c3) = repo_with_chain(&dir, &repo);
        let err = squash_commits(&repo, &[c3], "squashed").unwrap_err();
        assert!(err.to_string().contains("at least two"), "got: {err}");
    }

    #[test]
    fn squash_leaves_the_working_tree_untouched() {
        let (dir, repo) = init_repo();
        let (_base, c1, c2, c3) = repo_with_chain(&dir, &repo);
        // A dirty, unstaged edit that must survive the squash.
        fs::write(dir.path().join("dirty.txt"), "wip\n").unwrap();

        squash_commits(&repo, &[c3, c2, c1], "squashed").unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("dirty.txt")).unwrap(),
            "wip\n"
        );
        // Only the untracked edit shows as changed — the squash didn't touch
        // tracked files.
        let status = get_working_tree_status(&repo).unwrap();
        assert_eq!(status.staged.len(), 0);
        assert_eq!(status.unstaged.len(), 0);
        assert_eq!(status.untracked.len(), 1);
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
        repo.reset(first_commit.as_object(), git2::ResetType::Soft, None)
            .unwrap();

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
        assert_eq!(
            reopened.get_string("user.email").unwrap(),
            "solo@example.com"
        );
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

        let c = get_stage_file_contents(&repo, "f.txt", false).unwrap();
        assert_eq!(c.head_content, "a\nb\nc\n");
        assert_eq!(c.worktree_content, "a\nB\nc\n");
        assert!(!c.is_binary);
    }

    #[test]
    fn get_stage_file_contents_rejects_paths_escaping_the_repo() {
        let (_dir, repo) = init_repo();
        make_initial_commit(&repo);
        assert!(get_stage_file_contents(&repo, "../../../etc/passwd", false).is_err());
    }

    #[test]
    fn stage_contents_split_by_staged_flag_reflects_partial_index() {
        // The editor shows the git-native pair per panel: Staged = HEAD→index,
        // Changes = index→working tree. With one of two edits staged, each view
        // shows exactly its own line.
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\nc\n");
        make_initial_commit(&repo);
        // Working tree edits the first and third lines.
        fs::write(dir.path().join("f.txt"), "A\nb\nC\n").unwrap();
        // Stage only the first edit: index becomes "A\nb\nc\n".
        stage_file_content(&repo, "f.txt", "A\nb\nc\n").unwrap();

        // Staged view (HEAD → index): only the first line differs.
        let staged = get_stage_file_contents(&repo, "f.txt", true).unwrap();
        assert_eq!(staged.head_content, "a\nb\nc\n");
        assert_eq!(staged.worktree_content, "A\nb\nc\n");

        // Unstaged view (index → working tree): only the third line differs.
        let unstaged = get_stage_file_contents(&repo, "f.txt", false).unwrap();
        assert_eq!(unstaged.head_content, "A\nb\nc\n");
        assert_eq!(unstaged.worktree_content, "A\nb\nC\n");
    }

    #[test]
    fn staged_view_of_a_newly_staged_file_diffs_head_against_index() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("new.txt"), "hello\n").unwrap();
        stage_file_content(&repo, "new.txt", "hello\n").unwrap();

        // Staged: HEAD (absent) → index ("hello\n").
        let staged = get_stage_file_contents(&repo, "new.txt", true).unwrap();
        assert_eq!(staged.head_content, "");
        assert_eq!(staged.worktree_content, "hello\n");
        assert!(staged.worktree_exists, "the index still tracks the file");
    }

    #[test]
    fn get_stage_file_contents_empty_head_for_new_file() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("new.txt"), "hello\n").unwrap();

        let c = get_stage_file_contents(&repo, "new.txt", false).unwrap();
        assert_eq!(c.head_content, "");
        assert_eq!(c.worktree_content, "hello\n");
    }

    #[test]
    fn get_stage_file_contents_flags_a_deletion() {
        let (dir, repo) = init_repo();
        write_and_stage(&repo, &dir, "f.txt", "a\nb\n");
        make_initial_commit(&repo);
        fs::remove_file(dir.path().join("f.txt")).unwrap();

        let c = get_stage_file_contents(&repo, "f.txt", false).unwrap();
        assert!(!c.worktree_exists);
        assert_eq!(c.head_content, "a\nb\n");
    }

    #[test]
    fn get_stage_file_contents_flags_binary() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        fs::write(dir.path().join("bin"), b"a\0b").unwrap();

        let c = get_stage_file_contents(&repo, "bin", false).unwrap();
        assert!(c.is_binary);
    }

    #[test]
    fn get_stage_file_contents_returns_a_data_uri_for_an_image() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        // Minimal PNG signature bytes — enough to exercise the data-URI path.
        fs::write(
            dir.path().join("logo.png"),
            [0x89, b'P', b'N', b'G', 0, 1, 2],
        )
        .unwrap();

        let c = get_stage_file_contents(&repo, "logo.png", false).unwrap();
        // New (worktree) side is an image; no previous version on the HEAD side.
        let uri = c.worktree_image.expect("image data URI");
        assert!(uri.starts_with("data:image/png;base64,"));
        assert_eq!(c.head_image, None);

        // A non-image binary gets no image preview.
        fs::write(dir.path().join("blob.bin"), b"a\0b").unwrap();
        let bin = get_stage_file_contents(&repo, "blob.bin", false).unwrap();
        assert_eq!(bin.worktree_image, None);
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

        let c = get_stage_file_contents(&repo, "f.txt", false).unwrap();
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
        let mode_before = repo
            .index()
            .unwrap()
            .get_path(Path::new("f.txt"), 0)
            .unwrap()
            .mode;

        stage_file_content(&repo, "f.txt", "a\nb\n").unwrap();

        let mode_after = repo
            .index()
            .unwrap()
            .get_path(Path::new("f.txt"), 0)
            .unwrap()
            .mode;
        assert_eq!(mode_before, mode_after);
    }

    #[test]
    fn unstage_hunk_on_a_newly_staged_all_add_file_removes_the_index_entry() {
        let (dir, repo) = init_repo();
        make_initial_commit(&repo);
        write_and_stage(&repo, &dir, "new.txt", "line1\nline2\n");

        let hunks = crate::diff_engine::get_staged_diff(&repo, "new.txt")
            .unwrap()
            .hunks;
        assert_eq!(hunks.len(), 1);
        unstage_hunk(&repo, "new.txt", 0).unwrap();

        // `unstage_hunk` shells out to `git apply`, which rewrites `.git/index`
        // on disk directly; force a re-read so this repo handle's cached Index
        // object (opened earlier by `write_and_stage`/`get_staged_diff`) picks
        // up that external change instead of asserting on a stale snapshot.
        let mut index = repo.index().unwrap();
        index.read(true).unwrap();
        assert!(
            index.get_path(Path::new("new.txt"), 0).is_none(),
            "unstaging every line of a newly-added file must remove the index entry \
             entirely, matching `git restore --staged`, not leave a staged empty blob"
        );
    }
}
