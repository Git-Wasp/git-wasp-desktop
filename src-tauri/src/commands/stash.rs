use crate::repo_manager::AppState;
use crate::stash::{
    stash_apply, stash_drop, stash_list, stash_pop, stash_rename, stash_save, StashEntry,
};
use crate::working_tree::{get_working_tree_status, WorkingTreeStatus};
use tauri::State;

#[tauri::command]
pub async fn stash_save_cmd(
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo_mut(|repo| {
            stash_save(repo, message.as_deref())?;
            get_working_tree_status(repo)
        })
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stash_list_cmd(state: State<'_, AppState>) -> Result<Vec<StashEntry>, String> {
    state
        .with_repo_mut(|repo| stash_list(repo))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stash_apply_cmd(
    index: usize,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo_mut(|repo| {
            stash_apply(repo, index)?;
            get_working_tree_status(repo)
        })
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stash_pop_cmd(
    index: usize,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo_mut(|repo| {
            stash_pop(repo, index)?;
            get_working_tree_status(repo)
        })
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stash_drop_cmd(
    index: usize,
    state: State<'_, AppState>,
) -> Result<Vec<StashEntry>, String> {
    state
        .with_repo_mut(|repo| {
            stash_drop(repo, index)?;
            stash_list(repo)
        })
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stash_rename_cmd(
    index: usize,
    message: String,
    state: State<'_, AppState>,
) -> Result<Vec<StashEntry>, String> {
    state
        .with_repo_mut(|repo| {
            stash_rename(repo, index, &message)?;
            stash_list(repo)
        })
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
