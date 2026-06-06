use crate::diff_engine::{CommitDetail};
use crate::repo_manager::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_commit_diff(
    oid: String,
    state: State<'_, AppState>,
) -> Result<CommitDetail, String> {
    state.with_repo(|repo| {
        crate::diff_engine::get_commit_detail(repo, &oid)
    })
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_diff(
    oid: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.with_repo(|repo| {
        crate::diff_engine::get_file_diff(repo, &oid, &path)
    })
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
