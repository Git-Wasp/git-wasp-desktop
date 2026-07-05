use crate::repo_manager::AppState;
use crate::working_tree::{
    delete_file as wt_delete_file, discard_all as wt_discard_all, discard_file as wt_discard_file,
    discard_hunk as wt_discard_hunk, WorkingTreeStatus,
};
use tauri::State;

#[tauri::command]
pub async fn discard_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_discard_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_delete_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn discard_hunk(
    path: String,
    hunk_index: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .with_repo(|repo| wt_discard_hunk(repo, &path, hunk_index))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn discard_all(state: State<'_, AppState>) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(wt_discard_all)
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
