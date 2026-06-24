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
    state.with_repo(|repo| crate::graph::find_commit_row(repo, &oid))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Re-scans the working tree and updates the graph cache's dirty-file count
/// without rebuilding the full layout. Called by the frontend off the
/// debounced `working-tree-changed` event, before re-fetching the viewport —
/// see [`crate::graph::refresh_working_tree_status`] for why this is split
/// out from the per-scroll viewport fetch.
#[tauri::command]
pub fn refresh_graph_working_tree_status(state: State<'_, AppState>) -> Result<(), String> {
    state.refresh_graph_working_tree_status().map_err(|e| e.to_string())
}
