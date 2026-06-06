use crate::graph::GraphViewport;
use crate::repo_manager::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_graph_viewport(
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<GraphViewport, String> {
    state.with_repo(|repo| {
        crate::graph::compute_layout(repo, offset, limit)
    })
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
