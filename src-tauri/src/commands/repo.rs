use crate::repo_manager::{AppState, RepoEntry};
use tauri::{AppHandle, State};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub name: String,
    pub path: String,
    pub head_branch: Option<String>,
}

#[tauri::command]
pub async fn open_repo(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state.open_repo(&path, Some(app_handle)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recent_repos(
    state: State<'_, AppState>,
) -> Result<Vec<RepoEntry>, String> {
    state.get_recent_repos().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_current_repo(
    state: State<'_, AppState>,
) -> Result<Option<RepoInfo>, String> {
    state.get_current_repo().map_err(|e| e.to_string())
}
