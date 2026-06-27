use git2::Repository;
use notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use tauri::{AppHandle, Emitter};

/// Whether a changed path is churn we should ignore — i.e. git-ignored by the
/// repo's own rules (`target/`, `node_modules/`, `dist/`, …). Honouring
/// `.gitignore` keeps the filter authoritative and per-repo rather than a
/// hardcoded guess.
///
/// `.git/` is deliberately exempt: it isn't covered by `.gitignore`, and its
/// changes (commits, merges, branch switches — including from the CLI) are
/// exactly what we want to surface.
fn is_noise(repo: &Repository, root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    if rel.components().any(|c| c.as_os_str() == ".git") {
        return false;
    }
    repo.is_path_ignored(rel).unwrap_or(false)
}

pub fn start(app_handle: AppHandle, path: &Path) -> notify::Result<RecommendedWatcher> {
    // Canonicalise so event paths (which arrive resolved, e.g. /private/var on
    // macOS) strip cleanly to repo-relative paths for the ignore check.
    let root = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    // A lightweight read-only handle used only to consult gitignore from the
    // watcher thread (git2::Repository is Send). If it can't be opened we fall
    // back to emitting every event.
    let repo = Repository::open(&root).ok();

    let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // Suppress only when there are paths and every one is ignored churn.
        // Pathless events (rescans) and any non-ignored path emit.
        if let Some(repo) = &repo {
            if !event.paths.is_empty() && event.paths.iter().all(|p| is_noise(repo, &root, p)) {
                return;
            }
        }
        let _ = app_handle.emit("working-tree-changed", ());
    })?;
    watcher.watch(path, RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn repo_with_gitignore(rules: &str) -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        std::fs::write(dir.path().join(".gitignore"), rules).unwrap();
        (dir, repo)
    }

    #[test]
    fn ignores_paths_matched_by_gitignore() {
        let (dir, repo) = repo_with_gitignore("target/\nnode_modules/\ndist/\n");
        let root = dir.path();
        assert!(is_noise(
            &repo,
            root,
            &root.join("target/debug/build/foo.rs")
        ));
        assert!(is_noise(
            &repo,
            root,
            &root.join("node_modules/react/index.js")
        ));
        assert!(is_noise(&repo, root, &root.join("dist/assets/app.js")));
    }

    #[test]
    fn keeps_tracked_paths_and_git_changes() {
        let (dir, repo) = repo_with_gitignore("target/\n");
        let root = dir.path();
        assert!(!is_noise(&repo, root, &root.join("src/main.rs")));
        assert!(!is_noise(&repo, root, &root.join("Cargo.toml")));
        // .git changes must register even though git2 may treat .git specially.
        assert!(!is_noise(&repo, root, &root.join(".git/MERGE_HEAD")));
        assert!(!is_noise(&repo, root, &root.join(".git/refs/heads/main")));
    }
}
