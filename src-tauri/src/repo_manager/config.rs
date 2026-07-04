use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    pub path: PathBuf,
    pub name: String,
    pub pinned: bool,
    pub last_opened: u64,
}

/// Configuration for a single GitHub or GHE host.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubHostConfig {
    /// Base URL, e.g. "https://github.com" or "https://ghe.corp.com".
    pub base_url: String,
    /// Optional path to a CA bundle PEM file for self-signed TLS (GHE only).
    pub ca_bundle_path: Option<PathBuf>,
    /// OAuth client ID for this host. If None, the build-time GITHUB_OAUTH_CLIENT_ID env var is used.
    pub oauth_client_id: Option<String>,
}

impl GithubHostConfig {
    pub fn github_com() -> Self {
        Self {
            base_url: "https://github.com".to_string(),
            ca_bundle_path: None,
            oauth_client_id: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub recent_repos: Vec<RepoEntry>,
    pub last_repo_path: Option<PathBuf>,
    /// Repositories open as tabs, in tab order. Restored on launch.
    #[serde(default)]
    pub open_repos: Vec<PathBuf>,
    /// Which of `open_repos` is the active tab on launch.
    #[serde(default)]
    pub active_repo_path: Option<PathBuf>,
    #[serde(default = "default_github_hosts")]
    pub github_hosts: Vec<GithubHostConfig>,
    #[serde(default)]
    pub active_theme: Option<String>,
}

fn default_github_hosts() -> Vec<GithubHostConfig> {
    vec![GithubHostConfig::github_com()]
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            recent_repos: Vec::new(),
            last_repo_path: None,
            open_repos: Vec::new(),
            active_repo_path: None,
            github_hosts: default_github_hosts(),
            active_theme: None,
        }
    }
}

impl AppConfig {
    pub fn config_path() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("git-wasp").join("config.json"))
    }

    pub fn load() -> Self {
        let Some(path) = Self::config_path() else {
            return Self::default();
        };
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::config_path().ok_or_else(|| anyhow::anyhow!("no config dir"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;
        Ok(())
    }

    pub fn add_recent(&mut self, entry: RepoEntry) {
        self.recent_repos.retain(|r| r.path != entry.path);
        self.recent_repos.insert(0, entry.clone());
        self.recent_repos.truncate(10);
        self.last_repo_path = Some(entry.path);
    }

    /// Record the set of open tabs (in order) and which one is active, so the
    /// session can be restored on next launch.
    pub fn set_session(&mut self, open_repos: Vec<PathBuf>, active: Option<PathBuf>) {
        self.open_repos = open_repos;
        self.active_repo_path = active;
    }

    /// Drop a repository from the recent list (e.g. the user removed it). Only
    /// affects our reference to it; the repository on disk is untouched.
    pub fn remove_recent(&mut self, path: &Path) {
        self.recent_repos.retain(|r| r.path != path);
        if self.last_repo_path.as_deref() == Some(path) {
            self.last_repo_path = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_github_com_host() {
        let config = AppConfig::default();
        assert_eq!(config.github_hosts.len(), 1);
        assert_eq!(config.github_hosts[0].base_url, "https://github.com");
    }

    #[test]
    fn github_hosts_round_trips_json() {
        let mut config = AppConfig::default();
        config.github_hosts.push(GithubHostConfig {
            base_url: "https://ghe.corp.com".to_string(),
            ca_bundle_path: Some("/etc/ssl/corp-ca.pem".into()),
            oauth_client_id: Some("ghe-client-id".to_string()),
        });
        let json = serde_json::to_string(&config).unwrap();
        let restored: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.github_hosts.len(), 2);
        assert_eq!(restored.github_hosts[1].base_url, "https://ghe.corp.com");
        assert_eq!(
            restored.github_hosts[1].oauth_client_id,
            Some("ghe-client-id".to_string())
        );
    }

    #[test]
    fn legacy_config_without_github_hosts_gets_default() {
        let json = r#"{"recentRepos":[],"lastRepoPath":null}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.github_hosts.len(), 1);
        assert_eq!(config.github_hosts[0].base_url, "https://github.com");
    }

    #[test]
    fn unknown_legacy_workspace_fields_are_ignored() {
        // Old configs may still carry workspace keys; serde ignores unknown
        // fields, so loading them must succeed.
        let json = r#"{"recentRepos":[],"lastRepoPath":null,"workspaces":[{"id":"ws-1","name":"x","repoPaths":[]}],"activeWorkspaceId":"ws-1"}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.recent_repos.is_empty());
    }

    #[test]
    fn remove_recent_drops_the_entry_and_clears_last_when_it_matches() {
        let mut config = AppConfig::default();
        config.add_recent(RepoEntry {
            path: "/tmp/a".into(),
            name: "a".into(),
            pinned: false,
            last_opened: 0,
        });
        config.add_recent(RepoEntry {
            path: "/tmp/b".into(),
            name: "b".into(),
            pinned: false,
            last_opened: 0,
        });
        // last_repo_path is now "/tmp/b" (most recent).
        config.remove_recent(Path::new("/tmp/b"));
        assert_eq!(config.recent_repos.len(), 1);
        assert_eq!(config.recent_repos[0].path, PathBuf::from("/tmp/a"));
        assert_eq!(config.last_repo_path, None);

        // Removing a non-last entry leaves last_repo_path untouched.
        config.add_recent(RepoEntry {
            path: "/tmp/c".into(),
            name: "c".into(),
            pinned: false,
            last_opened: 0,
        });
        config.remove_recent(Path::new("/tmp/a"));
        assert_eq!(config.last_repo_path, Some(PathBuf::from("/tmp/c")));
    }

    #[test]
    fn session_fields_round_trip() {
        let mut config = AppConfig::default();
        config.set_session(
            vec!["/tmp/a".into(), "/tmp/b".into()],
            Some("/tmp/b".into()),
        );
        let restored: AppConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(
            restored.open_repos,
            vec![PathBuf::from("/tmp/a"), PathBuf::from("/tmp/b")]
        );
        assert_eq!(restored.active_repo_path, Some(PathBuf::from("/tmp/b")));
    }

    #[test]
    fn legacy_config_without_session_defaults_to_empty() {
        let json = r#"{"recentRepos":[],"lastRepoPath":null}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.open_repos.is_empty());
        assert_eq!(config.active_repo_path, None);
    }

    #[test]
    fn active_theme_round_trips_and_defaults_to_none() {
        let json = r#"{"recentRepos":[],"lastRepoPath":null}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.active_theme, None);

        let mut config = AppConfig::default();
        config.active_theme = Some("solar-light".to_string());
        let restored: AppConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(restored.active_theme, Some("solar-light".to_string()));
    }
}
