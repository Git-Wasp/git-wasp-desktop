pub trait CredentialStore: Send + Sync {
    fn store(&self, host: &str, token: &str) -> anyhow::Result<()>;
    fn load(&self, host: &str) -> anyhow::Result<Option<String>>;
    fn delete(&self, host: &str) -> anyhow::Result<()>;
}

pub struct KeyringStore;

impl CredentialStore for KeyringStore {
    fn store(&self, host: &str, token: &str) -> anyhow::Result<()> {
        keyring::Entry::new("gitclient", host)
            .map_err(|e| anyhow::anyhow!("keyring error: {e}"))?
            .set_password(token)
            .map_err(|e| anyhow::anyhow!("failed to store credential for {host}: {e}"))
    }

    fn load(&self, host: &str) -> anyhow::Result<Option<String>> {
        let entry = keyring::Entry::new("gitclient", host)
            .map_err(|e| anyhow::anyhow!("keyring error: {e}"))?;
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(anyhow::anyhow!("failed to load credential for {host}: {e}")),
        }
    }

    fn delete(&self, host: &str) -> anyhow::Result<()> {
        let entry = keyring::Entry::new("gitclient", host)
            .map_err(|e| anyhow::anyhow!("keyring error: {e}"))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("failed to delete credential for {host}: {e}")),
        }
    }
}

pub struct InMemoryStore {
    entries: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self { entries: std::sync::Mutex::new(std::collections::HashMap::new()) }
    }
}

impl CredentialStore for InMemoryStore {
    fn store(&self, host: &str, token: &str) -> anyhow::Result<()> {
        self.entries.lock().unwrap().insert(host.to_string(), token.to_string());
        Ok(())
    }

    fn load(&self, host: &str) -> anyhow::Result<Option<String>> {
        Ok(self.entries.lock().unwrap().get(host).cloned())
    }

    fn delete(&self, host: &str) -> anyhow::Result<()> {
        self.entries.lock().unwrap().remove(host);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> InMemoryStore {
        InMemoryStore::new()
    }

    #[test]
    fn store_and_load_roundtrip() {
        let s = store();
        s.store("github.com", "tok_abc123").unwrap();
        assert_eq!(s.load("github.com").unwrap(), Some("tok_abc123".to_string()));
    }

    #[test]
    fn load_missing_returns_none() {
        let s = store();
        assert_eq!(s.load("github.com").unwrap(), None);
    }

    #[test]
    fn delete_removes_entry() {
        let s = store();
        s.store("github.com", "tok_abc123").unwrap();
        s.delete("github.com").unwrap();
        assert_eq!(s.load("github.com").unwrap(), None);
    }

    #[test]
    fn delete_nonexistent_is_ok() {
        let s = store();
        assert!(s.delete("github.com").is_ok());
    }

    #[test]
    fn different_hosts_are_isolated() {
        let s = store();
        s.store("github.com", "token_gh").unwrap();
        s.store("ghe.corp.com", "token_ghe").unwrap();
        assert_eq!(s.load("github.com").unwrap(), Some("token_gh".to_string()));
        assert_eq!(s.load("ghe.corp.com").unwrap(), Some("token_ghe".to_string()));
    }
}
