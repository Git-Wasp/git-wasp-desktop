//! Gravatar avatars for commit authors, with an on-disk cache.
//!
//! Avatars are fetched once per email and cached to the OS cache directory so
//! they survive app restarts and are never re-fetched while fresh. Both hits
//! (`<hash>.png`) and misses (`<hash>.none`, for authors with no Gravatar) are
//! cached, the latter so we don't hammer the network for the common case of a
//! plain email with no avatar. Entries older than [`TTL`] are re-fetched so an
//! author adding/updating their Gravatar eventually shows through.

use anyhow::Context;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const GRAVATAR_BASE: &str = "https://www.gravatar.com/avatar";

/// How long a cached avatar (or "no avatar" marker) stays valid before it is
/// re-fetched. Gravatars change rarely, so a fortnight keeps traffic minimal
/// while still letting updates appear.
const TTL: Duration = Duration::from_secs(60 * 60 * 24 * 14);

/// The default avatar size requested from Gravatar, in pixels. Commit dots are
/// tiny, but we request a larger image so it stays crisp on HiDPI displays.
const AVATAR_SIZE: u32 = 72;

/// Gravatar identifies a user by the MD5 of their lowercased, trimmed email.
pub fn gravatar_hash(email: &str) -> String {
    format!("{:x}", md5::compute(email.trim().to_lowercase().as_bytes()))
}

fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF") {
        "image/gif"
    } else {
        "image/png"
    }
}

fn to_data_url(bytes: &[u8]) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{}", sniff_mime(bytes), b64)
}

/// A cache entry younger than [`TTL`]. A file whose modified time is in the
/// future (clock skew) is treated as fresh rather than refetched.
fn is_fresh(path: &Path) -> bool {
    match std::fs::metadata(path).and_then(|m| m.modified()) {
        Ok(modified) => modified.elapsed().map(|age| age < TTL).unwrap_or(true),
        Err(_) => false,
    }
}

enum Cached {
    Image(Vec<u8>),
    NoAvatar,
}

fn read_cache(dir: &Path, hash: &str) -> Option<Cached> {
    let png = dir.join(format!("{hash}.png"));
    if is_fresh(&png) {
        if let Ok(bytes) = std::fs::read(&png) {
            return Some(Cached::Image(bytes));
        }
    }
    if is_fresh(&dir.join(format!("{hash}.none"))) {
        return Some(Cached::NoAvatar);
    }
    None
}

async fn fetch(base_url: &str, hash: &str, size: u32) -> anyhow::Result<Option<Vec<u8>>> {
    // d=404 makes Gravatar return a 404 (rather than a generated fallback) when
    // the email has no avatar, so we can record a real "no avatar" miss.
    let url = format!("{base_url}/{hash}?s={size}&d=404");
    let resp = reqwest::get(&url)
        .await
        .context("gravatar request failed")?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let bytes = resp
        .error_for_status()
        .context("gravatar returned an error status")?
        .bytes()
        .await
        .context("reading gravatar response body failed")?;
    Ok(Some(bytes.to_vec()))
}

/// Resolve an avatar for `email`, returning a `data:` URL or `None` when the
/// author has no Gravatar. Serves from the on-disk cache when fresh; otherwise
/// fetches from `base_url` and updates the cache. The `base_url` seam keeps the
/// network path testable.
pub async fn resolve_avatar(
    dir: &Path,
    base_url: &str,
    email: &str,
    size: u32,
) -> anyhow::Result<Option<String>> {
    let hash = gravatar_hash(email);

    if let Some(cached) = read_cache(dir, &hash) {
        return Ok(match cached {
            Cached::Image(bytes) => Some(to_data_url(&bytes)),
            Cached::NoAvatar => None,
        });
    }

    std::fs::create_dir_all(dir).ok();
    let png = dir.join(format!("{hash}.png"));
    let none = dir.join(format!("{hash}.none"));

    match fetch(base_url, &hash, size).await? {
        Some(bytes) => {
            std::fs::write(&png, &bytes).ok();
            let _ = std::fs::remove_file(&none);
            Ok(Some(to_data_url(&bytes)))
        }
        None => {
            std::fs::write(&none, b"").ok();
            let _ = std::fs::remove_file(&png);
            Ok(None)
        }
    }
}

