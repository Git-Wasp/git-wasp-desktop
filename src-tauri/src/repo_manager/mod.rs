mod config;

pub use config::{AppConfig, HookPreferences, RepoEntry};

use crate::commands::branch::BranchInfo;
use crate::commands::repo::RepoInfo;
use crate::merge_ops::{ConflictSide, ConflictedFile, MergeOutcome};
use crate::operation_runner::{OperationKind, OperationState, OperationStatus};
use crate::worktree_ops::{CreateWorktreeMode, RemoveWorktreeResult, WorktreeEntry};
use anyhow::Context;
use git2::{BranchType, ObjectType, Repository};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::Manager;

/// Log the working-tree dirty counts under `label`, for diagnosing operations
/// (e.g. a checkout) that leave the tree unexpectedly modified. No-op unless
/// debug logging is on, since computing status walks the tree — and it never
/// logs file paths/contents, only counts (no PII).
fn log_worktree_state(repo: &Repository, label: &str) {
    if !log::log_enabled!(log::Level::Debug) {
        return;
    }
    match crate::working_tree::get_working_tree_status(repo) {
        Ok(s) => log::debug!(
            target: "git",
            "{label}: staged={} unstaged={} untracked={}",
            s.staged.len(),
            s.unstaged.len(),
            s.untracked.len()
        ),
        Err(e) => log::debug!(target: "git", "{label}: status unavailable: {e}"),
    }
}

/// Check out an existing local branch: update the working tree to its tree and
/// point HEAD at it. Logs the working-tree dirty counts on either side (debug)
/// to diagnose checkouts that leave the tree unexpectedly modified.
fn checkout_local_branch(repo: &Repository, branch_name: &str) -> anyhow::Result<()> {
    log_worktree_state(repo, "checkout: pre");
    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .with_context(|| format!("branch not found: {branch_name}"))?;
    let obj = branch
        .get()
        .peel(ObjectType::Commit)
        .context("could not resolve branch to commit")?;
    let head_ref = branch.get().name().unwrap().to_string();
    log::debug!(target: "git", "checkout: target={} head_ref={head_ref}", obj.id());
    crate::working_tree::safe_checkout_tree(repo, &obj)?;
    repo.set_head(&head_ref).context("could not update HEAD")?;
    log_worktree_state(repo, "checkout: post");
    Ok(())
}

/// Park tracked, uncommitted changes in a stash before a destructive action.
/// A no-op (returns `false`) when there's nothing stashable. The stash is left
/// in place — the caller decides whether to reapply it (pull) or leave it for
/// the user to restore manually (checkout).
fn stash_working_changes(repo: &mut Repository, label: &str) -> anyhow::Result<bool> {
    if crate::working_tree::has_stashable_changes(repo)? {
        crate::stash::stash_save(repo, Some(label))?;
        log::info!(target: "git", "auto-stash: parked changes ({label})");
        Ok(true)
    } else {
        Ok(false)
    }
}

/// The mutable, per-tab state that an operation on one repo needs together —
/// the repo handle, its in-progress operation, and its graph cache — held
/// behind its own lock. `with_repo`/`with_repo_mut`/etc. clone the `Arc`
/// pointing at this out of `RepoManager.repos` and release that outer lock
/// before locking here, so a slow op on one tab (a fetch, a large checkout)
/// never blocks another tab's otherwise-cheap operations.
struct RepoState {
    repo: Repository,
    operation: Option<OperationState>,
    /// Cached commit-graph layout, reused across scroll fetches and rebuilt only
    /// when HEAD or refs move. `None` until the graph is first requested.
    graph_cache: Option<crate::graph::GraphCache>,
}

pub(crate) struct RepoGraphDirtyHandle {
    state: Arc<Mutex<RepoState>>,
}

impl RepoGraphDirtyHandle {
    pub(crate) fn mark_dirty(&self) -> anyhow::Result<()> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
        crate::graph::mark_dirty(&mut guard.graph_cache);
        Ok(())
    }
}

/// A single open repository tab, carrying its own in-progress operation so a
/// merge (or future rebase) in one tab can't leak into another.
struct OpenRepo {
    /// Stable identity = the git2-normalised workdir path. Also the value the
    /// frontend passes back to `activate`/`close` (it's `RepoInfo.path`).
    key: String,
    state: Arc<Mutex<RepoState>>,
}

pub struct RepoManager {
    repos: Mutex<Vec<OpenRepo>>,
    active: Mutex<Option<String>>,
    config: Mutex<AppConfig>,
    lifecycle_guards: Mutex<HashSet<String>>,
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
    match crate::worktree_ops::resolve_repo_info(repo) {
        Ok(info) => info,
        Err(error) => {
            log::warn!(target: "git", "failed to resolve worktree metadata: {error}");
            crate::worktree_ops::degraded_repo_info(repo)
        }
    }
}

/// Best-effort `RepoInfo` for an already-open tab. `path`/`name` are always
/// exact — derived from `key`, the same value `repo_info` would compute for
/// `path`, captured once at `open()` time and never changing, so no lock is
/// needed for them. `head_branch` is filled in opportunistically via
/// `try_lock`: if the tab's state is currently held by another operation
/// (e.g. an in-flight fetch), this returns `None` for it rather than
/// blocking — so listing/activating/closing tabs never waits on an unrelated
/// tab's slow operation.
fn open_repo_info(entry: &OpenRepo) -> RepoInfo {
    entry.state.try_lock().ok().map_or_else(
        || RepoInfo {
            name: Path::new(&entry.key)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&entry.key)
                .to_string(),
            path: entry.key.clone(),
            head_branch: None,
            repo_kind: crate::commands::repo::RepoKind::Main,
            parent_repo_path: None,
            common_dir_path: entry.key.clone(),
            worktree_branch: None,
            worktree_locked: false,
            worktree_prunable: false,
        },
        |guard| repo_info(&guard.repo),
    )
}

impl RepoManager {
    fn new() -> Self {
        Self {
            repos: Mutex::new(Vec::new()),
            active: Mutex::new(None),
            config: Mutex::new(AppConfig::load()),
            lifecycle_guards: Mutex::new(HashSet::new()),
        }
    }

