use crate::commands::repo::RepoInfo;
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
}

#[tauri::command]
pub async fn list_branches(
    state: State<'_, AppState>,
) -> Result<Vec<BranchInfo>, String> {
    state.with_repo(|repo| {
        crate::repo_manager::list_branches(repo)
    })
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkout_branch(
    branch_name: String,
    state: State<'_, AppState>,
) -> Result<RepoInfo, String> {
    state.checkout_branch(&branch_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_branch(
    name: String,
    start_point: Option<String>,
    state: State<'_, AppState>,
) -> Result<BranchInfo, String> {
    state.create_branch(&name, start_point.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_branch(
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.rename_branch(&old_name, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_branch(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.delete_branch(&name).map_err(|e| e.to_string())
}
