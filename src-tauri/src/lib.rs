mod avatar;
mod commands;
mod credential_store;
mod diff_engine;
mod file_watcher;
mod github_client;
mod graph;
mod logging;
mod merge_ops;
mod operation_runner;
mod remote_ops;
mod repo_manager;
mod stash;
mod themes;
mod working_tree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Logging: file (app log dir) + stdout. The ceiling is Debug; the
        // effective verbosity is set at runtime in `.setup()` from the
        // diagnostics default (see the `logging` module). Noisy framework crates
        // are pinned down so diagnostics mode stays readable.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some(logging::LOG_FILE_NAME.to_string()),
                    }),
                ])
                .level(logging::LEVEL_CEILING)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Info)
                .level_for("reqwest", log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Persist & restore the window's size/position/maximised/fullscreen
        // across restarts (default StateFlags cover all of these).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(repo_manager::AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Repo
            commands::repo::open_repo,
            commands::repo::get_recent_repos,
            commands::repo::get_current_repo,
            commands::repo::list_open_repos,
            commands::repo::activate_repo,
            commands::repo::close_repo,
            // Graph
            commands::graph::get_graph_viewport,
            commands::graph::find_commit_row,
            commands::graph::refresh_graph_working_tree_status,
            // Diff (history)
            commands::diff::get_commit_diff,
            commands::diff::get_commit_file_contents,
            // Diff (working tree)
            commands::diff::get_unstaged_diff,
            commands::diff::get_staged_diff,
            // Branches
            commands::branch::list_branches,
            commands::branch::checkout_branch,
            commands::branch::checkout_remote_branch,
            commands::branch::checkout_commit,
            commands::branch::create_tag,
            commands::branch::delete_tag,
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
            commands::staging::get_stage_file_contents,
            commands::staging::stage_file_content,
            // Discard
            commands::discard::discard_file,
            commands::discard::discard_hunk,
            commands::discard::discard_all,
            // Commit
            commands::commit::create_commit,
            commands::commit::revert_commit,
            commands::commit::amend_commit_message,
            commands::commit::get_head_commit_info,
            commands::commit::get_commit_identity,
            commands::commit::get_identity_config,
            commands::commit::set_identity,
            avatar::get_avatar,
            // Stash
            commands::stash::stash_save_cmd,
            commands::stash::stash_list_cmd,
            commands::stash::stash_apply_cmd,
            commands::stash::stash_pop_cmd,
            commands::stash::stash_drop_cmd,
            commands::stash::stash_rename_cmd,
            // Merge / operation runner
            commands::merge::operation_status,
            commands::merge::operation_resume,
            commands::merge::operation_abort,
            commands::merge::merge_start,
            commands::merge::merge_resolve_file,
            commands::merge::merge_resolve_with_side,
            commands::merge::merge_resolve_with_deletion,
            commands::merge::merge_complete,
            commands::merge::merge_abort,
            // Remote operations
            commands::remote::detect_remote_info,
            commands::remote::fetch_remote,
            commands::remote::list_prunable_branches,
            commands::remote::push_tag,
            commands::remote::delete_remote_tag,
            commands::remote::list_remote_tags,
            commands::remote::pull_branch,
            commands::remote::push_branch,
            commands::remote::clone_repo,
            // GitHub auth & API
            commands::github::github_connection_status,
            commands::github::github_logout,
            commands::github::github_start_device_flow,
            commands::github::github_poll_device_flow,
            commands::github::list_github_repos,
            commands::github::list_pull_requests,
            commands::github::create_pull_request,
            commands::github::list_assignable_users,
            commands::github::list_repo_labels,
            // Themes
            commands::theme::list_custom_themes,
            commands::theme::import_theme,
            commands::theme::delete_theme,
            commands::theme::set_active_theme,
            commands::theme::get_active_theme,
            // Diagnostics / logging
            commands::diagnostics::get_diagnostics_info,
            commands::diagnostics::set_diagnostics,
            commands::diagnostics::open_log_dir,
            commands::diagnostics::frontend_log,
        ])
        .setup(|app| {
            // Apply the build's default verbosity; the frontend re-applies the
            // user's persisted choice on startup if they've set one.
            logging::set_diagnostics(logging::diagnostics_default());
            log::info!(
                target: "app",
                "gitclient starting (diagnostics default {})",
                if logging::diagnostics_default() { "on" } else { "off" }
            );
            repo_manager::restore_session(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
