use crate::commands::repo::{RepoInfo, RepoKind};
use anyhow::{anyhow, Context};
use git2::Repository;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorktreeListEntry {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CreateWorktreeMode {
    ExistingBranch,
    NewBranchFromBase,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub name: String,
    pub repo_kind: RepoKind,
    pub branch: Option<String>,
    pub is_current: bool,
    pub is_open: bool,
    pub is_locked: bool,
    pub has_uncommitted_changes: bool,
    pub parent_repo_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorktreeResult {
    pub removed_path: String,
    pub closed_tab: bool,
    pub active_repo: Option<RepoInfo>,
}

fn normalize_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(crate) fn parse_worktree_list(text: &str) -> anyhow::Result<Vec<WorktreeListEntry>> {
    let mut entries = Vec::new();
    let mut current: Option<WorktreeListEntry> = None;

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(WorktreeListEntry {
                path: PathBuf::from(rest),
                branch: None,
                locked: false,
                prunable: false,
            });
            continue;
        }

        let Some(entry) = current.as_mut() else {
            continue;
        };

        if let Some(rest) = line.strip_prefix("branch refs/heads/") {
            entry.branch = Some(rest.to_string());
        } else if line == "detached" {
            entry.branch = None;
        } else if line.starts_with("locked") {
            entry.locked = true;
        } else if line == "prunable" || line.starts_with("prunable ") {
            entry.prunable = true;
        }
    }

    if let Some(entry) = current.take() {
        entries.push(entry);
    }

    if entries.is_empty() {
        return Err(anyhow!("git worktree list returned no entries"));
    }

    Ok(entries)
}

