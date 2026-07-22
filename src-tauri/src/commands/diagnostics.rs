use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsInfo {
    /// Whether diagnostic (debug-level) logging is currently active.
    pub enabled: bool,
    /// Absolute path to the directory holding the log file.
    pub log_dir: String,
    /// Absolute path to the log file itself.
    pub log_file: String,
}

fn log_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_log_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_diagnostics_info(app: AppHandle) -> Result<DiagnosticsInfo, String> {
    let dir = log_dir(&app)?;
    let file = dir.join(format!("{}.log", crate::logging::LOG_FILE_NAME));
    Ok(DiagnosticsInfo {
        enabled: crate::logging::diagnostics_enabled(),
        log_dir: dir.to_string_lossy().into_owned(),
        log_file: file.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn set_diagnostics(enabled: bool) {
    crate::logging::set_diagnostics(enabled);
}

/// Reveal the log directory in the OS file manager.
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app)?;
    // The dir may not exist yet if nothing has been logged to disk; create it so
    // the reveal doesn't fail on a fresh install.
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Bridge a log message from the frontend into the backend log pipeline, so the
/// file log captures both sides. Callers should never pass PII.
#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    let message = sanitize_log_message(&message);
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{message}"),
        "warn" => log::warn!(target: "frontend", "{message}"),
        "debug" => log::debug!(target: "frontend", "{message}"),
        _ => log::info!(target: "frontend", "{message}"),
    }
}

const MAX_FRONTEND_LOG_LEN: usize = 2048;

/// Strips embedded newlines (which could forge fake log lines in the shared
/// diagnostics file users share for support) and caps length, so a single
/// runaway frontend log call can't blow up the log file.
fn sanitize_log_message(message: &str) -> String {
    let mut s: String = message
        .chars()
        .filter(|c| *c != '\n' && *c != '\r')
        .collect();
    if s.len() > MAX_FRONTEND_LOG_LEN {
        s.truncate(MAX_FRONTEND_LOG_LEN);
        s.push_str("…[truncated]");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_log_message_strips_embedded_newlines() {
        let out = sanitize_log_message("line one\nFAKE ERROR forged line\r\nline two");
        assert!(!out.contains('\n'));
        assert!(!out.contains('\r'));
    }

    #[test]
    fn sanitize_log_message_caps_length() {
        let long = "x".repeat(10_000);
        let out = sanitize_log_message(&long);
        assert!(out.len() <= MAX_FRONTEND_LOG_LEN + "…[truncated]".len());
    }

    #[test]
    fn sanitize_log_message_leaves_short_single_line_messages_untouched() {
        assert_eq!(sanitize_log_message("normal message"), "normal message");
    }
}
