use crate::commands::repo::{RepoInfo, RepoKind};
use anyhow::{anyhow, Context};
use git2::Repository;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorktreeListEntry {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub locked: bool,
    pub prunable: bool,
}

fn normalize_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
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
}
