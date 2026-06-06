use crate::diff_engine::{
    CommitDetail,
    get_unstaged_diff as de_get_unstaged_diff,
    get_staged_diff as de_get_staged_diff,
};
use crate::repo_manager::AppState;
use crate::working_tree::FileDiffHunks;
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

#[tauri::command]
pub async fn get_unstaged_diff(path: String, state: State<'_, AppState>) -> Result<FileDiffHunks, String> {
    state.with_repo(|repo| de_get_unstaged_diff(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_staged_diff(path: String, state: State<'_, AppState>) -> Result<FileDiffHunks, String> {
    state.with_repo(|repo| de_get_staged_diff(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
