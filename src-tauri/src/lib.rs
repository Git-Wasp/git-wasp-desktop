mod commands;
mod credential_store;
mod diff_engine;
mod file_watcher;
mod github_client;
mod graph;
mod operation_runner;
mod remote_ops;
mod repo_manager;
mod stash;
mod working_tree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(repo_manager::AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Repo
            commands::repo::open_repo,
            commands::repo::get_recent_repos,
            commands::repo::get_current_repo,
            // Graph
            commands::graph::get_graph_viewport,
            // Diff (history)
            commands::diff::get_commit_diff,
            commands::diff::get_file_diff,
            // Diff (working tree)
            commands::diff::get_unstaged_diff,
            commands::diff::get_staged_diff,
            // Branches
            commands::branch::list_branches,
            commands::branch::checkout_branch,
            commands::branch::create_branch,
            commands::branch::rename_branch,
            commands::branch::delete_branch,
            commands::branch::get_ahead_behind,
            // Working tree status
            commands::status::get_working_tree_status,
            // Staging
            commands::staging::stage_file,
            commands::staging::unstage_file,
            commands::staging::stage_hunk,
            commands::staging::unstage_hunk,
            // Discard
            commands::discard::discard_file,
            commands::discard::discard_hunk,
            // Commit
            commands::commit::create_commit,
            commands::commit::get_commit_identity,
            // Stash
            commands::stash::stash_save_cmd,
            commands::stash::stash_list_cmd,
            commands::stash::stash_apply_cmd,
            commands::stash::stash_pop_cmd,
            commands::stash::stash_drop_cmd,
            // Remote operations
            commands::remote::detect_remote_info,
            commands::remote::fetch_remote,
            commands::remote::pull_branch,
            commands::remote::push_branch,
            commands::remote::clone_repo,
            // GitHub auth & API
            commands::github::github_auth_status,
            commands::github::github_logout,
            commands::github::github_start_device_flow,
            commands::github::github_poll_device_flow,
            commands::github::list_github_repos,
            commands::github::list_pull_requests,
            commands::github::create_pull_request,
        ])
        .setup(|app| {
            repo_manager::restore_last_repo(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