fn cache_dir() -> anyhow::Result<PathBuf> {
    Ok(dirs::cache_dir()
        .context("no OS cache directory")?
        .join("git-wasp")
        .join("avatars"))
}

/// Tauri command: resolve a commit author's avatar to a `data:` URL (or `None`).
#[tauri::command]
pub async fn get_avatar(email: String) -> Result<Option<String>, String> {
    let dir = cache_dir().map_err(|e| e.to_string())?;
    resolve_avatar(&dir, GRAVATAR_BASE, &email, AVATAR_SIZE)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::MockServer;
    use tempfile::TempDir;

    #[test]
    fn gravatar_hash_matches_known_vector() {
        // Canonical example from Gravatar's docs (note the surrounding space and
        // mixed case, which must be trimmed and lowercased away).
        assert_eq!(
            gravatar_hash(" MyEmailAddress@example.com "),
            "0bc83cb571cd1c50ba6f3e8a78ef1346"
        );
    }

    #[test]
    fn sniff_mime_detects_formats() {
        assert_eq!(sniff_mime(&[0x89, 0x50, 0x4E, 0x47]), "image/png");
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(sniff_mime(b"GIF89a"), "image/gif");
        assert_eq!(sniff_mime(&[0, 1, 2, 3]), "image/png");
    }

    #[test]
    fn to_data_url_encodes_with_mime() {
        let url = to_data_url(&[0xFF, 0xD8, 0xFF]);
        assert!(url.starts_with("data:image/jpeg;base64,"));
    }

    #[tokio::test]
    async fn resolves_and_caches_a_hit_without_refetching() {
        let dir = TempDir::new().unwrap();
        let server = MockServer::start();
        let hash = gravatar_hash("a@b.com");
        let mock = server.mock(|when, then| {
            when.path(format!("/{hash}"));
            then.status(200).body([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]);
        });

        let first = resolve_avatar(dir.path(), &server.base_url(), "a@b.com", 72)
            .await
            .unwrap();
        assert!(first.unwrap().starts_with("data:image/png;base64,"));

        // Second call is served from the on-disk cache — no further network hit.
        let second = resolve_avatar(dir.path(), &server.base_url(), "a@b.com", 72)
            .await
            .unwrap();
        assert!(second.is_some());
        mock.assert_hits(1);
        assert!(dir.path().join(format!("{hash}.png")).exists());
    }

    #[tokio::test]
    async fn resolves_and_caches_a_miss() {
        let dir = TempDir::new().unwrap();
        let server = MockServer::start();
        let hash = gravatar_hash("nobody@nowhere.com");
        let mock = server.mock(|when, then| {
            when.path(format!("/{hash}"));
            then.status(404);
        });

        let first = resolve_avatar(dir.path(), &server.base_url(), "nobody@nowhere.com", 72)
            .await
            .unwrap();
        assert!(first.is_none());

        // The "no avatar" marker means the second call doesn't hit the network.
        let second = resolve_avatar(dir.path(), &server.base_url(), "nobody@nowhere.com", 72)
            .await
            .unwrap();
        assert!(second.is_none());
        mock.assert_hits(1);
        assert!(dir.path().join(format!("{hash}.none")).exists());
    }

    #[test]
    fn is_fresh_is_false_for_missing_file_and_true_for_new_file() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("missing.png");
        assert!(!is_fresh(&missing));

        let present = dir.path().join("present.png");
        std::fs::write(&present, b"x").unwrap();
        assert!(is_fresh(&present));
    }
}
