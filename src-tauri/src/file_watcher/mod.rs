use notify::{RecommendedWatcher, RecursiveMode, Watcher, recommended_watcher};
use std::path::{Component, Path};
use tauri::{AppHandle, Emitter};

/// Directories whose churn isn't a meaningful working-tree change. They produce
/// huge volumes of events (especially `target/` during a dev rebuild), which
/// would otherwise spam `working-tree-changed`. Git operations still land
/// outside these, so commits/merges/branch switches are still picked up.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", ".vite"];

/// True when a path lives inside an ignored build/dependency directory.
fn is_noise(path: &Path) -> bool {
    path.components().any(|c| {
        matches!(c, Component::Normal(name) if IGNORED_DIRS.iter().any(|d| name == *d))
    })
}

pub fn start(app_handle: AppHandle, path: &Path) -> notify::Result<RecommendedWatcher> {
    let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // Skip events whose every path is build/dependency churn. Events with no
        // paths (e.g. rescans) are treated as meaningful and still emitted.
        if !event.paths.is_empty() && event.paths.iter().all(|p| is_noise(p)) {
            return;
        }
        let _ = app_handle.emit("working-tree-changed", ());
    })?;
    watcher.watch(path, RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_build_and_dependency_dirs() {
        assert!(is_noise(Path::new("/repo/target/debug/build/foo.rs")));
        assert!(is_noise(Path::new("/repo/node_modules/react/index.js")));
        assert!(is_noise(Path::new("/repo/dist/assets/app.js")));
        assert!(is_noise(Path::new("/repo/.vite/deps/chunk.js")));
    }

    #[test]
    fn keeps_source_and_git_changes() {
        assert!(!is_noise(Path::new("/repo/src/main.rs")));
        assert!(!is_noise(Path::new("/repo/src-tauri/src/lib.rs")));
        // .git changes (commits, merges, branch switches) must still register.
        assert!(!is_noise(Path::new("/repo/.git/MERGE_HEAD")));
        assert!(!is_noise(Path::new("/repo/.git/refs/heads/main")));
    }
}
