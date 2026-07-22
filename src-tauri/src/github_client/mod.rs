use anyhow::Context;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};

const GITHUB_CLIENT_ID_RAW: &str = match option_env!("GITHUB_OAUTH_CLIENT_ID") {
    Some(id) => id,
    None => "dev-placeholder",
};

/// The configured OAuth client ID, trimmed. `GITHUB_OAUTH_CLIENT_ID` is set in a
/// human-edited `.cargo/config.toml`, where a stray trailing space silently rides
/// along into the request and GitHub rejects the unknown client with a 404
/// ("Not Found") — trimming here guards against that whole class of confusion.
fn client_id() -> &'static str {
    GITHUB_CLIENT_ID_RAW.trim()
}

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
        .user_agent("git-wasp/0.1")
        .build()
        .context("failed to build HTTP client")
}

#[derive(Deserialize)]
struct GhError {
    message: String,
}

/// GitHub's human-readable `message` from an error body, falling back to the raw
/// body when it isn't the expected `{ "message": ... }` shape.
fn github_error_message(body: &str) -> String {
    serde_json::from_str::<GhError>(body)
        .map(|e| e.message)
        .unwrap_or_else(|_| body.trim().to_string())
}

/// Deserialize a GitHub REST response into `T`, turning a non-2xx status into a
/// clear, actionable error (the status + GitHub's `message`) instead of a
/// cryptic JSON parse failure on the error body — a 401/403/404 used to surface
/// as e.g. "failed to parse PRs".
async fn github_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
    what: &str,
) -> anyhow::Result<T> {
    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("failed to read {what} response body"))?;
    if !status.is_success() {
        anyhow::bail!(
            "GitHub API error fetching {what} ({status}): {}",
            github_error_message(&body)
        );
    }
    serde_json::from_str(&body)
        .with_context(|| format!("failed to parse {what} (status {status}): {body}"))
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
    /// GitHub asked us to back off (RFC 8628 `slow_down`). The caller must
    /// increase its polling interval by at least 5 seconds and keep polling.
    pub slow_down: bool,
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
    info!(
        "starting GitHub device flow: POST {url} (client_id={})",
        client_id()
    );
    let client = http_client()?;
    let response = client
        .post(url)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id()), ("scope", "repo read:user")])
        .send()
        .await
        .context("device code request failed")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read device code response body")?;
    // Never log the raw body: it carries `device_code`, the credential used
    // to poll for the access token during its ~15-minute window. The
    // token-poll path nearby gets this right (logs a boolean only); the
    // parsed summary below (user_code/verification_uri/interval/expires_in)
    // is the safe substitute.
    debug!("device code response received: status={status}");
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

pub async fn poll_device_flow(
    host: &str,
    device_code: &str,
) -> anyhow::Result<DeviceFlowPollResult> {
    poll_device_flow_at(&access_token_url(host), device_code).await
}

async fn poll_device_flow_at(url: &str, device_code: &str) -> anyhow::Result<DeviceFlowPollResult> {
    debug!(
        "polling device flow: POST {url} (client_id={})",
        client_id()
    );
    let client = http_client()?;
    let response = client
        .post(url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id()),
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
    let resp: AccessTokenResponse = serde_json::from_str(&body)
        .with_context(|| format!("failed to parse poll response (status {status}): {body}"))?;

    let has_token = resp.access_token.as_deref().is_some_and(|t| !t.is_empty());
    info!(
        "poll response: status={status} has_access_token={has_token} error={:?}",
        resp.error
    );

    if has_token {
        return Ok(DeviceFlowPollResult {
            done: true,
            token: resp.access_token,
            slow_down: false,
        });
    }

    match resp.error.as_deref() {
        None | Some("authorization_pending") => Ok(DeviceFlowPollResult {
            done: false,
            token: None,
            slow_down: false,
        }),
        Some("slow_down") => Ok(DeviceFlowPollResult {
            done: false,
            token: None,
            slow_down: true,
        }),
        Some(other) => {
            warn!("device authorization terminated with error: {other}");
            Err(anyhow::anyhow!(
                "GitHub device authorization failed: {other}"
            ))
        }
    }
}

