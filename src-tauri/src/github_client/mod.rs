use anyhow::Context;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};

const GITHUB_CLIENT_ID: &str = match option_env!("GITHUB_OAUTH_CLIENT_ID") {
    Some(id) => id,
    None => "dev-placeholder",
};

fn device_code_url(host: &str) -> String {
    if host == "github.com" {
        "https://github.com/login/device/code".to_string()
    } else {
        format!("https://{host}/login/device/code")
    }
}

fn access_token_url(host: &str) -> String {
    if host == "github.com" {
        "https://github.com/login/oauth/access_token".to_string()
    } else {
        format!("https://{host}/login/oauth/access_token")
    }
}

pub fn api_base(host: &str) -> String {
    if host == "github.com" {
        "https://api.github.com".to_string()
    } else {
        format!("https://{host}/api/v3")
    }
}

fn http_client() -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("gitclient/0.1")
        .build()
        .context("failed to build HTTP client")
}

// ----- Device flow -----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowInit {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u32,
    pub interval: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowPollResult {
    pub done: bool,
    pub token: Option<String>,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u32,
    interval: u32,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

pub async fn start_device_flow(host: &str) -> anyhow::Result<DeviceFlowInit> {
    start_device_flow_at(&device_code_url(host)).await
}

async fn start_device_flow_at(url: &str) -> anyhow::Result<DeviceFlowInit> {
    info!("starting GitHub device flow: POST {url} (client_id={GITHUB_CLIENT_ID})");
    let client = http_client()?;
    let response = client
        .post(url)
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "repo read:user")])
        .send()
        .await
        .context("device code request failed")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read device code response body")?;
    debug!("device code response: status={status} body={body}");
    let resp: DeviceCodeResponse = serde_json::from_str(&body).with_context(|| {
        format!("failed to parse device code response (status {status}): {body}")
    })?;
    info!(
        "device flow ready: user_code={} verification_uri={} interval={}s expires_in={}s",
        resp.user_code, resp.verification_uri, resp.interval, resp.expires_in
    );
    Ok(DeviceFlowInit {
        user_code: resp.user_code,
        verification_uri: resp.verification_uri,
        device_code: resp.device_code,
        expires_in: resp.expires_in,
        interval: resp.interval,
    })
}

pub async fn poll_device_flow(host: &str, device_code: &str) -> anyhow::Result<DeviceFlowPollResult> {
    poll_device_flow_at(&access_token_url(host), device_code).await
}

