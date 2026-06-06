use crate::repo_manager::AppState;
use crate::working_tree::{
    Identity,
    create_commit as wt_create_commit,
    get_commit_identity as wt_get_identity,
};
use tauri::State;

#[tauri::command]
pub async fn create_commit(message: String, state: State<'_, AppState>) -> Result<String, String> {
    state.with_repo(|repo| wt_create_commit(repo, &message))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_commit_identity(state: State<'_, AppState>) -> Result<Identity, String> {
    state.with_repo(|repo| wt_get_identity(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