    // Lock order is always active → repos → config; every helper below obeys it.
    fn repos_lock(&self) -> anyhow::Result<MutexGuard<'_, Vec<OpenRepo>>> {
        self.repos
            .lock()
            .map_err(|_| anyhow::anyhow!("repos lock poisoned"))
    }

    fn active_lock(&self) -> anyhow::Result<MutexGuard<'_, Option<String>>> {
        self.active
            .lock()
            .map_err(|_| anyhow::anyhow!("active lock poisoned"))
    }

    fn config_lock(&self) -> anyhow::Result<MutexGuard<'_, AppConfig>> {
        self.config
            .lock()
            .map_err(|_| anyhow::anyhow!("config lock poisoned"))
    }

    fn lifecycle_guards_lock(&self) -> anyhow::Result<MutexGuard<'_, HashSet<String>>> {
        self.lifecycle_guards
            .lock()
            .map_err(|_| anyhow::anyhow!("lifecycle guard lock poisoned"))
    }

    fn common_dir_key(repo: &Repository) -> String {
        std::fs::canonicalize(repo.commondir())
            .unwrap_or_else(|_| repo.commondir().to_path_buf())
            .to_string_lossy()
            .into_owned()
    }

    fn family_has_active_operation(&self, common_dir: &str) -> anyhow::Result<bool> {
        let states: Vec<_> = self
            .repos_lock()?
            .iter()
            .map(|repo| Arc::clone(&repo.state))
            .collect();
        for state in states {
            let guard = state
                .lock()
                .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
            if Self::common_dir_key(&guard.repo) != common_dir {
                continue;
            }
            if guard.operation.is_some() || guard.repo.state() != git2::RepositoryState::Clean {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn begin_family_lifecycle_guard(
        &self,
        common_dir: &str,
    ) -> anyhow::Result<FamilyLifecycleGuard<'_>> {
        let mut guards = self.lifecycle_guards_lock()?;
        if guards.contains(common_dir) {
            anyhow::bail!(
                "another worktree mutation is already in progress for this worktree family"
            );
        }
        guards.insert(common_dir.to_string());
        Ok(FamilyLifecycleGuard {
            manager: self,
            common_dir: common_dir.to_string(),
        })
    }

    fn ensure_family_allows_lifecycle(&self, common_dir: &str) -> anyhow::Result<()> {
        if self.family_has_active_operation(common_dir)? {
            anyhow::bail!("another tab in this worktree family has an operation in progress");
        }
        Ok(())
    }

    fn ensure_family_not_mutating(&self, common_dir: &str) -> anyhow::Result<()> {
        if self.lifecycle_guards_lock()?.contains(common_dir) {
            anyhow::bail!("a worktree mutation is already in progress for this worktree family");
        }
        Ok(())
    }

    /// Clone the active tab's per-repo state handle. Only the outer `repos`
    /// Vec is locked here, and only long enough to find the entry and clone
    /// its `Arc` — the actual git2 work happens afterwards against just that
    /// clone, so it can never block a lookup/mutation on a different tab.
    fn active_state(&self) -> anyhow::Result<Arc<Mutex<RepoState>>> {
        let key = self
            .active_lock()?
            .clone()
            .ok_or_else(|| anyhow::anyhow!("no repository open"))?;
        let repos = self.repos_lock()?;
        repos
            .iter()
            .find(|r| r.key == key)
            .map(|r| Arc::clone(&r.state))
            .ok_or_else(|| anyhow::anyhow!("no repository open"))
    }

    /// Run `f` against the active repo and its operation state under one lock —
    /// the only sanctioned way to touch both, mirroring how multi-step git ops
    /// route through a single critical section.
    fn with_repo_and_operation_mut<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Repository, &mut Option<OperationState>) -> anyhow::Result<T>,
    {
        let state = self.active_state()?;
        let mut guard = state
            .lock()
            .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
        let RepoState {
            repo,
            operation,
            graph_cache,
            ..
        } = &mut *guard;
        let result = f(repo, operation);
        // Conservative: any `&mut Repository` access here could have moved
        // HEAD or a ref (multi-step merge/rebase steps route through this),
        // so flag the graph cache for re-verification regardless of whether
        // `f` reports success — see `crate::graph::mark_dirty`.
        crate::graph::mark_dirty(graph_cache);
        result
    }

    /// Snapshot the open tabs (in order) + active into config and persist, so
    /// the session is restored on next launch.
    fn persist_session(&self) -> anyhow::Result<()> {
        let active = self.active_lock()?.clone().map(PathBuf::from);
        let open_paths: Vec<PathBuf> = self
            .repos_lock()?
            .iter()
            .map(|r| PathBuf::from(&r.key))
            .collect();
        let mut config = self.config_lock()?;
        config.set_session(open_paths, active);
        if let Err(e) = config.save() {
            log::error!(target: "config", "failed to persist session: {e}");
        }
        Ok(())
    }

    pub fn open(&self, path: &str) -> anyhow::Result<RepoInfo> {
        let info = {
            let mut repos = self.repos_lock()?;
            let repo =
                Repository::open(path).with_context(|| format!("not a git repository: {path}"))?;
            let info = repo_info(&repo);
            if !repos.iter().any(|r| r.key == info.path) {
                repos.push(OpenRepo {
                    key: info.path.clone(),
                    state: Arc::new(Mutex::new(RepoState {
                        repo,
                        operation: None,
                        graph_cache: None,
                    })),
                });
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
            open_repo_info(entry)
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
                Some(ak) => repos.iter().find(|r| r.key == ak).map(open_repo_info),
                None => None,
            }
        };
        self.persist_session()?;
        Ok(new_active)
    }

    pub fn list_open(&self) -> anyhow::Result<Vec<RepoInfo>> {
        Ok(self.repos_lock()?.iter().map(open_repo_info).collect())
    }

    pub fn get_current(&self) -> anyhow::Result<Option<RepoInfo>> {
        let Some(key) = self.active_lock()?.clone() else {
            return Ok(None);
        };
        let repos = self.repos_lock()?;
        Ok(repos.iter().find(|r| r.key == key).map(open_repo_info))
    }

    pub fn get_recent(&self) -> anyhow::Result<Vec<RepoEntry>> {
        Ok(self.config_lock()?.recent_repos.clone())
    }

    fn require_open_repo_key(&self, repo_path: &str) -> anyhow::Result<PathBuf> {
        let repos = self.repos_lock()?;
        repos
            .iter()
            .find(|repo| repo.key == repo_path)
            .map(|repo| PathBuf::from(&repo.key))
            .ok_or_else(|| anyhow::anyhow!("repository not open: {repo_path}"))
    }

    pub(crate) fn open_repo_worktree_and_graph_handle(
        &self,
        repo_path: &str,
    ) -> anyhow::Result<(PathBuf, RepoGraphDirtyHandle)> {
        let state = {
            let repos = self.repos_lock()?;
            repos
                .iter()
                .find(|repo| repo.key == repo_path)
                .map(|repo| Arc::clone(&repo.state))
                .ok_or_else(|| anyhow::anyhow!("repository not open: {repo_path}"))?
        };
        let worktree = {
            let guard = state
                .lock()
                .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
            guard
                .repo
                .workdir()
                .map(Path::to_path_buf)
                .context("open repository has no working tree")?
        };
        Ok((worktree, RepoGraphDirtyHandle { state }))
    }

    pub fn hook_preferences(&self, repo_path: &str) -> anyhow::Result<HookPreferences> {
        let repo_path = self.require_open_repo_key(repo_path)?;
        Ok(self.config_lock()?.hook_preferences_for(&repo_path))
    }

    pub fn set_hook_preferences(
        &self,
        repo_path: &str,
        preferences: HookPreferences,
    ) -> anyhow::Result<HookPreferences> {
        let repo_path = self.require_open_repo_key(repo_path)?;
        let mut config = self.config_lock()?;
        config.set_hook_preferences(repo_path, preferences);
        config.save()?;
        Ok(preferences)
    }

    /// Remove a repository from the recent list and return the updated list. Only
    /// forgets our reference — the repository on disk is untouched.
    pub fn remove_recent(&self, path: &str) -> anyhow::Result<Vec<RepoEntry>> {
        let mut config = self.config_lock()?;
        config.remove_recent(Path::new(path));
        if let Err(e) = config.save() {
            log::error!(target: "config", "failed to persist recent-repos removal: {e}");
        }
        Ok(config.recent_repos.clone())
    }

    pub fn with_repo<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Repository) -> T,
    {
        let state = self.active_state()?;
        let guard = state
            .lock()
            .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
        Ok(f(&guard.repo))
    }

    pub fn with_repo_mut<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Repository) -> T,
    {
        let state = self.active_state()?;
        let mut guard = state
            .lock()
            .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
        let result = f(&mut guard.repo);
        // Conservative: any `&mut Repository` access could have moved HEAD or
        // a ref — see `crate::graph::mark_dirty`.
        crate::graph::mark_dirty(&mut guard.graph_cache);
        Ok(result)
    }

    /// Run `f` against the active repo and its (mutable) graph-layout cache. The
    /// graph command uses this so the cache lives as long as the tab does.
    pub fn with_repo_graph_cache<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Repository, &mut Option<crate::graph::GraphCache>) -> T,
    {
        let state = self.active_state()?;
        let mut guard = state
            .lock()
            .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
        let RepoState {
            repo, graph_cache, ..
        } = &mut *guard;
        Ok(f(repo, graph_cache))
    }

    /// Re-scans the working tree and updates the graph cache's dirty-file
    /// count, without rebuilding the full layout. Called when the file
    /// watcher reports a change, so the (expensive) scan happens once per
    /// change rather than once per scroll-driven viewport fetch.
    /// Scan the working tree once, updating the graph cache's dirty-file count
    /// from that same scan and returning the detailed status. Replaces the old
    /// pair of calls (`get_working_tree_status` + a separate count scan), halving
    /// the `repo.statuses()` work the poll/watcher/focus refresh does — the hot
    /// path on a large monorepo where `git status` dominates.
    ///
    /// Also flags the graph cache for re-verification (`mark_dirty`): this is
    /// the path the file watcher's "something changed" event drives, so it's
    /// the one place that needs to notice a change made *outside* the app
    /// (e.g. a `git` command run in a terminal) — `with_repo_mut` only covers
    /// changes made through this app's own commands.
    pub fn refresh_working_tree(&self) -> anyhow::Result<crate::working_tree::WorkingTreeStatus> {
        self.with_repo_graph_cache(|repo, cache| {
            let status = crate::working_tree::get_working_tree_status(repo)?;
            crate::graph::set_change_count(cache, status.distinct_change_count());
            crate::graph::mark_dirty(cache);
            Ok(status)
        })?
    }

    /// Check out a local branch. When `auto_stash` is set, tracked uncommitted
    /// changes are parked in a stash first (left in place — "park on switch") so
    /// the checkout can't be blocked by them.
    pub fn checkout_branch(&self, branch_name: &str, auto_stash: bool) -> anyhow::Result<RepoInfo> {
        log::info!(target: "git", "checkout: branch={branch_name} auto_stash={auto_stash}");
        self.with_repo_mut(|repo| -> anyhow::Result<()> {
            if auto_stash {
                stash_working_changes(
                    repo,
                    &format!("Auto-stash before checkout of {branch_name}"),
                )?;
            }
            checkout_local_branch(repo, branch_name)
        })??;
        log::info!(target: "git", "checkout: branch={branch_name} ok");
        self.get_current()?
            .ok_or_else(|| anyhow::anyhow!("no repo after checkout"))
    }

    /// Check out a remote-tracking branch (e.g. `origin/feature`) by creating a
    /// local branch of the same short name that tracks it, then checking that
    /// out. If a matching local branch already exists, just switches to it.
    /// `auto_stash` parks tracked changes first (left in place), as above.
    pub fn checkout_remote_branch(
        &self,
        remote_ref: &str,
        auto_stash: bool,
    ) -> anyhow::Result<RepoInfo> {
        log::info!(target: "git", "checkout remote: {remote_ref} auto_stash={auto_stash}");
        self.with_repo_mut(|repo| -> anyhow::Result<()> {
            if auto_stash {
                stash_working_changes(repo, &format!("Auto-stash before checkout of {remote_ref}"))?;
            }
            // Strip the remote name ("origin/feature/x" -> "feature/x").
            let local_name = remote_ref.split_once('/').map(|(_, rest)| rest).unwrap_or(remote_ref);

            if repo.find_branch(local_name, BranchType::Local).is_err() {
                let remote = repo
                    .find_branch(remote_ref, BranchType::Remote)
                    .with_context(|| format!("remote branch not found: {remote_ref}"))?;
                let commit = remote
                    .get()
                    .peel_to_commit()
                    .context("remote branch has no commit")?;
                let mut local = repo
                    .branch(local_name, &commit, false)
                    .with_context(|| format!("failed to create local branch: {local_name}"))?;
                // Track the remote so pull/push and ahead/behind work; non-fatal.
                let _ = local.set_upstream(Some(remote_ref));
                log::info!(target: "git", "checkout remote: created local {local_name} tracking {remote_ref}");
            }

            checkout_local_branch(repo, local_name)
        })??;
        log::info!(target: "git", "checkout remote: {remote_ref} ok");
        self.get_current()?
            .ok_or_else(|| anyhow::anyhow!("no repo after checkout"))
    }

    /// Check out an arbitrary commit, detaching HEAD. Updates the working tree to
    /// the commit's tree first (baseline = old HEAD, so files are written), then
    /// detaches HEAD — same ordering lesson as the fast-forward fix.
    pub fn checkout_commit(&self, oid_str: &str, auto_stash: bool) -> anyhow::Result<RepoInfo> {
        log::info!(target: "git", "checkout commit (detached): {oid_str} auto_stash={auto_stash}");
        self.with_repo_mut(|repo| -> anyhow::Result<()> {
            let oid = git2::Oid::from_str(oid_str).context("invalid commit oid")?;
            log_worktree_state(repo, "checkout: pre");
            // Stash before taking the (immutable) commit borrow used for checkout.
            if auto_stash {
                stash_working_changes(repo, &format!("Auto-stash before checkout of {oid_str}"))?;
            }
            let commit = repo.find_commit(oid).context("commit not found")?;
            crate::working_tree::safe_checkout_tree(repo, commit.as_object())?;
            repo.set_head_detached(oid)
                .context("could not detach HEAD")?;
            log_worktree_state(repo, "checkout: post");
            Ok(())
        })??;
        log::info!(target: "git", "checkout commit (detached): {oid_str} ok");
        self.get_current()?
            .ok_or_else(|| anyhow::anyhow!("no repo after checkout"))
    }

    /// Fast-forward local `branch` to `target_oid` (see [`crate::branch_ops`]).
    pub fn fast_forward_branch(
        &self,
        branch: &str,
        target_oid: &str,
    ) -> anyhow::Result<crate::branch_ops::FastForwardOutcome> {
        let oid = git2::Oid::from_str(target_oid).context("invalid commit oid")?;
        self.with_repo(|repo| crate::branch_ops::fast_forward(repo, branch, oid))?
    }

    /// Fast-forward local `branch` to its upstream tracking branch (no fetch).
    pub fn fast_forward_to_upstream(
        &self,
        branch: &str,
    ) -> anyhow::Result<crate::branch_ops::FastForwardOutcome> {
        self.with_repo(|repo| crate::branch_ops::fast_forward_to_upstream(repo, branch))?
    }

    /// Local branches that can be fast-forwarded to `target_oid`.
    pub fn fast_forwardable_branches(&self, target_oid: &str) -> anyhow::Result<Vec<String>> {
        let oid = git2::Oid::from_str(target_oid).context("invalid commit oid")?;
        self.with_repo(|repo| crate::branch_ops::fast_forwardable_branches(repo, oid))?
    }

    /// Create a tag at `oid`. With a non-empty `message` it's an annotated tag
    /// (using the repo's signature); otherwise a lightweight tag.
    pub fn create_tag(
        &self,
        name: &str,
        oid_str: &str,
        message: Option<&str>,
    ) -> anyhow::Result<()> {
        log::info!(target: "git", "tag: create {name} at {oid_str} (annotated={})", message.is_some());
        self.with_repo(|repo| -> anyhow::Result<()> {
            let oid = git2::Oid::from_str(oid_str).context("invalid commit oid")?;
            let obj = repo.find_object(oid, None).context("commit not found")?;
            match message.filter(|m| !m.trim().is_empty()) {
                Some(msg) => {
                    let sig = repo.signature().context(
                        "Git user identity not configured. Set user.name and user.email in your .gitconfig.",
                    )?;
                    repo.tag(name, &obj, &sig, msg, false)
                        .with_context(|| format!("failed to create tag: {name}"))?;
                }
                None => {
                    repo.tag_lightweight(name, &obj, false)
                        .with_context(|| format!("failed to create tag: {name}"))?;
                }
            }
            Ok(())
        })?
    }

    pub fn delete_tag(&self, name: &str) -> anyhow::Result<()> {
        log::info!(target: "git", "tag: delete {name}");
        self.with_repo(|repo| -> anyhow::Result<()> {
            repo.tag_delete(name)
                .with_context(|| format!("failed to delete tag: {name}"))
        })?
    }

    pub fn create_branch(&self, name: &str, start_oid: Option<&str>) -> anyhow::Result<BranchInfo> {
        log::info!(target: "git", "branch: create {name} (start={})", start_oid.unwrap_or("HEAD"));
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
            })
        })?
    }

    pub fn rename_branch(&self, old_name: &str, new_name: &str) -> anyhow::Result<()> {
        log::info!(target: "git", "branch: rename {old_name} -> {new_name}");
        self.with_repo(|repo| -> anyhow::Result<()> {
            let mut branch = repo
                .find_branch(old_name, BranchType::Local)
                .with_context(|| format!("branch not found: {old_name}"))?;
            branch
                .rename(new_name, false)
                .with_context(|| format!("failed to rename branch to: {new_name}"))?;
            Ok(())
        })?
    }

    pub fn delete_branch(&self, name: &str) -> anyhow::Result<()> {
        log::info!(target: "git", "branch: delete {name}");
        self.with_repo(|repo| -> anyhow::Result<()> {
            let mut branch = repo
                .find_branch(name, BranchType::Local)
                .with_context(|| format!("branch not found: {name}"))?;
            if branch.is_head() {
                anyhow::bail!("Cannot delete the currently checked out branch: {name}");
            }
            branch
                .delete()
                .with_context(|| format!("failed to delete branch: {name}"))?;
            Ok(())
        })?
    }

    pub fn list_worktrees(&self, repo_path: &str) -> anyhow::Result<Vec<WorktreeEntry>> {
        let current_key = self.require_open_repo_key(repo_path)?;
        let state = {
            let repos = self.repos_lock()?;
            repos
                .iter()
                .find(|repo| repo.key == current_key.to_string_lossy())
                .map(|repo| Arc::clone(&repo.state))
                .ok_or_else(|| anyhow::anyhow!("repository not open: {repo_path}"))?
        };
        let open_paths: HashSet<String> = self
            .repos_lock()?
            .iter()
            .map(|repo| repo.key.clone())
            .collect();
        let guard = state
            .lock()
            .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
        crate::worktree_ops::list_worktrees(&guard.repo, &current_key, &open_paths)
    }

    pub fn create_worktree(
        &self,
        repo_path: Option<&str>,
        target_path: &str,
        mode: CreateWorktreeMode,
        branch_name: Option<&str>,
        start_point: Option<&str>,
        _app_handle: Option<tauri::AppHandle>,
    ) -> anyhow::Result<RepoInfo> {
        let state = match repo_path {
            Some(path) => {
                let key = self.require_open_repo_key(path)?;
                let repos = self.repos_lock()?;
                repos
                    .iter()
                    .find(|repo| repo.key == key.to_string_lossy())
                    .map(|repo| Arc::clone(&repo.state))
                    .ok_or_else(|| anyhow::anyhow!("repository not open: {path}"))?
            }
            None => self.active_state()?,
        };
        let common_dir = {
            let guard = state
                .lock()
                .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
            Self::common_dir_key(&guard.repo)
        };
        self.ensure_family_allows_lifecycle(&common_dir)?;
        let _family_guard = self.begin_family_lifecycle_guard(&common_dir)?;
        {
            let guard = state
                .lock()
                .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
            crate::worktree_ops::create_worktree(
                &guard.repo,
                Path::new(target_path),
                mode,
                branch_name,
                start_point,
            )?;
        }
        self.open(target_path)
    }

    pub fn lock_worktree(&self, repo_path: &str) -> anyhow::Result<RepoInfo> {
        let repo = Repository::open(repo_path)
            .with_context(|| format!("not a git repository: {repo_path}"))?;
        let common_dir = Self::common_dir_key(&repo);
        self.ensure_family_allows_lifecycle(&common_dir)?;
        let _family_guard = self.begin_family_lifecycle_guard(&common_dir)?;
        crate::worktree_ops::lock_worktree(Path::new(repo_path))?;
        let repo = Repository::open(repo_path)
            .with_context(|| format!("not a git repository: {repo_path}"))?;
        Ok(repo_info(&repo))
    }

    pub fn unlock_worktree(&self, repo_path: &str) -> anyhow::Result<RepoInfo> {
        let repo = Repository::open(repo_path)
            .with_context(|| format!("not a git repository: {repo_path}"))?;
        let common_dir = Self::common_dir_key(&repo);
        self.ensure_family_allows_lifecycle(&common_dir)?;
        let _family_guard = self.begin_family_lifecycle_guard(&common_dir)?;
        crate::worktree_ops::unlock_worktree(Path::new(repo_path))?;
        let repo = Repository::open(repo_path)
            .with_context(|| format!("not a git repository: {repo_path}"))?;
        Ok(repo_info(&repo))
    }

    pub fn remove_worktree(&self, repo_path: &str) -> anyhow::Result<RemoveWorktreeResult> {
        let repo = Repository::open(repo_path)
            .with_context(|| format!("not a git repository: {repo_path}"))?;
        let common_dir = Self::common_dir_key(&repo);
        self.ensure_family_allows_lifecycle(&common_dir)?;
        let _family_guard = self.begin_family_lifecycle_guard(&common_dir)?;
        crate::worktree_ops::remove_worktree(Path::new(repo_path))?;

        let was_open = self.repos_lock()?.iter().any(|repo| repo.key == repo_path);
        let active_repo = if was_open {
            self.close(repo_path)?
        } else {
            self.get_current()?
        };

        Ok(RemoveWorktreeResult {
            removed_path: repo_path.to_string(),
            closed_tab: was_open,
            active_repo,
        })
    }

    pub fn open_parent_repo(&self, repo_path: &str) -> anyhow::Result<RepoInfo> {
        let repo = Repository::open(repo_path)
            .with_context(|| format!("not a git repository: {repo_path}"))?;
        let info = repo_info(&repo);
        let target = info.parent_repo_path.unwrap_or(info.path);
        self.open(&target)
    }

    pub fn operation_status(&self) -> anyhow::Result<OperationStatus> {
        self.with_repo_and_operation_mut(|repo, op| {
            crate::operation_runner::derive_status(repo, op)
        })
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
        let state = self.active_state()?;
        let common_dir = {
            let guard = state
                .lock()
                .map_err(|_| anyhow::anyhow!("repo state lock poisoned"))?;
            Self::common_dir_key(&guard.repo)
        };
        self.ensure_family_not_mutating(&common_dir)?;
        self.with_repo_and_operation_mut(|repo, op| {
            crate::operation_runner::start_merge(repo, op, branch_name)
        })
    }

    pub fn merge_resolve_file(
        &self,
        path: &str,
        content: &str,
    ) -> anyhow::Result<Vec<ConflictedFile>> {
        self.with_repo(|repo| -> anyhow::Result<Vec<ConflictedFile>> {
            crate::merge_ops::write_resolution(repo, path, content)?;
            crate::merge_ops::collect_conflicts(repo)
        })?
    }

    pub fn merge_resolve_with_side(
        &self,
        path: &str,
        side: ConflictSide,
    ) -> anyhow::Result<Vec<ConflictedFile>> {
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
        if let Err(e) = config.save() {
            log::error!(target: "config", "failed to persist active theme: {e}");
        }
        Ok(())
    }

    pub fn get_active_theme(&self) -> anyhow::Result<Option<String>> {
        Ok(self.config_lock()?.active_theme.clone())
    }
}

