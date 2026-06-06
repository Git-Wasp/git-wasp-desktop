use anyhow::Context;
use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

pub fn stash_save(repo: &mut Repository, message: Option<&str>) -> anyhow::Result<StashEntry> {
    let sig = repo.signature().context(
        "Git user identity not configured. Set user.name and user.email in your .gitconfig.",
    )?;
    let msg = message.unwrap_or("WIP");
    let oid = repo
        .stash_save(&sig, msg, None)
        .context("nothing to stash — working tree is clean")?;
    Ok(StashEntry { index: 0, message: msg.to_string(), oid: oid.to_string() })
}

pub fn stash_list(repo: &mut Repository) -> anyhow::Result<Vec<StashEntry>> {
    let mut entries = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        entries.push(StashEntry {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true
    })
    .context("failed to list stashes")?;
    Ok(entries)
}

pub fn stash_apply(repo: &mut Repository, index: usize) -> anyhow::Result<()> {
    repo.stash_apply(index, None).context("failed to apply stash")
}

pub fn stash_pop(repo: &mut Repository, index: usize) -> anyhow::Result<()> {
    repo.stash_pop(index, None).context("failed to pop stash")
}

pub fn stash_drop(repo: &mut Repository, index: usize) -> anyhow::Result<()> {
    repo.stash_drop(index).context("failed to drop stash")
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::{fs, path::Path};
    use tempfile::TempDir;

    fn normalise(s: &str) -> String {
        s.replace("\r\n", "\n")
    }

    fn init_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        (dir, repo)
    }

    fn commit_file(repo: &Repository, dir: &TempDir, name: &str, content: &str) {
        let path = dir.path().join(name);
        fs::write(&path, content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, "commit", &tree, &parents).unwrap();
        drop(tree);
    }

    #[test]
    fn stash_save_clears_working_tree() {
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "file.txt", "original\n");
        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        stash_save(&mut repo, Some("my stash")).unwrap();
        let content = fs::read_to_string(dir.path().join("file.txt")).unwrap();
        assert_eq!(normalise(&content), "original\n");
    }

    #[test]
    fn stash_list_returns_saved_entries() {
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "file.txt", "original\n");
        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        stash_save(&mut repo, Some("stash one")).unwrap();
        let entries = stash_list(&mut repo).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn stash_pop_applies_and_removes() {
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "file.txt", "original\n");
        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        stash_save(&mut repo, Some("stash")).unwrap();
        stash_pop(&mut repo, 0).unwrap();
        let content = fs::read_to_string(dir.path().join("file.txt")).unwrap();
        assert_eq!(normalise(&content), "modified\n");
        let entries = stash_list(&mut repo).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn stash_drop_removes_entry() {
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "file.txt", "original\n");
        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        stash_save(&mut repo, Some("stash")).unwrap();
        stash_drop(&mut repo, 0).unwrap();
        let entries = stash_list(&mut repo).unwrap();
        assert!(entries.is_empty());
    }
}
