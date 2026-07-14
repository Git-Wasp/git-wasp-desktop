use crate::repo_manager::AppState;
use crate::working_tree::{
    get_stage_file_contents as wt_get_stage_file_contents, stage_file as wt_stage_file,
    stage_file_content as wt_stage_file_content, stage_hunk as wt_stage_hunk,
    unstage_file as wt_unstage_file, unstage_hunk as wt_unstage_hunk, StageFileContents,
    WorkingTreeStatus,
};
use tauri::State;

// Not `async`: every command body below is 100% synchronous git2/fs work with
// no `.await` points — see commands/graph.rs for the full rationale.
#[tauri::command]
pub fn stage_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_stage_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_unstage_file(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_hunk(
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
pub fn unstage_hunk(
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
pub fn get_stage_file_contents(
    path: String,
    staged: bool,
    state: State<'_, AppState>,
) -> Result<StageFileContents, String> {
    state
        .with_repo(|repo| wt_get_stage_file_contents(repo, &path, staged))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_file_content(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<WorkingTreeStatus, String> {
    state
        .with_repo(|repo| wt_stage_file_content(repo, &path, &content))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
