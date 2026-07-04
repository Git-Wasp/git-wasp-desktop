use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Parsed metadata + content for a custom theme file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeManifest {
    /// Filename stem, used as the stable id.
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub version: Option<String>,
    /// "light" or "dark" — drives the editor syntax theme. Defaults to "dark".
    pub appearance: String,
    pub css: String,
}

/// `~/.config/git-wasp/themes` (platform config dir).
pub fn themes_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("git-wasp").join("themes"))
}

/// Parses the leading `/* ==Theme== ... */` comment block for `key: value`
/// metadata. Unknown keys are ignored; `name` falls back to the id and
/// `appearance` defaults to "dark".
pub fn parse_manifest(id: &str, css: &str) -> ThemeManifest {
    let mut name: Option<String> = None;
    let mut author: Option<String> = None;
    let mut version: Option<String> = None;
    let mut appearance: Option<String> = None;

    if let Some(start) = css.find("/*") {
        if let Some(end_rel) = css[start..].find("*/") {
            let block = &css[start + 2..start + end_rel];
            for line in block.lines() {
                let line = line.trim().trim_start_matches('*').trim();
                let Some((key, value)) = line.split_once(':') else {
                    continue;
                };
                let value = value.trim().to_string();
                if value.is_empty() {
                    continue;
                }
                match key.trim().to_ascii_lowercase().as_str() {
                    "name" => name = Some(value),
                    "author" => author = Some(value),
                    "version" => version = Some(value),
                    "appearance" => appearance = Some(value.to_ascii_lowercase()),
                    _ => {}
                }
            }
        }
    }

    let appearance = match appearance.as_deref() {
        Some("light") => "light".to_string(),
        _ => "dark".to_string(),
    };

    ThemeManifest {
        id: id.to_string(),
        name: name.unwrap_or_else(|| id.to_string()),
        author,
        version,
        appearance,
        css: css.to_string(),
    }
}

/// A theme file must define at least one design token to be usable.
fn validate_css(css: &str) -> Result<()> {
    if !css.contains("--color-") {
        bail!("not a valid theme: no --color-* custom properties found");
    }
    Ok(())
}

/// Lists the custom themes in `dir`, skipping unreadable/invalid files.
pub fn list_themes_in(dir: &Path) -> Result<Vec<ThemeManifest>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut themes = Vec::new();
    for entry in std::fs::read_dir(dir).context("reading themes directory")? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("css") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(css) = std::fs::read_to_string(&path) else {
            continue;
        };
        if validate_css(&css).is_err() {
            continue;
        }
        themes.push(parse_manifest(id, &css));
    }
    themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(themes)
}

/// Validates a `.css` file and copies it into `dir`, returning its manifest.
pub fn import_theme_into(dir: &Path, src: &Path) -> Result<ThemeManifest> {
    let css = std::fs::read_to_string(src).context("reading theme file")?;
    validate_css(&css)?;

    let id = src
        .file_stem()
        .and_then(|s| s.to_str())
        .context("theme file has no name")?
        .to_string();

    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(format!("{id}.css")), &css)?;

    Ok(parse_manifest(&id, &css))
}

/// Removes a custom theme file by id from `dir`.
pub fn delete_theme_in(dir: &Path, id: &str) -> Result<()> {
    let path = dir.join(format!("{id}.css"));
    if path.exists() {
        std::fs::remove_file(&path).context("deleting theme file")?;
    }
    Ok(())
}

// Public wrappers resolving the real themes directory, used by the command layer.

pub fn list_themes() -> Result<Vec<ThemeManifest>> {
    match themes_dir() {
        Some(dir) => list_themes_in(&dir),
        None => Ok(Vec::new()),
    }
}

pub fn import_theme(src: &Path) -> Result<ThemeManifest> {
    let dir = themes_dir().context("no config directory")?;
    import_theme_into(&dir, src)
}

pub fn delete_theme(id: &str) -> Result<()> {
    let dir = themes_dir().context("no config directory")?;
    delete_theme_in(&dir, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "/* ==Theme==\n   name: Solar Light\n   author: Jane\n   version: 1.2.0\n   appearance: light\n*/\n:root { --color-bg-app: #fff; }";

    #[test]
    fn parse_manifest_extracts_all_fields() {
        let m = parse_manifest("solar-light", SAMPLE);
        assert_eq!(m.id, "solar-light");
        assert_eq!(m.name, "Solar Light");
        assert_eq!(m.author.as_deref(), Some("Jane"));
        assert_eq!(m.version.as_deref(), Some("1.2.0"));
        assert_eq!(m.appearance, "light");
    }

    #[test]
    fn parse_manifest_applies_defaults() {
        let m = parse_manifest("plain", ":root { --color-bg-app: #000; }");
        assert_eq!(m.name, "plain"); // falls back to id
        assert_eq!(m.author, None);
        assert_eq!(m.appearance, "dark"); // default
    }

    #[test]
    fn validate_rejects_css_without_tokens() {
        assert!(validate_css("body { color: red; }").is_err());
        assert!(validate_css(":root { --color-bg-app: #fff; }").is_ok());
    }

    #[test]
    fn import_then_list_round_trips() {
        let store = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let src = src_dir.path().join("my-theme.css");
        std::fs::write(&src, SAMPLE).unwrap();

        let imported = import_theme_into(store.path(), &src).unwrap();
        assert_eq!(imported.id, "my-theme");
        assert_eq!(imported.name, "Solar Light");

        let listed = list_themes_in(store.path()).unwrap();
        assert!(listed.iter().any(|t| t.id == "my-theme"));

        delete_theme_in(store.path(), "my-theme").unwrap();
        let after = list_themes_in(store.path()).unwrap();
        assert!(!after.iter().any(|t| t.id == "my-theme"));
    }

    #[test]
    fn import_rejects_invalid_css() {
        let store = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let src = src_dir.path().join("bad.css");
        std::fs::write(&src, "body { color: red; }").unwrap();
        assert!(import_theme_into(store.path(), &src).is_err());
    }

    #[test]
    fn list_skips_non_css_and_invalid_files() {
        let store = tempfile::tempdir().unwrap();
        std::fs::write(store.path().join("good.css"), SAMPLE).unwrap();
        std::fs::write(store.path().join("notes.txt"), "ignore me").unwrap();
        std::fs::write(store.path().join("bad.css"), "body{}").unwrap();

        let listed = list_themes_in(store.path()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "good");
    }
}
