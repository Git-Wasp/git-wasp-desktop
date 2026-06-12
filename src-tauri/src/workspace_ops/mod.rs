use git2::{BranchType, Repository, Sort};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

/// How many of the most recent commits (from HEAD) `search_workspace_repo`
/// scans for a message match. Bounds the cost of cross-repo search on large
/// histories — a deliberate trade-off, not an oversight.
const SEARCH_COMMIT_DEPTH: usize = 200;

/// At-a-glance status for a single repository in a workspace, computed via a
/// transiently-opened `Repository` handle (opened, used, dropped). Never
/// hard-fails — a bad path (deleted repo, not a git repo) is captured in
/// `error` so one broken entry doesn't break the whole workspace view.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatusSummary {
    pub path: String,
    pub name: String,
    pub head_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub uncommitted_count: usize,
    pub error: Option<String>,
}

fn repo_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or(""))
        .to_string()
}

pub fn repo_status_summary(path: &Path) -> RepoStatusSummary {
    let path_str = path.to_string_lossy().to_string();
    let name = repo_name(path);

    let repo = match Repository::open(path) {
        Ok(repo) => repo,
        Err(e) => {
            return RepoStatusSummary {
                path: path_str,
                name,
                head_branch: None,
                ahead: 0,
                behind: 0,
                uncommitted_count: 0,
                error: Some(e.to_string()),
            };
        }
    };

    let head_branch = repo.head().ok().and_then(|h| h.shorthand().map(|s| s.to_string()));

    let uncommitted_count = match crate::working_tree::get_working_tree_status(&repo) {
        Ok(status) => {
            let mut paths = HashSet::new();
            for entry in status.staged.iter().chain(status.unstaged.iter()).chain(status.untracked.iter()) {
                paths.insert(entry.path.clone());
            }
            paths.len()
        }
        Err(_) => 0,
    };

    let (ahead, behind) = match crate::remote_ops::compute_ahead_behind(&repo) {
        Ok(entries) => head_branch
            .as_ref()
            .and_then(|hb| entries.iter().find(|ab| &ab.branch == hb))
            .map(|ab| (ab.ahead, ab.behind))
            .unwrap_or((0, 0)),
        Err(_) => (0, 0),
    };

    RepoStatusSummary { path: path_str, name, head_branch, ahead, behind, uncommitted_count, error: None }
}

/// A branch or commit in a workspace repository matching a cross-repo search
/// query.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SearchResultKind {
    Branch,
    Commit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossRepoSearchResult {
    pub repo_path: String,
    pub repo_name: String,
    pub kind: SearchResultKind,
    pub label: String,
    pub oid: Option<String>,
}

