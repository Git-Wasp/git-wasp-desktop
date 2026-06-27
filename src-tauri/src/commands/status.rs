use crate::repo_manager::AppState;
use crate::working_tree::{get_working_tree_status as wt_status, WorkingTreeStatus};
use tauri::State;

#[tauri::command]
pub async fn get_working_tree_status(
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_status(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
