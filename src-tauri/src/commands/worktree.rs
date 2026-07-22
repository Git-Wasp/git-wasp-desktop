use crate::commands::repo::RepoInfo;
use crate::repo_manager::AppState;
use crate::worktree_ops::{CreateWorktreeMode, WorktreeEntry};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn list_worktrees(
    repo_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorktreeEntry>, String> {
    state.list_worktrees(&repo_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_worktree(
    repo_path: Option<String>,
    target_path: String,
    mode: CreateWorktreeMode,
    branch_name: Option<String>,
    start_point: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state
        .create_worktree(
            repo_path.as_deref(),
            &target_path,
            mode,
            branch_name.as_deref(),
            start_point.as_deref(),
            Some(app_handle),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_parent_repo(
    repo_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state
        .open_parent_repo(&repo_path, Some(app_handle))
        .map_err(|e| e.to_string())
}
