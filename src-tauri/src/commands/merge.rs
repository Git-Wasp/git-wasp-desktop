use crate::merge_ops::{ConflictSide, ConflictedFile, MergeOutcome};
use crate::operation_runner::OperationStatus;
use crate::repo_manager::AppState;
use tauri::State;

#[tauri::command]
pub async fn operation_status(state: State<'_, AppState>) -> Result<OperationStatus, String> {
    state.operation_status().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn operation_resume(state: State<'_, AppState>) -> Result<OperationStatus, String> {
    state.operation_resume().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn operation_abort(state: State<'_, AppState>) -> Result<(), String> {
    state.operation_abort().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_start(branch_name: String, state: State<'_, AppState>) -> Result<MergeOutcome, String> {
    state.merge_start(&branch_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_resolve_file(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<Vec<ConflictedFile>, String> {
    state.merge_resolve_file(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_resolve_with_side(
    path: String,
    side: ConflictSide,
    state: State<'_, AppState>,
) -> Result<Vec<ConflictedFile>, String> {
    state.merge_resolve_with_side(&path, side).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_resolve_with_deletion(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<ConflictedFile>, String> {
    state.merge_resolve_with_deletion(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_complete(message: String, state: State<'_, AppState>) -> Result<String, String> {
    state.merge_complete(&message).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_abort(state: State<'_, AppState>) -> Result<(), String> {
    state.merge_abort().map_err(|e| e.to_string())
}
