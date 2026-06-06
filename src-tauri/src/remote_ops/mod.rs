use anyhow::Context;
use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub protocol: String, // "https" or "ssh"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub branch: String,
    pub upstream: String,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub updated_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "status")]
pub enum PullResult {
    FastForwarded,
    AlreadyUpToDate,
}

pub fn is_ssh_remote(url: &str) -> bool {
    url.starts_with("git@") || url.starts_with("ssh://")
}

/// Parse a GitHub or GHE remote URL into host, owner, and repo name.
///
/// Supported formats:
///   https://github.com/owner/repo.git
///   https://github.com/owner/repo
///   git@github.com:owner/repo.git
///   ssh://git@github.com/owner/repo.git
///   https://ghe.corp.com/owner/repo
pub fn detect_remote_info(
    repo: &Repository,
    known_hosts: &[String],
) -> anyhow::Result<RemoteInfo> {
    let remote = repo
        .find_remote("origin")
        .context("no 'origin' remote configured")?;
    let url = remote.url().context("remote URL is not valid UTF-8")?;
    parse_remote_url(url, known_hosts)
}

pub fn parse_remote_url(url: &str, known_hosts: &[String]) -> anyhow::Result<RemoteInfo> {
    let protocol = if is_ssh_remote(url) { "ssh" } else { "https" };

    // Normalise SSH formats to host/path form
    // git@github.com:owner/repo.git  →  github.com/owner/repo.git
    // ssh://git@github.com/owner/repo → github.com/owner/repo
    let normalised = if url.starts_with("git@") {
        url.trim_start_matches("git@").replacen(':', "/", 1)
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        // strip optional "git@" user
        rest.trim_start_matches("git@").to_string()
    } else {
        // HTTPS: strip scheme
        url.split("://").nth(1).unwrap_or(url).to_string()
    };

    // normalised is now: host/owner/repo[.git]
    let parts: Vec<&str> = normalised.trim_end_matches('/').splitn(3, '/').collect();
    if parts.len() < 3 {
        anyhow::bail!("cannot parse remote URL: {url}");
    }

    let host_raw = parts[0];
    // Strip port if present (github.com:443 → github.com)
    let host = host_raw.split(':').next().unwrap_or(host_raw).to_string();
    let owner = parts[1].to_string();
    let repo_name = parts[2].trim_end_matches(".git").to_string();

    // Verify this is a known GitHub/GHE host
    let is_known = known_hosts.iter().any(|h| {
        let h_clean = h
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        h_clean.eq_ignore_ascii_case(&host)
    });
    if !is_known {
        anyhow::bail!("remote host '{host}' is not a configured GitHub host");
    }

    Ok(RemoteInfo { host, owner, repo: repo_name, protocol: protocol.to_string() })
}

pub fn compute_ahead_behind(repo: &Repository) -> anyhow::Result<Vec<AheadBehind>> {
    let mut results = Vec::new();
    let branches = repo
        .branches(Some(git2::BranchType::Local))
        .context("failed to list branches")?;
    for item in branches {
        let (branch, _) = item.context("invalid branch")?;
        let name = match branch.name()? {
            Some(n) => n.to_string(),
            None => continue,
        };
        let upstream = match branch.upstream() {
            Ok(u) => u,
            Err(_) => continue, // no upstream configured
        };
        let upstream_name = match upstream.name()? {
            Some(n) => n.to_string(),
            None => continue,
        };
        let local_oid = branch
            .get()
            .peel(git2::ObjectType::Commit)
            .map(|o| o.id())
            .context("cannot resolve local branch to commit")?;
        let upstream_oid = upstream
            .get()
            .peel(git2::ObjectType::Commit)
            .map(|o| o.id())
            .context("cannot resolve upstream to commit")?;
        let (ahead, behind) = repo
            .graph_ahead_behind(local_oid, upstream_oid)
            .context("failed to compute ahead/behind")?;
        results.push(AheadBehind { branch: name, upstream: upstream_name, ahead, behind });
    }
    Ok(results)
}

pub fn fetch(repo: &Repository, remote_name: &str, token: Option<&str>) -> anyhow::Result<FetchResult> {
    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let url = remote.url().unwrap_or("").to_string();

    if is_ssh_remote(&url) {
        return fetch_cli(repo, remote_name);
    }

    let updated_refs = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let refs_cb = updated_refs.clone();
    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(tok) = token {
        let tok = tok.to_string();
        callbacks.credentials(move |_, _, _| {
            git2::Cred::userpass_plaintext("x-access-token", &tok)
        });
    }
    callbacks.update_tips(move |refname, _old, _new| {
        refs_cb.lock().unwrap().push(refname.to_string());
        true
    });
    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(callbacks);
    remote
        .fetch(&[] as &[&str], Some(&mut opts), None)
        .context("fetch failed")?;
    let refs = std::sync::Arc::try_unwrap(updated_refs)
        .unwrap_or_default()
        .into_inner()
        .unwrap_or_default();
    Ok(FetchResult { updated_refs: refs })
}

fn fetch_cli(repo: &Repository, remote_name: &str) -> anyhow::Result<FetchResult> {
    let workdir = repo.workdir().context("bare repo not supported")?;
    let output = std::process::Command::new("git")
        .args(["fetch", remote_name])
        .current_dir(workdir)
        .output()
        .context("failed to run git fetch")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git fetch failed: {stderr}");
    }
    Ok(FetchResult { updated_refs: Vec::new() })
}

