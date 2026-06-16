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
    Ok(oid.to_string())
}

pub fn get_commit_identity(repo: &Repository) -> anyhow::Result<Identity> {
    let config = repo.config().context("failed to read git config")?;
    Ok(Identity {
        name: config.get_string("user.name").unwrap_or_default(),
        email: config.get_string("user.email").unwrap_or_default(),
    })
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

    #[test]
    fn get_commit_identity_reads_from_config() {
        let (_dir, repo) = init_repo();
        let identity = get_commit_identity(&repo).unwrap();
        assert_eq!(identity.name, "Test User");
        assert_eq!(identity.email, "test@test.com");
    }
}
