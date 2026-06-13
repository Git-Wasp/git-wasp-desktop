use crate::repo_manager::{AppState, Workspace};
use crate::workspace_ops::{self, CrossRepoSearchResult, RepoOperationResult, RepoStatusSummary};
use std::path::Path;
use tauri::State;

fn find_workspace(state: &State<'_, AppState>, workspace_id: &str) -> Result<Workspace, String> {
    state
        .list_workspaces()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| format!("workspace not found: {workspace_id}"))
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    state.list_workspaces().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_workspace(name: String, state: State<'_, AppState>) -> Result<Workspace, String> {
    state.create_workspace(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_workspace(id: String, name: String, state: State<'_, AppState>) -> Result<(), String> {
    state.rename_workspace(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_workspace(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.delete_workspace(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_repo_to_workspace(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Workspace, String> {
    state.add_repo_to_workspace(&workspace_id, Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_repo_from_workspace(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Workspace, String> {
    state.remove_repo_from_workspace(&workspace_id, Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_workspace(id: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.set_active_workspace(id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_workspace(state: State<'_, AppState>) -> Result<Option<Workspace>, String> {
    state.get_active_workspace().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_workspace_status(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RepoStatusSummary>, String> {
    let workspace = find_workspace(&state, &workspace_id)?;
    // TODO(perf): parallelise with spawn_blocking if slow for large workspaces
    Ok(workspace.repo_paths.iter().map(|p| workspace_ops::repo_status_summary(p)).collect())
}

#[tauri::command]
pub async fn workspace_fetch_all(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RepoOperationResult>, String> {
    let workspace = find_workspace(&state, &workspace_id)?;
    let known_hosts = state.known_github_hosts().map_err(|e| e.to_string())?;
    Ok(workspace_ops::fetch_all(&workspace.repo_paths, &known_hosts, state.credentials.as_ref()))
}

#[tauri::command]
pub async fn workspace_pull_all(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RepoOperationResult>, String> {
    let workspace = find_workspace(&state, &workspace_id)?;
    let known_hosts = state.known_github_hosts().map_err(|e| e.to_string())?;
    Ok(workspace_ops::pull_all(&workspace.repo_paths, &known_hosts, state.credentials.as_ref()))
}

#[tauri::command]
pub async fn search_workspace(
    workspace_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<CrossRepoSearchResult>, String> {
    let workspace = find_workspace(&state, &workspace_id)?;
    Ok(workspace
        .repo_paths
        .iter()
        .flat_map(|p| workspace_ops::search_workspace_repo(p, &query))
        .collect())
}
