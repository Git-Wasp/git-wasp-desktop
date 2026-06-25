//! Logging configuration and the runtime "diagnostics" toggle.
//!
//! Logging is wired through the standard `log` facade (file + stdout targets are
//! installed by `tauri-plugin-log` in `lib.rs`). The plugin sets a `Debug`
//! ceiling; the *effective* verbosity is then controlled at runtime via
//! `log::set_max_level`, which the `log` macros consult before building a record.
//! That's what lets us flip "diagnostic logging" on and off without restarting.
//!
//! Verbosity policy:
//! - **off** → `Info`: high-level operations only (a checkout happened, a push
//!   succeeded/failed). Quiet enough for everyday use.
//! - **on**  → `Debug`: adds the detail useful for diagnosing a problem (e.g. the
//!   working-tree state before/after a checkout). Never `Trace`, and never
//!   anything that would record PII (file contents, tokens, author emails).
//!
//! Diagnostics defaults **on** for dev builds and **off** for release builds; the
//! user can override either way (the choice is persisted on the frontend and
//! re-applied on startup via `set_diagnostics`).

use log::LevelFilter;

/// The file name (without extension) used for the on-disk log in the app log dir.
/// `tauri-plugin-log` appends `.log`, so the file is `gitclient.log`.
pub const LOG_FILE_NAME: &str = "gitclient";

/// The level ceiling configured on the logging backend. The runtime level (see
/// [`level_for`]) is always at or below this, so a higher ceiling here just
/// leaves headroom — records above it are dropped by the backend regardless.
pub const LEVEL_CEILING: LevelFilter = LevelFilter::Debug;

/// Whether diagnostic logging is enabled by default. On for dev builds (so we
/// always have detail while developing), off for release builds.
pub fn diagnostics_default() -> bool {
    cfg!(debug_assertions)
}

/// The effective max log level for a given diagnostics state.
pub fn level_for(diagnostics: bool) -> LevelFilter {
    if diagnostics {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

/// Whether diagnostic logging is currently active (i.e. debug records flow).
pub fn diagnostics_enabled() -> bool {
    log::max_level() >= LevelFilter::Debug
}

/// Apply a diagnostics on/off choice at runtime.
pub fn set_diagnostics(enabled: bool) {
    log::set_max_level(level_for(enabled));
    // Logged at info so it appears whether or not diagnostics is on.
    log::info!(
        target: "diagnostics",
        "diagnostic logging {}",
        if enabled { "enabled (debug)" } else { "disabled (info)" }
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_maps_to_debug_when_on_info_when_off() {
        assert_eq!(level_for(true), LevelFilter::Debug);
        assert_eq!(level_for(false), LevelFilter::Info);
    }

    #[test]
    fn runtime_level_ceiling_is_not_exceeded_by_either_state() {
        assert!(level_for(true) <= LEVEL_CEILING);
        assert!(level_for(false) <= LEVEL_CEILING);
    }

    #[test]
    fn diagnostics_defaults_on_in_debug_builds() {
        // The test binary is a debug build, so the dev default is on.
        assert_eq!(diagnostics_default(), cfg!(debug_assertions));
    }

    #[test]
    fn set_diagnostics_round_trips_the_runtime_level() {
        set_diagnostics(true);
        assert!(diagnostics_enabled());
        set_diagnostics(false);
        assert!(!diagnostics_enabled());
        // Restore the dev default so test ordering can't leak state.
        set_diagnostics(diagnostics_default());
    }
}
