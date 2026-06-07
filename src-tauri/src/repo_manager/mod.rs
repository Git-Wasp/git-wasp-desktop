mod config;

pub use config::{AppConfig, RepoEntry};

use crate::commands::branch::BranchInfo;
use crate::commands::repo::RepoInfo;
use crate::merge_ops::{ConflictedFile, MergeOutcome};
use crate::operation_runner::{OperationKind, OperationState, OperationStatus};
use anyhow::Context;
use git2::{BranchType, ObjectType, Repository};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::Manager;

pub struct RepoManager {
    repo: Mutex<Option<Repository>>,
    operation: Mutex<Option<OperationState>>,
    config: Mutex<AppConfig>,
}

impl RepoManager {
    fn new() -> Self {
        Self {
            repo: Mutex::new(None),
            operation: Mutex::new(None),
            config: Mutex::new(AppConfig::load()),
        }
    }

    fn repo_lock(&self) -> anyhow::Result<MutexGuard<'_, Option<Repository>>> {
        self.repo.lock().map_err(|_| anyhow::anyhow!("repo lock poisoned"))
    }

    fn operation_lock(&self) -> anyhow::Result<MutexGuard<'_, Option<OperationState>>> {
        self.operation.lock().map_err(|_| anyhow::anyhow!("operation lock poisoned"))
    }

    fn config_lock(&self) -> anyhow::Result<MutexGuard<'_, AppConfig>> {
        self.config.lock().map_err(|_| anyhow::anyhow!("config lock poisoned"))
    }

    /// Locks the repo and operation state together as a single critical
    /// section — the only sanctioned way to touch both, so lock order
    /// (repo, then operation) stays consistent everywhere and there's no new
    /// ordering hazard alongside the existing `repo_lock`/`config_lock`.
    fn with_repo_and_operation_mut<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Repository, &mut Option<OperationState>) -> anyhow::Result<T>,
    {
        let mut repo_lock = self.repo_lock()?;
        let repo = repo_lock.as_mut().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let mut op_lock = self.operation_lock()?;
        f(repo, &mut op_lock)
    }

    pub fn open(&self, path: &str) -> anyhow::Result<RepoInfo> {
        let repo = Repository::open(path)
            .with_context(|| format!("not a git repository: {path}"))?;

        let name = Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path)
            .to_string();

        let head_branch = repo.head().ok().and_then(|h| {
            h.shorthand().map(|s| s.to_string())
        });

        let info = RepoInfo { name: name.clone(), path: path.to_string(), head_branch };

        let mut config = self.config_lock()?;
        config.add_recent(RepoEntry {
            path: path.into(),
            name,
            pinned: false,
            last_opened: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        });
        let _ = config.save();
        drop(config);

        *self.repo_lock()? = Some(repo);

        Ok(info)
    }

    pub fn get_current(&self) -> anyhow::Result<Option<RepoInfo>> {
        let lock = self.repo_lock()?;
        let Some(repo) = lock.as_ref() else { return Ok(None) };
        let path = repo.path()
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();
        let name = Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path)
            .to_string();
        let head_branch = repo.head().ok().and_then(|h| h.shorthand().map(|s| s.to_string()));
        Ok(Some(RepoInfo { name, path, head_branch }))
    }

    pub fn get_recent(&self) -> anyhow::Result<Vec<RepoEntry>> {
        Ok(self.config_lock()?.recent_repos.clone())
    }

    pub fn with_repo<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Repository) -> T,
    {
        let lock = self.repo_lock()?;
        let repo = lock.as_ref().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        Ok(f(repo))
    }

    pub fn with_repo_mut<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Repository) -> T,
    {
        let mut lock = self.repo_lock()?;
        let repo = lock.as_mut().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        Ok(f(repo))
    }

    pub fn checkout_branch(&self, branch_name: &str) -> anyhow::Result<RepoInfo> {
        // All borrows from lock must be dropped before this block exits so
        // the mutex guard is released before we call get_current() below.
        {
            let lock = self.repo_lock()?;
            let repo = lock.as_ref().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
            let branch = repo
                .find_branch(branch_name, BranchType::Local)
                .with_context(|| format!("branch not found: {branch_name}"))?;
            let obj = branch
                .get()
                .peel(ObjectType::Commit)
                .context("could not resolve branch to commit")?;
            let head_ref = branch.get().name().unwrap().to_string();
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.safe();
            repo.checkout_tree(&obj, Some(&mut checkout))
                .context("checkout failed — working tree has conflicting changes")?;
            repo.set_head(&head_ref).context("could not update HEAD")?;
            // obj, branch, lock all dropped here in reverse declaration order
        }
        self.get_current()?.ok_or_else(|| anyhow::anyhow!("no repo after checkout"))
    }

    pub fn create_branch(&self, name: &str, start_oid: Option<&str>) -> anyhow::Result<BranchInfo> {
        let lock = self.repo_lock()?;
        let repo = lock.as_ref().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let commit = match start_oid {
            Some(oid) => repo.find_commit(git2::Oid::from_str(oid)?)?,
            None => repo.head()?.peel_to_commit()?,
        };
        repo.branch(name, &commit, false)
            .with_context(|| format!("failed to create branch: {name}"))?;
        let oid = commit.id().to_string();
        Ok(BranchInfo {
            name: name.to_string(),
            is_remote: false,
            is_head: false,
            upstream: None,
            oid,
            ahead: None,
            behind: None,
        })
    }

    pub fn rename_branch(&self, old_name: &str, new_name: &str) -> anyhow::Result<()> {
        let lock = self.repo_lock()?;
        let repo = lock.as_ref().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let mut branch = repo.find_branch(old_name, BranchType::Local)
            .with_context(|| format!("branch not found: {old_name}"))?;
        branch.rename(new_name, false)
            .with_context(|| format!("failed to rename branch to: {new_name}"))?;
        Ok(())
    }

    pub fn delete_branch(&self, name: &str) -> anyhow::Result<()> {
        let lock = self.repo_lock()?;
        let repo = lock.as_ref().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let mut branch = repo.find_branch(name, BranchType::Local)
            .with_context(|| format!("branch not found: {name}"))?;
        if branch.is_head() {
            anyhow::bail!("Cannot delete the currently checked out branch: {name}");
        }
        branch.delete().with_context(|| format!("failed to delete branch: {name}"))?;
        Ok(())
    }

    pub fn operation_status(&self) -> anyhow::Result<OperationStatus> {
        let repo_lock = self.repo_lock()?;
        let repo = repo_lock.as_ref().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let mut op_lock = self.operation_lock()?;
        crate::operation_runner::derive_status(repo, &mut op_lock)
    }

    /// Re-derives and returns the current status. A distinct command from
    /// `operation_status` per CLAUDE.md's `resume`/`abort`/`status` contract —
    /// for merge it's equivalent to a status check, but future pauseable
    /// operations (e.g. interactive rebase) will use `resume` to pick a
    /// paused sequence back up rather than just report on it.
    pub fn operation_resume(&self) -> anyhow::Result<OperationStatus> {
        self.operation_status()
    }

    pub fn operation_abort(&self) -> anyhow::Result<()> {
        let kind = {
            let op_lock = self.operation_lock()?;
            op_lock.as_ref().map(|s| s.kind)
        };
        match kind {
            Some(OperationKind::Merge) => self.merge_abort(),
            None => match self.operation_status()? {
                OperationStatus::Merge { .. } => self.merge_abort(),
                OperationStatus::None => anyhow::bail!("no operation in progress to abort"),
            },
        }
    }

    pub fn merge_start(&self, branch_name: &str) -> anyhow::Result<MergeOutcome> {
        self.with_repo_and_operation_mut(|repo, op| {
            crate::operation_runner::start_merge(repo, op, branch_name)
        })
    }

    pub fn merge_resolve_file(&self, path: &str, content: &str) -> anyhow::Result<Vec<ConflictedFile>> {
        let repo_lock = self.repo_lock()?;
        let repo = repo_lock.as_ref().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        crate::merge_ops::write_resolution(repo, path, content)?;
        crate::merge_ops::collect_conflicts(repo)
    }

    pub fn merge_complete(&self, message: &str) -> anyhow::Result<String> {
        self.with_repo_and_operation_mut(|repo, op| {
            crate::operation_runner::complete_merge(repo, op, message)
        })
    }

    pub fn merge_abort(&self) -> anyhow::Result<()> {
        self.with_repo_and_operation_mut(|repo, op| crate::operation_runner::abort_merge(repo, op))
    }
}

