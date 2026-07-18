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
pub struct FetchResult {
    pub updated_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "status")]
pub enum PullResult {
    FastForwarded,
    AlreadyUpToDate,
    /// Divergent histories were merged into a new merge commit.
    Merged,
    /// A merge was started but produced conflicts; the merge editor takes over.
    Conflicts,
    /// The pull succeeded, but reapplying the auto-stashed local changes hit a
    /// conflict. The stash is kept so the user can resolve/apply it manually.
    StashReapplyConflict,
}

/// Result of a fetch + fast-forward attempt. `Diverged` is returned without
/// modifying the repository so the caller can decide how to reconcile.
#[derive(Debug)]
pub enum PullFfOutcome {
    AlreadyUpToDate,
    FastForwarded,
    Diverged {
        /// "remote/branch" shorthand to merge or rebase.
        remote_branch: String,
    },
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
pub fn detect_remote_info(repo: &Repository, known_hosts: &[String]) -> anyhow::Result<RemoteInfo> {
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

    Ok(RemoteInfo {
        host,
        owner,
        repo: repo_name,
        protocol: protocol.to_string(),
    })
}

/// Ahead/behind counts for one local branch against its configured upstream.
/// Errors when the branch doesn't exist or has no upstream configured —
/// callers (the `branch_ahead_behind` command) treat that as "nothing to
/// show" for this branch, same as the old bulk computation silently skipped
/// upstream-less branches.
pub fn branch_ahead_behind(repo: &Repository, branch_name: &str) -> anyhow::Result<(usize, usize)> {
    let branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .with_context(|| format!("branch not found: {branch_name}"))?;
    let upstream = branch
        .upstream()
        .with_context(|| format!("branch '{branch_name}' has no upstream"))?;
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
    repo.graph_ahead_behind(local_oid, upstream_oid)
        .context("failed to compute ahead/behind")
}

pub fn fetch(
    repo: &Repository,
    remote_name: &str,
    token: Option<&str>,
    prune: bool,
) -> anyhow::Result<FetchResult> {
    // Never log the token; "auth=token/none" records only whether one was used.
    log::info!(
        target: "git",
        "fetch: remote={remote_name} prune={prune} auth={}",
        if token.is_some() { "token" } else { "none" }
    );
    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let url = remote.url().unwrap_or("").to_string();

    if is_ssh_remote(&url) {
        log::debug!(target: "git", "fetch: ssh remote, using git CLI");
        return fetch_cli(repo, remote_name, prune);
    }

    let updated_refs = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let refs_cb = updated_refs.clone();
    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(tok) = token {
        let tok = tok.to_string();
        callbacks
            .credentials(move |_, _, _| git2::Cred::userpass_plaintext("x-access-token", &tok));
    }
    callbacks.update_tips(move |refname, _old, _new| {
        refs_cb.lock().unwrap().push(refname.to_string());
        true
    });
    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(callbacks);
    // Prune deletes remote-tracking refs whose remote branch is gone, which is
    // what makes those local branches detectable as prunable.
    if prune {
        opts.prune(git2::FetchPrune::On);
    }
    remote
        .fetch(&[] as &[&str], Some(&mut opts), None)
        .context("fetch failed")?;
    let refs = std::sync::Arc::try_unwrap(updated_refs)
        .unwrap_or_default()
        .into_inner()
        .unwrap_or_default();
    log::info!(target: "git", "fetch: remote={remote_name} ok ({} refs updated)", refs.len());
    Ok(FetchResult { updated_refs: refs })
}

fn fetch_cli(repo: &Repository, remote_name: &str, prune: bool) -> anyhow::Result<FetchResult> {
    let workdir = repo.workdir().context("bare repo not supported")?;
    let mut args = vec!["fetch"];
    if prune {
        args.push("--prune");
    }
    args.push("--");
    args.push(remote_name);
    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(workdir)
        .output()
        .context("failed to run git fetch")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git fetch failed: {stderr}");
    }
    Ok(FetchResult {
        updated_refs: Vec::new(),
    })
}

