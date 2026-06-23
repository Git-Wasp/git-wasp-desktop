use crate::repo_manager::AppState;
use crate::working_tree::{
    StageFileContents,
    WorkingTreeStatus,
    stage_file as wt_stage_file,
    unstage_file as wt_unstage_file,
    stage_hunk as wt_stage_hunk,
    unstage_hunk as wt_unstage_hunk,
    get_stage_file_contents as wt_get_stage_file_contents,
    stage_file_content as wt_stage_file_content,
};
use tauri::State;

#[tauri::command]
pub async fn stage_file(path: String, state: State<'_, AppState>) -> Result<WorkingTreeStatus, String> {
    state.with_repo(|repo| wt_stage_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unstage_file(path: String, state: State<'_, AppState>) -> Result<WorkingTreeStatus, String> {
    state.with_repo(|repo| wt_unstage_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stage_hunk(path: String, hunk_index: usize, state: State<'_, AppState>) -> Result<(), String> {
    state.with_repo(|repo| wt_stage_hunk(repo, &path, hunk_index))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unstage_hunk(path: String, hunk_index: usize, state: State<'_, AppState>) -> Result<(), String> {
    state.with_repo(|repo| wt_unstage_hunk(repo, &path, hunk_index))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_stage_file_contents(path: String, state: State<'_, AppState>) -> Result<StageFileContents, String> {
    state.with_repo(|repo| wt_get_stage_file_contents(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stage_file_content(path: String, content: String, state: State<'_, AppState>) -> Result<WorkingTreeStatus, String> {
    state.with_repo(|repo| wt_stage_file_content(repo, &path, &content))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