// ----- Auth check -----

#[derive(Deserialize)]
struct GhAuthUser {
    login: String,
}

/// Result of validating a stored token against the API.
#[derive(Debug)]
pub enum AuthCheck {
    /// Token works; carries the authenticated user's login.
    Valid(String),
    /// Token was rejected (401) — the user must reconnect.
    Invalid,
}

/// Validate a token by calling `GET /user`. A 401 means the token is no longer
/// valid (revoked/expired). Other non-2xx responses or network failures bubble
/// up as errors, so a transient blip isn't mistaken for a revoked token.
pub async fn check_token(base: &str, token: &str) -> anyhow::Result<AuthCheck> {
    let client = http_client()?;
    let response = client
        .get(format!("{base}/user"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("auth check request failed")?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(AuthCheck::Invalid);
    }
    let user: GhAuthUser = github_json(response, "the authenticated user").await?;
    Ok(AuthCheck::Valid(user.login))
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
    let response = client
        .get(format!("{base_url}/user/repos?per_page=100&sort=updated"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("list repos request failed")?;
    let repos: Vec<GhRepo> = github_json(response, "repositories").await?;
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
    // `user` can be null for a deleted/ghost author — don't let that fail the parse.
    user: Option<GhUser>,
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
        matches!(
            r.conclusion.as_deref(),
            Some("failure") | Some("timed_out") | Some("cancelled")
        )
    };
    if runs.iter().any(is_failed) {
        return CiStatus::Failure;
    }
    if runs
        .iter()
        .any(|r| r.status != "completed" || r.conclusion.is_none())
    {
        return CiStatus::Pending;
    }
    CiStatus::Success
}

/// Per-PR round trips (check-runs + reviews) are independent, so they're
/// issued concurrently rather than in a sequential loop — 50 open PRs used to
/// mean 101 sequential round-trips (seconds of latency, an easy route to
/// secondary rate limiting). Capped at `MAX_CONCURRENT_PR_FETCHES` in-flight
/// requests via a semaphore so a large PR list doesn't fire everything at
/// once.
const MAX_CONCURRENT_PR_FETCHES: usize = 8;

async fn fetch_ci_status(
    client: &reqwest::Client,
    base: &str,
    owner: &str,
    repo: &str,
    sha: &str,
    token: &str,
) -> CiStatus {
    match client
        .get(format!(
            "{base}/repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=100"
        ))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(resp) => match resp.json::<CheckRunsResponse>().await {
            Ok(parsed) => aggregate_ci_status(&parsed.check_runs),
            Err(e) => {
                warn!("failed to parse check-runs for {sha}: {e}");
                CiStatus::None
            }
        },
        Err(e) => {
            warn!("failed to fetch check-runs for {sha}: {e}");
            CiStatus::None
        }
    }
}

async fn fetch_approval_count(
    client: &reqwest::Client,
    base: &str,
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> u32 {
    let reviews: Vec<GhReview> = match client
        .get(format!(
            "{base}/repos/{owner}/{repo}/pulls/{pr_number}/reviews"
        ))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Vec<GhReview>>().await {
            Ok(r) => r,
            Err(e) => {
                warn!("failed to parse reviews for PR #{pr_number}: {e}");
                Vec::new()
            }
        },
        Err(e) => {
            warn!("failed to fetch reviews for PR #{pr_number}: {e}");
            Vec::new()
        }
    };
    reviews.iter().filter(|r| r.state == "APPROVED").count() as u32
}

pub async fn list_pull_requests(
    base: &str,
    owner: &str,
    repo: &str,
    token: &str,
) -> anyhow::Result<Vec<PullRequest>> {
    let client = http_client()?;

    let response = client
        .get(format!(
            "{base}/repos/{owner}/{repo}/pulls?state=open&per_page=50"
        ))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("list PRs request failed")?;
    let prs: Vec<GhPr> = github_json(response, "pull requests").await?;

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_PR_FETCHES));
    let mut join_set = tokio::task::JoinSet::new();
    for (index, pr) in prs.into_iter().enumerate() {
        let client = client.clone();
        let base = base.to_string();
        let owner = owner.to_string();
        let repo = repo.to_string();
        let token = token.to_string();
        let semaphore = semaphore.clone();
        join_set.spawn(async move {
            let _permit = semaphore.acquire_owned().await.expect("semaphore closed");
            let ci_status =
                fetch_ci_status(&client, &base, &owner, &repo, &pr.head.sha, &token).await;
            let approval_count =
                fetch_approval_count(&client, &base, &owner, &repo, pr.number, &token).await;
            (index, pr, ci_status, approval_count)
        });
    }

    let mut indexed = Vec::new();
    while let Some(joined) = join_set.join_next().await {
        indexed.push(joined.expect("PR fetch task panicked"));
    }
    // JoinSet completion order isn't input order — restore it so PR listing
    // stays deterministic (matching GitHub's own ordering) across runs.
    indexed.sort_by_key(|(index, ..)| *index);

    Ok(indexed
        .into_iter()
        .map(|(_, pr, ci_status, approval_count)| PullRequest {
            number: pr.number,
            title: pr.title,
            author: pr
                .user
                .map(|u| u.login)
                .unwrap_or_else(|| "ghost".to_string()),
            head_ref: pr.head.ref_name,
            base_ref: pr.base.ref_name,
            url: pr.html_url,
            ci_status,
            approval_count,
        })
        .collect())
}