struct FamilyLifecycleGuard<'a> {
    manager: &'a RepoManager,
    common_dir: String,
}

impl Drop for FamilyLifecycleGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut guards) = self.manager.lifecycle_guards.lock() {
            guards.remove(&self.common_dir);
        }
    }
}

/// The debounced file watcher's concrete type (see `file_watcher::start`).
type FileWatcher = notify_debouncer_full::Debouncer<
    notify::RecommendedWatcher,
    notify_debouncer_full::RecommendedCache,
>;

/// Tauri managed state — wraps RepoManager in Arc so it can be cloned into
/// the async command handlers without holding a lock across await points.
/// Also holds the file watcher and credential store for the app's lifetime.
pub struct AppState {
    pub manager: Arc<RepoManager>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub credentials: Box<dyn crate::credential_store::CredentialStore>,
    hook_runs: crate::hook_runner::RunRegistry,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            manager: Arc::new(RepoManager::new()),
            watcher: Mutex::new(None),
            credentials: Box::new(crate::credential_store::KeyringStore),
            hook_runs: crate::hook_runner::RunRegistry::default(),
        }
    }

    pub fn begin_hook_run(
        &self,
        repo_path: &str,
    ) -> anyhow::Result<crate::hook_runner::HookRunGuard> {
        let repo_key = self.manager.require_open_repo_key(repo_path)?;
        let repo_key = repo_key
            .to_str()
            .context("open repository path is not valid UTF-8")?;
        self.hook_runs.begin(repo_key)
    }

    pub fn known_github_hosts(&self) -> anyhow::Result<Vec<String>> {
        let config = self.manager.config_lock()?;
        Ok(config
            .github_hosts
            .iter()
            .map(|h| h.base_url.clone())
            .collect())
    }

    /// Point the single file watcher at `workdir` (the active tab's working
    /// tree), or stop it when `None`. Dropping the previous watcher stops it.
    fn restart_watcher(&self, app_handle: tauri::AppHandle, workdir: Option<&Path>) {
        let new = workdir.and_then(|w| crate::file_watcher::start(app_handle, w).ok());
        if let Ok(mut lock) = self.watcher.lock() {
            *lock = new;
        }
    }

    pub fn open_repo(
        &self,
        path: &str,
        app_handle: Option<tauri::AppHandle>,
    ) -> anyhow::Result<RepoInfo> {
        let info = self.manager.open(path)?;
        if let Some(handle) = app_handle {
            self.restart_watcher(handle, Some(Path::new(&info.path)));
        }
        Ok(info)
    }

    pub fn activate_repo(
        &self,
        path: &str,
        app_handle: Option<tauri::AppHandle>,
    ) -> anyhow::Result<RepoInfo> {
        let info = self.manager.activate(path)?;
        if let Some(handle) = app_handle {
            self.restart_watcher(handle, Some(Path::new(&info.path)));
        }
        Ok(info)
    }

    pub fn close_repo(
        &self,
        path: &str,
        app_handle: Option<tauri::AppHandle>,
    ) -> anyhow::Result<Option<RepoInfo>> {
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

    pub fn remove_recent_repo(&self, path: &str) -> anyhow::Result<Vec<RepoEntry>> {
        self.manager.remove_recent(path)
    }

    pub fn list_worktrees(&self, repo_path: &str) -> anyhow::Result<Vec<WorktreeEntry>> {
        self.manager.list_worktrees(repo_path)
    }

    pub fn lock_worktree(&self, repo_path: &str) -> anyhow::Result<RepoInfo> {
        self.manager.lock_worktree(repo_path)
    }

    pub fn unlock_worktree(&self, repo_path: &str) -> anyhow::Result<RepoInfo> {
        self.manager.unlock_worktree(repo_path)
    }

    pub fn remove_worktree(
        &self,
        repo_path: &str,
        app_handle: Option<tauri::AppHandle>,
    ) -> anyhow::Result<RemoveWorktreeResult> {
        let result = self.manager.remove_worktree(repo_path)?;
        if let Some(handle) = app_handle {
            self.restart_watcher(
                handle,
                result
                    .active_repo
                    .as_ref()
                    .map(|info| Path::new(info.path.as_str())),
            );
        }
        Ok(result)
    }

    pub fn hook_preferences(&self, repo_path: &str) -> anyhow::Result<HookPreferences> {
        self.manager.hook_preferences(repo_path)
    }

    pub fn set_hook_preferences(
        &self,
        repo_path: &str,
        preferences: HookPreferences,
    ) -> anyhow::Result<HookPreferences> {
        self.manager.set_hook_preferences(repo_path, preferences)
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

    pub fn refresh_working_tree(&self) -> anyhow::Result<crate::working_tree::WorkingTreeStatus> {
        self.manager.refresh_working_tree()
    }

    pub fn checkout_branch(&self, branch_name: &str, auto_stash: bool) -> anyhow::Result<RepoInfo> {
        self.manager.checkout_branch(branch_name, auto_stash)
    }

    pub fn checkout_remote_branch(
        &self,
        remote_ref: &str,
        auto_stash: bool,
    ) -> anyhow::Result<RepoInfo> {
        self.manager.checkout_remote_branch(remote_ref, auto_stash)
    }

    pub fn checkout_commit(&self, oid: &str, auto_stash: bool) -> anyhow::Result<RepoInfo> {
        self.manager.checkout_commit(oid, auto_stash)
    }

    pub fn create_tag(&self, name: &str, oid: &str, message: Option<&str>) -> anyhow::Result<()> {
        self.manager.create_tag(name, oid, message)
    }

    pub fn delete_tag(&self, name: &str) -> anyhow::Result<()> {
        self.manager.delete_tag(name)
    }

    pub fn create_branch(&self, name: &str, start_oid: Option<&str>) -> anyhow::Result<BranchInfo> {
        self.manager.create_branch(name, start_oid)
    }

    pub fn create_worktree(
        &self,
        repo_path: Option<&str>,
        target_path: &str,
        mode: CreateWorktreeMode,
        branch_name: Option<&str>,
        start_point: Option<&str>,
        app_handle: Option<tauri::AppHandle>,
    ) -> anyhow::Result<RepoInfo> {
        let info = self.manager.create_worktree(
            repo_path,
            target_path,
            mode,
            branch_name,
            start_point,
            app_handle.clone(),
        )?;
        if let Some(handle) = app_handle {
            self.restart_watcher(handle, Some(Path::new(&info.path)));
        }
        Ok(info)
    }

    pub fn open_parent_repo(
        &self,
        repo_path: &str,
        app_handle: Option<tauri::AppHandle>,
    ) -> anyhow::Result<RepoInfo> {
        let info = self.manager.open_parent_repo(repo_path)?;
        if let Some(handle) = app_handle {
            self.restart_watcher(handle, Some(Path::new(&info.path)));
        }
        Ok(info)
    }

    pub fn fast_forward_branch(
        &self,
        branch: &str,
        target_oid: &str,
    ) -> anyhow::Result<crate::branch_ops::FastForwardOutcome> {
        self.manager.fast_forward_branch(branch, target_oid)
    }

    pub fn fast_forward_to_upstream(
        &self,
        branch: &str,
    ) -> anyhow::Result<crate::branch_ops::FastForwardOutcome> {
        self.manager.fast_forward_to_upstream(branch)
    }

    pub fn fast_forwardable_branches(&self, target_oid: &str) -> anyhow::Result<Vec<String>> {
        self.manager.fast_forwardable_branches(target_oid)
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

    pub fn merge_resolve_file(
        &self,
        path: &str,
        content: &str,
    ) -> anyhow::Result<Vec<ConflictedFile>> {
        self.manager.merge_resolve_file(path, content)
    }

    pub fn merge_resolve_with_side(
        &self,
        path: &str,
        side: ConflictSide,
    ) -> anyhow::Result<Vec<ConflictedFile>> {
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

    restore_open_paths(&state.manager, open_paths.clone(), active.clone())?;
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

fn restore_open_paths(
    manager: &RepoManager,
    open_paths: Vec<PathBuf>,
    _active: Option<PathBuf>,
) -> anyhow::Result<()> {
    for path in open_paths {
        if !path.exists() {
            continue;
        }
        if let Err(error) = manager.open(path.to_str().unwrap_or("")) {
            log::warn!(
                target: "config",
                "skipping restored repository {}: {error}",
                path.display()
            );
        }
    }
    Ok(())
}

/// Lists every branch (local and remote-tracking) with cheap-to-derive
/// metadata only. Ahead/behind counts used to be computed here for every
/// local branch eagerly (one `graph_ahead_behind` walk per branch); that's
/// dead weight the frontend never read from this list — it's fetched
/// per-branch, on demand, via the `branch_ahead_behind` command instead (see
/// `remote_ops::branch_ahead_behind`), so this stays cheap regardless of how
/// many branches a monorepo has.
pub fn list_branches(repo: &Repository) -> anyhow::Result<Vec<BranchInfo>> {
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
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));
        branches.push(BranchInfo {
            name,
            is_remote,
            is_head,
            upstream,
            oid,
        });
    }
    Ok(branches)
}

/// Why a local branch is offered for pruning. `Gone` branches tracked a remote
/// branch that has since been deleted (safe to remove — the work is on the
/// remote or was merged); `LocalOnly` branches have no remote counterpart at all
/// (never pushed), so deleting one may discard unpushed commits — the UI treats
/// them more cautiously.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrunableKind {
    /// Tracked an upstream that is now gone (the `[origin/x: gone]` state
    /// `git branch -vv` shows).
    Gone,
    /// Exists only locally — no configured upstream and no remote-tracking
    /// branch of the same name.
    LocalOnly,
}