pub fn pull(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    token: Option<&str>,
) -> anyhow::Result<PullResult> {
    fetch(repo, remote_name, token)?;

    // Resolve the upstream ref
    let upstream_ref = format!("refs/remotes/{remote_name}/{branch}");
    let upstream_oid = repo
        .refname_to_id(&upstream_ref)
        .with_context(|| format!("upstream ref '{upstream_ref}' not found after fetch"))?;

    let local_ref = format!("refs/heads/{branch}");
    let local_oid = repo
        .refname_to_id(&local_ref)
        .with_context(|| format!("local branch ref '{local_ref}' not found"))?;

    if local_oid == upstream_oid {
        return Ok(PullResult::AlreadyUpToDate);
    }

    // Verify fast-forward is possible
    let (ahead, _behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
    if ahead > 0 {
        anyhow::bail!("cannot fast-forward: local branch has diverged from upstream");
    }

    // Fast-forward: update the local ref
    let upstream_commit = repo.find_commit(upstream_oid)?;
    repo.reference(
        &local_ref,
        upstream_oid,
        true,
        &format!("Fast-forward to {upstream_ref}"),
    )?;

    // Update HEAD and working tree if this is the current branch
    if let Ok(head) = repo.head() {
        if head.name() == Some(local_ref.as_str()) {
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.safe();
            repo.checkout_tree(upstream_commit.as_object(), Some(&mut checkout))
                .context("checkout after fast-forward failed")?;
        }
    }

    Ok(PullResult::FastForwarded)
}

pub fn push(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    token: Option<&str>,
) -> anyhow::Result<()> {
    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let url = remote.url().unwrap_or("").to_string();

    if is_ssh_remote(&url) {
        let workdir = repo.workdir().context("bare repo not supported")?;
        let output = std::process::Command::new("git")
            .args(["push", remote_name, branch])
            .current_dir(workdir)
            .output()
            .context("failed to run git push")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("git push failed: {stderr}");
        }
        return Ok(());
    }

    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(tok) = token {
        let tok = tok.to_string();
        callbacks.credentials(move |_, _, _| {
            git2::Cred::userpass_plaintext("x-access-token", &tok)
        });
    }
    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote
        .push(&[refspec.as_str()], Some(&mut opts))
        .context("push failed")?;
    Ok(())
}

pub fn clone_repo(url: &str, dest: &std::path::Path, token: Option<&str>) -> anyhow::Result<()> {
    if is_ssh_remote(url) {
        let output = std::process::Command::new("git")
            .args(["clone", url, dest.to_str().unwrap_or("")])
            .output()
            .context("failed to run git clone")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("git clone failed: {stderr}");
        }
        return Ok(());
    }

    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(tok) = token {
        let tok = tok.to_string();
        callbacks.credentials(move |_, _, _| {
            git2::Cred::userpass_plaintext("x-access-token", &tok)
        });
    }
    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch_opts);
    builder.clone(url, dest).context("clone failed")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known() -> Vec<String> {
        vec!["https://github.com".to_string()]
    }

    fn known_with_ghe() -> Vec<String> {
        vec![
            "https://github.com".to_string(),
            "https://ghe.corp.com".to_string(),
        ]
    }

    // ----- detect_remote_info / parse_remote_url -----

    #[test]
    fn parse_https_github_url() {
        let info = parse_remote_url("https://github.com/owner/repo.git", &known()).unwrap();
        assert_eq!(info.host, "github.com");
        assert_eq!(info.owner, "owner");
        assert_eq!(info.repo, "repo");
        assert_eq!(info.protocol, "https");
    }

    #[test]
    fn parse_https_github_url_no_dot_git() {
        let info = parse_remote_url("https://github.com/owner/repo", &known()).unwrap();
        assert_eq!(info.repo, "repo");
    }

    #[test]
    fn parse_ssh_github_url() {
        let info = parse_remote_url("git@github.com:owner/repo.git", &known()).unwrap();
        assert_eq!(info.host, "github.com");
        assert_eq!(info.owner, "owner");
        assert_eq!(info.repo, "repo");
        assert_eq!(info.protocol, "ssh");
    }

    #[test]
    fn parse_ghe_https_url() {
        let info = parse_remote_url("https://ghe.corp.com/owner/repo.git", &known_with_ghe()).unwrap();
        assert_eq!(info.host, "ghe.corp.com");
        assert_eq!(info.owner, "owner");
        assert_eq!(info.repo, "repo");
    }

    #[test]
    fn unknown_host_returns_error() {
        let result = parse_remote_url("https://gitlab.com/owner/repo.git", &known());
        assert!(result.is_err());
    }

    // ----- is_ssh_remote -----

    #[test]
    fn git_at_prefix_is_ssh() {
        assert!(is_ssh_remote("git@github.com:owner/repo.git"));
    }

    #[test]
    fn ssh_scheme_is_ssh() {
        assert!(is_ssh_remote("ssh://git@github.com/owner/repo.git"));
    }

    #[test]
    fn https_is_not_ssh() {
        assert!(!is_ssh_remote("https://github.com/owner/repo.git"));
    }
}
