use crate::merge_ops::{ConflictedFile, MergeOutcome};
use anyhow::Context;
use git2::{Repository, RepositoryState};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const SIDECAR_FILE_NAME: &str = "gitclient-operation.json";

/// The kind of multi-step operation currently in progress. A thin tag used to
/// dispatch generic commands (`operation_abort`) to the right concrete
/// implementation — new variants (e.g. `Rebase`) extend this without changing
/// the dispatcher's shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    Merge,
}

/// In-memory record of the operation `RepoManager` started — composed as a
/// sibling to the repo handle (not a separate top-level lock) so the two can
/// be locked together in a single critical section via
/// `with_repo_and_operation_mut`, without introducing a new lock-ordering
/// hazard. Mirrors (and is recoverable from) the on-disk sidecar file.
#[derive(Debug, Clone)]
pub struct OperationState {
    pub kind: OperationKind,
    pub source_branch: Option<String>,
}

/// Status reported to the frontend. Conflicts are always re-derived live from
/// `index.conflicts()` — never cached — since staging state can change
/// underneath the app (e.g. via an external terminal).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OperationStatus {
    None,
    Merge {
        /// `None` when recovered without a sidecar — e.g. the merge was
        /// started from the command line rather than this app.
        source_branch: Option<String>,
        conflicts: Vec<ConflictedFile>,
    },
}

/// On-disk shape of the recovery sidecar at `.git/gitclient-operation.json`.
/// Only `source_branch` actually needs persisting — everything else about an
/// in-progress merge (conflicts, resolution state) is re-derived live from
/// `repo.state()` and `index.conflicts()`, mirroring how `RepoManager`
/// already re-derives `RepoInfo` rather than caching it. MERGE_HEAD is an
/// OID, not a branch name, so the source branch is the one fact git's own
/// on-disk state can't give back to us.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarState {
    kind: OperationKind,
    source_branch: Option<String>,
}

fn sidecar_path(repo: &Repository) -> PathBuf {
    repo.path().join(SIDECAR_FILE_NAME)
}

fn write_sidecar(repo: &Repository, state: &OperationState) -> anyhow::Result<()> {
    let sidecar = SidecarState { kind: state.kind, source_branch: state.source_branch.clone() };
    let json = serde_json::to_string(&sidecar).context("failed to serialise operation state")?;
    std::fs::write(sidecar_path(repo), json).context("failed to write operation recovery file")?;
    Ok(())
}

