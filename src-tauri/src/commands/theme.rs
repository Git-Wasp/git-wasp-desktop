use crate::repo_manager::AppState;
use crate::themes::{self, ThemeManifest};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn list_custom_themes() -> Result<Vec<ThemeManifest>, String> {
    themes::list_themes().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_theme(src_path: String) -> Result<ThemeManifest, String> {
    themes::import_theme(&PathBuf::from(src_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_theme(id: String) -> Result<(), String> {
    themes::delete_theme(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_theme(
    id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .set_active_theme(id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_theme(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.get_active_theme().map_err(|e| e.to_string())
}
