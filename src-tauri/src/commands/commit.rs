use crate::repo_manager::AppState;
use crate::working_tree::{
    HeadCommitInfo,
    Identity,
    amend_commit_message as wt_amend_commit_message,
    create_commit as wt_create_commit,
    get_commit_identity as wt_get_identity,
    head_commit_info as wt_head_commit_info,
};
use tauri::State;

#[tauri::command]
pub async fn create_commit(message: String, state: State<'_, AppState>) -> Result<String, String> {
    state.with_repo(|repo| wt_create_commit(repo, &message))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn amend_commit_message(message: String, state: State<'_, AppState>) -> Result<String, String> {
    state.with_repo(|repo| wt_amend_commit_message(repo, &message))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_head_commit_info(state: State<'_, AppState>) -> Result<Option<HeadCommitInfo>, String> {
    state.with_repo(|repo| wt_head_commit_info(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_commit_identity(state: State<'_, AppState>) -> Result<Identity, String> {
    state.with_repo(|repo| wt_get_identity(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
