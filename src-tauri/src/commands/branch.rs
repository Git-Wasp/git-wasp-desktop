use crate::commands::repo::RepoInfo;
use crate::remote_ops::AheadBehind;
use crate::repo_manager::AppState;
use tauri::State;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub oid: String,
    pub ahead: Option<usize>,
    pub behind: Option<usize>,
}

#[tauri::command]
pub async fn list_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, String> {
    state
        .with_repo(|repo| crate::repo_manager::list_branches(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkout_branch(
    branch_name: String,
    auto_stash: Option<bool>,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state
        .checkout_branch(&branch_name, auto_stash.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkout_remote_branch(
    remote_ref: String,
    auto_stash: Option<bool>,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state
        .checkout_remote_branch(&remote_ref, auto_stash.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkout_commit(
    oid: String,
    auto_stash: Option<bool>,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state
        .checkout_commit(&oid, auto_stash.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_tag(
    name: String,
    oid: String,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .create_tag(&name, &oid, message.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_branch(
    name: String,
    start_point: Option<String>,
    state: State<'_, AppState>,
) -> Result<BranchInfo, String> {
    state
        .create_branch(&name, start_point.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_branch(
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .rename_branch(&old_name, &new_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_branch(name: String, state: State<'_, AppState>) -> Result<(), String> {
    state.delete_branch(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_tag(name: String, state: State<'_, AppState>) -> Result<(), String> {
    state.delete_tag(&name).map_err(|e| e.to_string())
}

/// Fast-forward local `branch` to `target` (a commit oid), advancing the branch
/// pointer without checking it out unless it's the current branch. Errors with a
/// clear message when the move isn't a fast-forward.
#[tauri::command]
pub async fn fast_forward_branch(
    branch: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::branch_ops::FastForwardOutcome;
    match state
        .fast_forward_branch(&branch, &target)
        .map_err(|e| e.to_string())?
    {
        FastForwardOutcome::NotFastForward => Err(format!(
            "cannot fast-forward {branch}: it has diverged from that commit"
        )),
        _ => Ok(()),
    }
}

/// Fast-forward local `branch` to its upstream tracking branch, using the
/// already-fetched remote state (no network access).
#[tauri::command]
pub async fn fast_forward_to_upstream(
    branch: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::branch_ops::FastForwardOutcome;
    match state
        .fast_forward_to_upstream(&branch)
        .map_err(|e| e.to_string())?
    {
        FastForwardOutcome::NotFastForward => Err(format!(
            "cannot fast-forward {branch}: it has diverged from its upstream"
        )),
        _ => Ok(()),
    }
}

/// The local branches that can be fast-forwarded to `target` (a commit oid).
#[tauri::command]
pub async fn list_fast_forwardable_branches(
    target: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state
        .fast_forwardable_branches(&target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_ahead_behind(state: State<'_, AppState>) -> Result<Vec<AheadBehind>, String> {
    state
        .with_repo(|repo| crate::remote_ops::compute_ahead_behind(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