/// Turn GitHub's opaque "Resource not accessible by integration" 403 into an
/// actionable message. This happens when the GitHub App authorizing the user
/// lacks the *Pull requests: write* permission — note that pushing only needs
/// *Contents: write*, so a push can succeed while opening the PR is forbidden.
fn explain_pr_permission_error(err: anyhow::Error) -> anyhow::Error {
    let msg = err.to_string();
    if msg.contains("Resource not accessible") {
        return anyhow::anyhow!(
            "Your GitHub authorization isn't allowed to open pull requests. The GitHub App \
             needs the \"Pull requests: Read and write\" permission (and \"Issues: Read and \
             write\" to set assignees/labels) — add it in the App's settings, then disconnect \
             and reconnect under Settings → GitHub to re-authorize. (GitHub said: {msg})"
        );
    }
    err
}

#[allow(clippy::too_many_arguments)]
pub async fn create_pull_request(
    api: &str,
    owner: &str,
    repo: &str,
    title: &str,
    body: &str,
    head: &str,
    base: &str,
    assignees: &[String],
    labels: &[String],
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

    let response = client
        .post(format!("{api}/repos/{owner}/{repo}/pulls"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .json(&CreatePrBody {
            title,
            body,
            head,
            base,
        })
        .send()
        .await
        .context("create PR request failed")?;
    let pr: GhPr = github_json(response, "the created pull request")
        .await
        .map_err(explain_pr_permission_error)?;

    // Assignees and labels aren't accepted by the create-PR endpoint; a PR is an
    // issue under the hood, so they're set via a follow-up PATCH to the issue.
    // Best-effort: the PR is *already created*, so a failure here (e.g. a GitHub
    // App without "Issues: write") must not discard it — log a warning and return
    // the PR rather than erroring the whole operation.
    if !assignees.is_empty() || !labels.is_empty() {
        #[derive(Serialize)]
        struct UpdateIssueBody<'a> {
            assignees: &'a [String],
            labels: &'a [String],
        }
        let patch = async {
            let response = client
                .patch(format!("{api}/repos/{owner}/{repo}/issues/{}", pr.number))
                .bearer_auth(token)
                .header("Accept", "application/vnd.github+json")
                .json(&UpdateIssueBody { assignees, labels })
                .send()
                .await
                .context("setting PR assignees/labels failed")?;
            github_json::<serde_json::Value>(response, "the pull request assignees/labels").await?;
            anyhow::Ok(())
        }
        .await;
        if let Err(e) = patch {
            warn!(
                target: "git",
                "pull request #{} created, but setting assignees/labels failed: {e}",
                pr.number
            );
        }
    }

    Ok(PullRequest {
        number: pr.number,
        title: pr.title,
        author: pr
            .user
            .map(|u| u.login)
            .unwrap_or_else(|| "ghost".to_string()),
        head_ref: pr.head.ref_name,
        base_ref: pr.base.ref_name,
        url: pr.html_url,
        ci_status: CiStatus::None,
        approval_count: 0,
    })
}

/// A label defined on a repository, for pre-populating the labels picker when
/// opening a PR. `color` is GitHub's 6-hex-digit string (no leading `#`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoLabel {
    pub name: String,
    pub color: String,
}

