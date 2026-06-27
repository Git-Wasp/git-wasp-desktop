use crate::github_client::{
    AuthCheck, DeviceFlowInit, DeviceFlowPollResult, GithubRepo, PullRequest,
};
use crate::repo_manager::AppState;
use log::info;
use serde::Serialize;
use tauri::State;

/// A validated connection status: not just "is there a token" but "does the
/// token still work". `state` is one of "disconnected" | "connected" |
/// "expired" | "error".
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub state: String,
    pub login: Option<String>,
    pub message: Option<String>,
}

impl ConnectionStatus {
    fn of(state: &str) -> Self {
        ConnectionStatus {
            state: state.to_string(),
            login: None,
            message: None,
        }
    }
}

/// Validate the stored token for `host` against the API so the UI can show a
/// *real* connection state (and detect a revoked/expired token) rather than
/// merely "a token exists in the keychain".
#[tauri::command]
pub async fn github_connection_status(
    host: String,
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, String> {
    let token = match state.credentials.load(&host).map_err(|e| e.to_string())? {
        Some(token) => token,
        None => return Ok(ConnectionStatus::of("disconnected")),
    };

    let base = crate::github_client::api_base(&host);
    Ok(
        match crate::github_client::check_token(&base, &token).await {
            Ok(AuthCheck::Valid(login)) => ConnectionStatus {
                state: "connected".to_string(),
                login: Some(login),
                message: None,
            },
            Ok(AuthCheck::Invalid) => ConnectionStatus::of("expired"),
            Err(e) => ConnectionStatus {
                state: "error".to_string(),
                login: None,
                message: Some(e.to_string()),
            },
        },
    )
}

#[tauri::command]
pub async fn github_logout(host: String, state: State<'_, AppState>) -> Result<(), String> {
    state.credentials.delete(&host).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_start_device_flow(host: String) -> Result<DeviceFlowInit, String> {
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
            state
                .credentials
                .store(&host, token)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_github_repos(
    host: String,
    state: State<'_, AppState>,
) -> Result<Vec<GithubRepo>, String> {
    info!("list_github_repos: looking up credentials for host={host:?}");
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
    crate::github_client::list_pull_requests(
        &base_url,
        &remote_info.owner,
        &remote_info.repo,
        &token,
    )
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
    assignees: Vec<String>,
    labels: Vec<String>,
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
        &assignees,
        &labels,
        &token,
    )
    .await
    .map_err(|e| e.to_string())
}
