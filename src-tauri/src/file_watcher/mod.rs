use notify::{RecommendedWatcher, RecursiveMode, Watcher, recommended_watcher};
use std::path::Path;
use tauri::{AppHandle, Emitter};

pub fn start(app_handle: AppHandle, path: &Path) -> notify::Result<RecommendedWatcher> {
    let mut watcher = recommended_watcher(move |_event| {
        let _ = app_handle.emit("working-tree-changed", ());
    })?;
    watcher.watch(path, RecursiveMode::Recursive)?;
    Ok(watcher)
}
