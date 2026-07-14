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
///
/// For every index but 0, store runs *before* drop: storing the same commit
/// under a new message while the original entry still exists is safe (it just
/// writes a new reflog entry), so if store fails the original is untouched —
/// no window where the stash exists nowhere. Index 0 can't use that ordering:
/// `git stash store` is a true no-op (exit 0, no new reflog entry) when the
/// given oid already equals the *current* stash@{0}, which is exactly the case
/// when renaming the top entry — so drop must run first there to force a real
/// store afterward, keeping the (documented, narrow) failure window for that
/// one case.
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

    let run_store = || -> anyhow::Result<()> {
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
    };
    let run_drop = |target_index: usize| -> anyhow::Result<()> {
        let drop = std::process::Command::new("git")
            .args(["stash", "drop", &format!("stash@{{{target_index}}}")])
            .current_dir(workdir)
            .output()
            .context("failed to run git stash drop")?;
        if !drop.status.success() {
            anyhow::bail!(
                "git stash drop failed: {}",
                String::from_utf8_lossy(&drop.stderr).trim()
            );
        }
        Ok(())
    };

    if index == 0 {
        run_drop(0)?;
        run_store()?;
    } else {
        run_store()?;
        // The store above pushed a new stash@{0} referencing the same commit,
        // shifting the original up to stash@{index + 1}.
        run_drop(index + 1)?;
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

    #[test]
    fn stash_rename_keeps_exactly_one_entry_per_stash_when_renaming_a_non_top_entry() {
        // Renaming stash@{1} (not the top of the stack) exercises the index
        // arithmetic: `git stash store` always inserts at stash@{0}, so the
        // entry being renamed shifts by one *regardless* of which index it
        // started at. If that shift is miscounted, the rename either drops the
        // wrong entry (losing a stash) or leaves a duplicate behind.
        let (dir, mut repo) = init_repo();
        commit_file(&repo, &dir, "file.txt", "original\n");
        fs::write(dir.path().join("file.txt"), "older change\n").unwrap();
        stash_save(&mut repo, Some("older stash")).unwrap();
        fs::write(dir.path().join("file.txt"), "newer change\n").unwrap();
        stash_save(&mut repo, Some("newer stash")).unwrap();

        // stash@{0} = "newer stash", stash@{1} = "older stash".
        let older_oid = stash_list(&mut repo).unwrap()[1].oid.clone();

        stash_rename(&mut repo, 1, "renamed older stash").unwrap();

        let entries = stash_list(&mut repo).unwrap();
        assert_eq!(entries.len(), 2, "no stash should be lost or duplicated");
        assert!(
            entries.iter().any(|e| e.oid == older_oid
                && e.message.contains("renamed older stash")),
            "the renamed entry must keep its original commit and carry the new message"
        );
        assert!(
            entries.iter().any(|e| e.message.contains("newer stash")),
            "the untouched stash must survive unchanged"
        );
    }
}
