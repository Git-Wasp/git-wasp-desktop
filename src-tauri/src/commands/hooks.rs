use crate::repo_manager::{AppState, HookPreferences};
use tauri::State;

#[tauri::command]
pub fn get_hook_preferences(
    repo_path: String,
    state: State<'_, AppState>,
) -> Result<HookPreferences, String> {
    state
        .hook_preferences(&repo_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_hook_preferences(
    repo_path: String,
    preferences: HookPreferences,
    state: State<'_, AppState>,
) -> Result<HookPreferences, String> {
    state
        .set_hook_preferences(&repo_path, preferences)
        .map_err(|error| error.to_string())
}