pub(crate) fn worktree_list(repo: &Repository) -> anyhow::Result<Vec<WorktreeListEntry>> {
    let output = std::process::Command::new("git")
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .current_dir(
            repo.workdir()
                .context("repository has no working directory")?,
        )
        .output()
        .context("failed to run git worktree list")?;

    if !output.status.success() {
        return Err(anyhow!(
            "git worktree list failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    parse_worktree_list(&String::from_utf8_lossy(&output.stdout))
}

fn basic_repo_info(repo: &Repository) -> RepoInfo {
    let path = repo
        .workdir()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    let head_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    RepoInfo {
        name,
        path: path.clone(),
        head_branch: head_branch.clone(),
        repo_kind: RepoKind::Main,
        parent_repo_path: None,
        common_dir_path: repo
            .commondir()
            .to_str()
            .unwrap_or(path.as_str())
            .to_string(),
        worktree_branch: head_branch,
        worktree_locked: false,
        worktree_prunable: false,
    }
}

fn main_worktree_path(
    entries: &[WorktreeListEntry],
    current_common_dir: &Path,
) -> anyhow::Result<Option<PathBuf>> {
    let target_common = normalize_path(current_common_dir);
    for entry in entries {
        let Ok(candidate) = Repository::open(&entry.path) else {
            continue;
        };
        if normalize_path(candidate.path()) == target_common {
            return Ok(candidate.workdir().map(normalize_path));
        }
    }
    Ok(None)
}

pub(crate) fn list_worktrees(
    repo: &Repository,
    current_repo_path: &Path,
    open_paths: &HashSet<String>,
) -> anyhow::Result<Vec<WorktreeEntry>> {
    let entries = worktree_list(repo)?;
    let current_path = normalize_path(current_repo_path);
    let main_path = main_worktree_path(&entries, repo.commondir())?
        .or_else(|| entries.first().map(|entry| normalize_path(&entry.path)))
        .unwrap_or_else(|| current_path.clone());
    let main_path_str = path_to_string(&main_path);

    let mut out = Vec::new();
    for entry in entries {
        let path = normalize_path(&entry.path);
        let path_str = path_to_string(&path);
        let repo_kind = if path == main_path {
            RepoKind::Main
        } else {
            RepoKind::Worktree
        };
        let parent_repo_path = match repo_kind {
            RepoKind::Main => None,
            RepoKind::Worktree => Some(main_path_str.clone()),
        };
        let has_uncommitted_changes = Repository::open(&path)
            .ok()
            .and_then(|repo| crate::working_tree::get_working_tree_status(&repo).ok())
            .map(|status| {
                !status.staged.is_empty()
                    || !status.unstaged.is_empty()
                    || !status.untracked.is_empty()
            })
            .unwrap_or(false);

        out.push(WorktreeEntry {
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(path_str.as_str())
                .to_string(),
            path: path_str.clone(),
            repo_kind,
            branch: entry.branch,
            is_current: path == current_path,
            is_open: open_paths.contains(&path_str),
            is_locked: entry.locked,
            has_uncommitted_changes,
            parent_repo_path,
        });
    }

    Ok(out)
}

pub(crate) fn create_worktree(
    repo: &Repository,
    target_path: &Path,
    mode: CreateWorktreeMode,
    branch_name: Option<&str>,
    start_point: Option<&str>,
) -> anyhow::Result<()> {
    if target_path.exists() {
        let mut contents = std::fs::read_dir(target_path)
            .with_context(|| format!("failed to read {}", target_path.display()))?;
        if contents.next().is_some() {
            anyhow::bail!("Target folder must not already contain files");
        }
    }

    let mut command = std::process::Command::new("git");
    command.arg("worktree").arg("add").arg(target_path);
    match mode {
        CreateWorktreeMode::ExistingBranch => {
            let branch = branch_name.context("existing branch mode requires a branch name")?;
            command.arg(branch);
        }
        CreateWorktreeMode::NewBranchFromBase => {
            let branch = branch_name.context("new branch mode requires a branch name")?;
            let start = start_point.context("new branch mode requires a start point")?;
            command.arg("-b").arg(branch).arg(start);
        }
    }
    let output = command
        .current_dir(
            repo.workdir()
                .context("repository has no working directory")?,
        )
        .output()
        .context("failed to run git worktree add")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.contains("already checked out") || stderr.contains("already used by worktree") {
            anyhow::bail!("{stderr}");
        }
        anyhow::bail!("git worktree add failed: {stderr}");
    }
    Ok(())
}

pub(crate) fn lock_worktree(path: &Path) -> anyhow::Result<()> {
    let repo = Repository::open(path)
        .with_context(|| format!("not a git repository: {}", path.display()))?;
    let output = std::process::Command::new("git")
        .args(["worktree", "lock", path.to_string_lossy().as_ref()])
        .current_dir(
            repo.workdir()
                .context("repository has no working directory")?,
        )
        .output()
        .context("failed to run git worktree lock")?;
    if !output.status.success() {
        anyhow::bail!(
            "git worktree lock failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub(crate) fn unlock_worktree(path: &Path) -> anyhow::Result<()> {
    let repo = Repository::open(path)
        .with_context(|| format!("not a git repository: {}", path.display()))?;
    let output = std::process::Command::new("git")
        .args(["worktree", "unlock", path.to_string_lossy().as_ref()])
        .current_dir(
            repo.workdir()
                .context("repository has no working directory")?,
        )
        .output()
        .context("failed to run git worktree unlock")?;
    if !output.status.success() {
        anyhow::bail!(
            "git worktree unlock failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub(crate) fn remove_worktree(path: &Path) -> anyhow::Result<()> {
    let repo = Repository::open(path)
        .with_context(|| format!("not a git repository: {}", path.display()))?;
    let info = resolve_repo_info(&repo)?;
    if info.repo_kind == RepoKind::Main {
        anyhow::bail!("cannot remove the main working tree");
    }
    if info.worktree_locked {
        anyhow::bail!("cannot remove a locked worktree");
    }

    let status = crate::working_tree::get_working_tree_status(&repo)?;
    if !status.staged.is_empty() || !status.unstaged.is_empty() || !status.untracked.is_empty() {
        anyhow::bail!("cannot remove a worktree with uncommitted changes");
    }

    let output = std::process::Command::new("git")
        .args(["worktree", "remove", path.to_string_lossy().as_ref()])
        .current_dir(
            repo.workdir()
                .context("repository has no working directory")?,
        )
        .output()
        .context("failed to run git worktree remove")?;
    if !output.status.success() {
        anyhow::bail!(
            "git worktree remove failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub(crate) fn resolve_repo_info(repo: &Repository) -> anyhow::Result<RepoInfo> {
    let mut info = basic_repo_info(repo);
    let entries = worktree_list(repo)?;
    let current_path = normalize_path(
        repo.workdir()
            .context("repository has no working directory")?,
    );
    let current_common = normalize_path(repo.commondir());
    let main_path = main_worktree_path(&entries, repo.commondir())?
        .or_else(|| entries.first().map(|e| normalize_path(&e.path)))
        .unwrap_or_else(|| current_path.clone());

    if let Some(entry) = entries
        .iter()
        .find(|entry| normalize_path(&entry.path) == current_path)
    {
        info.worktree_branch = entry.branch.clone();
        info.worktree_locked = entry.locked;
        info.worktree_prunable = entry.prunable;
    }

    info.common_dir_path = current_common.to_string_lossy().into_owned();
    if current_path == main_path {
        info.repo_kind = RepoKind::Main;
        info.parent_repo_path = None;
    } else {
        info.repo_kind = RepoKind::Worktree;
        info.parent_repo_path = Some(main_path.to_string_lossy().into_owned());
    }

    Ok(info)
}

pub(crate) fn degraded_repo_info(repo: &Repository) -> RepoInfo {
    basic_repo_info(repo)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use tempfile::TempDir;

    fn init_repo_with_commit() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Test").unwrap();
            config.set_str("user.email", "test@test.com").unwrap();
        }
        {
            let sig = Signature::now("Test", "test@test.com").unwrap();
            let tree_id = {
                let mut index = repo.index().unwrap();
                index.write_tree().unwrap()
            };
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
                .unwrap();
        }
        (dir, repo)
    }

    fn create_branch(repo: &Repository, name: &str) {
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch(name, &head, false).unwrap();
    }

    #[test]
    fn parse_worktree_list_marks_main_and_linked_entries() {
        let text = "\
worktree /repos/main
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /repos/main-feature
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feature/worktree

";

        let entries = parse_worktree_list(text).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, std::path::PathBuf::from("/repos/main"));
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert_eq!(entries[1].branch.as_deref(), Some("feature/worktree"));
    }

    #[test]
    fn parse_worktree_list_marks_locked_and_prunable_entries() {
        let text = "\
worktree /repos/main-hotfix
HEAD 3333333333333333333333333333333333333333
branch refs/heads/hotfix
locked maintenance window
prunable worktree path missing

";

        let entries = parse_worktree_list(text).unwrap();

        assert!(entries[0].locked);
        assert!(entries[0].prunable);
    }

    #[test]
    fn parse_worktree_list_handles_detached_entries() {
        let text = "\
worktree /repos/detached
HEAD 4444444444444444444444444444444444444444
detached

";

        let entries = parse_worktree_list(text).unwrap();

        assert_eq!(entries[0].branch, None);
    }

    #[test]
    fn remove_worktree_rejects_dirty_entries() {
        let (main_dir, repo) = init_repo_with_commit();
        create_branch(&repo, "feature/worktree");
        let worktree_dir = tempfile::tempdir().unwrap();
        let output = std::process::Command::new("git")
            .args([
                "worktree",
                "add",
                worktree_dir.path().to_str().unwrap(),
                "feature/worktree",
            ])
            .current_dir(main_dir.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        std::fs::write(worktree_dir.path().join("dirty.txt"), "dirty\n").unwrap();

        let err = remove_worktree(worktree_dir.path()).unwrap_err();

        assert!(err
            .to_string()
            .contains("cannot remove a worktree with uncommitted changes"));
    }
}
