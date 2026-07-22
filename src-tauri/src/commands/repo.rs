use crate::repo_manager::{AppState, RepoEntry};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RepoKind {
    Main,
    Worktree,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub name: String,
    pub path: String,
    pub head_branch: Option<String>,
    pub repo_kind: RepoKind,
    pub parent_repo_path: Option<String>,
    pub common_dir_path: String,
    pub worktree_branch: Option<String>,
    pub worktree_locked: bool,
    pub worktree_prunable: bool,
}

// Not `async`: every command body below is 100% synchronous git2/fs work with
// no `.await` points — see commands/graph.rs for the full rationale.
#[tauri::command]
pub fn open_repo(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state
        .open_repo(&path, Some(app_handle))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_repos(state: State<'_, AppState>) -> Result<Vec<RepoEntry>, String> {
    state.get_recent_repos().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_recent_repo(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<RepoEntry>, String> {
    state.remove_recent_repo(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_current_repo(state: State<'_, AppState>) -> Result<Option<RepoInfo>, String> {
    state.get_current_repo().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_open_repos(state: State<'_, AppState>) -> Result<Vec<RepoInfo>, String> {
    state.list_open_repos().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn activate_repo(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state
        .activate_repo(&path, Some(app_handle))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_repo(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<RepoInfo>, String> {
    state
        .close_repo(&path, Some(app_handle))
        .map_err(|e| e.to_string())
}