/// A local branch a user might want to clean up. Detection is config-based
/// because git2's `Branch::upstream()` returns `None` for a gone upstream,
/// indistinguishable from a branch that never had one.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrunableBranch {
    pub name: String,
    pub kind: PrunableKind,
    /// The remote-tracking branch it followed, now gone (e.g. "origin/feature").
    /// `None` for local-only branches, which never had one.
    pub upstream: Option<String>,
    /// Whether the branch's commits are already contained in the base branch
    /// (local `main`/`master`, else `origin/HEAD`). A merged local-only branch is
    /// safe to delete — nothing unique is lost — so the UI pre-selects it.
    pub merged: bool,
}

/// The commit a prunable branch is measured "merged into", plus the local branch
/// name (if any) to exclude from pruning so we never offer to delete the base
/// itself. Prefers a local `main`/`master`, else the remote default (`origin/HEAD`).
fn find_prune_base(repo: &Repository) -> (Option<git2::Oid>, Option<String>) {
    for name in ["main", "master"] {
        if let Ok(branch) = repo.find_branch(name, BranchType::Local) {
            if let Ok(commit) = branch.get().peel_to_commit() {
                return (Some(commit.id()), Some(name.to_string()));
            }
        }
    }
    if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Ok(commit) = reference.peel_to_commit() {
            return (Some(commit.id()), None);
        }
    }
    (None, None)
}

