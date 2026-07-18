use crate::repo_manager::AppState;
use crate::working_tree::{
    amend_commit_message as wt_amend_commit_message, get_commit_identity as wt_get_identity,
    get_identity_config as wt_get_identity_config, head_commit_info as wt_head_commit_info,
    revert_commit as wt_revert_commit, set_identity as wt_set_identity,
    squash_commits as wt_squash_commits, HeadCommitInfo, Identity, IdentityConfig,
};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn create_commit(
    repo_path: String,
    message: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let preferences = state
        .hook_preferences(&repo_path)
        .map_err(|error| error.to_string())?;
    let worktree = state
        .open_repo_worktree(&repo_path)
        .map_err(|error| error.to_string())?;
    let guard = state
        .begin_hook_run(&repo_path)
        .map_err(|error| error.to_string())?;
    let run_id = guard.run_id().to_string();
    let manager = std::sync::Arc::clone(&state.manager);
    let captured_repo_path = repo_path;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let result = crate::hook_runner::run_commit(
            &app_handle,
            &worktree,
            &run_id,
            &message,
            preferences.pre_commit,
        );
        manager.mark_repo_graph_dirty(&captured_repo_path)?;
        result
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn revert_commit(
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
pub fn amend_commit_message(
    message: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state
        .with_repo(|repo| wt_amend_commit_message(repo, &message))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn squash_commits(
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
pub fn get_head_commit_info(
    state: State<'_, AppState>,
) -> Result<Option<HeadCommitInfo>, String> {
    state
        .with_repo(|repo| wt_head_commit_info(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_commit_identity(state: State<'_, AppState>) -> Result<Identity, String> {
    state
        .with_repo(|repo| wt_get_identity(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_identity_config(state: State<'_, AppState>) -> Result<IdentityConfig, String> {
    state
        .with_repo(|repo| wt_get_identity_config(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_identity(
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