pub fn search_workspace_repo(_path: &Path, _query: &str) -> Vec<CrossRepoSearchResult> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{BranchType, Commit, Signature};
    use std::fs;
    use tempfile::TempDir;

    fn make_git_repo_with_commit() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        fs::write(dir.path().join("file.txt"), "original\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();
        drop(tree);
        (dir, repo)
    }

    /// Bare repo with a single empty-tree commit on `refs/heads/main`, used as
    /// a clone source so `compute_ahead_behind` has a real upstream to compare
    /// against without any network access.
    fn make_bare_remote_with_commit() -> TempDir {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init_bare(dir.path()).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree_id = repo.treebuilder(None).unwrap().write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("refs/heads/main"), &sig, &sig, "initial", &tree, &[]).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        dir
    }

    fn clone_repo(remote_path: &Path, dest: &Path) -> Repository {
        let repo = git2::build::RepoBuilder::new().clone(remote_path.to_str().unwrap(), dest).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        repo
    }

    fn commit_file(
        repo: &Repository,
        dir: &Path,
        name: &str,
        content: &str,
        message: &str,
        parents: &[&Commit],
    ) -> git2::Oid {
        fs::write(dir.join(name), content).unwrap();
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

    /// Builds a repo with `n` empty-tree commits on HEAD, with `oldest_message`
    /// as the very first (oldest) commit — used to test the search depth bound.
    fn make_repo_with_n_commits(n: usize, oldest_message: &str) -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        let tree_id = repo.treebuilder(None).unwrap().write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();

        let mut parent_oid: Option<git2::Oid> = None;
        for i in 0..n {
            let message = if i == 0 { oldest_message.to_string() } else { format!("commit {i}") };
            let parent = parent_oid.map(|oid| repo.find_commit(oid).unwrap());
            let parents: Vec<&Commit> = parent.iter().collect();
            parent_oid = Some(repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents).unwrap());
        }
        drop(tree);
        (dir, repo)
    }

    // ---- repo_status_summary ----

    #[test]
    fn summary_for_clean_repo_has_zero_uncommitted() {
        let (dir, _repo) = make_git_repo_with_commit();

        let summary = repo_status_summary(dir.path());

        assert!(summary.error.is_none());
        assert!(summary.head_branch.is_some());
        assert_eq!(summary.uncommitted_count, 0);
        assert_eq!(summary.ahead, 0);
        assert_eq!(summary.behind, 0);
    }

    #[test]
    fn summary_counts_distinct_paths_only() {
        let (dir, repo) = make_git_repo_with_commit();

        // Stage a modification to the tracked file...
        fs::write(dir.path().join("file.txt"), "staged change\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
        index.write().unwrap();
        // ...then modify it again without staging (same path, counts once).
        fs::write(dir.path().join("file.txt"), "unstaged change\n").unwrap();
        // Plus one untracked file (a second, distinct path).
        fs::write(dir.path().join("new.txt"), "new\n").unwrap();

        let summary = repo_status_summary(dir.path());

        assert_eq!(summary.uncommitted_count, 2);
    }

    #[test]
    fn summary_for_nonexistent_path_returns_error_field_not_err() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("does-not-exist");

        let summary = repo_status_summary(&missing);

        assert!(summary.error.is_some());
        assert_eq!(summary.uncommitted_count, 0);
        assert_eq!(summary.ahead, 0);
        assert_eq!(summary.behind, 0);
    }

    #[test]
    fn summary_ahead_behind_uses_current_branch_only() {
        let remote_dir = make_bare_remote_with_commit();
        let local_dir = TempDir::new().unwrap();
        let repo = clone_repo(remote_dir.path(), local_dir.path());

        // Create a second branch tracking the same upstream, then advance it
        // so it's ahead of `origin/main` — but leave it checked out elsewhere.
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head_commit, false).unwrap();
        {
            let mut feature_branch = repo.find_branch("feature", BranchType::Local).unwrap();
            feature_branch.set_upstream(Some("origin/main")).unwrap();
        }
        checkout_branch(&repo, "feature");
        commit_file(&repo, local_dir.path(), "f.txt", "feature content\n", "feature commit", &[&head_commit]);

        // Switch back to `main`, which is still in sync with `origin/main`.
        checkout_branch(&repo, "main");

        let summary = repo_status_summary(local_dir.path());

        assert_eq!(summary.head_branch.as_deref(), Some("main"));
        assert_eq!(summary.ahead, 0);
        assert_eq!(summary.behind, 0);
    }

    // ---- search_workspace_repo ----

    #[test]
    fn search_finds_matching_branch_case_insensitive() {
        let (dir, repo) = make_git_repo_with_commit();
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("Feature-Login", &head_commit, false).unwrap();

        let results = search_workspace_repo(dir.path(), "feature");

        assert!(results
            .iter()
            .any(|r| matches!(r.kind, SearchResultKind::Branch) && r.label == "Feature-Login"));
    }

    #[test]
    fn search_finds_matching_commit_message() {
        let (dir, repo) = make_git_repo_with_commit();
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        let oid = commit_file(&repo, dir.path(), "f.txt", "content\n", "fix: resolve important bug", &[&head_commit]);

        let results = search_workspace_repo(dir.path(), "important");

        let found = results.iter().find(|r| matches!(r.kind, SearchResultKind::Commit));
        let found = found.expect("expected a commit match");
        assert!(found.label.contains("important"));
        assert_eq!(found.oid.as_deref(), Some(oid.to_string().as_str()));
    }

    #[test]
    fn search_bounded_to_recent_commits() {
        let (dir, _repo) = make_repo_with_n_commits(SEARCH_COMMIT_DEPTH + 1, "very-unique-old-marker");

        let results = search_workspace_repo(dir.path(), "very-unique-old-marker");

        assert!(results.is_empty());
    }

    #[test]
    fn search_returns_empty_for_no_matches() {
        let (dir, _repo) = make_git_repo_with_commit();

        let results = search_workspace_repo(dir.path(), "nonexistent-query-xyz");

        assert!(results.is_empty());
    }

    #[test]
    fn search_nonexistent_repo_returns_empty_not_error() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("does-not-exist");

        let results = search_workspace_repo(&missing, "anything");

        assert!(results.is_empty());
    }
}