async fn poll_device_flow_at(url: &str, device_code: &str) -> anyhow::Result<DeviceFlowPollResult> {
    debug!("polling device flow: POST {url} (client_id={GITHUB_CLIENT_ID})");
    let client = http_client()?;
    let response = client
        .post(url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .context("poll request failed")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read poll response body")?;
    let resp: AccessTokenResponse = serde_json::from_str(&body).with_context(|| {
        format!("failed to parse poll response (status {status}): {body}")
    })?;

    let has_token = resp
        .access_token
        .as_deref()
        .is_some_and(|t| !t.is_empty());
    info!(
        "poll response: status={status} has_access_token={has_token} error={:?}",
        resp.error
    );

    if has_token {
        return Ok(DeviceFlowPollResult { done: true, token: resp.access_token });
    }

    match resp.error.as_deref() {
        None | Some("authorization_pending") | Some("slow_down") => {
            Ok(DeviceFlowPollResult { done: false, token: None })
        }
        Some(other) => {
            warn!("device authorization terminated with error: {other}");
            Err(anyhow::anyhow!("GitHub device authorization failed: {other}"))
        }
    }
}

// ----- Repos -----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub clone_url: String,
    pub ssh_url: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
struct GhRepo {
    id: u64,
    name: String,
    full_name: String,
    private: bool,
    clone_url: String,
    ssh_url: String,
    description: Option<String>,
}

pub async fn list_repos(base_url: &str, token: &str) -> anyhow::Result<Vec<GithubRepo>> {
    let client = http_client()?;
    let repos: Vec<GhRepo> = client
        .get(format!("{base_url}/user/repos?per_page=100&sort=updated"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("list repos request failed")?
        .json()
        .await
        .context("failed to parse repos response")?;
    Ok(repos
        .into_iter()
        .map(|r| GithubRepo {
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            private: r.private,
            clone_url: r.clone_url,
            ssh_url: r.ssh_url,
            description: r.description,
        })
        .collect())
}

// ----- Pull Requests -----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub head_ref: String,
    pub base_ref: String,
    pub url: String,
    pub ci_status: CiStatus,
    pub approval_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CiStatus {
    Success,
    Failure,
    Pending,
    None,
}

#[derive(Deserialize)]
struct GhPr {
    number: u64,
    title: String,
    user: GhUser,
    head: GhRef,
    base: GhRef,
    html_url: String,
}

#[derive(Deserialize)]
struct GhUser {
    login: String,
}

#[derive(Deserialize)]
struct GhRef {
    #[serde(rename = "ref")]
    ref_name: String,
    sha: String,
}

#[derive(Deserialize)]
struct GhReview {
    state: String,
}

#[derive(Deserialize)]
pub struct GhCheckRun {
    pub conclusion: Option<String>,
    pub status: String,
}

#[derive(Deserialize)]
struct CheckRunsResponse {
    check_runs: Vec<GhCheckRun>,
}

pub fn aggregate_ci_status(runs: &[GhCheckRun]) -> CiStatus {
    if runs.is_empty() {
        return CiStatus::None;
    }
    let is_failed = |r: &GhCheckRun| {
        matches!(r.conclusion.as_deref(), Some("failure") | Some("timed_out") | Some("cancelled"))
    };
    if runs.iter().any(is_failed) {
        return CiStatus::Failure;
    }
    if runs.iter().any(|r| r.status != "completed" || r.conclusion.is_none()) {
        return CiStatus::Pending;
    }
    CiStatus::Success
}

pub async fn list_pull_requests(
    base: &str,
    owner: &str,
    repo: &str,
    token: &str,
) -> anyhow::Result<Vec<PullRequest>> {
    let client = http_client()?;

    let prs: Vec<GhPr> = client
        .get(format!("{base}/repos/{owner}/{repo}/pulls?state=open&per_page=50"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("list PRs request failed")?
        .json()
        .await
        .context("failed to parse PRs")?;

    let mut result = Vec::new();
    for pr in prs {
        let sha = &pr.head.sha;

        let ci_status = match client
            .get(format!("{base}/repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=100"))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
        {
            Ok(resp) => match resp.json::<CheckRunsResponse>().await {
                Ok(parsed) => aggregate_ci_status(&parsed.check_runs),
                Err(_) => CiStatus::None,
            },
            Err(_) => CiStatus::None,
        };

        let reviews: Vec<GhReview> = match client
            .get(format!("{base}/repos/{owner}/{repo}/pulls/{}/reviews", pr.number))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
        {
            Ok(resp) => resp.json::<Vec<GhReview>>().await.unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        let approval_count = reviews.iter().filter(|r| r.state == "APPROVED").count() as u32;

        result.push(PullRequest {
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            head_ref: pr.head.ref_name,
            base_ref: pr.base.ref_name,
            url: pr.html_url,
            ci_status,
            approval_count,
        });
    }
    Ok(result)
}

pub async fn create_pull_request(
    api: &str,
    owner: &str,
    repo: &str,
    title: &str,
    body: &str,
    head: &str,
    base: &str,
    token: &str,
) -> anyhow::Result<PullRequest> {
    let client = http_client()?;

    #[derive(Serialize)]
    struct CreatePrBody<'a> {
        title: &'a str,
        body: &'a str,
        head: &'a str,
        base: &'a str,
    }

    let pr: GhPr = client
        .post(format!("{api}/repos/{owner}/{repo}/pulls"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .json(&CreatePrBody { title, body, head, base })
        .send()
        .await
        .context("create PR request failed")?
        .json()
        .await
        .context("failed to parse created PR")?;

    Ok(PullRequest {
        number: pr.number,
        title: pr.title,
        author: pr.user.login,
        head_ref: pr.head.ref_name,
        base_ref: pr.base.ref_name,
        url: pr.html_url,
        ci_status: CiStatus::None,
        approval_count: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_run(status: &str, conclusion: Option<&str>) -> GhCheckRun {
        GhCheckRun {
            status: status.to_string(),
            conclusion: conclusion.map(|s| s.to_string()),
        }
    }

    #[test]
    fn aggregate_all_success() {
        let runs = vec![
            make_run("completed", Some("success")),
            make_run("completed", Some("success")),
        ];
        assert_eq!(aggregate_ci_status(&runs), CiStatus::Success);
    }

    #[test]
    fn aggregate_any_failure() {
        let runs = vec![
            make_run("completed", Some("success")),
            make_run("completed", Some("failure")),
        ];
        assert_eq!(aggregate_ci_status(&runs), CiStatus::Failure);
    }

    #[test]
    fn aggregate_pending_when_in_progress() {
        let runs = vec![
            make_run("completed", Some("success")),
            make_run("in_progress", None),
        ];
        assert_eq!(aggregate_ci_status(&runs), CiStatus::Pending);
    }

    #[test]
    fn aggregate_timed_out_is_failure() {
        let runs = vec![make_run("completed", Some("timed_out"))];
        assert_eq!(aggregate_ci_status(&runs), CiStatus::Failure);
    }

    #[test]
    fn aggregate_empty_is_none() {
        assert_eq!(aggregate_ci_status(&[]), CiStatus::None);
    }

    #[test]
    fn api_base_for_github_com() {
        assert_eq!(api_base("github.com"), "https://api.github.com");
    }

    #[test]
    fn api_base_for_ghe() {
        assert_eq!(api_base("ghe.corp.com"), "https://ghe.corp.com/api/v3");
    }

    #[tokio::test]
    async fn start_device_flow_parses_init_response() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST).path("/login/device/code");
            then.status(200).json_body(serde_json::json!({
                "device_code": "device-abc",
                "user_code": "WXYZ-1234",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900,
                "interval": 5
            }));
        });

        let init = start_device_flow_at(&format!("{}/login/device/code", server.base_url()))
            .await
            .unwrap();

        mock.assert();
        assert_eq!(init.device_code, "device-abc");
        assert_eq!(init.user_code, "WXYZ-1234");
        assert_eq!(init.interval, 5);
    }

    #[tokio::test]
    async fn start_device_flow_surfaces_error_body_on_parse_failure() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST).path("/login/device/code");
            then.status(404).json_body(serde_json::json!({ "error": "Not Found" }));
        });

        let err = start_device_flow_at(&format!("{}/login/device/code", server.base_url()))
            .await
            .unwrap_err();

        mock.assert();
        let message = format!("{err:#}");
        assert!(message.contains("404"), "expected status in error, got: {message}");
        assert!(message.contains("Not Found"), "expected response body in error, got: {message}");
    }

    #[tokio::test]
    async fn poll_device_flow_pending_is_not_done() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST).path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": null,
                "error": "authorization_pending"
            }));
        });

        let result = poll_device_flow_at(&format!("{}/login/oauth/access_token", server.base_url()), "device-abc")
            .await
            .unwrap();

        mock.assert();
        assert!(!result.done);
        assert!(result.token.is_none());
    }

    #[tokio::test]
    async fn poll_device_flow_slow_down_is_not_done() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST).path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": null,
                "error": "slow_down"
            }));
        });

        let result = poll_device_flow_at(&format!("{}/login/oauth/access_token", server.base_url()), "device-abc")
            .await
            .unwrap();

        mock.assert();
        assert!(!result.done);
        assert!(result.token.is_none());
    }

    #[tokio::test]
    async fn poll_device_flow_terminal_error_surfaces_as_error() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST).path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": null,
                "error": "expired_token"
            }));
        });

        let err = poll_device_flow_at(&format!("{}/login/oauth/access_token", server.base_url()), "device-abc")
            .await
            .unwrap_err();

        mock.assert();
        let message = format!("{err:#}");
        assert!(message.contains("expired_token"), "expected the GitHub error in the message, got: {message}");
    }

    #[tokio::test]
    async fn poll_device_flow_done_returns_token() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST).path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": "gho_secrettoken",
                "error": null
            }));
        });

        let result = poll_device_flow_at(&format!("{}/login/oauth/access_token", server.base_url()), "device-abc")
            .await
            .unwrap();

        mock.assert();
        assert!(result.done);
        assert_eq!(result.token.as_deref(), Some("gho_secrettoken"));
    }

    #[tokio::test]
    async fn list_repos_parses_response() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/user/repos")
                .header("authorization", "Bearer test-token");
            then.status(200).json_body(serde_json::json!([
                {
                    "id": 1,
                    "name": "gitclient",
                    "full_name": "mike/gitclient",
                    "private": false,
                    "clone_url": "https://github.com/mike/gitclient.git",
                    "ssh_url": "git@github.com:mike/gitclient.git",
                    "description": "a git client"
                }
            ]));
        });

        let repos = list_repos(&server.base_url(), "test-token").await.unwrap();

        mock.assert();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].full_name, "mike/gitclient");
        assert_eq!(repos[0].description.as_deref(), Some("a git client"));
    }

    #[tokio::test]
    async fn list_pull_requests_aggregates_ci_and_approvals() {
        let server = httpmock::MockServer::start();
        let prs_mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET).path("/repos/mike/gitclient/pulls");
            then.status(200).json_body(serde_json::json!([
                {
                    "number": 42,
                    "title": "Add feature",
                    "user": { "login": "mike" },
                    "head": { "ref": "feat/x", "sha": "abc123" },
                    "base": { "ref": "main", "sha": "def456" },
                    "html_url": "https://github.com/mike/gitclient/pull/42"
                }
            ]));
        });
        let checks_mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/commits/abc123/check-runs");
            then.status(200).json_body(serde_json::json!({
                "check_runs": [
                    { "status": "completed", "conclusion": "success" }
                ]
            }));
        });
        let reviews_mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/pulls/42/reviews");
            then.status(200).json_body(serde_json::json!([
                { "state": "APPROVED" },
                { "state": "COMMENTED" }
            ]));
        });

        let prs = list_pull_requests(&server.base_url(), "mike", "gitclient", "test-token")
            .await
            .unwrap();

        prs_mock.assert();
        checks_mock.assert();
        reviews_mock.assert();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].number, 42);
        assert_eq!(prs[0].ci_status, CiStatus::Success);
        assert_eq!(prs[0].approval_count, 1);
    }

    #[tokio::test]
    async fn create_pull_request_posts_and_parses_result() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/repos/mike/gitclient/pulls")
                .json_body(serde_json::json!({
                    "title": "Add feature",
                    "body": "description",
                    "head": "feat/x",
                    "base": "main"
                }));
            then.status(201).json_body(serde_json::json!({
                "number": 7,
                "title": "Add feature",
                "user": { "login": "mike" },
                "head": { "ref": "feat/x", "sha": "abc123" },
                "base": { "ref": "main", "sha": "def456" },
                "html_url": "https://github.com/mike/gitclient/pull/7"
            }));
        });

        let pr = create_pull_request(
            &server.base_url(),
            "mike",
            "gitclient",
            "Add feature",
            "description",
            "feat/x",
            "main",
            "test-token",
        )
        .await
        .unwrap();

        mock.assert();
        assert_eq!(pr.number, 7);
        assert_eq!(pr.head_ref, "feat/x");
        assert_eq!(pr.base_ref, "main");
    }
}
