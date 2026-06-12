use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
        Self { base_url: "https://github.com".to_string(), ca_bundle_path: None, oauth_client_id: None }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub recent_repos: Vec<RepoEntry>,
    pub last_repo_path: Option<PathBuf>,
    #[serde(default = "default_github_hosts")]
    pub github_hosts: Vec<GithubHostConfig>,
}

fn default_github_hosts() -> Vec<GithubHostConfig> {
    vec![GithubHostConfig::github_com()]
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            recent_repos: Vec::new(),
            last_repo_path: None,
            github_hosts: default_github_hosts(),
        }
    }
}

impl AppConfig {
    pub fn config_path() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("gitclient").join("config.json"))
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
    fn default_config_has_no_workspaces() {
        let config = AppConfig::default();
        assert!(config.workspaces.is_empty());
        assert_eq!(config.active_workspace_id, None);
    }

    #[test]
    fn workspace_round_trips_json() {
        let mut config = AppConfig::default();
        config.workspaces.push(Workspace {
            id: "ws-1".to_string(),
            name: "My Workspace".to_string(),
            repo_paths: vec![PathBuf::from("/repos/a"), PathBuf::from("/repos/b")],
        });
        config.active_workspace_id = Some("ws-1".to_string());

        let json = serde_json::to_string(&config).unwrap();
        let restored: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.workspaces.len(), 1);
        assert_eq!(restored.workspaces[0].id, "ws-1");
        assert_eq!(restored.workspaces[0].name, "My Workspace");
        assert_eq!(
            restored.workspaces[0].repo_paths,
            vec![PathBuf::from("/repos/a"), PathBuf::from("/repos/b")]
        );
        assert_eq!(restored.active_workspace_id, Some("ws-1".to_string()));
    }

    #[test]
    fn legacy_config_without_workspaces_gets_default() {
        let json = r#"{"recentRepos":[],"lastRepoPath":null}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.workspaces.is_empty());
        assert_eq!(config.active_workspace_id, None);
    }
}
