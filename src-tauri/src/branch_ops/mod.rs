//! Local branch-pointer operations that don't touch a remote: fast-forwarding a
//! branch to a descendant commit, with or without it being the checked-out one.

use anyhow::Context;
use git2::{BranchType, Oid, Repository};

#[derive(Debug, PartialEq, Eq)]
pub enum FastForwardOutcome {
    /// The branch already points at the target — nothing to do.
    AlreadyUpToDate,
    /// The branch ref was advanced to the target.
    FastForwarded,
    /// The target isn't a descendant of the branch tip; the repo is untouched.
    NotFastForward,
}

/// Fast-forward local `branch` to `target_oid`, when `target_oid` is a
/// descendant of the branch tip.
///
/// When `branch` is the checked-out branch, the working tree and index are
/// updated to the target *before* the ref moves — order matters because HEAD is
/// a symbolic ref to the branch, so moving the ref first would make checkout's
/// baseline equal the target and leave the tree stale (see the same reasoning in
/// [`crate::remote_ops::pull_ff`]). When HEAD is detached, the branch is never
/// "current", so only the ref moves and the working tree is left untouched —
/// which is exactly the recovery for a commit made on a detached HEAD.
///
/// Returns [`FastForwardOutcome::NotFastForward`], leaving the repository
/// untouched, when the move would not be a fast-forward.
pub fn fast_forward(
    repo: &Repository,
    branch: &str,
    target_oid: Oid,
) -> anyhow::Result<FastForwardOutcome> {
    let local_ref = format!("refs/heads/{branch}");
    let tip = repo
        .refname_to_id(&local_ref)
        .with_context(|| format!("local branch ref '{local_ref}' not found"))?;

    if tip == target_oid {
        return Ok(FastForwardOutcome::AlreadyUpToDate);
    }

    // A fast-forward is only possible when the branch tip is an ancestor of the
    // target (i.e. the target descends from it).
    if !repo.graph_descendant_of(target_oid, tip)? {
        return Ok(FastForwardOutcome::NotFastForward);
    }

    let is_current = repo
        .head()
        .ok()
        .and_then(|h| h.name().map(|n| n == local_ref.as_str()))
        .unwrap_or(false);

    if is_current {
        let target_commit = repo.find_commit(target_oid)?;
        crate::working_tree::safe_checkout_tree(repo, target_commit.as_object())?;
    }

    repo.reference(
        &local_ref,
        target_oid,
        true,
        &format!("Fast-forward {branch} to {target_oid}"),
    )?;

    log::info!(
        target: "git",
        "fast-forward: branch={branch} -> {target_oid} (current={is_current})"
    );
    Ok(FastForwardOutcome::FastForwarded)
}

/// Fast-forward local `branch` to its configured upstream tracking branch,
/// using whatever the last fetch already recorded (no network access).
pub fn fast_forward_to_upstream(
    repo: &Repository,
    branch: &str,
) -> anyhow::Result<FastForwardOutcome> {
    let local = repo
        .find_branch(branch, BranchType::Local)
        .with_context(|| format!("branch not found: {branch}"))?;
    let upstream = local
        .upstream()
        .with_context(|| format!("branch '{branch}' has no upstream"))?;
    let target = upstream
        .get()
        .target()
        .context("upstream tracking branch has no commit")?;
    fast_forward(repo, branch, target)
}

