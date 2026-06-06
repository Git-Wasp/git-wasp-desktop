mod commands;
mod repo_manager;
mod graph;
mod diff_engine;
mod file_watcher;
mod operation_runner;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(repo_manager::AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_recent_repos,
            commands::repo::get_current_repo,
            commands::graph::get_graph_viewport,
            commands::diff::get_commit_diff,
            commands::diff::get_file_diff,
            commands::branch::list_branches,
            commands::branch::checkout_branch,
        ])
        .setup(|app| {
            repo_manager::restore_last_repo(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
