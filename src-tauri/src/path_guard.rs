use std::path::Path;

/// Rejects any path that isn't a plain repo-relative path: absolute paths and
/// paths containing a `..` component would escape the working directory once
/// joined onto it. Every Tauri command that turns a frontend-supplied string
/// into a filesystem path must call this first — the IPC boundary is the
/// app's trust boundary, not the operating system's.
pub fn validate_repo_relative(path: &str) -> anyhow::Result<()> {
    let rel = Path::new(path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| c == std::path::Component::ParentDir)
    {
        anyhow::bail!("refusing to operate on path outside the repository: {path}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_relative_path() {
        assert!(validate_repo_relative("src/main.rs").is_ok());
    }

    #[test]
    fn accepts_relative_path_with_dots_in_filename() {
        // Regression guard: must not reject legitimate filenames that merely
        // contain "..", only an actual ParentDir path component.
        assert!(validate_repo_relative("app/[id]..bak.tsx").is_ok());
    }

    #[test]
    fn rejects_absolute_path() {
        assert!(validate_repo_relative("/etc/passwd").is_err());
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        assert!(validate_repo_relative("../../etc/passwd").is_err());
        assert!(validate_repo_relative("a/../../b").is_err());
    }
}