/// The logins of users who can be assigned to issues/PRs in this repo (the
/// repo's collaborators + org members with access). Used to populate the
/// assignees picker rather than relying on free-text entry.
pub async fn list_assignable_users(
    api: &str,
    owner: &str,
    repo: &str,
    token: &str,
) -> anyhow::Result<Vec<String>> {
    #[derive(Deserialize)]
    struct Assignee {
        login: String,
    }

    let client = http_client()?;
    let response = client
        .get(format!("{api}/repos/{owner}/{repo}/assignees?per_page=100"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("list assignees request failed")?;
    let users: Vec<Assignee> = github_json(response, "the repository's assignable users").await?;
    Ok(users.into_iter().map(|u| u.login).collect())
}

/// The labels defined on this repo, to populate the labels picker when opening
/// a PR.
pub async fn list_repo_labels(
    api: &str,
    owner: &str,
    repo: &str,
    token: &str,
) -> anyhow::Result<Vec<RepoLabel>> {
    let client = http_client()?;
    let response = client
        .get(format!("{api}/repos/{owner}/{repo}/labels?per_page=100"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("list labels request failed")?;
    github_json(response, "the repository's labels").await
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
            when.method(httpmock::Method::POST)
                .path("/login/device/code");
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
            when.method(httpmock::Method::POST)
                .path("/login/device/code");
            then.status(404)
                .json_body(serde_json::json!({ "error": "Not Found" }));
        });

        let err = start_device_flow_at(&format!("{}/login/device/code", server.base_url()))
            .await
            .unwrap_err();

        mock.assert();
        let message = format!("{err:#}");
        assert!(
            message.contains("404"),
            "expected status in error, got: {message}"
        );
        assert!(
            message.contains("Not Found"),
            "expected response body in error, got: {message}"
        );
    }

    #[tokio::test]
    async fn poll_device_flow_pending_is_not_done() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": null,
                "error": "authorization_pending"
            }));
        });

        let result = poll_device_flow_at(
            &format!("{}/login/oauth/access_token", server.base_url()),
            "device-abc",
        )
        .await
        .unwrap();

        mock.assert();
        assert!(!result.done);
        assert!(result.token.is_none());
        assert!(!result.slow_down);
    }

    #[tokio::test]
    async fn poll_device_flow_slow_down_is_not_done() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": null,
                "error": "slow_down"
            }));
        });

        let result = poll_device_flow_at(
            &format!("{}/login/oauth/access_token", server.base_url()),
            "device-abc",
        )
        .await
        .unwrap();

        mock.assert();
        assert!(!result.done);
        assert!(result.token.is_none());
        assert!(
            result.slow_down,
            "slow_down responses must be reported so the caller can back off"
        );
    }

    #[tokio::test]
    async fn poll_device_flow_terminal_error_surfaces_as_error() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": null,
                "error": "expired_token"
            }));
        });

        let err = poll_device_flow_at(
            &format!("{}/login/oauth/access_token", server.base_url()),
            "device-abc",
        )
        .await
        .unwrap_err();

        mock.assert();
        let message = format!("{err:#}");
        assert!(
            message.contains("expired_token"),
            "expected the GitHub error in the message, got: {message}"
        );
    }

    #[tokio::test]
    async fn poll_device_flow_done_returns_token() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/login/oauth/access_token");
            then.status(200).json_body(serde_json::json!({
                "access_token": "gho_secrettoken",
                "error": null
            }));
        });

        let result = poll_device_flow_at(
            &format!("{}/login/oauth/access_token", server.base_url()),
            "device-abc",
        )
        .await
        .unwrap();

        mock.assert();
        assert!(result.done);
        assert_eq!(result.token.as_deref(), Some("gho_secrettoken"));
        assert!(!result.slow_down);
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
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/pulls");
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
    async fn list_pull_requests_fetches_check_runs_and_reviews_concurrently() {
        // N PRs, each with a delayed check-runs/reviews mock. If the fetches
        // are still sequential, total wall time scales with N * delay; if
        // concurrent, it stays close to one round-trip's delay regardless of N.
        const N: u64 = 8;
        const DELAY_MS: u64 = 60;

        let server = httpmock::MockServer::start();
        let pr_bodies: Vec<_> = (0..N)
            .map(|i| {
                serde_json::json!({
                    "number": i,
                    "title": format!("PR {i}"),
                    "user": { "login": "mike" },
                    "head": { "ref": format!("feat/{i}"), "sha": format!("sha{i}") },
                    "base": { "ref": "main", "sha": "def456" },
                    "html_url": format!("https://github.com/mike/gitclient/pull/{i}")
                })
            })
            .collect();
        server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/pulls");
            then.status(200).json_body(serde_json::json!(pr_bodies));
        });
        for i in 0..N {
            server.mock(|when, then| {
                when.method(httpmock::Method::GET)
                    .path(format!("/repos/mike/gitclient/commits/sha{i}/check-runs"));
                then.status(200)
                    .delay(std::time::Duration::from_millis(DELAY_MS))
                    .json_body(serde_json::json!({ "check_runs": [] }));
            });
            server.mock(|when, then| {
                when.method(httpmock::Method::GET)
                    .path(format!("/repos/mike/gitclient/pulls/{i}/reviews"));
                then.status(200)
                    .delay(std::time::Duration::from_millis(DELAY_MS))
                    .json_body(serde_json::json!([]));
            });
        }

        let started = std::time::Instant::now();
        let prs = list_pull_requests(&server.base_url(), "mike", "gitclient", "test-token")
            .await
            .unwrap();
        let elapsed = started.elapsed();

        assert_eq!(prs.len(), N as usize);
        assert!(
            elapsed < std::time::Duration::from_millis(N * DELAY_MS),
            "expected concurrent fetches to finish well under {}ms (sequential worst case), took {:?}",
            N * DELAY_MS,
            elapsed
        );
    }

    #[test]
    fn github_error_message_extracts_message_field() {
        let body = r#"{"message":"Bad credentials","documentation_url":"https://docs.github.com"}"#;
        assert_eq!(github_error_message(body), "Bad credentials");
    }

    #[test]
    fn github_error_message_falls_back_to_raw_body() {
        assert_eq!(github_error_message("  not json  "), "not json");
    }

    #[tokio::test]
    async fn check_token_valid_returns_login() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/user")
                .header("authorization", "Bearer good-token");
            then.status(200)
                .json_body(serde_json::json!({ "login": "mike" }));
        });

        let result = check_token(&server.base_url(), "good-token").await.unwrap();

        mock.assert();
        assert!(matches!(result, AuthCheck::Valid(login) if login == "mike"));
    }

    #[tokio::test]
    async fn check_token_unauthorized_is_invalid_not_an_error() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET).path("/user");
            then.status(401)
                .json_body(serde_json::json!({ "message": "Bad credentials" }));
        });

        let result = check_token(&server.base_url(), "stale-token")
            .await
            .unwrap();

        mock.assert();
        assert!(matches!(result, AuthCheck::Invalid));
    }

    #[tokio::test]
    async fn check_token_other_failure_bubbles_up_as_error() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET).path("/user");
            then.status(500).body("upstream boom");
        });

        let err = check_token(&server.base_url(), "good-token")
            .await
            .unwrap_err();

        mock.assert();
        // A 500 is transient — surfaced as an error, not a revoked token.
        assert!(format!("{err:#}").contains("500"));
    }

    #[tokio::test]
    async fn list_pull_requests_surfaces_a_clear_error_on_api_failure() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/pulls");
            then.status(401)
                .json_body(serde_json::json!({ "message": "Bad credentials" }));
        });

        let err = list_pull_requests(&server.base_url(), "mike", "gitclient", "bad-token")
            .await
            .unwrap_err();

        mock.assert();
        let message = format!("{err:#}");
        // The old behaviour surfaced a cryptic "failed to parse PRs"; now the
        // status and GitHub's message come through.
        assert!(
            message.contains("401"),
            "expected status in error, got: {message}"
        );
        assert!(
            message.contains("Bad credentials"),
            "expected GitHub's message in error, got: {message}"
        );
        assert!(
            !message.contains("failed to parse"),
            "an API error should not read as a parse failure, got: {message}"
        );
    }

    #[tokio::test]
    async fn list_pull_requests_tolerates_a_null_author() {
        let server = httpmock::MockServer::start();
        let prs_mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/pulls");
            then.status(200).json_body(serde_json::json!([
                {
                    "number": 9,
                    "title": "Ghost PR",
                    "user": null,
                    "head": { "ref": "feat/y", "sha": "aaa" },
                    "base": { "ref": "main", "sha": "bbb" },
                    "html_url": "https://github.com/mike/gitclient/pull/9"
                }
            ]));
        });

        let prs = list_pull_requests(&server.base_url(), "mike", "gitclient", "test-token")
            .await
            .unwrap();

        prs_mock.assert();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].author, "ghost");
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
            &[],
            &[],
            "test-token",
        )
        .await
        .unwrap();

        mock.assert();
        assert_eq!(pr.number, 7);
        assert_eq!(pr.head_ref, "feat/x");
        assert_eq!(pr.base_ref, "main");
    }

    #[tokio::test]
    async fn create_pull_request_sets_assignees_and_labels() {
        let server = httpmock::MockServer::start();
        let create = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/repos/mike/gitclient/pulls");
            then.status(201).json_body(serde_json::json!({
                "number": 7,
                "title": "Add feature",
                "user": { "login": "mike" },
                "head": { "ref": "feat/x", "sha": "abc123" },
                "base": { "ref": "main", "sha": "def456" },
                "html_url": "https://github.com/mike/gitclient/pull/7"
            }));
        });
        // The follow-up PATCH to the issue carries the assignees + labels.
        let update = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path("/repos/mike/gitclient/issues/7")
                .json_body(serde_json::json!({
                    "assignees": ["mike"],
                    "labels": ["bug", "ux"]
                }));
            then.status(200)
                .json_body(serde_json::json!({ "number": 7 }));
        });

        create_pull_request(
            &server.base_url(),
            "mike",
            "gitclient",
            "Add feature",
            "description",
            "feat/x",
            "main",
            &["mike".to_string()],
            &["bug".to_string(), "ux".to_string()],
            "test-token",
        )
        .await
        .unwrap();

        create.assert();
        update.assert();
    }

    #[tokio::test]
    async fn create_pull_request_explains_a_missing_permission_403() {
        let server = httpmock::MockServer::start();
        server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/repos/mike/gitclient/pulls");
            then.status(403).json_body(
                serde_json::json!({ "message": "Resource not accessible by integration" }),
            );
        });

        let err = create_pull_request(
            &server.base_url(),
            "mike",
            "gitclient",
            "Add feature",
            "description",
            "feat/x",
            "main",
            &[],
            &[],
            "test-token",
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(err.contains("Pull requests: Read and write"), "got: {err}");
    }

    #[tokio::test]
    async fn create_pull_request_succeeds_even_if_setting_assignees_fails() {
        let server = httpmock::MockServer::start();
        let create = server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/repos/mike/gitclient/pulls");
            then.status(201).json_body(serde_json::json!({
                "number": 11,
                "title": "Add feature",
                "user": { "login": "mike" },
                "head": { "ref": "feat/x", "sha": "abc123" },
                "base": { "ref": "main", "sha": "def456" },
                "html_url": "https://github.com/mike/gitclient/pull/11"
            }));
        });
        // The issue PATCH is forbidden (e.g. no "Issues: write") — must not discard the PR.
        let update = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path("/repos/mike/gitclient/issues/11");
            then.status(403).json_body(
                serde_json::json!({ "message": "Resource not accessible by integration" }),
            );
        });

        let pr = create_pull_request(
            &server.base_url(),
            "mike",
            "gitclient",
            "Add feature",
            "description",
            "feat/x",
            "main",
            &["mike".to_string()],
            &["bug".to_string()],
            "test-token",
        )
        .await
        .expect("PR creation should still succeed despite the assignees/labels failure");

        create.assert();
        update.assert();
        assert_eq!(pr.number, 11);
    }

    #[tokio::test]
    async fn list_assignable_users_returns_logins() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/assignees");
            then.status(200).json_body(serde_json::json!([
                { "login": "mike" },
                { "login": "ann" }
            ]));
        });

        let users = list_assignable_users(&server.base_url(), "mike", "gitclient", "test-token")
            .await
            .unwrap();

        mock.assert();
        assert_eq!(users, vec!["mike".to_string(), "ann".to_string()]);
    }

    #[tokio::test]
    async fn list_repo_labels_returns_name_and_color() {
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/repos/mike/gitclient/labels");
            then.status(200).json_body(serde_json::json!([
                { "name": "bug", "color": "d73a4a" },
                { "name": "ux", "color": "0e8a16" }
            ]));
        });

        let labels = list_repo_labels(&server.base_url(), "mike", "gitclient", "test-token")
            .await
            .unwrap();

        mock.assert();
        assert_eq!(
            labels,
            vec![
                RepoLabel {
                    name: "bug".to_string(),
                    color: "d73a4a".to_string()
                },
                RepoLabel {
                    name: "ux".to_string(),
                    color: "0e8a16".to_string()
                },
            ]
        );
    }

    #[tokio::test]
    async fn create_pull_request_skips_issue_patch_when_no_assignees_or_labels() {
        let server = httpmock::MockServer::start();
        server.mock(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/repos/mike/gitclient/pulls");
            then.status(201).json_body(serde_json::json!({
                "number": 7,
                "title": "Add feature",
                "user": { "login": "mike" },
                "head": { "ref": "feat/x", "sha": "abc123" },
                "base": { "ref": "main", "sha": "def456" },
                "html_url": "https://github.com/mike/gitclient/pull/7"
            }));
        });
        let update = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path("/repos/mike/gitclient/issues/7");
            then.status(200)
                .json_body(serde_json::json!({ "number": 7 }));
        });

        create_pull_request(
            &server.base_url(),
            "mike",
            "gitclient",
            "Add feature",
            "description",
            "feat/x",
            "main",
            &[],
            &[],
            "test-token",
        )
        .await
        .unwrap();

        // No assignees/labels → the issue PATCH must not be made.
        assert_eq!(update.calls(), 0);
    }
}