/// Fetches and fast-forwards `branch` to its upstream when possible. Returns
/// `Diverged` (leaving the repository untouched) when a fast-forward is not
/// possible, so the caller can choose to merge or rebase.
pub fn pull_ff(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    token: Option<&str>,
) -> anyhow::Result<PullFfOutcome> {
    log::info!(target: "git", "pull (ff): remote={remote_name} branch={branch}");
    fetch(repo, remote_name, token, false)?;

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
        log::info!(target: "git", "pull (ff): branch={branch} already up to date");
        return Ok(PullFfOutcome::AlreadyUpToDate);
    }

    // A fast-forward is only possible when the local branch has no commits the
    // upstream lacks.
    let (ahead, _behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
    if ahead > 0 {
        log::info!(
            target: "git",
            "pull (ff): branch={branch} diverged ({ahead} local commit(s) ahead) — needs merge/rebase"
        );
        return Ok(PullFfOutcome::Diverged {
            remote_branch: format!("{remote_name}/{branch}"),
        });
    }

    // Fast-forward. When this is the checked-out branch, update the working tree
    // and index to the upstream commit *before* moving the ref. Order matters:
    // HEAD is a symbolic ref to the branch, so moving the branch ref first would
    // make checkout's baseline (HEAD) equal the target, leaving the working tree
    // untouched while the index advances — every changed file would then read as
    // "modified". Checking out first (baseline = old HEAD) writes the files, then
    // we move the ref.
    let upstream_commit = repo.find_commit(upstream_oid)?;
    let is_current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.name().map(|n| n == local_ref.as_str()))
        .unwrap_or(false);

    if is_current_branch {
        crate::working_tree::safe_checkout_tree(repo, upstream_commit.as_object())?;
    }

    repo.reference(
        &local_ref,
        upstream_oid,
        true,
        &format!("Fast-forward to {upstream_ref}"),
    )?;

    log::info!(target: "git", "pull (ff): branch={branch} fast-forwarded to {upstream_oid}");
    Ok(PullFfOutcome::FastForwarded)
}

pub fn push(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    token: Option<&str>,
) -> anyhow::Result<()> {
    log::info!(
        target: "git",
        "push: remote={remote_name} branch={branch} auth={}",
        if token.is_some() { "token" } else { "none" }
    );
    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let url = remote.url().unwrap_or("").to_string();

    if is_ssh_remote(&url) {
        log::debug!(target: "git", "push: ssh remote, using git CLI");
        let workdir = repo.workdir().context("bare repo not supported")?;
        let output = std::process::Command::new("git")
            .args(["push", "--", remote_name, branch])
            .current_dir(workdir)
            .output()
            .context("failed to run git push")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("git push failed: {stderr}");
        }
        log::info!(target: "git", "push: remote={remote_name} branch={branch} ok (cli)");
        return Ok(());
    }

    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(tok) = token {
        let tok = tok.to_string();
        callbacks
            .credentials(move |_, _, _| git2::Cred::userpass_plaintext("x-access-token", &tok));
    }
    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote
        .push(&[refspec.as_str()], Some(&mut opts))
        .context("push failed")?;
    log::info!(target: "git", "push: remote={remote_name} branch={branch} ok");
    Ok(())
}

