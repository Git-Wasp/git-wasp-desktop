use crate::repo_manager::AppState;
use crate::working_tree::{
    get_stage_file_contents as wt_get_stage_file_contents, stage_file as wt_stage_file,
    stage_file_content as wt_stage_file_content, stage_hunk as wt_stage_hunk,
    unstage_file as wt_unstage_file, unstage_hunk as wt_unstage_hunk, StageFileContents,
    WorkingTreeStatus,
};
use tauri::State;

#[tauri::command]
pub async fn stage_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_stage_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unstage_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_unstage_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stage_hunk(
    path: String,
    hunk_index: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .with_repo(|repo| wt_stage_hunk(repo, &path, hunk_index))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unstage_hunk(
    path: String,
    hunk_index: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .with_repo(|repo| wt_unstage_hunk(repo, &path, hunk_index))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_stage_file_contents(
    path: String,
    state: State<'_, AppState>,
) -> Result<StageFileContents, String> {
    state
        .with_repo(|repo| wt_get_stage_file_contents(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stage_file_content(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_stage_file_content(repo, &path, &content))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
