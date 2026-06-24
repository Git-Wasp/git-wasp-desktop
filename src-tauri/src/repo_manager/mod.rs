mod config;

pub use config::{AppConfig, RepoEntry};

use crate::commands::branch::BranchInfo;
use crate::commands::repo::RepoInfo;
use crate::merge_ops::{ConflictSide, ConflictedFile, MergeOutcome};
use crate::operation_runner::{OperationKind, OperationState, OperationStatus};
use anyhow::Context;
use git2::{BranchType, ObjectType, Repository};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::Manager;

/// A single open repository tab, carrying its own in-progress operation so a
/// merge (or future rebase) in one tab can't leak into another.
struct OpenRepo {
    /// Stable identity = the git2-normalised workdir path. Also the value the
    /// frontend passes back to `activate`/`close` (it's `RepoInfo.path`).
    key: String,
    repo: Repository,
    operation: Option<OperationState>,
    /// Cached commit-graph layout, reused across scroll fetches and rebuilt only
    /// when HEAD or refs move. `None` until the graph is first requested.
    graph_cache: Option<crate::graph::GraphCache>,
}

pub struct RepoManager {
    repos: Mutex<Vec<OpenRepo>>,
    active: Mutex<Option<String>>,
    config: Mutex<AppConfig>,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Derive display info from a repo handle. The workdir path doubles as the tab
/// key — git2 normalises it, so the same repo opened via different path strings
/// resolves to one tab.
fn repo_info(repo: &Repository) -> RepoInfo {
    let path = repo
        .path()
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
    RepoInfo { name, path, head_branch }
}

impl RepoManager {
    fn new() -> Self {
        Self {
            repos: Mutex::new(Vec::new()),
            active: Mutex::new(None),
            config: Mutex::new(AppConfig::load()),
        }
    }

    // Lock order is always active → repos → config; every helper below obeys it.
    fn repos_lock(&self) -> anyhow::Result<MutexGuard<'_, Vec<OpenRepo>>> {
        self.repos.lock().map_err(|_| anyhow::anyhow!("repos lock poisoned"))
    }