pub trait PushTransport {
    fn push(
        &self,
        repo: &Repository,
        remote_name: &str,
        branch: &str,
        token: Option<&str>,
    ) -> anyhow::Result<()>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultPushTransport;

impl PushTransport for DefaultPushTransport {
    fn push(
        &self,
        repo: &Repository,
        remote_name: &str,
        branch: &str,
        token: Option<&str>,
    ) -> anyhow::Result<()> {
        push(repo, remote_name, branch, token)
    }
}

pub fn remote_branch_oid(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    token: Option<&str>,
) -> anyhow::Result<git2::Oid> {
    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(token) = token {
        let token = token.to_string();
        callbacks
            .credentials(move |_, _, _| git2::Cred::userpass_plaintext("x-access-token", &token));
    }
    let connection = remote
        .connect_auth(git2::Direction::Fetch, Some(callbacks), None)
        .context("failed to connect to remote")?;
    let refname = format!("refs/heads/{branch}");
    Ok(connection
        .list()
        .context("failed to list remote refs")?
        .iter()
        .find(|head| head.name() == refname)
        .map(|head| head.oid())
        .unwrap_or_else(git2::Oid::zero))
}

pub fn ssh_push_command(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    pre_push_enabled: bool,
) -> anyhow::Result<std::process::Command> {
    let workdir = repo.workdir().context("bare repo not supported")?;
    let mut command = std::process::Command::new("git");
    command.arg("push");
    if !pre_push_enabled {
        command.arg("--no-verify");
    }
    command
        .arg("--")
        .arg(remote_name)
        .arg(branch)
        .current_dir(workdir);
    Ok(command)
}

/// Push an arbitrary refspec, choosing the git CLI for SSH remotes and git2 with
/// a token for HTTPS — mirroring [`push`]. Used by the tag push/delete ops.
fn push_refspec(
    repo: &Repository,
    remote_name: &str,
    refspec: &str,
    token: Option<&str>,
) -> anyhow::Result<()> {
    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let url = remote.url().unwrap_or("").to_string();

    if is_ssh_remote(&url) {
        let workdir = repo.workdir().context("bare repo not supported")?;
        let output = std::process::Command::new("git")
            .args(["push", "--", remote_name, refspec])
            .current_dir(workdir)
            .output()
            .context("failed to run git push")?;
        if !output.status.success() {
            anyhow::bail!(
                "git push failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        return Ok(());
    }

    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(tok) = token {
        let tok = tok.to_string();
        callbacks
            .credentials(move |_, _, _| git2::Cred::userpass_plaintext("x-access-token", &tok));
    }
    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(callbacks);
    remote
        .push(&[refspec], Some(&mut opts))
        .context("push failed")
}

/// Push a tag to the remote (`refs/tags/<tag>:refs/tags/<tag>`).
pub fn push_tag(
    repo: &Repository,
    remote_name: &str,
    tag: &str,
    token: Option<&str>,
) -> anyhow::Result<()> {
    log::info!(target: "git", "push tag: remote={remote_name} tag={tag}");
    push_refspec(
        repo,
        remote_name,
        &format!("refs/tags/{tag}:refs/tags/{tag}"),
        token,
    )
}

/// Delete a tag on the remote (push the empty side: `:refs/tags/<tag>`).
pub fn delete_remote_tag(
    repo: &Repository,
    remote_name: &str,
    tag: &str,
    token: Option<&str>,
) -> anyhow::Result<()> {
    log::info!(target: "git", "delete remote tag: remote={remote_name} tag={tag}");
    push_refspec(repo, remote_name, &format!(":refs/tags/{tag}"), token)
}

/// `refs/tags/x` → `Some("x")`; ignores non-tags and peeled `^{}` entries.
fn tag_short_name(refname: &str) -> Option<String> {
    let name = refname.strip_prefix("refs/tags/")?;
    if name.ends_with("^{}") {
        return None;
    }
    Some(name.to_string())
}

/// Tag short-names from `git ls-remote --tags` output (lines `<sha>\t<ref>`).
fn parse_ls_remote_tags(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| tag_short_name(line.split('\t').nth(1)?))
        .collect()
}

/// The tag short-names present on `remote` — for the local/remote/both indicator.
/// git2 (with token) for HTTPS, the git CLI for SSH.
pub fn list_remote_tags(
    repo: &Repository,
    remote_name: &str,
    token: Option<&str>,
) -> anyhow::Result<Vec<String>> {
    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("remote '{remote_name}' not found"))?;
    let url = remote.url().unwrap_or("").to_string();

    if is_ssh_remote(&url) {
        let workdir = repo.workdir().context("bare repo not supported")?;
        let output = std::process::Command::new("git")
            .args(["ls-remote", "--tags", "--", remote_name])
            .current_dir(workdir)
            .output()
            .context("failed to run git ls-remote")?;
        if !output.status.success() {
            anyhow::bail!(
                "git ls-remote failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        return Ok(parse_ls_remote_tags(&String::from_utf8_lossy(
            &output.stdout,
        )));
    }

    let mut callbacks = git2::RemoteCallbacks::new();
    if let Some(tok) = token {
        let tok = tok.to_string();
        callbacks
            .credentials(move |_, _, _| git2::Cred::userpass_plaintext("x-access-token", &tok));
    }
    let conn = remote
        .connect_auth(git2::Direction::Fetch, Some(callbacks), None)
        .context("failed to connect to remote")?;
    let tags = conn
        .list()
        .context("failed to list remote refs")?
        .iter()
        .filter_map(|h| tag_short_name(h.name()))
        .collect();
    Ok(tags)
}