/// Tauri managed state — wraps RepoManager in Arc so it can be cloned into
/// the async command handlers without holding a lock across await points.
/// Also holds the file watcher and credential store for the app's lifetime.
pub struct AppState {
    pub manager: Arc<RepoManager>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
    pub credentials: Box<dyn crate::credential_store::CredentialStore>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            manager: Arc::new(RepoManager::new()),
            watcher: Mutex::new(None),
            credentials: Box::new(crate::credential_store::KeyringStore),
        }
    }

    pub fn known_github_hosts(&self) -> anyhow::Result<Vec<String>> {
        let config = self.manager.config_lock()?;
        Ok(config.github_hosts.iter().map(|h| h.base_url.clone()).collect())
    }

    pub fn open_repo(&self, path: &str, app_handle: Option<tauri::AppHandle>) -> anyhow::Result<RepoInfo> {
        let info = self.manager.open(path)?;
        // Start file watcher on the new workdir
        if let Some(handle) = app_handle {
            let workdir = std::path::PathBuf::from(path);
            if let Ok(w) = crate::file_watcher::start(handle, &workdir) {
                if let Ok(mut lock) = self.watcher.lock() {
                    *lock = Some(w);
                }
            }
        }
        Ok(info)
    }

    pub fn get_current_repo(&self) -> anyhow::Result<Option<RepoInfo>> {
        self.manager.get_current()
    }

    pub fn get_recent_repos(&self) -> anyhow::Result<Vec<RepoEntry>> {
        self.manager.get_recent()
    }

    pub fn with_repo<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Repository) -> T,
    {
        self.manager.with_repo(f)
    }

    pub fn with_repo_mut<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Repository) -> T,
    {
        self.manager.with_repo_mut(f)
    }

    pub fn checkout_branch(&self, branch_name: &str) -> anyhow::Result<RepoInfo> {
        self.manager.checkout_branch(branch_name)
    }

    pub fn create_branch(&self, name: &str, start_oid: Option<&str>) -> anyhow::Result<BranchInfo> {
        self.manager.create_branch(name, start_oid)
    }

    pub fn rename_branch(&self, old_name: &str, new_name: &str) -> anyhow::Result<()> {
        self.manager.rename_branch(old_name, new_name)
    }

    pub fn delete_branch(&self, name: &str) -> anyhow::Result<()> {
        self.manager.delete_branch(name)
    }

    pub fn operation_status(&self) -> anyhow::Result<OperationStatus> {
        self.manager.operation_status()
    }

    pub fn operation_resume(&self) -> anyhow::Result<OperationStatus> {
        self.manager.operation_resume()
    }

    pub fn operation_abort(&self) -> anyhow::Result<()> {
        self.manager.operation_abort()
    }

    pub fn merge_start(&self, branch_name: &str) -> anyhow::Result<MergeOutcome> {
        self.manager.merge_start(branch_name)
    }

    pub fn merge_resolve_file(&self, path: &str, content: &str) -> anyhow::Result<Vec<ConflictedFile>> {
        self.manager.merge_resolve_file(path, content)
    }

    pub fn merge_complete(&self, message: &str) -> anyhow::Result<String> {
        self.manager.merge_complete(message)
    }

    pub fn merge_abort(&self) -> anyhow::Result<()> {
        self.manager.merge_abort()
    }
}

