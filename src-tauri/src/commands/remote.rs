use crate::merge_ops::MergeOutcome;
use crate::remote_ops::{self, FetchResult, PullFfOutcome, PullResult, PushTransport, RemoteInfo};
use crate::repo_manager::AppState;
use anyhow::Context;
use tauri::{AppHandle, State};

// Not `async`: every command body below is 100% synchronous git2/CLI-passthrough
// work with no `.await` points — see commands/graph.rs for the full rationale.
// These do network I/O via blocking git2/CLI calls, which is exactly the
// "pins a tokio worker" problem this fix addresses most: converting them to
// plain `fn` moves that blocking work onto Tauri's dedicated blocking pool
// instead of a tokio async worker.
#[tauri::command]
pub fn detect_remote_info(state: State<'_, AppState>) -> Result<RemoteInfo, String> {
    let known_hosts: Vec<String> = state.known_github_hosts().map_err(|e| e.to_string())?;
    state
        .with_repo(|repo| remote_ops::detect_remote_info(repo, &known_hosts))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_remote(
    remote_name: Option<String>,
    prune: Option<bool>,
    state: State<'_, AppState>,
) -> Result<FetchResult, String> {
    let remote = remote_name.as_deref().unwrap_or("origin");

    // Extract the remote URL and host before holding the repo lock,
    // so we can load the token without holding the lock across any await.
    let host = state
        .with_repo(|repo| {
            let known = state.known_github_hosts().unwrap_or_default();
            remote_ops::detect_remote_info(repo, &known)
                .map(|info| info.host)
                .ok()
        })
        .map_err(|e| e.to_string())?;

    let token = host
        .as_deref()
        .and_then(|h| state.credentials.load(h).ok().flatten());

    state
        .with_repo(|repo| remote_ops::fetch(repo, remote, token.as_deref(), prune.unwrap_or(false)))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_prunable_branches(
    state: State<'_, AppState>,
) -> Result<Vec<crate::repo_manager::PrunableBranch>, String> {
    state
        .with_repo(crate::repo_manager::find_prunable_branches)
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// The stored token for the repo's detected remote host, if any (for remote
/// operations that need auth on HTTPS). Best-effort: returns `None` rather than
/// erroring when there's no remote/host/token.
fn remote_token(state: &State<'_, AppState>) -> Option<String> {
    let host: Option<String> = state
        .with_repo(|repo| {
            let known = state.known_github_hosts().unwrap_or_default();
            remote_ops::detect_remote_info(repo, &known)
                .map(|info| info.host)
                .ok()
        })
        .ok()
        .flatten();
    host.as_deref()
        .and_then(|h| state.credentials.load(h).ok().flatten())
}

#[tauri::command]
pub fn push_tag(
    tag: String,
    remote_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let remote = remote_name.as_deref().unwrap_or("origin");
    let token = remote_token(&state);
    state
        .with_repo(|repo| remote_ops::push_tag(repo, remote, &tag, token.as_deref()))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_remote_tag(
    tag: String,
    remote_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let remote = remote_name.as_deref().unwrap_or("origin");
    let token = remote_token(&state);
    state
        .with_repo(|repo| remote_ops::delete_remote_tag(repo, remote, &tag, token.as_deref()))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_remote_tags(
    remote_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let remote = remote_name.as_deref().unwrap_or("origin");
    let token = remote_token(&state);
    state
        .with_repo(|repo| remote_ops::list_remote_tags(repo, remote, token.as_deref()))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pull_branch(
    remote_name: Option<String>,
    branch: Option<String>,
    mode: Option<String>,
    auto_stash: Option<bool>,
    state: State<'_, AppState>,
) -> Result<PullResult, String> {
    let remote = remote_name.as_deref().unwrap_or("origin");
    let auto_stash = auto_stash.unwrap_or(false);

    let (host, head_branch) = state
        .with_repo(|repo| {
            let known = state.known_github_hosts().unwrap_or_default();
            let host = remote_ops::detect_remote_info(repo, &known)
                .map(|info| info.host)
                .ok();
            let head = repo
                .head()
                .ok()
                .and_then(|h| h.shorthand().map(|s| s.to_string()));
            (host, head)
        })
        .map_err(|e| e.to_string())?;

    let branch_name = branch
        .or(head_branch)
        .ok_or("could not determine current branch")?;
    let token = host
        .as_deref()
        .and_then(|h| state.credentials.load(h).ok().flatten());

    // Auto-stash: park tracked local changes before the pull so a dirty tree
    // can't block the fast-forward, then reapply them afterwards ("reapply on
    // pull"). No-op when there's nothing stashable.
    let stashed = if auto_stash {
        state
            .with_repo_mut(|repo| -> anyhow::Result<bool> {
                if crate::working_tree::has_stashable_changes(repo)? {
                    crate::stash::stash_save(repo, Some("Auto-stash before pull"))?;
                    Ok(true)
                } else {
                    Ok(false)
                }
            })
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    } else {
        false
    };

    let outcome = state
        .with_repo(|repo| remote_ops::pull_ff(repo, remote, &branch_name, token.as_deref()))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let result = match outcome {
        PullFfOutcome::AlreadyUpToDate => PullResult::AlreadyUpToDate,
        PullFfOutcome::FastForwarded => PullResult::FastForwarded,
        PullFfOutcome::Diverged { remote_branch } => {
            // ffOnly (default) refuses a divergent pull; ffOrMerge reconciles by
            // merging the upstream through the OperationRunner, so any conflicts
            // surface in the existing merge editor.
            if mode.as_deref().unwrap_or("ffOnly") != "ffOrMerge" {
                // Nothing was pulled — undo the auto-stash so the working tree is
                // exactly as the user left it before returning the refusal.
                if stashed {
                    let _ = state.with_repo_mut(|repo| crate::stash::stash_pop(repo, 0));
                }
                return Err(
                    "cannot fast-forward: local branch has diverged from upstream".to_string(),
                );
            }
            match state
                .merge_start(&remote_branch)
                .map_err(|e| e.to_string())?
            {
                MergeOutcome::Clean => {
                    state
                        .merge_complete(&format!("Merge remote-tracking branch '{remote_branch}'"))
                        .map_err(|e| e.to_string())?;
                    PullResult::Merged
                }
                // The merge editor now owns the working tree; leave the stash in
                // the panel for the user to apply once the merge is resolved.
                MergeOutcome::Conflicts { .. } => return Ok(PullResult::Conflicts),
            }
        }
    };

    // Reapply the auto-stash onto the freshly-pulled tree. A pop conflict keeps
    // the stash (libgit2 only drops it on a clean apply) and is reported so the
    // user can resolve it — the pull itself still succeeded.
    if stashed {
        let popped = state
            .with_repo_mut(|repo| crate::stash::stash_pop(repo, 0))
            .map_err(|e| e.to_string())?;
        if popped.is_err() {
            return Ok(PullResult::StashReapplyConflict);
        }
    }

    Ok(result)
}

struct HttpsPushRequest<'a> {
    repo_path: &'a std::path::Path,
    metadata: &'a crate::hook_runner::HookRunMetadata,
    remote_name: &'a str,
    branch: &'a str,
    token: Option<&'a str>,
    pre_push_enabled: bool,
    advertised_remote_oid: Option<git2::Oid>,
}

fn push_https_with_hook<R: tauri::Runtime, T: PushTransport>(
    app: &AppHandle<R>,
    request: HttpsPushRequest<'_>,
    transport: &T,
) -> anyhow::Result<()> {
    crate::hook_runner::emit_started(app, request.metadata)?;
    let prepared: anyhow::Result<(git2::Repository, Option<crate::hook_runner::PushHookInput>)> =
        (|| {
            let repo =
                git2::Repository::open(request.repo_path).context("could not reopen repository")?;
            let advertised_remote_oid = match request.advertised_remote_oid {
                Some(oid) => oid,
                None => remote_ops::remote_branch_oid(
                    &repo,
                    request.remote_name,
                    request.branch,
                    request.token,
                )?,
            };
            let hook = if request.pre_push_enabled {
                crate::hook_runner::prepare_pre_push(
                    &repo,
                    request.remote_name,
                    request.branch,
                    advertised_remote_oid,
                )?
            } else {
                None
            };
            Ok((repo, hook))
        })();
    let (repo, hook) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            let result = Err(error).context("push preparation failed");
            crate::hook_runner::emit_finished(
                app,
                request.metadata,
                &result,
                None,
                "push completed",
                "push preparation failed",
            )?;
            return result;
        }
    };
    if let Some(input) = hook {
        if let Err(error) = crate::hook_runner::run_pre_push(app, request.metadata, input) {
            let summary = if error.to_string() == "pre-push failed; review hook output" {
                "pre-push failed; review hook output"
            } else {
                "could not launch pre-push hook"
            };
            let result = Err(error).context(summary);
            crate::hook_runner::emit_finished(
                app,
                request.metadata,
                &result,
                None,
                "push completed",
                summary,
            )?;
            return result;
        }
    }
    let result = transport
        .push(&repo, request.remote_name, request.branch, request.token)
        .context("push transport failed");
    let emit_result = crate::hook_runner::emit_finished(
        app,
        request.metadata,
        &result,
        None,
        "push completed",
        "push transport failed",
    );
    match result {
        Err(error) => Err(error),
        Ok(()) => {
            emit_result?;
            Ok(())
        }
    }
}

fn push_ssh<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo_path: &std::path::Path,
    metadata: &crate::hook_runner::HookRunMetadata,
    remote_name: &str,
    branch: &str,
    pre_push_enabled: bool,
) -> anyhow::Result<()> {
    crate::hook_runner::emit_started(app, metadata)?;
    let command_result = (|| {
        let repo = git2::Repository::open(repo_path).context("could not reopen repository")?;
        let command = remote_ops::ssh_push_command(&repo, remote_name, branch, pre_push_enabled)?;
        crate::hook_runner::stream_command_after_started(app, metadata, command, None)
    })();
    let exit_code = command_result
        .as_ref()
        .ok()
        .and_then(|output| output.status.code());
    let result = command_result.and_then(|output| {
        if output.status.success() {
            Ok(())
        } else {
            anyhow::bail!("push failed; review hook output")
        }
    });
    let emit_result = crate::hook_runner::emit_finished(
        app,
        metadata,
        &result,
        exit_code,
        "push completed",
        "push failed; review hook output",
    );
    match result {
        Err(error) => Err(error),
        Ok(()) => {
            emit_result?;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn push_branch(
    repo_path: String,
    remote_name: Option<String>,
    branch: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let remote = remote_name.unwrap_or_else(|| "origin".to_string());
    let preferences = state
        .hook_preferences(&repo_path)
        .map_err(|error| error.to_string())?;
    let (worktree, _) = state
        .manager
        .open_repo_worktree_and_graph_handle(&repo_path)
        .map_err(|error| error.to_string())?;
    let repo = git2::Repository::open(&worktree).map_err(|error| error.to_string())?;
    let (host, head_branch, remote_url) = {
        let known = state.known_github_hosts().unwrap_or_default();
        let head = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()));
        let remote_url = repo
            .find_remote(&remote)
            .ok()
            .and_then(|remote| remote.url().map(str::to_string))
            .ok_or_else(|| format!("remote '{remote}' has no URL"))?;
        let host = remote_ops::parse_remote_url(&remote_url, &known)
            .map(|info| info.host)
            .ok();
        (host, head, remote_url)
    };

    let branch_name = branch
        .or(head_branch)
        .ok_or("could not determine current branch")?;
    let token = host
        .as_deref()
        .and_then(|h| state.credentials.load(h).ok().flatten());
    let guard = state
        .begin_hook_run(&repo_path)
        .map_err(|error| error.to_string())?;
    let metadata = crate::hook_runner::HookRunMetadata {
        repo_path,
        run_id: guard.run_id().to_string(),
        hook: crate::hook_runner::HookName::PrePush,
        operation: "push",
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        if remote_ops::is_ssh_remote(&remote_url) {
            push_ssh(
                &app_handle,
                &worktree,
                &metadata,
                &remote,
                &branch_name,
                preferences.pre_push,
            )
        } else {
            push_https_with_hook(
                &app_handle,
                HttpsPushRequest {
                    repo_path: &worktree,
                    metadata: &metadata,
                    remote_name: &remote,
                    branch: &branch_name,
                    token: token.as_deref(),
                    pre_push_enabled: preferences.pre_push,
                    advertised_remote_oid: None,
                },
                &remote_ops::DefaultPushTransport,
            )
        }
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

// Joins `dest_dir`/`repo_name` into the clone destination, rejecting a
// `repo_name` that looks like path traversal or an embedded path separator.
// `repo_name` is GHE/GitHub-API-supplied (untrusted) input, even though it's
// expected to be a bare repo name in practice. Split out from `clone_repo` so
// the validation can be unit-tested without a `State<'_, AppState>` (which
// needs a running Tauri app to construct).
fn resolve_clone_dest(dest_dir: &str, repo_name: &str) -> Result<std::path::PathBuf, String> {
    if repo_name.is_empty()
        || repo_name == "."
        || repo_name.contains('/')
        || repo_name.contains('\\')
        || repo_name.contains("..")
    {
        return Err(format!("invalid repository name: {repo_name}"));
    }
    Ok(std::path::PathBuf::from(dest_dir).join(repo_name))
}

#[tauri::command]
pub fn clone_repo(
    url: String,
    dest_dir: String,
    repo_name: String,
    state: State<'_, AppState>,
) -> Result<crate::commands::repo::RepoInfo, String> {
    let dest = resolve_clone_dest(&dest_dir, &repo_name)?;

    // Load token for the host in the URL if we can determine it
    let known = state.known_github_hosts().unwrap_or_default();
    let token = remote_ops::parse_remote_url(&url, &known)
        .ok()
        .and_then(|info| state.credentials.load(&info.host).ok().flatten());

    remote_ops::clone_repo(&url, &dest, token.as_deref()).map_err(|e| e.to_string())?;

    // Open the cloned repo
    state
        .open_repo(dest.to_string_lossy().as_ref(), None)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_ops::PushTransport;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct RecordingPushTransport(AtomicUsize);

    impl PushTransport for RecordingPushTransport {
        fn push(
            &self,
            _repo: &git2::Repository,
            _remote_name: &str,
            _branch: &str,
            _token: Option<&str>,
        ) -> anyhow::Result<()> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    impl RecordingPushTransport {
        fn call_count(&self) -> usize {
            self.0.load(Ordering::SeqCst)
        }
    }

    struct FailingPushTransport;

    impl PushTransport for FailingPushTransport {
        fn push(
            &self,
            _repo: &git2::Repository,
            _remote_name: &str,
            _branch: &str,
            _token: Option<&str>,
        ) -> anyhow::Result<()> {
            anyhow::bail!("network unavailable")
        }
    }

    #[cfg(unix)]
    fn push_fixture(hook: &str) -> tempfile::TempDir {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(directory.path())
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Git Wasp Test"]);
        git(&["config", "user.email", "git-wasp@example.test"]);
        std::fs::write(directory.path().join("file.txt"), "initial\n").unwrap();
        git(&["add", "file.txt"]);
        git(&["commit", "-m", "initial"]);
        git(&["remote", "add", "origin", "https://example.test/repo.git"]);
        let hook_path = directory.path().join(".git/hooks/pre-push");
        std::fs::write(&hook_path, hook).unwrap();
        let mut permissions = std::fs::metadata(&hook_path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(hook_path, permissions).unwrap();
        directory
    }

    #[cfg(unix)]
    fn push_with_hook_for_test(
        app: &tauri::App<tauri::test::MockRuntime>,
        fixture: &tempfile::TempDir,
        enabled: bool,
        transport: &RecordingPushTransport,
    ) -> anyhow::Result<()> {
        let metadata = crate::hook_runner::HookRunMetadata {
            repo_path: fixture.path().display().to_string(),
            run_id: "push-test".into(),
            hook: crate::hook_runner::HookName::PrePush,
            operation: "push",
        };
        push_https_with_hook(
            app.handle(),
            HttpsPushRequest {
                repo_path: fixture.path(),
                metadata: &metadata,
                remote_name: "origin",
                branch: "main",
                token: None,
                pre_push_enabled: enabled,
                advertised_remote_oid: Some(git2::Oid::zero()),
            },
            transport,
        )
    }

    #[cfg(unix)]
    #[test]
    fn failed_pre_push_never_calls_transport() {
        let fixture = push_fixture("#!/bin/sh\nexit 7\n");
        let transport = RecordingPushTransport::default();
        let app = tauri::test::mock_app();
        let finished = std::sync::Arc::new(std::sync::Mutex::new(0));
        let finished_events = std::sync::Arc::clone(&finished);
        use tauri::Listener;
        app.listen(crate::hook_runner::FINISHED_EVENT, move |_| {
            *finished_events.lock().unwrap() += 1;
        });
        let result = push_with_hook_for_test(&app, &fixture, true, &transport);
        assert!(result.is_err());
        assert_eq!(transport.call_count(), 0);
        assert_eq!(*finished.lock().unwrap(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn discovery_failure_is_classified_as_push_preparation() {
        let fixture = push_fixture("#!/bin/sh\nexit 0\n");
        let transport = RecordingPushTransport::default();
        let app = tauri::test::mock_app();
        let metadata = crate::hook_runner::HookRunMetadata {
            repo_path: fixture.path().display().to_string(),
            run_id: "preparation-test".into(),
            hook: crate::hook_runner::HookName::PrePush,
            operation: "push",
        };
        let error = push_https_with_hook(
            app.handle(),
            HttpsPushRequest {
                repo_path: fixture.path(),
                metadata: &metadata,
                remote_name: "missing",
                branch: "main",
                token: None,
                pre_push_enabled: true,
                advertised_remote_oid: Some(git2::Oid::zero()),
            },
            &transport,
        )
        .unwrap_err();
        assert!(error.to_string().contains("push preparation failed"));
        assert!(!error.to_string().contains("pre-push failed"));
        assert_eq!(transport.call_count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn successful_pre_push_calls_transport_once() {
        let fixture = push_fixture("#!/bin/sh\nexit 0\n");
        let transport = RecordingPushTransport::default();
        let app = tauri::test::mock_app();
        push_with_hook_for_test(&app, &fixture, true, &transport).unwrap();
        assert_eq!(transport.call_count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn transport_failure_is_not_reported_as_a_hook_failure() {
        let fixture = push_fixture("#!/bin/sh\nexit 0\n");
        let app = tauri::test::mock_app();
        let metadata = crate::hook_runner::HookRunMetadata {
            repo_path: fixture.path().display().to_string(),
            run_id: "transport-test".into(),
            hook: crate::hook_runner::HookName::PrePush,
            operation: "push",
        };
        let error = push_https_with_hook(
            app.handle(),
            HttpsPushRequest {
                repo_path: fixture.path(),
                metadata: &metadata,
                remote_name: "origin",
                branch: "main",
                token: None,
                pre_push_enabled: true,
                advertised_remote_oid: Some(git2::Oid::zero()),
            },
            &FailingPushTransport,
        )
        .unwrap_err();
        assert!(error.to_string().contains("push transport failed"));
        assert!(!error.to_string().contains("pre-push failed"));
    }

    #[cfg(unix)]
    #[test]
    fn disabled_pre_push_calls_transport_once() {
        let fixture = push_fixture("#!/bin/sh\nexit 7\n");
        let transport = RecordingPushTransport::default();
        let app = tauri::test::mock_app();
        push_with_hook_for_test(&app, &fixture, false, &transport).unwrap();
        assert_eq!(transport.call_count(), 1);
    }

    #[test]
    fn resolve_clone_dest_joins_dir_and_name() {
        let dest = resolve_clone_dest("/Users/mike/code", "gitclient").unwrap();
        assert_eq!(dest, std::path::PathBuf::from("/Users/mike/code/gitclient"));
    }

    #[test]
    fn resolve_clone_dest_rejects_empty_repo_name() {
        assert!(resolve_clone_dest("/Users/mike/code", "").is_err());
    }

    #[test]
    fn resolve_clone_dest_rejects_forward_slash_in_repo_name() {
        assert!(resolve_clone_dest("/Users/mike/code", "sub/dir").is_err());
    }

    #[test]
    fn resolve_clone_dest_rejects_backslash_in_repo_name() {
        assert!(resolve_clone_dest("/Users/mike/code", "sub\\dir").is_err());
    }

    #[test]
    fn resolve_clone_dest_rejects_dot_dot_traversal() {
        assert!(resolve_clone_dest("/Users/mike/code", "../../etc").is_err());
        assert!(resolve_clone_dest("/Users/mike/code", "..").is_err());
    }

    #[test]
    fn resolve_clone_dest_rejects_bare_dot() {
        // Not a traversal outside dest_dir, but a "." repo name resolves to
        // dest_dir itself rather than a real subdirectory — reject it rather
        // than silently clone into (and later open) the parent folder.
        assert!(resolve_clone_dest("/Users/mike/code", ".").is_err());
    }
}