pub fn clone_repo(url: &str, dest: &std::path::Path, token: Option<&str>) -> anyhow::Result<()> {
    if is_ssh_remote(url) {
        let output = std::process::Command::new("git")
            .args(["clone", "--", url, dest.to_str().unwrap_or("")])
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
        callbacks
            .credentials(move |_, _, _| git2::Cred::userpass_plaintext("x-access-token", &tok));
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

    // ----- CLI passthrough argument injection hardening -----

    #[test]
    fn fetch_cli_treats_a_dash_prefixed_remote_name_as_a_literal_name_not_a_flag() {
        // A remote literally named "-o" would previously be parsed by `git
        // fetch` as an option rather than a remote name. After the `--`
        // separator fix, it should fail with git's "no such remote" (or
        // similar) rather than a flag-parsing error, proving the name reached
        // git as a positional arg.
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let result = fetch_cli(&repo, "-o", false);
        let err = result.unwrap_err().to_string().to_lowercase();
        assert!(
            !err.contains("switch") && !err.contains("requires a value") && !err.contains("unknown option"),
            "expected a 'remote not found'-style error, got a flag-parsing error: {err}"
        );
    }

    // ----- tag ref parsing -----

    #[test]
    fn parse_ls_remote_tags_extracts_names_and_drops_peeled() {
        let stdout = "\
abc123\trefs/tags/v1.0\n\
def456\trefs/tags/v1.0^{}\n\
789abc\trefs/tags/v2.0\n\
000000\trefs/heads/main\n";
        assert_eq!(
            parse_ls_remote_tags(stdout),
            vec!["v1.0".to_string(), "v2.0".to_string()]
        );
    }

    #[test]
    fn tag_short_name_strips_prefix_and_ignores_non_tags() {
        assert_eq!(tag_short_name("refs/tags/v1.0").as_deref(), Some("v1.0"));
        assert_eq!(tag_short_name("refs/tags/v1.0^{}"), None);
        assert_eq!(tag_short_name("refs/heads/main"), None);
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
        let info =
            parse_remote_url("https://ghe.corp.com/owner/repo.git", &known_with_ghe()).unwrap();
        assert_eq!(info.host, "ghe.corp.com");
        assert_eq!(info.owner, "owner");
        assert_eq!(info.repo, "repo");
    }

    #[test]
    fn unknown_host_returns_error() {
        let result = parse_remote_url("https://gitlab.com/owner/repo.git", &known());
        assert!(result.is_err());
    }

    // ----- branch_ahead_behind -----

    #[test]
    fn branch_ahead_behind_counts_local_and_upstream_commits() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();

        let base_tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let base_tree = repo.find_tree(base_tree_id).unwrap();
        let base_oid = repo
            .commit(Some("HEAD"), &sig, &sig, "base", &base_tree, &[])
            .unwrap();
        let base_commit = repo.find_commit(base_oid).unwrap();
        let head_branch_name = repo.head().unwrap().shorthand().unwrap().to_string();

        // Remote-tracking ref, configured as the local branch's upstream.
        // `set_upstream` needs a matching remote to resolve "origin/main"
        // against, hence the (unfetchable, never contacted) remote below.
        repo.remote("origin", "https://example.invalid/repo.git")
            .unwrap();
        repo.reference("refs/remotes/origin/main", base_oid, true, "set up")
            .unwrap();
        repo.find_branch(&head_branch_name, git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some("origin/main"))
            .unwrap();

        // Local gets 1 commit ahead.
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        let local_tree = repo.find_tree(head_commit.tree_id()).unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "local work",
            &local_tree,
            &[&head_commit],
        )
        .unwrap();

        // Upstream diverges with 2 commits of its own.
        let mut upstream_tip = base_commit;
        for i in 0..2 {
            let t = repo.find_tree(upstream_tip.tree_id()).unwrap();
            let oid = repo
                .commit(
                    None,
                    &sig,
                    &sig,
                    &format!("upstream {i}"),
                    &t,
                    &[&upstream_tip],
                )
                .unwrap();
            upstream_tip = repo.find_commit(oid).unwrap();
        }
        repo.reference(
            "refs/remotes/origin/main",
            upstream_tip.id(),
            true,
            "advance",
        )
        .unwrap();

        let (ahead, behind) = branch_ahead_behind(&repo, &head_branch_name).unwrap();
        assert_eq!(ahead, 1);
        assert_eq!(behind, 2);
    }

    #[test]
    fn branch_ahead_behind_errors_when_branch_has_no_upstream() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "base", &tree, &[])
            .unwrap();
        let head_branch_name = repo.head().unwrap().shorthand().unwrap().to_string();

        assert!(branch_ahead_behind(&repo, &head_branch_name).is_err());
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

    // ----- pull_ff (fetch + fast-forward analysis) -----

    use git2::Signature;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn bare_remote() -> TempDir {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init_bare(dir.path()).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree = repo
            .find_tree(repo.treebuilder(None).unwrap().write().unwrap())
            .unwrap();
        repo.commit(Some("refs/heads/main"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        repo.set_head("refs/heads/main").unwrap();
        dir
    }

    fn clone(remote: &Path, dest: &Path) -> Repository {
        let repo = git2::build::RepoBuilder::new()
            .clone(remote.to_str().unwrap(), dest)
            .unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        repo
    }

    /// Adds a commit to `branch` reusing the parent tree (works for bare repos).
    fn advance(repo_path: &Path, branch: &str) -> git2::Oid {
        let repo = Repository::open(repo_path).unwrap();
        let branch_ref = format!("refs/heads/{branch}");
        let parent = repo
            .find_reference(&branch_ref)
            .unwrap()
            .peel_to_commit()
            .unwrap();
        let tree = parent.tree().unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some(&branch_ref), &sig, &sig, "advance", &tree, &[&parent])
            .unwrap()
    }

    /// Adds a commit to the remote `branch` that creates a file, so a
    /// fast-forward must materialise it in the working tree.
    fn advance_with_file(repo_path: &Path, branch: &str, name: &str, content: &str) -> git2::Oid {
        let repo = Repository::open(repo_path).unwrap();
        let branch_ref = format!("refs/heads/{branch}");
        let parent = repo
            .find_reference(&branch_ref)
            .unwrap()
            .peel_to_commit()
            .unwrap();
        let blob = repo.blob(content.as_bytes()).unwrap();
        let mut builder = repo.treebuilder(Some(&parent.tree().unwrap())).unwrap();
        builder.insert(name, blob, 0o100644).unwrap();
        let tree = repo.find_tree(builder.write().unwrap()).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some(&branch_ref), &sig, &sig, "add file", &tree, &[&parent])
            .unwrap()
    }

    /// Commits a working-tree file onto the local clone's current HEAD.
    fn commit_local(repo: &Repository, work_dir: &Path, name: &str, content: &str) -> git2::Oid {
        fs::write(work_dir.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "local change", &tree, &[&parent])
            .unwrap()
    }

    #[test]
    fn pull_ff_reports_already_up_to_date() {
        let remote = bare_remote();
        let local = TempDir::new().unwrap();
        let repo = clone(remote.path(), local.path());

        let outcome = pull_ff(&repo, "origin", "main", None).unwrap();
        assert!(matches!(outcome, PullFfOutcome::AlreadyUpToDate));
    }

    #[test]
    fn pull_ff_fast_forwards_when_behind() {
        let remote = bare_remote();
        let local = TempDir::new().unwrap();
        let repo = clone(remote.path(), local.path());

        let new_oid = advance(remote.path(), "main");

        let outcome = pull_ff(&repo, "origin", "main", None).unwrap();
        assert!(matches!(outcome, PullFfOutcome::FastForwarded));
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), new_oid);
    }

    #[test]
    fn pull_ff_materialises_new_files_and_leaves_a_clean_tree() {
        // Regression: a fast-forward used to move the branch ref before checking
        // out the new tree, so (HEAD being symbolic) the checkout baseline equalled
        // the target and the working tree was never updated — leaving every changed
        // file reading as "modified". The working tree must match the new commit
        // and be clean after a fast-forward.
        let remote = bare_remote();
        let local = TempDir::new().unwrap();
        let repo = clone(remote.path(), local.path());

        advance_with_file(remote.path(), "main", "added.txt", "hello\n");

        let outcome = pull_ff(&repo, "origin", "main", None).unwrap();
        assert!(matches!(outcome, PullFfOutcome::FastForwarded));

        // The upstream's new file is written into the working tree... (normalise
        // line endings: a Windows checkout with core.autocrlf=true writes CRLF).
        let contents = fs::read_to_string(local.path().join("added.txt")).unwrap();
        assert_eq!(contents.replace("\r\n", "\n"), "hello\n");

        // ...and there are no spurious staged/unstaged changes.
        let status = crate::working_tree::get_working_tree_status(&repo).unwrap();
        assert!(
            status.staged.is_empty(),
            "unexpected staged: {:?}",
            status.staged
        );
        assert!(
            status.unstaged.is_empty(),
            "unexpected unstaged: {:?}",
            status.unstaged
        );
        assert!(
            status.untracked.is_empty(),
            "unexpected untracked: {:?}",
            status.untracked
        );
    }

    #[test]
    fn pull_ff_reports_diverged() {
        let remote = bare_remote();
        let local = TempDir::new().unwrap();
        let repo = clone(remote.path(), local.path());

        advance(remote.path(), "main"); // upstream moves ahead
        commit_local(&repo, local.path(), "local.txt", "local work"); // local moves ahead too

        let outcome = pull_ff(&repo, "origin", "main", None).unwrap();
        match outcome {
            PullFfOutcome::Diverged { remote_branch } => assert_eq!(remote_branch, "origin/main"),
            other => panic!("expected Diverged, got {other:?}"),
        }
    }
}