pub fn restore_last_repo(app: &tauri::App) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let config = state.manager.config_lock()?;
    let last = config.last_repo_path.clone();
    drop(config);
    if let Some(path) = last {
        if path.exists() {
            let handle = app.app_handle().clone();
            let _ = state.open_repo(path.to_str().unwrap_or(""), Some(handle));
        }
    }
    Ok(())
}

pub fn list_branches(repo: &Repository) -> anyhow::Result<Vec<BranchInfo>> {
    let ahead_behind_map: std::collections::HashMap<String, (usize, usize)> =
        crate::remote_ops::compute_ahead_behind(repo)
            .unwrap_or_default()
            .into_iter()
            .map(|ab| (ab.branch, (ab.ahead, ab.behind)))
            .collect();

    let mut branches = Vec::new();
    for branch in repo.branches(None).context("failed to list branches")? {
        let (branch, branch_type) = branch.context("invalid branch reference")?;
        let name = branch.name()?.unwrap_or("").to_string();
        let is_remote = branch_type == BranchType::Remote;
        let is_head = branch.is_head();
        let oid = branch
            .get()
            .peel(ObjectType::Commit)
            .map(|o| o.id().to_string())
            .unwrap_or_default();
        let upstream = branch.upstream().ok().and_then(|u| {
            u.name().ok().flatten().map(|s| s.to_string())
        });
        let (ahead, behind) = ahead_behind_map
            .get(&name)
            .map(|&(a, b)| (Some(a), Some(b)))
            .unwrap_or((None, None));
        branches.push(BranchInfo { name, is_remote, is_head, upstream, oid, ahead, behind });
    }
    Ok(branches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use tempfile::TempDir;

    fn make_git_repo_with_commit() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        {
            let sig = Signature::now("Test", "test@test.com").unwrap();
            let tree_id = {
                let mut index = repo.index().unwrap();
                index.write_tree().unwrap()
            };
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();
            drop(tree);
        }
        (dir, repo)
    }

    #[test]
    fn open_valid_repo_succeeds() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        let result = manager.open(dir.path().to_str().unwrap());
        assert!(result.is_ok(), "{:?}", result.err());
        let info = result.unwrap();
        assert!(!info.name.is_empty());
    }

    #[test]
    fn open_non_repo_path_returns_error() {
        let dir = TempDir::new().unwrap();
        let manager = RepoManager::new();
        let result = manager.open(dir.path().to_str().unwrap());
        assert!(result.is_err());
    }

    #[test]
    fn config_add_recent_persists_entry() {
        let mut config = AppConfig::default();
        config.add_recent(RepoEntry {
            path: "/tmp/foo".into(),
            name: "foo".into(),
            pinned: false,
            last_opened: 0,
        });
        assert_eq!(config.recent_repos.len(), 1);
        assert_eq!(config.recent_repos[0].name, "foo");
        assert_eq!(config.last_repo_path, Some("/tmp/foo".into()));
    }

    #[test]
    fn recent_repos_capped_at_ten() {
        let mut config = AppConfig::default();
        for i in 0..15 {
            config.add_recent(RepoEntry {
                path: format!("/tmp/repo{i}").into(),
                name: format!("repo{i}"),
                pinned: false,
                last_opened: 0,
            });
        }
        assert_eq!(config.recent_repos.len(), 10);
    }

    #[test]
    fn last_repo_path_updated_on_open() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        let config = manager.config_lock().unwrap();
        assert_eq!(
            config.last_repo_path.as_ref().unwrap(),
            dir.path()
        );
    }

    #[test]
    fn get_current_repo_returns_none_when_no_repo_open() {
        let manager = RepoManager::new();
        let result = manager.get_current().unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn get_current_repo_returns_info_when_open() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        let result = manager.get_current().unwrap();
        assert!(result.is_some());
    }

    #[test]
    fn list_branches_returns_branches() {
        let (_dir, repo) = make_git_repo_with_commit();
        let branches = list_branches(&repo).unwrap();
        assert!(!branches.is_empty());
        let head_branch = branches.iter().find(|b| b.is_head);
        assert!(head_branch.is_some());
    }

    #[test]
    fn create_branch_succeeds() {
        let (_dir, _repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(_dir.path().to_str().unwrap()).unwrap();
        let info = manager.create_branch("feature/new", None).unwrap();
        assert_eq!(info.name, "feature/new");
        let branches = manager.with_repo(|r| list_branches(r)).unwrap().unwrap();
        assert!(branches.iter().any(|b| b.name == "feature/new"));
    }

    #[test]
    fn create_branch_duplicate_name_returns_error() {
        let (_dir, _repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(_dir.path().to_str().unwrap()).unwrap();
        manager.create_branch("dup", None).unwrap();
        let result = manager.create_branch("dup", None);
        assert!(result.is_err());
    }

    #[test]
    fn rename_branch_updates_name() {
        let (_dir, _repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(_dir.path().to_str().unwrap()).unwrap();
        manager.create_branch("old-name", None).unwrap();
        manager.rename_branch("old-name", "new-name").unwrap();
        let branches = manager.with_repo(|r| list_branches(r)).unwrap().unwrap();
        assert!(branches.iter().any(|b| b.name == "new-name"));
        assert!(branches.iter().all(|b| b.name != "old-name"));
    }

    #[test]
    fn delete_branch_removes_it() {
        let (_dir, _repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(_dir.path().to_str().unwrap()).unwrap();
        manager.create_branch("to-delete", None).unwrap();
        manager.delete_branch("to-delete").unwrap();
        let branches = manager.with_repo(|r| list_branches(r)).unwrap().unwrap();
        assert!(branches.iter().all(|b| b.name != "to-delete"));
    }

    #[test]
    fn delete_current_branch_returns_error() {
        let (_dir, _repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(_dir.path().to_str().unwrap()).unwrap();
        // The HEAD branch (main/master) is the current branch
        let head_branch = manager.get_current().unwrap().unwrap().head_branch.unwrap();
        let result = manager.delete_branch(&head_branch);
        assert!(result.is_err());
    }
}
