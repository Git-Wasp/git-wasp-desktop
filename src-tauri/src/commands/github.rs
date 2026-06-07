use crate::github_client::{
    DeviceFlowInit, DeviceFlowPollResult, GithubRepo, PullRequest,
};
use crate::repo_manager::AppState;
use tauri::State;

#[tauri::command]
pub async fn github_auth_status(
    host: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state
        .credentials
        .load(&host)
        .map(|t| t.is_some())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_logout(
    host: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.credentials.delete(&host).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_start_device_flow(
    host: String,
) -> Result<DeviceFlowInit, String> {
    crate::github_client::start_device_flow(&host)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_poll_device_flow(
    host: String,
    device_code: String,
    state: State<'_, AppState>,
) -> Result<DeviceFlowPollResult, String> {
    let result = crate::github_client::poll_device_flow(&host, &device_code)
        .await
        .map_err(|e| e.to_string())?;
    if result.done {
        if let Some(ref token) = result.token {
            state.credentials.store(&host, token).map_err(|e| e.to_string())?;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_github_repos(
    host: String,
    state: State<'_, AppState>,
) -> Result<Vec<GithubRepo>, String> {
    let token = state
        .credentials
        .load(&host)
        .map_err(|e| e.to_string())?
        .ok_or("not authenticated — connect your GitHub account first")?;
    let base_url = crate::github_client::api_base(&host);
    crate::github_client::list_repos(&base_url, &token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_pull_requests(
    host: String,
    state: State<'_, AppState>,
) -> Result<Vec<PullRequest>, String> {
    let token = state
        .credentials
        .load(&host)
        .map_err(|e| e.to_string())?
        .ok_or("not authenticated — connect your GitHub account first")?;

    // Detect owner/repo from the open repo's origin remote
    let known = state.known_github_hosts().map_err(|e| e.to_string())?;
    let remote_info = state
        .with_repo(|repo| crate::remote_ops::detect_remote_info(repo, &known))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let base_url = crate::github_client::api_base(&host);
    crate::github_client::list_pull_requests(&base_url, &remote_info.owner, &remote_info.repo, &token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_pull_request(
    host: String,
    title: String,
    body: String,
    head: String,
    base: String,
    state: State<'_, AppState>,
) -> Result<PullRequest, String> {
    let token = state
        .credentials
        .load(&host)
        .map_err(|e| e.to_string())?
        .ok_or("not authenticated — connect your GitHub account first")?;

    let known = state.known_github_hosts().map_err(|e| e.to_string())?;
    let remote_info = state
        .with_repo(|repo| crate::remote_ops::detect_remote_info(repo, &known))
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let base_url = crate::github_client::api_base(&host);
    crate::github_client::create_pull_request(
        &base_url,
        &remote_info.owner,
        &remote_info.repo,
        &title,
        &body,
        &head,
        &base,
        &token,
    )
    .await
    .map_err(|e| e.to_string())
}
