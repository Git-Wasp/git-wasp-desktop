use crate::graph::GraphViewport;
use crate::repo_manager::AppState;
use tauri::State;

// Not `async`: the body is 100% synchronous git2/fs work with no `.await`
// points. Tauri dispatches non-async commands to its blocking thread pool;
// marking this `async` previously meant every call ran inline on a tokio
// worker thread, so rapid scroll-driven calls serialized behind one another
// instead of running concurrently.
#[tauri::command]
pub fn get_graph_viewport(
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<GraphViewport, String> {
    let started = std::time::Instant::now();
    let result = state
        .with_repo_graph_cache(|repo, cache| {
            crate::graph::compute_layout_cached(repo, cache, offset, limit)
        })
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string());

    let elapsed = started.elapsed().as_millis();
    match &result {
        Ok(vp) => crate::graph::diag_log(&format!(
            "REQUEST offset={offset} limit={limit} returned={} total={} elapsed_ms={elapsed}",
            vp.nodes.len(),
            vp.total_count,
        )),
        Err(e) => crate::graph::diag_log(&format!(
            "REQUEST offset={offset} limit={limit} ERROR={e} elapsed_ms={elapsed}"
        )),
    }
    result
}

/// The graph row of a commit (e.g. a branch head), so the frontend can scroll
/// the graph to it. `None` when the commit isn't reachable from HEAD.
#[tauri::command]
pub fn find_commit_row(oid: String, state: State<'_, AppState>) -> Result<Option<usize>, String> {
    state
        .with_repo(|repo| crate::graph::find_commit_row(repo, &oid))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Scan the working tree once, returning the detailed status *and* updating the
/// graph cache's dirty-file count from that same scan. The frontend's combined
/// refresh (poll / focus / file-watcher) calls this instead of a separate status
/// fetch plus count-refresh, so a working-tree change costs one `repo.statuses()`
/// scan rather than two — the dominant cost on a large monorepo.
#[tauri::command]
pub fn refresh_working_tree(
    state: State<'_, AppState>,
) -> Result<crate::working_tree::WorkingTreeStatus, String> {
    state.refresh_working_tree().map_err(|e| e.to_string())
}