fn read_sidecar(repo: &Repository) -> Option<SidecarState> {
    let bytes = std::fs::read(sidecar_path(repo)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn remove_sidecar(repo: &Repository) {
    let _ = std::fs::remove_file(sidecar_path(repo));
}

/// Reconciles the in-memory cache, git's own `repo.state()`, the recovery
/// sidecar, and the live index into a single `OperationStatus` — the
/// "mirroring Git's own in-progress operation tracking" recovery contract
/// from `CLAUDE.md`. Updates `cached` in place so a relaunch (cache starts
/// `None`) recovers cleanly the first time status is checked, and so a stale
/// cache left over from an externally-aborted operation gets cleared.
///
/// Reconciliation rules:
/// - `repo.state() == Merge` and no cached state: recover `source_branch`
///   from the sidecar if present, else report it as `None` (CLI-initiated).
/// - `repo.state() != Merge`: git's state is authoritative. Clear any cached
///   state and remove a stale sidecar (e.g. left behind by `git merge --abort`
///   run outside the app).
pub fn derive_status(
    repo: &Repository,
    cached: &mut Option<OperationState>,
) -> anyhow::Result<OperationStatus> {
    match repo.state() {
        RepositoryState::Merge => {
            let source_branch = match cached.as_ref() {
                Some(state) => state.source_branch.clone(),
                None => {
                    let source_branch =
                        read_sidecar(repo).and_then(|sidecar| sidecar.source_branch);
                    *cached = Some(OperationState {
                        kind: OperationKind::Merge,
                        source_branch: source_branch.clone(),
                    });
                    source_branch
                }
            };
            let conflicts = crate::merge_ops::collect_conflicts(repo)?;
            Ok(OperationStatus::Merge { source_branch, conflicts })
        }
        _ => {
            *cached = None;
            if sidecar_path(repo).exists() {
                remove_sidecar(repo);
            }
            Ok(OperationStatus::None)
        }
    }
}

/// Starts a merge and, on success (clean or conflicted), records operation
/// state both in memory and in the recovery sidecar. Refuses to start if
/// another operation is already in progress — matching git's own behaviour
/// and preventing the cached state from being clobbered.
pub fn start_merge(
    repo: &mut Repository,
    cached: &mut Option<OperationState>,
    branch_name: &str,
) -> anyhow::Result<MergeOutcome> {
    if repo.state() != RepositoryState::Clean {
        anyhow::bail!("cannot start a merge: another operation is already in progress");
    }

    let outcome = crate::merge_ops::start_merge(repo, branch_name)?;

    let state = OperationState {
        kind: OperationKind::Merge,
        source_branch: Some(branch_name.to_string()),
    };
    write_sidecar(repo, &state)?;
    *cached = Some(state);

    Ok(outcome)
}

/// Completes the in-progress merge and clears operation state (memory +
/// sidecar) on success — mirroring `git merge --continue`'s cleanup.
pub fn complete_merge(
    repo: &mut Repository,
    cached: &mut Option<OperationState>,
    message: &str,
) -> anyhow::Result<String> {
    let oid = crate::merge_ops::complete_merge(repo, message)?;
    *cached = None;
    remove_sidecar(repo);
    Ok(oid)
}

/// Aborts the in-progress merge and clears operation state (memory +
/// sidecar) — mirroring `git merge --abort`'s cleanup.
pub fn abort_merge(repo: &mut Repository, cached: &mut Option<OperationState>) -> anyhow::Result<()> {
    crate::merge_ops::abort_merge(repo)?;
    *cached = None;
    remove_sidecar(repo);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Commit, Signature};
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn init_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        (dir, repo)
    }

    fn commit_file(
        repo: &Repository,
        dir: &TempDir,
        name: &str,
        content: &str,
        message: &str,
        parents: &[&Commit],
    ) -> git2::Oid {
        fs::write(dir.path().join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, parents).unwrap()
    }

    fn checkout_branch(repo: &Repository, name: &str) {
        repo.set_head(&format!("refs/heads/{name}")).unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force())).unwrap();
    }

    /// Sets up two branches that conflict on the same line of file.txt and
    /// returns the name of the branch to merge into the (checked-out)
    /// original branch — mirrors `merge_ops::tests::make_conflicting_branches`.
    fn make_conflicting_branches(dir: &TempDir, repo: &Repository) -> String {
        let base_oid = commit_file(repo, dir, "file.txt", "line1\nshared\nline3\n", "base", &[]);
        let base = repo.find_commit(base_oid).unwrap();
        let current_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        repo.branch("theirs", &base, false).unwrap();
        checkout_branch(repo, "theirs");
        commit_file(repo, dir, "file.txt", "line1\ntheir change\nline3\n", "their change", &[&base]);

        checkout_branch(repo, &current_branch);
        commit_file(repo, dir, "file.txt", "line1\nour change\nline3\n", "our change", &[&base]);

        "theirs".to_string()
    }

    // ---- derive_status ----

    #[test]
    fn derive_status_reports_none_for_a_clean_repo() {
        let (dir, repo) = init_repo();
        commit_file(&repo, &dir, "a.txt", "a\n", "base", &[]);
        let mut cached = None;

        let status = derive_status(&repo, &mut cached).unwrap();

        assert!(matches!(status, OperationStatus::None));
        assert!(cached.is_none());
    }

    #[test]
    fn derive_status_reports_merge_with_cached_source_branch() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let mut cached = None;
        start_merge(&mut repo, &mut cached, &branch).unwrap();

        let status = derive_status(&repo, &mut cached).unwrap();

        match status {
            OperationStatus::Merge { source_branch, conflicts } => {
                assert_eq!(source_branch.as_deref(), Some("theirs"));
                assert_eq!(conflicts.len(), 1);
            }
            OperationStatus::None => panic!("expected an in-progress merge"),
        }
    }

    #[test]
    fn derive_status_recovers_source_branch_from_sidecar_when_cache_is_empty() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let mut cached = None;
        start_merge(&mut repo, &mut cached, &branch).unwrap();

        // Simulate a relaunch: the in-memory cache is gone, but the merge
        // and its sidecar are still on disk.
        let mut recovered_cache = None;
        let status = derive_status(&repo, &mut recovered_cache).unwrap();

        match status {
            OperationStatus::Merge { source_branch, .. } => {
                assert_eq!(source_branch.as_deref(), Some("theirs"));
            }
            OperationStatus::None => panic!("expected merge to be recovered from the sidecar"),
        }
        assert!(recovered_cache.is_some(), "cache should be repopulated from the sidecar");
    }

    #[test]
    fn derive_status_reports_merge_in_progress_without_sidecar_as_unknown_source() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);

        // CLI-initiated merge: no sidecar was ever written, no cached state exists.
        crate::merge_ops::start_merge(&mut repo, &branch).unwrap();
        let mut cached = None;

        let status = derive_status(&repo, &mut cached).unwrap();

        match status {
            OperationStatus::Merge { source_branch, conflicts } => {
                assert_eq!(source_branch, None);
                assert_eq!(conflicts.len(), 1);
            }
            OperationStatus::None => panic!("expected an in-progress merge"),
        }
    }

    #[test]
    fn derive_status_clears_a_stale_sidecar_left_by_an_external_abort() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let mut cached = None;
        start_merge(&mut repo, &mut cached, &branch).unwrap();
        assert!(sidecar_path(&repo).exists());

        // Simulate `git merge --abort` run from outside the app: git's state
        // goes back to clean, but the sidecar (and our cache) don't know yet.
        crate::merge_ops::abort_merge(&mut repo).unwrap();
        assert!(sidecar_path(&repo).exists(), "sidecar should still be present before reconciliation");

        let status = derive_status(&repo, &mut cached).unwrap();

        assert!(matches!(status, OperationStatus::None));
        assert!(cached.is_none());
        assert!(!sidecar_path(&repo).exists(), "stale sidecar should be removed");
    }

    // ---- start_merge / complete_merge / abort_merge state management ----

    #[test]
    fn start_merge_writes_sidecar_and_populates_cache() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let mut cached = None;

        start_merge(&mut repo, &mut cached, &branch).unwrap();

        let state = cached.as_ref().expect("operation state should be cached");
        assert_eq!(state.kind, OperationKind::Merge);
        assert_eq!(state.source_branch.as_deref(), Some("theirs"));
        assert!(sidecar_path(&repo).exists());
    }

    #[test]
    fn start_merge_refuses_when_an_operation_is_already_in_progress() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let mut cached = None;
        start_merge(&mut repo, &mut cached, &branch).unwrap();

        let result = start_merge(&mut repo, &mut cached, &branch);

        assert!(result.is_err());
    }

    #[test]
    fn complete_merge_clears_cache_and_sidecar_on_success() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let mut cached = None;
        start_merge(&mut repo, &mut cached, &branch).unwrap();
        crate::merge_ops::write_resolution(&repo, "file.txt", "line1\nresolved\nline3\n").unwrap();

        complete_merge(&mut repo, &mut cached, "merge theirs into current").unwrap();

        assert!(cached.is_none());
        assert!(!sidecar_path(&repo).exists());
    }

    #[test]
    fn abort_merge_clears_cache_and_sidecar() {
        let (dir, mut repo) = init_repo();
        let branch = make_conflicting_branches(&dir, &repo);
        let mut cached = None;
        start_merge(&mut repo, &mut cached, &branch).unwrap();

        abort_merge(&mut repo, &mut cached).unwrap();

        assert!(cached.is_none());
        assert!(!sidecar_path(&repo).exists());
        assert_eq!(repo.state(), RepositoryState::Clean);
    }
}