/// The local branches that could be fast-forwarded to `target_oid` — those whose
/// tip is a strict ancestor of the target. Used to offer only valid
/// "fast-forward X to here" actions in the UI.
pub fn fast_forwardable_branches(
    repo: &Repository,
    target_oid: Oid,
) -> anyhow::Result<Vec<String>> {
    let mut out = Vec::new();
    for entry in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = entry?;
        let Some(name) = branch.name()?.map(str::to_string) else {
            continue;
        };
        let Some(tip) = branch.get().target() else {
            continue;
        };
        if tip != target_oid && repo.graph_descendant_of(target_oid, tip)? {
            out.push(name);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::build::CheckoutBuilder;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    /// A fresh non-bare repo on `main` with one (empty-tree) commit.
    fn init_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Test").unwrap();
            config.set_str("user.email", "test@test.com").unwrap();
        }
        {
            let sig = repo.signature().unwrap();
            let tree = repo
                .find_tree(repo.treebuilder(None).unwrap().write().unwrap())
                .unwrap();
            repo.commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        repo.set_head("refs/heads/main").unwrap();
        (dir, repo)
    }

    /// Commit a file onto the current HEAD (advances whatever HEAD points at).
    fn commit_file(repo: &Repository, dir: &Path, name: &str, content: &str) -> Oid {
        fs::write(dir.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "change", &tree, &[&parent])
            .unwrap()
    }

    fn checkout(repo: &Repository, refname: &str) {
        let obj = repo.revparse_single(refname).unwrap();
        repo.checkout_tree(&obj, Some(CheckoutBuilder::new().force()))
            .unwrap();
        repo.set_head(refname).unwrap();
    }

    fn oid_of(repo: &Repository, refname: &str) -> Oid {
        repo.refname_to_id(refname).unwrap()
    }

    #[test]
    fn already_up_to_date_when_branch_at_target() {
        let (_dir, repo) = init_repo();
        let base = oid_of(&repo, "refs/heads/main");
        repo.branch("feature", &repo.find_commit(base).unwrap(), false)
            .unwrap();

        let outcome = fast_forward(&repo, "feature", base).unwrap();
        assert_eq!(outcome, FastForwardOutcome::AlreadyUpToDate);
    }

    #[test]
    fn fast_forward_non_current_branch_moves_ref_only() {
        let (dir, repo) = init_repo();
        let base = oid_of(&repo, "refs/heads/main");
        // feature stays at base; main advances ahead of it (main is current).
        repo.branch("feature", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        commit_file(&repo, dir.path(), "a.txt", "a");
        let target = commit_file(&repo, dir.path(), "b.txt", "b");

        let head_before = repo.head().unwrap().name().unwrap().to_string();
        let outcome = fast_forward(&repo, "feature", target).unwrap();

        assert_eq!(outcome, FastForwardOutcome::FastForwarded);
        assert_eq!(oid_of(&repo, "refs/heads/feature"), target);
        // HEAD is untouched — we were on main and stay on main.
        assert_eq!(repo.head().unwrap().name().unwrap(), head_before);
        assert_eq!(head_before, "refs/heads/main");
    }

    #[test]
    fn fast_forward_current_branch_updates_working_tree() {
        let (dir, repo) = init_repo();
        let base = oid_of(&repo, "refs/heads/main");
        // Build the target on a side branch so main can be fast-forwarded to it.
        repo.branch("ahead", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        checkout(&repo, "refs/heads/ahead");
        let target = commit_file(&repo, dir.path(), "new.txt", "hello");
        // Back to main (base) — the new file is removed by the forced checkout.
        checkout(&repo, "refs/heads/main");
        assert!(!dir.path().join("new.txt").exists());

        let outcome = fast_forward(&repo, "main", target).unwrap();

        assert_eq!(outcome, FastForwardOutcome::FastForwarded);
        assert_eq!(oid_of(&repo, "refs/heads/main"), target);
        // The working tree was materialised and is clean.
        assert_eq!(
            fs::read_to_string(dir.path().join("new.txt")).unwrap(),
            "hello"
        );
        let status = crate::working_tree::get_working_tree_status(&repo).unwrap();
        assert!(status.staged.is_empty() && status.unstaged.is_empty());
    }

    #[test]
    fn fast_forward_detached_head_advances_branch_leaving_tree() {
        // The footgun recovery: a commit was made on a detached HEAD; main lags
        // behind. Fast-forwarding main to HEAD must move only the ref.
        let (dir, repo) = init_repo();
        let base = oid_of(&repo, "refs/heads/main");
        repo.set_head_detached(base).unwrap();
        let detached_commit = commit_file(&repo, dir.path(), "orphan.txt", "work");
        assert!(repo.head_detached().unwrap());
        assert_eq!(oid_of(&repo, "refs/heads/main"), base); // main still lags

        let outcome = fast_forward(&repo, "main", detached_commit).unwrap();

        assert_eq!(outcome, FastForwardOutcome::FastForwarded);
        assert_eq!(oid_of(&repo, "refs/heads/main"), detached_commit);
        // HEAD is still the (unchanged) detached commit.
        assert!(repo.head_detached().unwrap());
        assert_eq!(
            repo.head().unwrap().peel_to_commit().unwrap().id(),
            detached_commit
        );
    }

    #[test]
    fn diverged_returns_not_fast_forward_untouched() {
        let (dir, repo) = init_repo();
        let base = oid_of(&repo, "refs/heads/main");
        // feature diverges from main.
        repo.branch("feature", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        checkout(&repo, "refs/heads/feature");
        let feature_tip = commit_file(&repo, dir.path(), "f.txt", "f");
        checkout(&repo, "refs/heads/main");
        let target = commit_file(&repo, dir.path(), "m.txt", "m");

        let outcome = fast_forward(&repo, "feature", target).unwrap();

        assert_eq!(outcome, FastForwardOutcome::NotFastForward);
        assert_eq!(oid_of(&repo, "refs/heads/feature"), feature_tip); // untouched
    }

    #[test]
    fn fast_forwardable_branches_returns_only_ancestors() {
        let (dir, repo) = init_repo();
        let base = oid_of(&repo, "refs/heads/main");
        // A sits at base (an ancestor of the target); B diverges.
        repo.branch("A", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        repo.branch("B", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        checkout(&repo, "refs/heads/B");
        commit_file(&repo, dir.path(), "b.txt", "b");
        checkout(&repo, "refs/heads/main");
        let target = commit_file(&repo, dir.path(), "t.txt", "t");

        let mut names = fast_forwardable_branches(&repo, target).unwrap();
        names.sort();
        assert_eq!(names, vec!["A".to_string()]);
    }
}
