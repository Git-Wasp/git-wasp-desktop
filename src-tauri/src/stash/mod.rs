use anyhow::Context;
use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
    /// The commit the stash was created on (the stash commit's first parent),
    /// so the graph can draw the stash hanging off that commit. `None` if it
    /// can't be resolved.
    #[serde(default)]
    pub base_oid: Option<String>,
}

pub fn stash_save(repo: &mut Repository, message: Option<&str>) -> anyhow::Result<StashEntry> {
    let sig = repo.signature().context(
        "Git user identity not configured. Set user.name and user.email in your .gitconfig.",
    )?;
    let msg = message.unwrap_or("WIP");
    let oid = repo
        .stash_save(&sig, msg, None)
        .context("nothing to stash — working tree is clean")?;
    let base_oid = repo
        .find_commit(oid)
        .ok()
        .and_then(|c| c.parent_id(0).ok())
        .map(|p| p.to_string());
    Ok(StashEntry {
        index: 0,
        message: msg.to_string(),
        oid: oid.to_string(),
        base_oid,
    })
}

pub fn stash_list(repo: &mut Repository) -> anyhow::Result<Vec<StashEntry>> {
    // Collect raw entries first — the foreach closure borrows `repo`, so the
    // base-commit lookups happen after it returns.
    let mut raw: Vec<(usize, String, git2::Oid)> = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        raw.push((index, message.to_string(), *oid));
        true
    })
    .context("failed to list stashes")?;

    Ok(raw
        .into_iter()
        .map(|(index, message, oid)| {
            let base_oid = repo
                .find_commit(oid)
                .ok()
                .and_then(|c| c.parent_id(0).ok())
                .map(|p| p.to_string());
            StashEntry {
                index,
                message,
                oid: oid.to_string(),
                base_oid,
            }
        })
        .collect())
}

/// Rename a stash. Git has no native rename, so re-store the same stash commit
/// with the new message and drop the original — note this moves the renamed
/// stash to the top (stash@{0}). Uses the `git` CLI (the sanctioned fallback for
/// gaps in git2; `git stash store` has no libgit2 equivalent).
pub fn stash_rename(repo: &mut Repository, index: usize, message: &str) -> anyhow::Result<()> {
    let oid = {
        let entries = stash_list(repo)?;
        entries
            .get(index)
            .context("stash index out of range")?
            .oid
            .clone()
    };
    let workdir = repo
        .workdir()
        .context("bare repositories have no working tree")?;
    // Drop the entry first, then re-store the same commit with the new message —
    // storing it while it's still the current stash@{0} is a no-op that adds no
    // reflog entry. The commit object survives the drop, so re-storing is safe.
    let drop = std::process::Command::new("git")
        .args(["stash", "drop", &format!("stash@{{{index}}}")])
        .current_dir(workdir)
        .output()
        .context("failed to run git stash drop")?;
    if !drop.status.success() {
        anyhow::bail!(
            "git stash drop failed: {}",
            String::from_utf8_lossy(&drop.stderr).trim()
        );
    }
    let store = std::process::Command::new("git")
        .args(["stash", "store", "-m", message, &oid])
        .current_dir(workdir)
        .output()
        .context("failed to run git stash store")?;
    if !store.status.success() {
        anyhow::bail!(
            "git stash store failed: {}",
            String::from_utf8_lossy(&store.stderr).trim()
        );
    }
    Ok(())
}

pub fn stash_apply(repo: &mut Repository, index: usize) -> anyhow::Result<()> {
    repo.stash_apply(index, None)
        .context("failed to apply stash")
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
        repo.commit(Some("HEAD"), &sig, &sig, "commit", &tree, &parents)
            .unwrap();
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

    #[test]
    fn stash_entry_carries_its_base_commit() {
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "file.txt", "original\n");
        let head = repo.head().unwrap().target().unwrap().to_string();
        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        stash_save(&mut repo, Some("stash")).unwrap();

        let entries = stash_list(&mut repo).unwrap();
        assert_eq!(entries[0].base_oid.as_deref(), Some(head.as_str()));
    }

    #[test]
    fn stash_rename_changes_the_message_keeping_the_commit() {
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "file.txt", "original\n");
        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        stash_save(&mut repo, Some("old name")).unwrap();
        let original_oid = stash_list(&mut repo).unwrap()[0].oid.clone();

        stash_rename(&mut repo, 0, "new name").unwrap();

        let entries = stash_list(&mut repo).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].message.contains("new name"));
        // Same underlying stash commit — no data lost in the rename.
        assert_eq!(entries[0].oid, original_oid);
    }
}
