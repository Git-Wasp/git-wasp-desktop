use crate::merge_ops::MergeOutcome;
use crate::remote_ops::{self, FetchResult, PullFfOutcome, PullResult, RemoteInfo};
use crate::repo_manager::AppState;
use tauri::State;

#[tauri::command]
pub async fn detect_remote_info(state: State<'_, AppState>) -> Result<RemoteInfo, String> {
    let known_hosts: Vec<String> = state.known_github_hosts().map_err(|e| e.to_string())?;
    state
        .with_repo(|repo| remote_ops::detect_remote_info(repo, &known_hosts))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_remote(
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
pub async fn list_prunable_branches(
    state: State<'_, AppState>,
) -> Result<Vec<crate::repo_manager::PrunableBranch>, String> {
    state
        .with_repo(crate::repo_manager::find_prunable_branches)
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pull_branch(
    remote_name: Option<String>,
    branch: Option<String>,
    mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<PullResult, String> {
    let remote = remote_name.as_deref().unwrap_or("origin");

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

    let outcome = state
        .with_repo(|repo| remote_ops::pull_ff(repo, remote, &branch_name, token.as_deref()))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    match outcome {
        PullFfOutcome::AlreadyUpToDate => Ok(PullResult::AlreadyUpToDate),
        PullFfOutcome::FastForwarded => Ok(PullResult::FastForwarded),
        PullFfOutcome::Diverged { remote_branch } => {
            // ffOnly (default) refuses a divergent pull; ffOrMerge reconciles by
            // merging the upstream through the OperationRunner, so any conflicts
            // surface in the existing merge editor.
            if mode.as_deref().unwrap_or("ffOnly") != "ffOrMerge" {
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
                    Ok(PullResult::Merged)
                }
                MergeOutcome::Conflicts { .. } => Ok(PullResult::Conflicts),
            }
        }
    }
}

#[tauri::command]
pub async fn push_branch(
    remote_name: Option<String>,
    branch: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let remote = remote_name.as_deref().unwrap_or("origin");

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

    state
        .with_repo(|repo| remote_ops::push(repo, remote, &branch_name, token.as_deref()))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clone_repo(
    url: String,
    dest_path: String,
    state: State<'_, AppState>,
) -> Result<crate::commands::repo::RepoInfo, String> {
    // Load token for the host in the URL if we can determine it
    let known = state.known_github_hosts().unwrap_or_default();
    let token = remote_ops::parse_remote_url(&url, &known)
        .ok()
        .and_then(|info| state.credentials.load(&info.host).ok().flatten());

    let dest = std::path::PathBuf::from(&dest_path);
    remote_ops::clone_repo(&url, &dest, token.as_deref()).map_err(|e| e.to_string())?;

    // Open the cloned repo
    state.open_repo(&dest_path, None).map_err(|e| e.to_string())
}
