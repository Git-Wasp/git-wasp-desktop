use crate::diff_engine::{
    get_staged_diff as de_get_staged_diff, get_unstaged_diff as de_get_unstaged_diff, CommitDetail,
};
use crate::repo_manager::AppState;
use crate::working_tree::{FileDiffHunks, StageFileContents};
use tauri::State;

// Not `async`: every command body below is 100% synchronous git2/fs work with
// no `.await` points — see commands/graph.rs for the full rationale.
#[tauri::command]
pub fn get_commit_diff(
    oid: String,
    state: State<'_, AppState>,
) -> Result<CommitDetail, String> {
    state
        .with_repo(|repo| crate::diff_engine::get_commit_detail(repo, &oid))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Parent-vs-commit content for a single file, for the read-only commit diff
/// viewer (the staging editor surface, in read-only mode). Reuses
/// `StageFileContents`: `headContent` is the parent side, `worktreeContent` the
/// version in this commit. `old_path` carries the pre-rename path when set.
#[tauri::command]
pub fn get_commit_file_contents(
    oid: String,
    path: String,
    old_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<StageFileContents, String> {
    state
        .with_repo(|repo| {
            crate::working_tree::get_commit_file_contents(repo, &oid, &path, old_path.as_deref())
        })
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_unstaged_diff(
    path: String,
    state: State<'_, AppState>,
) -> Result<FileDiffHunks, String> {
    state
        .with_repo(|repo| de_get_unstaged_diff(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_staged_diff(
    path: String,
    state: State<'_, AppState>,
) -> Result<FileDiffHunks, String> {
    state
        .with_repo(|repo| de_get_staged_diff(repo, &path))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