    fn active_lock(&self) -> anyhow::Result<MutexGuard<'_, Option<String>>> {
        self.active.lock().map_err(|_| anyhow::anyhow!("active lock poisoned"))
    }

    fn config_lock(&self) -> anyhow::Result<MutexGuard<'_, AppConfig>> {
        self.config.lock().map_err(|_| anyhow::anyhow!("config lock poisoned"))
    }

    /// Run `f` against the active repo and its operation state under one lock —
    /// the only sanctioned way to touch both, mirroring how multi-step git ops
    /// route through a single critical section.
    fn with_repo_and_operation_mut<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Repository, &mut Option<OperationState>) -> anyhow::Result<T>,
    {
        let key = self.active_lock()?.clone().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let mut repos = self.repos_lock()?;
        let entry = repos.iter_mut().find(|r| r.key == key).ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        f(&mut entry.repo, &mut entry.operation)
    }

    /// Snapshot the open tabs (in order) + active into config and persist, so
    /// the session is restored on next launch.
    fn persist_session(&self) -> anyhow::Result<()> {
        let active = self.active_lock()?.clone().map(PathBuf::from);
        let open_paths: Vec<PathBuf> = self.repos_lock()?.iter().map(|r| PathBuf::from(&r.key)).collect();
        let mut config = self.config_lock()?;
        config.set_session(open_paths, active);
        let _ = config.save();
        Ok(())
    }

    pub fn open(&self, path: &str) -> anyhow::Result<RepoInfo> {
        let info = {
            let mut repos = self.repos_lock()?;
            let repo = Repository::open(path)
                .with_context(|| format!("not a git repository: {path}"))?;
            let info = repo_info(&repo);
            if !repos.iter().any(|r| r.key == info.path) {
                repos.push(OpenRepo { key: info.path.clone(), repo, operation: None, graph_cache: None });
            }
            info
        };
        *self.active_lock()? = Some(info.path.clone());
        {
            let mut config = self.config_lock()?;
            config.add_recent(RepoEntry {
                path: info.path.clone().into(),
                name: info.name.clone(),
                pinned: false,
                last_opened: now_millis(),
            });
        }
        self.persist_session()?;
        Ok(info)
    }

    /// Make an already-open repo the active tab.
    pub fn activate(&self, path: &str) -> anyhow::Result<RepoInfo> {
        let info = {
            let repos = self.repos_lock()?;
            let entry = repos
                .iter()
                .find(|r| r.key == path)
                .ok_or_else(|| anyhow::anyhow!("repository not open: {path}"))?;
            repo_info(&entry.repo)
        };
        *self.active_lock()? = Some(info.path.clone());
        self.persist_session()?;
        Ok(info)
    }

    /// Close a tab. If it was active, the active tab falls back to the first
    /// remaining repo (or `None` when the last tab is closed).
    pub fn close(&self, path: &str) -> anyhow::Result<Option<RepoInfo>> {
        let new_active = {
            let mut active = self.active_lock()?;
            let mut repos = self.repos_lock()?;
            repos.retain(|r| r.key != path);
            if active.as_deref() == Some(path) || active.is_none() {
                *active = repos.first().map(|r| r.key.clone());
            }
            match active.clone() {
                Some(ak) => repos.iter().find(|r| r.key == ak).map(|r| repo_info(&r.repo)),
                None => None,
            }
        };
        self.persist_session()?;
        Ok(new_active)
    }

    pub fn list_open(&self) -> anyhow::Result<Vec<RepoInfo>> {
        Ok(self.repos_lock()?.iter().map(|r| repo_info(&r.repo)).collect())
    }

    pub fn get_current(&self) -> anyhow::Result<Option<RepoInfo>> {
        let Some(key) = self.active_lock()?.clone() else { return Ok(None) };
        let repos = self.repos_lock()?;
        Ok(repos.iter().find(|r| r.key == key).map(|r| repo_info(&r.repo)))
    }

    pub fn get_recent(&self) -> anyhow::Result<Vec<RepoEntry>> {
        Ok(self.config_lock()?.recent_repos.clone())
    }

    pub fn with_repo<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Repository) -> T,
    {
        let key = self.active_lock()?.clone().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let repos = self.repos_lock()?;
        let entry = repos.iter().find(|r| r.key == key).ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        Ok(f(&entry.repo))
    }

    pub fn with_repo_mut<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Repository) -> T,
    {
        let key = self.active_lock()?.clone().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let mut repos = self.repos_lock()?;
        let entry = repos.iter_mut().find(|r| r.key == key).ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        Ok(f(&mut entry.repo))
    }

    /// Run `f` against the active repo and its (mutable) graph-layout cache. The
    /// graph command uses this so the cache lives as long as the tab does.
    pub fn with_repo_graph_cache<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Repository, &mut Option<crate::graph::GraphCache>) -> T,
    {
        let key = self.active_lock()?.clone().ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let mut repos = self.repos_lock()?;
        let entry = repos.iter_mut().find(|r| r.key == key).ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        Ok(f(&entry.repo, &mut entry.graph_cache))
    }

    /// Re-scans the working tree and updates the graph cache's dirty-file
    /// count, without rebuilding the full layout. Called when the file
    /// watcher reports a change, so the (expensive) scan happens once per
    /// change rather than once per scroll-driven viewport fetch.
    pub fn refresh_graph_working_tree_status(&self) -> anyhow::Result<()> {
        self.with_repo_graph_cache(|repo, cache| {
            crate::graph::refresh_working_tree_status(repo, cache);
        })
    }

    pub fn checkout_branch(&self, branch_name: &str) -> anyhow::Result<RepoInfo> {
        self.with_repo(|repo| -> anyhow::Result<()> {
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
            Ok(())
        })??;
        self.get_current()?.ok_or_else(|| anyhow::anyhow!("no repo after checkout"))
    }

    pub fn create_branch(&self, name: &str, start_oid: Option<&str>) -> anyhow::Result<BranchInfo> {
        self.with_repo(|repo| -> anyhow::Result<BranchInfo> {
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
        })?
    }

    pub fn rename_branch(&self, old_name: &str, new_name: &str) -> anyhow::Result<()> {
        self.with_repo(|repo| -> anyhow::Result<()> {
            let mut branch = repo.find_branch(old_name, BranchType::Local)
                .with_context(|| format!("branch not found: {old_name}"))?;
            branch.rename(new_name, false)
                .with_context(|| format!("failed to rename branch to: {new_name}"))?;
            Ok(())
        })?
    }

    pub fn delete_branch(&self, name: &str) -> anyhow::Result<()> {
        self.with_repo(|repo| -> anyhow::Result<()> {
            let mut branch = repo.find_branch(name, BranchType::Local)
                .with_context(|| format!("branch not found: {name}"))?;
            if branch.is_head() {
                anyhow::bail!("Cannot delete the currently checked out branch: {name}");
            }
            branch.delete().with_context(|| format!("failed to delete branch: {name}"))?;
            Ok(())
        })?
    }

    pub fn operation_status(&self) -> anyhow::Result<OperationStatus> {
        self.with_repo_and_operation_mut(|repo, op| crate::operation_runner::derive_status(repo, op))
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
        let kind = self.with_repo_and_operation_mut(|_repo, op| Ok(op.as_ref().map(|s| s.kind)))?;
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
        self.with_repo(|repo| -> anyhow::Result<Vec<ConflictedFile>> {
            crate::merge_ops::write_resolution(repo, path, content)?;
            crate::merge_ops::collect_conflicts(repo)
        })?
    }

    pub fn merge_resolve_with_side(&self, path: &str, side: ConflictSide) -> anyhow::Result<Vec<ConflictedFile>> {
        self.with_repo(|repo| -> anyhow::Result<Vec<ConflictedFile>> {
            crate::merge_ops::resolve_with_side(repo, path, side)?;
            crate::merge_ops::collect_conflicts(repo)
        })?
    }

    pub fn merge_resolve_with_deletion(&self, path: &str) -> anyhow::Result<Vec<ConflictedFile>> {
        self.with_repo(|repo| -> anyhow::Result<Vec<ConflictedFile>> {
            crate::merge_ops::resolve_with_deletion(repo, path)?;
            crate::merge_ops::collect_conflicts(repo)
        })?
    }

    pub fn merge_complete(&self, message: &str) -> anyhow::Result<String> {
        self.with_repo_and_operation_mut(|repo, op| {
            crate::operation_runner::complete_merge(repo, op, message)
        })
    }

    pub fn merge_abort(&self) -> anyhow::Result<()> {
        self.with_repo_and_operation_mut(|repo, op| crate::operation_runner::abort_merge(repo, op))
    }

    pub fn set_active_theme(&self, id: Option<&str>) -> anyhow::Result<()> {
        let mut config = self.config_lock()?;
        config.active_theme = id.map(|s| s.to_string());
        let _ = config.save();
        Ok(())
    }

    pub fn get_active_theme(&self) -> anyhow::Result<Option<String>> {
        Ok(self.config_lock()?.active_theme.clone())
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

    /// Point the single file watcher at `workdir` (the active tab's working
    /// tree), or stop it when `None`. Dropping the previous watcher stops it.
    fn restart_watcher(&self, app_handle: tauri::AppHandle, workdir: Option<&Path>) {
        let new = workdir.and_then(|w| crate::file_watcher::start(app_handle, w).ok());
        if let Ok(mut lock) = self.watcher.lock() {
            *lock = new;
        }
    }

    pub fn open_repo(&self, path: &str, app_handle: Option<tauri::AppHandle>) -> anyhow::Result<RepoInfo> {
        let info = self.manager.open(path)?;
        if let Some(handle) = app_handle {
            self.restart_watcher(handle, Some(Path::new(&info.path)));
        }
        Ok(info)
    }

    pub fn activate_repo(&self, path: &str, app_handle: Option<tauri::AppHandle>) -> anyhow::Result<RepoInfo> {
        let info = self.manager.activate(path)?;
        if let Some(handle) = app_handle {
            self.restart_watcher(handle, Some(Path::new(&info.path)));
        }
        Ok(info)
    }

    pub fn close_repo(&self, path: &str, app_handle: Option<tauri::AppHandle>) -> anyhow::Result<Option<RepoInfo>> {
        let info = self.manager.close(path)?;
        if let Some(handle) = app_handle {
            self.restart_watcher(handle, info.as_ref().map(|i| Path::new(i.path.as_str())));
        }
        Ok(info)
    }

    pub fn list_open_repos(&self) -> anyhow::Result<Vec<RepoInfo>> {
        self.manager.list_open()
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

    pub fn with_repo_graph_cache<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Repository, &mut Option<crate::graph::GraphCache>) -> T,
    {
        self.manager.with_repo_graph_cache(f)
    }

    pub fn refresh_graph_working_tree_status(&self) -> anyhow::Result<()> {
        self.manager.refresh_graph_working_tree_status()
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

    pub fn merge_resolve_with_side(&self, path: &str, side: ConflictSide) -> anyhow::Result<Vec<ConflictedFile>> {
        self.manager.merge_resolve_with_side(path, side)
    }

    pub fn merge_resolve_with_deletion(&self, path: &str) -> anyhow::Result<Vec<ConflictedFile>> {
        self.manager.merge_resolve_with_deletion(path)
    }

    pub fn merge_complete(&self, message: &str) -> anyhow::Result<String> {
        self.manager.merge_complete(message)
    }

    pub fn merge_abort(&self) -> anyhow::Result<()> {
        self.manager.merge_abort()
    }

    pub fn set_active_theme(&self, id: Option<&str>) -> anyhow::Result<()> {
        self.manager.set_active_theme(id)
    }

    pub fn get_active_theme(&self) -> anyhow::Result<Option<String>> {
        self.manager.get_active_theme()
    }
}

/// Reopen the tabs from the last session and activate the saved active tab,
/// then point the file watcher at it. Falls back to `last_repo_path` for
/// configs written before multi-tab existed.
pub fn restore_session(app: &tauri::App) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let (mut open_paths, active) = {
        let config = state.manager.config_lock()?;
        (config.open_repos.clone(), config.active_repo_path.clone())
    };
    if open_paths.is_empty() {
        let config = state.manager.config_lock()?;
        open_paths = config.last_repo_path.clone().into_iter().collect();
    }

    for path in &open_paths {
        if path.exists() {
            let _ = state.manager.open(path.to_str().unwrap_or(""));
        }
    }
    // `open` left the last-opened repo active; restore the saved active tab.
    if let Some(active) = active {
        if active.exists() {
            let _ = state.manager.activate(active.to_str().unwrap_or(""));
        }
    }

    if let Ok(Some(info)) = state.manager.get_current() {
        let handle = app.app_handle().clone();
        state.restart_watcher(handle, Some(Path::new(&info.path)));
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
        let info = manager.open(dir.path().to_str().unwrap()).unwrap();
        let config = manager.config_lock().unwrap();
        // The recorded path is the git2-normalised workdir (== the tab key),
        // which may differ from the raw tempdir path by symlink resolution.
        assert_eq!(config.last_repo_path.as_ref().unwrap(), &PathBuf::from(&info.path));
    }

    #[test]
    fn open_two_repos_lists_both_with_second_active() {
        let (dir_a, _) = make_git_repo_with_commit();
        let (dir_b, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(dir_a.path().to_str().unwrap()).unwrap();
        let b = manager.open(dir_b.path().to_str().unwrap()).unwrap();
        assert_eq!(manager.list_open().unwrap().len(), 2);
        assert_eq!(manager.get_current().unwrap().unwrap().path, b.path);
    }

    #[test]
    fn opening_same_repo_twice_keeps_one_tab() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(manager.list_open().unwrap().len(), 1);
    }

    #[test]
    fn activate_switches_the_active_tab() {
        let (dir_a, _) = make_git_repo_with_commit();
        let (dir_b, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        let a = manager.open(dir_a.path().to_str().unwrap()).unwrap();
        manager.open(dir_b.path().to_str().unwrap()).unwrap();
        manager.activate(&a.path).unwrap();
        assert_eq!(manager.get_current().unwrap().unwrap().path, a.path);
    }

    #[test]
    fn close_active_falls_back_to_remaining() {
        let (dir_a, _) = make_git_repo_with_commit();
        let (dir_b, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        let a = manager.open(dir_a.path().to_str().unwrap()).unwrap();
        let b = manager.open(dir_b.path().to_str().unwrap()).unwrap(); // active
        let new_active = manager.close(&b.path).unwrap();
        assert_eq!(new_active.unwrap().path, a.path);
        assert_eq!(manager.list_open().unwrap().len(), 1);
    }

    #[test]
    fn close_last_tab_leaves_no_active_repo() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        let a = manager.open(dir.path().to_str().unwrap()).unwrap();
        let new_active = manager.close(&a.path).unwrap();
        assert!(new_active.is_none());
        assert!(manager.get_current().unwrap().is_none());
    }

    #[test]
    fn freshly_activated_clean_repo_has_no_operation() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        assert!(matches!(
            manager.operation_status().unwrap(),
            OperationStatus::None
        ));
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
