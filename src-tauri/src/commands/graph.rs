use crate::graph::GraphViewport;
use crate::repo_manager::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_graph_viewport(
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
pub async fn find_commit_row(
    oid: String,
    state: State<'_, AppState>,
) -> Result<Option<usize>, String> {
    state.with_repo(|repo| crate::graph::find_commit_row(repo, &oid))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