/// Whether `tip`'s history is fully contained in `base` (i.e. the branch is
/// merged into the base branch): the tip is the base, or the base descends from it.
fn is_merged_into(repo: &Repository, tip: git2::Oid, base: git2::Oid) -> bool {
    tip == base || repo.graph_descendant_of(base, tip).unwrap_or(false)
}

/// Whether any remote has a remote-tracking branch sharing this local branch's
/// short name (e.g. local "feature" ↔ "origin/feature"). Used to tell a truly
/// local-only branch from one that's published but has no upstream configured.
fn branch_has_remote_counterpart(repo: &Repository, name: &str) -> anyhow::Result<bool> {
    for remote_branch in repo
        .branches(Some(BranchType::Remote))
        .context("failed to list remote branches")?
    {
        let (remote_branch, _) = remote_branch.context("invalid remote branch reference")?;
        if let Some(full) = remote_branch.name()? {
            // full is "<remote>/<short>"; compare the part after the remote.
            if let Some((_, short)) = full.split_once('/') {
                if short == name {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

/// Local branches a user might want to prune, in two flavours (see
/// [`PrunableKind`]): those whose tracked upstream is gone, and those that only
/// exist locally. The currently checked-out branch is never included. Pure (no
/// network) — callers should fetch with prune first so the remote-tracking refs
/// are up to date.
pub fn find_prunable_branches(repo: &Repository) -> anyhow::Result<Vec<PrunableBranch>> {
    let config = repo.config().context("failed to read repo config")?;
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));
    let (base_oid, base_name) = find_prune_base(repo);

    let mut out = Vec::new();
    for branch in repo
        .branches(Some(BranchType::Local))
        .context("failed to list local branches")?
    {
        let (branch, _) = branch.context("invalid branch reference")?;
        let name = match branch.name()?.map(|s| s.to_string()) {
            Some(n) => n,
            None => continue,
        };
        // Never offer to delete the branch you're currently on, nor the base
        // branch we measure "merged" against.
        if head_name.as_deref() == Some(name.as_str())
            || base_name.as_deref() == Some(name.as_str())
        {
            continue;
        }

        // Is the branch already contained in the base branch? (Safe to delete.)
        let merged = match (base_oid, branch.get().peel_to_commit()) {
            (Some(base), Ok(tip)) => is_merged_into(repo, tip.id(), base),
            _ => false,
        };

        // A branch configured to track a real remote is classified by whether
        // that upstream still exists; either way it's fully handled here.
        let remote = config.get_string(&format!("branch.{name}.remote")).ok();
        let merge = config.get_string(&format!("branch.{name}.merge")).ok();
        if let (Some(remote), Some(merge)) = (&remote, &merge) {
            // "." means it tracks a local branch, not a remote — fall through to
            // the local-only check below.
            if remote != "." {
                let short = merge.strip_prefix("refs/heads/").unwrap_or(merge);
                let tracking_ref = format!("refs/remotes/{remote}/{short}");
                // Gone ⇒ the upstream it tracked no longer exists locally.
                if repo.find_reference(&tracking_ref).is_err() {
                    out.push(PrunableBranch {
                        name,
                        kind: PrunableKind::Gone,
                        upstream: Some(format!("{remote}/{short}")),
                        merged,
                    });
                }
                // else: still tracking an existing upstream — not a prune target.
                continue;
            }
        }

        // No remote upstream configured: local-only unless a remote-tracking
        // branch of the same name exists (published, just no upstream set).
        if !branch_has_remote_counterpart(repo, &name)? {
            out.push(PrunableBranch {
                name,
                kind: PrunableKind::LocalOnly,
                upstream: None,
                merged,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use tempfile::TempDir;

    fn make_git_repo_with_commit() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        // Set identity in the *repo* config so operations that resolve it via
        // `repo.signature()` (e.g. auto-stash's `stash_save`) work without a
        // global ~/.gitconfig — keeps these tests hermetic.
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Test").unwrap();
            config.set_str("user.email", "test@test.com").unwrap();
            // Pin line-ending handling so blobs round-trip byte-for-byte across
            // platforms. Without this a host with `core.autocrlf=true` (the
            // Windows git default) rewrites LF to CRLF on checkout, breaking the
            // exact-content assertions (e.g. reading back "a\n").
            config.set_bool("core.autocrlf", false).unwrap();
            config.set_str("core.eol", "lf").unwrap();
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
            drop(tree);
        }
        (dir, repo)
    }

    fn mark_operation_in_progress_for_path(manager: &RepoManager, path: &Path) {
        let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let repos = manager.repos_lock().unwrap();
        let entry = repos
            .iter()
            .find(|repo| {
                std::fs::canonicalize(&repo.key).unwrap_or_else(|_| PathBuf::from(&repo.key))
                    == target
            })
            .unwrap();
        let mut state = entry.state.lock().unwrap();
        state.operation = Some(OperationState {
            kind: OperationKind::Merge,
            source_branch: Some("feature/a".to_string()),
        });
    }

    #[test]
    fn hook_preferences_require_an_open_normalized_repository_key() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        let info = manager.open(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(
            manager.hook_preferences(&info.path).unwrap(),
            HookPreferences::default()
        );

        let alias = dir.path().join(".").to_string_lossy().into_owned();
        let error = manager.hook_preferences(&alias).unwrap_err();
        assert!(error.to_string().contains("repository not open"));
        let error = manager
            .set_hook_preferences("/tmp/not-open", HookPreferences::default())
            .unwrap_err();
        assert!(error.to_string().contains("repository not open"));
    }

    #[test]
    fn hook_runs_require_and_share_the_open_normalized_repository_key() {
        let (dir, _) = make_git_repo_with_commit();
        let state = AppState::new();
        let info = state.manager.open(dir.path().to_str().unwrap()).unwrap();
        let first = state.begin_hook_run(&info.path).unwrap();

        let alias = dir.path().join(".").to_string_lossy().into_owned();
        assert!(state
            .begin_hook_run(&alias)
            .unwrap_err()
            .to_string()
            .contains("repository not open"));
        assert_eq!(
            state.begin_hook_run(&info.path).unwrap_err().to_string(),
            "a hook-aware operation is already running for this repository"
        );
        drop(first);
        assert!(state.begin_hook_run(&info.path).is_ok());
    }

    #[test]
    fn captured_graph_handle_dirties_the_original_repo_after_tab_closes() {
        let (dir, external_repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        let info = manager.open(dir.path().to_str().unwrap()).unwrap();
        let (_, graph_handle) = manager
            .open_repo_worktree_and_graph_handle(&info.path)
            .unwrap();
        {
            let mut state = graph_handle.state.lock().unwrap();
            let RepoState {
                repo, graph_cache, ..
            } = &mut *state;
            let layout = crate::graph::compute_layout_cached(repo, graph_cache, 0, 10).unwrap();
            assert_eq!(layout.total_count, 1);
        }

        manager.close(&info.path).unwrap();
        {
            let sig = Signature::now("Test", "test@test.com").unwrap();
            let head = external_repo.head().unwrap().peel_to_commit().unwrap();
            let tree = head.tree().unwrap();
            external_repo
                .commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&head])
                .unwrap();
        }
        graph_handle.mark_dirty().unwrap();

        let mut state = graph_handle.state.lock().unwrap();
        let RepoState {
            repo, graph_cache, ..
        } = &mut *state;
        let layout = crate::graph::compute_layout_cached(repo, graph_cache, 0, 10).unwrap();
        assert_eq!(layout.total_count, 2);
    }

    /// Task B2: `with_repo_mut` must flag the graph cache dirty after any
    /// mutation, so a checkout/commit/merge made through this app's own
    /// commands is never missed by `compute_layout_cached`'s "only re-verify
    /// when told to" optimisation (see `crate::graph::mark_dirty`) — this is
    /// the integration point layout.rs's own cache-behaviour tests can't
    /// cover, since they don't go through `RepoManager` at all.
    #[test]
    fn with_repo_mut_marks_the_graph_cache_dirty_so_a_commit_is_noticed() {
        let (dir, _) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();

        let before = manager
            .with_repo_graph_cache(|repo, cache| {
                crate::graph::compute_layout_cached(repo, cache, 0, 10)
            })
            .unwrap()
            .unwrap();
        assert_eq!(before.total_count, 1);

        manager
            .with_repo_mut(|repo| {
                let sig = Signature::now("Test", "test@test.com").unwrap();
                let head = repo.head().unwrap().peel_to_commit().unwrap();
                let tree = head.tree().unwrap();
                repo.commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&head])
                    .unwrap();
            })
            .unwrap();

        let after = manager
            .with_repo_graph_cache(|repo, cache| {
                crate::graph::compute_layout_cached(repo, cache, 0, 10)
            })
            .unwrap()
            .unwrap();
        assert_eq!(after.total_count, 2);
    }

    /// Task B1 spike gate (docs/superpowers/perf-baseline.md): reproduces the
    /// problem the per-repo-locking task exists to fix, with a real number —
    /// not simulated by `BENCH_REPO_PATH`, since the point isn't repo size,
    /// it's that `repos: Mutex<Vec<OpenRepo>>` is one lock shared by every
    /// open tab. A slow operation on tab A (stood in for by a `sleep` inside
    /// the `with_repo_mut` closure, in place of a real network fetch) must
    /// not hold up a totally unrelated, otherwise-cheap operation on tab B
    /// (`get_working_tree_status`) — each tab's repo state lives behind its
    /// own lock (see `RepoState`), so tab B only ever waits on the brief
    /// outer-Vec lookup, never on tab A's slow closure. This is the fixed
    /// counterpart of the Task B1 spike gate (see perf-baseline.md), which
    /// measured tab B blocked ~135ms of A's 150ms op under the old single
    /// shared `Mutex<Vec<OpenRepo>>`. Deterministic (fixed sleep, no bench
    /// repo needed), so it runs as part of the normal suite.
    #[test]
    fn tab_a_slow_op_does_not_block_tab_b() {
        let (dir_a, _) = make_git_repo_with_commit();
        let (dir_b, _) = make_git_repo_with_commit();
        let manager = std::sync::Arc::new(RepoManager::new());
        // `open`'s returned `RepoInfo.path` is git2's canonicalised workdir
        // path, which can differ from the raw tempdir string (e.g. macOS
        // resolves `/var/...` to `/private/var/...`) — `activate` matches on
        // that canonical form, so tests must use it too (see
        // `activate_switches_the_active_tab` for the same pattern).
        let info_a = manager.open(dir_a.path().to_str().unwrap()).unwrap();
        let info_b = manager.open(dir_b.path().to_str().unwrap()).unwrap();
        manager.activate(&info_a.path).unwrap();

        const SLOW_OP_MS: u64 = 150;
        let m2 = std::sync::Arc::clone(&manager);
        let handle = std::thread::spawn(move || {
            // Stands in for a real long/network op (e.g. fetch) on tab A.
            m2.with_repo_mut(|_repo| {
                std::thread::sleep(std::time::Duration::from_millis(SLOW_OP_MS));
            })
            .unwrap();
        });
        // Give the spawned thread a head start so it acquires the lock first.
        std::thread::sleep(std::time::Duration::from_millis(20));

        let t0 = std::time::Instant::now();
        manager.activate(&info_b.path).unwrap();
        manager
            .with_repo(|repo| crate::working_tree::get_working_tree_status(repo))
            .unwrap()
            .unwrap();
        let blocked = t0.elapsed();

        handle.join().unwrap();
        println!(
            "tab B (get_working_tree_status) took {blocked:?} while tab A ran a {SLOW_OP_MS}ms op"
        );
        assert!(
            blocked < std::time::Duration::from_millis(100),
            "expected tab B to run without waiting on tab A's slow op, but it took {blocked:?}"
        );
    }

    /// Perf harness (Phase 0 of docs/superpowers/perf-baseline.md): opens the
    /// repo at `BENCH_REPO_PATH` directly (no `RepoManager` needed — the same
    /// seam a Tauri command uses) and times `list_branches` on it. Ignored by
    /// default; run with:
    /// `BENCH_REPO_PATH=/path/to/bench-repo cargo test --release -- --ignored --nocapture bench_`
    #[test]
    #[ignore = "perf harness: requires BENCH_REPO_PATH"]
    fn bench_list_branches() {
        let path = std::env::var("BENCH_REPO_PATH").expect("set BENCH_REPO_PATH to the bench repo");
        let repo = Repository::open(&path).unwrap();
        let start = std::time::Instant::now();
        let branches = list_branches(&repo).unwrap();
        println!(
            "list_branches: {} branches in {:?}",
            branches.len(),
            start.elapsed()
        );
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
    fn repo_info_uses_the_actual_workdir_for_a_linked_worktree() {
        let (main_dir, repo) = make_git_repo_with_commit();
        let head = repo.head().unwrap().peel_to_commit().unwrap().id();
        let worktree_dir = tempfile::tempdir().unwrap();
        // Register a linked worktree via the git CLI (git2's worktree support
        // doesn't cover the checkout step conveniently here); its gitdir will
        // be <main>/.git/worktrees/wt.
        let output = std::process::Command::new("git")
            .args([
                "worktree",
                "add",
                "--detach",
                worktree_dir.path().to_str().unwrap(),
                &head.to_string(),
            ])
            .current_dir(main_dir.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        drop(repo);

        let wt_repo = git2::Repository::open(worktree_dir.path()).unwrap();
        let info = repo_info(&wt_repo);

        assert_eq!(
            std::fs::canonicalize(&info.path).unwrap(),
            std::fs::canonicalize(worktree_dir.path()).unwrap(),
            "repo_info's path must be the worktree's actual working directory, \
             not .git/worktrees/<name> (repo.path()'s parent for a linked worktree)"
        );
    }

    #[test]
    fn open_repo_returns_worktree_metadata_for_a_linked_worktree() {
        let (main_dir, repo) = make_git_repo_with_commit();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/worktree", &head, false).unwrap();

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
        assert!(
            output.status.success(),
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let manager = RepoManager::new();
        let info = manager.open(worktree_dir.path().to_str().unwrap()).unwrap();

        assert_eq!(info.repo_kind, crate::commands::repo::RepoKind::Worktree);
        assert_eq!(
            info.parent_repo_path
                .as_deref()
                .map(|path| std::fs::canonicalize(path).unwrap()),
            Some(std::fs::canonicalize(repo.workdir().unwrap()).unwrap())
        );
        assert_eq!(info.worktree_branch.as_deref(), Some("feature/worktree"));
    }

    #[test]
    fn restore_open_paths_skips_an_existing_but_invalid_path() {
        let (dir, repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        let invalid_dir = tempfile::tempdir().unwrap();
        std::fs::write(invalid_dir.path().join("not-a-repo.txt"), "x\n").unwrap();

        restore_open_paths(
            &manager,
            vec![
                repo.workdir().unwrap().to_path_buf(),
                invalid_dir.path().to_path_buf(),
            ],
            Some(repo.workdir().unwrap().to_path_buf()),
        )
        .unwrap();

        let open = manager.list_open().unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(
            std::fs::canonicalize(&open[0].path).unwrap(),
            std::fs::canonicalize(dir.path()).unwrap()
        );
    }

    #[test]
    fn create_worktree_creates_and_returns_a_linked_worktree_repo() {
        let (_main_dir, repo) = make_git_repo_with_commit();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/worktree", &head, false).unwrap();
        let worktree_dir = tempfile::tempdir().unwrap();

        let manager = RepoManager::new();
        manager
            .open(repo.workdir().unwrap().to_str().unwrap())
            .unwrap();

        let info = manager
            .create_worktree(
                Some(repo.workdir().unwrap().to_str().unwrap()),
                worktree_dir.path().to_str().unwrap(),
                crate::worktree_ops::CreateWorktreeMode::ExistingBranch,
                Some("feature/worktree"),
                None,
                None,
            )
            .unwrap();

        assert_eq!(info.repo_kind, crate::commands::repo::RepoKind::Worktree);
        assert_eq!(
            std::fs::canonicalize(&info.path).unwrap(),
            std::fs::canonicalize(worktree_dir.path()).unwrap()
        );
    }

    #[test]
    fn create_worktree_rejects_a_branch_checked_out_in_another_worktree() {
        let (main_dir, repo) = make_git_repo_with_commit();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/worktree", &head, false).unwrap();
        let first = tempfile::tempdir().unwrap();
        let output = std::process::Command::new("git")
            .args([
                "worktree",
                "add",
                first.path().to_str().unwrap(),
                "feature/worktree",
            ])
            .current_dir(main_dir.path())
            .output()
            .unwrap();
        assert!(output.status.success());

        let second = tempfile::tempdir().unwrap();
        let manager = RepoManager::new();
        manager
            .open(repo.workdir().unwrap().to_str().unwrap())
            .unwrap();

        let err = manager
            .create_worktree(
                Some(repo.workdir().unwrap().to_str().unwrap()),
                second.path().to_str().unwrap(),
                crate::worktree_ops::CreateWorktreeMode::ExistingBranch,
                Some("feature/worktree"),
                None,
                None,
            )
            .unwrap_err();

        assert!(err.to_string().contains("already used by worktree"));
    }

    #[test]
    fn create_worktree_rejects_a_non_empty_target_directory() {
        let (_main_dir, repo) = make_git_repo_with_commit();
        let target = tempfile::tempdir().unwrap();
        std::fs::write(target.path().join("existing.txt"), "x\n").unwrap();

        let manager = RepoManager::new();
        manager
            .open(repo.workdir().unwrap().to_str().unwrap())
            .unwrap();

        let err = manager
            .create_worktree(
                Some(repo.workdir().unwrap().to_str().unwrap()),
                target.path().to_str().unwrap(),
                crate::worktree_ops::CreateWorktreeMode::NewBranchFromBase,
                Some("feature/new"),
                Some("main"),
                None,
            )
            .unwrap_err();

        assert!(err
            .to_string()
            .contains("Target folder must not already contain files"));
    }

    #[test]
    fn create_worktree_is_blocked_when_a_sibling_tab_in_the_same_family_has_an_active_operation() {
        let (main_dir, repo) = make_git_repo_with_commit();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/a", &head, false).unwrap();
        repo.branch("feature/b", &head, false).unwrap();
        let sibling = tempfile::tempdir().unwrap();
        let output = std::process::Command::new("git")
            .args([
                "worktree",
                "add",
                sibling.path().to_str().unwrap(),
                "feature/a",
            ])
            .current_dir(main_dir.path())
            .output()
            .unwrap();
        assert!(output.status.success());

        let manager = RepoManager::new();
        manager
            .open(repo.workdir().unwrap().to_str().unwrap())
            .unwrap();
        manager.open(sibling.path().to_str().unwrap()).unwrap();
        mark_operation_in_progress_for_path(&manager, sibling.path());

        let target = tempfile::tempdir().unwrap();
        let err = manager
            .create_worktree(
                Some(repo.workdir().unwrap().to_str().unwrap()),
                target.path().to_str().unwrap(),
                crate::worktree_ops::CreateWorktreeMode::NewBranchFromBase,
                Some("feature/c"),
                Some("main"),
                None,
            )
            .unwrap_err();

        assert!(err
            .to_string()
            .contains("another tab in this worktree family has an operation in progress"));
    }

    #[test]
    fn checkout_remote_branch_creates_tracking_local_and_checks_it_out() {
        let (dir, repo) = make_git_repo_with_commit();
        // Simulate a clone: an "origin" remote plus a remote-tracking branch.
        repo.remote("origin", "https://example.com/repo.git")
            .unwrap();
        let head_id = repo.head().unwrap().peel_to_commit().unwrap().id();
        repo.reference(
            "refs/remotes/origin/feature",
            head_id,
            true,
            "remote branch",
        )
        .unwrap();
        drop(repo);

        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        manager
            .checkout_remote_branch("origin/feature", false)
            .unwrap();

        manager
            .with_repo(|r| {
                let b = r
                    .find_branch("feature", BranchType::Local)
                    .expect("local branch created");
                assert!(b.is_head(), "feature should be checked out");
                let upstream = b.upstream().unwrap();
                assert_eq!(upstream.name().unwrap().unwrap(), "origin/feature");
            })
            .unwrap();
    }

    #[test]
    fn checkout_remote_branch_errors_when_remote_missing() {
        let (dir, _repo) = make_git_repo_with_commit();
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        assert!(manager
            .checkout_remote_branch("origin/nope", false)
            .is_err());
    }

    #[test]
    fn checkout_commit_detaches_head_at_that_commit() {
        let (dir, repo) = make_git_repo_with_commit();
        // Add a second commit so we can detach back onto the first.
        let first = repo.head().unwrap().peel_to_commit().unwrap().id();
        {
            let sig = Signature::now("Test", "test@test.com").unwrap();
            let parent = repo.find_commit(first).unwrap();
            let tree = parent.tree().unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent])
                .unwrap();
        }
        drop(repo);

        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        manager.checkout_commit(&first.to_string(), false).unwrap();

        manager
            .with_repo(|r| {
                assert!(r.head_detached().unwrap(), "HEAD should be detached");
                assert_eq!(r.head().unwrap().peel_to_commit().unwrap().id(), first);
            })
            .unwrap();
    }

    #[test]
    fn checkout_commit_does_not_discard_uncommitted_changes() {
        // safe() checkout must refuse (not silently overwrite) when a file with
        // local edits would be changed by the checkout — the edits stay on disk.
        let (dir, repo) = make_git_repo_with_commit();
        let path = dir.path().join("f.txt");

        // c1: f.txt = "a"
        std::fs::write(&path, "a\n").unwrap();
        let c1;
        {
            let mut idx = repo.index().unwrap();
            idx.add_path(std::path::Path::new("f.txt")).unwrap();
            idx.write().unwrap();
            let tree = repo.find_tree(idx.write_tree().unwrap()).unwrap();
            let sig = Signature::now("Test", "test@test.com").unwrap();
            let parent = repo.head().unwrap().peel_to_commit().unwrap();
            c1 = repo
                .commit(Some("HEAD"), &sig, &sig, "c1", &tree, &[&parent])
                .unwrap();
        }
        // c2 (now HEAD): f.txt = "b"
        std::fs::write(&path, "b\n").unwrap();
        {
            let mut idx = repo.index().unwrap();
            idx.add_path(std::path::Path::new("f.txt")).unwrap();
            idx.write().unwrap();
            let tree = repo.find_tree(idx.write_tree().unwrap()).unwrap();
            let sig = Signature::now("Test", "test@test.com").unwrap();
            let parent = repo.head().unwrap().peel_to_commit().unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "c2", &tree, &[&parent])
                .unwrap();
        }
        // Uncommitted local edit that conflicts with c1's version of f.txt.
        std::fs::write(&path, "local edit\n").unwrap();
        drop(repo);

        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        let result = manager.checkout_commit(&c1.to_string(), false);

        assert!(
            result.is_err(),
            "checkout should refuse to overwrite local changes"
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "local edit\n",
            "the uncommitted edit must be preserved",
        );
    }

    #[test]
    fn blocked_checkout_reports_the_auto_stash_sentinel() {
        // A checkout refused purely because stashable local changes would be lost
        // surfaces the sentinel, so the frontend can offer to auto-stash.
        let (dir, repo) = make_conflicting_branch_repo();
        drop(repo);
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();

        let err = match manager.checkout_branch("target", false) {
            Ok(_) => panic!("checkout should have been refused"),
            Err(e) => e,
        };
        assert_eq!(err.to_string(), crate::working_tree::AUTO_STASH_SENTINEL);
    }

    #[test]
    fn auto_stash_checkout_parks_changes_and_switches() {
        // With auto_stash, the conflicting local edit is stashed (left in the
        // stash list — "park on switch") and the checkout completes.
        let (dir, repo) = make_conflicting_branch_repo();
        let path = dir.path().join("f.txt");
        drop(repo);
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();

        manager.checkout_branch("target", true).unwrap();

        // The working tree now holds target's version, not the local edit...
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a\n");
        // ...and the edit is preserved in exactly one stash entry.
        let stashes = manager
            .with_repo_mut(|repo| crate::stash::stash_list(repo))
            .unwrap()
            .unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.contains("Auto-stash before checkout"));
    }

    #[test]
    fn auto_stash_checkout_is_a_no_op_stash_when_tree_is_clean() {
        // auto_stash set but nothing to stash: switch normally, create no stash.
        let (dir, repo) = make_conflicting_branch_repo();
        drop(repo);
        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        // Discard the working-tree edit so the tree is clean before switching.
        manager
            .with_repo(crate::working_tree::discard_all)
            .unwrap()
            .unwrap();

        manager.checkout_branch("target", true).unwrap();

        let stashes = manager
            .with_repo_mut(|repo| crate::stash::stash_list(repo))
            .unwrap()
            .unwrap();
        assert!(stashes.is_empty(), "clean tree must not create a stash");
    }

    /// Repo with `main`/`master` at f.txt="b" (HEAD), a `target` branch at
    /// f.txt="a", and an uncommitted edit to f.txt that conflicts with `target`
    /// — so a plain checkout of `target` is refused.
    fn make_conflicting_branch_repo() -> (TempDir, Repository) {
        let (dir, repo) = make_git_repo_with_commit();
        let path = dir.path().join("f.txt");
        let sig = Signature::now("Test", "test@test.com").unwrap();

        let commit_f = |content: &str, msg: &str| -> git2::Oid {
            std::fs::write(&path, content).unwrap();
            let mut idx = repo.index().unwrap();
            idx.add_path(std::path::Path::new("f.txt")).unwrap();
            idx.write().unwrap();
            let tree = repo.find_tree(idx.write_tree().unwrap()).unwrap();
            let parent = repo.head().unwrap().peel_to_commit().unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&parent])
                .unwrap()
        };

        let c1 = commit_f("a\n", "c1");
        commit_f("b\n", "c2");
        // Branch `target` at c1 (f.txt="a").
        repo.branch("target", &repo.find_commit(c1).unwrap(), false)
            .unwrap();
        // Uncommitted local edit conflicting with target's "a".
        std::fs::write(&path, "local edit\n").unwrap();
        (dir, repo)
    }

    #[test]
    fn create_tag_makes_lightweight_and_annotated_tags() {
        let (dir, repo) = make_git_repo_with_commit();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Test").unwrap();
            cfg.set_str("user.email", "test@test.com").unwrap();
        }
        let head = repo.head().unwrap().peel_to_commit().unwrap().id();
        drop(repo);

        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        manager.create_tag("v1", &head.to_string(), None).unwrap();
        manager
            .create_tag("v2", &head.to_string(), Some("release notes"))
            .unwrap();

        manager
            .with_repo(|r| {
                assert!(
                    r.find_reference("refs/tags/v1").is_ok(),
                    "lightweight tag missing"
                );
                // The annotated tag resolves to a tag object.
                let v2 = r.revparse_single("v2").unwrap();
                assert!(v2.as_tag().is_some(), "v2 should be an annotated tag");
                assert_eq!(v2.as_tag().unwrap().target_id(), head);
            })
            .unwrap();
    }

    #[test]
    fn delete_tag_removes_the_ref() {
        let (dir, repo) = make_git_repo_with_commit();
        let head = repo.head().unwrap().peel_to_commit().unwrap().id();
        drop(repo);

        let manager = RepoManager::new();
        manager.open(dir.path().to_str().unwrap()).unwrap();
        manager.create_tag("v1", &head.to_string(), None).unwrap();
        manager
            .with_repo(|r| assert!(r.find_reference("refs/tags/v1").is_ok()))
            .unwrap();

        manager.delete_tag("v1").unwrap();
        manager
            .with_repo(|r| assert!(r.find_reference("refs/tags/v1").is_err()))
            .unwrap();
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
        assert_eq!(
            config.last_repo_path.as_ref().unwrap(),
            &PathBuf::from(&info.path)
        );
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
    fn find_prunable_branches_classifies_gone_and_local_only() {
        let (_dir, repo) = make_git_repo_with_commit();
        let head = repo.head().unwrap().peel_to_commit().unwrap();

        {
            let mut config = repo.config().unwrap();
            // "gone": tracks origin/gone, but the remote-tracking ref is absent.
            repo.branch("gone", &head, false).unwrap();
            config.set_str("branch.gone.remote", "origin").unwrap();
            config
                .set_str("branch.gone.merge", "refs/heads/gone")
                .unwrap();

            // "alive": tracks origin/alive, and the remote-tracking ref exists.
            repo.branch("alive", &head, false).unwrap();
            config.set_str("branch.alive.remote", "origin").unwrap();
            config
                .set_str("branch.alive.merge", "refs/heads/alive")
                .unwrap();
            repo.reference("refs/remotes/origin/alive", head.id(), true, "test")
                .unwrap();

            // "published-no-upstream": no upstream config, but a remote-tracking
            // ref of the same name exists — not local-only, not prunable.
            repo.branch("published-no-upstream", &head, false).unwrap();
            repo.reference(
                "refs/remotes/origin/published-no-upstream",
                head.id(),
                true,
                "test",
            )
            .unwrap();

            // "local-only": never had an upstream; sits on the base tip, so it's
            // already contained in the base branch (merged).
            repo.branch("local-only", &head, false).unwrap();

            // "wip": local-only with a commit the base branch doesn't have (unmerged).
            let sig = Signature::now("Test", "test@test.com").unwrap();
            let wip_oid = repo
                .commit(
                    None,
                    &sig,
                    &sig,
                    "wip work",
                    &head.tree().unwrap(),
                    &[&head],
                )
                .unwrap();
            repo.branch("wip", &repo.find_commit(wip_oid).unwrap(), false)
                .unwrap();
        }

        let prunable = find_prunable_branches(&repo).unwrap();
        let find = |name: &str| {
            prunable
                .iter()
                .find(|p| p.name == name)
                .unwrap_or_else(|| panic!("{name} should be prunable"))
                .clone()
        };

        let gone = find("gone");
        assert_eq!(gone.kind, PrunableKind::Gone);
        assert_eq!(gone.upstream.as_deref(), Some("origin/gone"));

        let local = find("local-only");
        assert_eq!(local.kind, PrunableKind::LocalOnly);
        assert_eq!(local.upstream, None);
        assert!(local.merged, "local-only on the base tip is merged");

        let wip = find("wip");
        assert_eq!(wip.kind, PrunableKind::LocalOnly);
        assert!(!wip.merged, "wip has a commit the base lacks — not merged");

        // "alive" and "published-no-upstream" both have a remote counterpart.
        assert!(prunable.iter().all(|p| p.name != "alive"));
        assert!(prunable.iter().all(|p| p.name != "published-no-upstream"));
    }

    #[test]
    fn find_prunable_branches_never_includes_the_current_branch() {
        let (_dir, repo) = make_git_repo_with_commit();
        let head_name = repo.head().unwrap().shorthand().unwrap().to_string();

        {
            let mut config = repo.config().unwrap();
            // Configure the checked-out branch as if its upstream were gone.
            config
                .set_str(&format!("branch.{head_name}.remote"), "origin")
                .unwrap();
            config
                .set_str(
                    &format!("branch.{head_name}.merge"),
                    &format!("refs/heads/{head_name}"),
                )
                .unwrap();
        }

        let prunable = find_prunable_branches(&repo).unwrap();
        assert!(prunable.iter().all(|p| p.name != head_name));
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
