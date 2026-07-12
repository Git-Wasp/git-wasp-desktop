use crate::repo_manager::AppState;
use crate::working_tree::{
    amend_commit_message as wt_amend_commit_message, create_commit as wt_create_commit,
    get_commit_identity as wt_get_identity, get_identity_config as wt_get_identity_config,
    head_commit_info as wt_head_commit_info, revert_commit as wt_revert_commit,
    set_identity as wt_set_identity, squash_commits as wt_squash_commits, HeadCommitInfo, Identity,
    IdentityConfig,
};
use tauri::State;

#[tauri::command]
pub async fn create_commit(message: String, state: State<'_, AppState>) -> Result<String, String> {
    state
        .with_repo(|repo| wt_create_commit(repo, &message))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn revert_commit(
    oid: String,
    auto_commit: bool,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    state
        .with_repo(|repo| wt_revert_commit(repo, &oid, auto_commit))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn amend_commit_message(
    message: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state
        .with_repo(|repo| wt_amend_commit_message(repo, &message))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn squash_commits(
    oids: Vec<String>,
    message: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state
        .with_repo(|repo| wt_squash_commits(repo, &oids, &message))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_head_commit_info(
    state: State<'_, AppState>,
) -> Result<Option<HeadCommitInfo>, String> {
    state
        .with_repo(|repo| wt_head_commit_info(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_commit_identity(state: State<'_, AppState>) -> Result<Identity, String> {
    state
        .with_repo(|repo| wt_get_identity(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_identity_config(state: State<'_, AppState>) -> Result<IdentityConfig, String> {
    state
        .with_repo(|repo| wt_get_identity_config(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_identity(
    name: String,
    email: String,
    global: bool,
    state: State<'_, AppState>,
) -> Result<IdentityConfig, String> {
    state
        .with_repo(|repo| wt_set_identity(repo, &name, &email, global))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
