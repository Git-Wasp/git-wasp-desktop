use git2::Repository;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer_opt, DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache,
};
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// How long to wait for a lull in filesystem activity before emitting
/// `working-tree-changed`. Collapses a burst of individual notify events —
/// a checkout touching thousands of files, a fetch updating many refs — into
/// at most one emit per window instead of one per raw event. Complements the
/// frontend's own 300ms debounce (`workingTreeStore.ts`) by cutting emits at
/// the source; this is also what Task B2's graph-cache `mark_dirty` hangs off
/// (via `refresh_working_tree`, called once per emit rather than once per
/// raw filesystem event).
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(250);

#[derive(Default)]
struct EmitGate {
    last_batch_at: Option<Instant>,
}

impl EmitGate {
    fn should_emit(&mut self, now: Instant) -> bool {
        let should_emit = !self
            .last_batch_at
            .is_some_and(|last_batch| now.duration_since(last_batch) < DEBOUNCE_WINDOW);

        self.last_batch_at = Some(now);
        should_emit
    }
}

fn change_notifier<F, C>(
    repo: Option<Repository>,
    root: std::path::PathBuf,
    mut on_change: F,
    mut now: C,
) -> impl FnMut(DebounceEventResult)
where
    F: FnMut(&[DebouncedEvent]) + Send + 'static,
    C: FnMut() -> Instant + Send + 'static,
{
    let mut emit_gate = EmitGate::default();

    move |result| {
        let Ok(events) = result else { return };
        if let Some(repo) = &repo {
            if is_noise_batch(repo, &root, &events) {
                return;
            }
        }
        if emit_gate.should_emit(now()) {
            on_change(&events);
        }
    }
}

/// Whether a changed path is churn we should ignore — i.e. git-ignored by the
/// repo's own rules (`target/`, `node_modules/`, `dist/`, …). Honouring
/// `.gitignore` keeps the filter authoritative and per-repo rather than a
/// hardcoded guess.
///
/// `.git/` is deliberately exempt: it isn't covered by `.gitignore`, and its
/// changes (commits, merges, branch switches — including from the CLI) are
/// exactly what we want to surface.
fn is_noise(repo: &Repository, root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    if rel.components().any(|c| c.as_os_str() == ".git") {
        return false;
    }
    repo.is_path_ignored(rel).unwrap_or(false)
}

/// Whether a whole batch of debounced events is pure noise — every event's
/// paths are entirely git-ignored churn — and should be suppressed rather
/// than emitted. Mirrors the single-event rule ("suppress only when there
/// are paths and every one is ignored churn; pathless events and any
/// non-ignored path emit"), applied across the batch: the batch is noise
/// only if *every* event in it individually qualifies.
fn is_noise_batch(repo: &Repository, root: &Path, events: &[DebouncedEvent]) -> bool {
    !events.is_empty()
        && events
            .iter()
            .all(|e| !e.paths.is_empty() && e.paths.iter().all(|p| is_noise(repo, root, p)))
}

/// Start a debounced watcher on `path`, calling `on_change` at most once per
/// [`DEBOUNCE_WINDOW`] when a non-noise batch of filesystem events arrives.
/// Split out from [`start`] so the debounce + noise-filtering logic is
/// testable without a real Tauri `AppHandle`.
fn start_with_watcher<T, F>(
    path: &Path,
    config: Config,
    on_change: F,
) -> notify::Result<Debouncer<T, RecommendedCache>>
where
    T: Watcher,
    F: FnMut(&[DebouncedEvent]) + Send + 'static,
{
    // Canonicalise so event paths (which arrive resolved, e.g. /private/var on
    // macOS) strip cleanly to repo-relative paths for the ignore check.
    let root = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    // A lightweight read-only handle used only to consult gitignore from the
    // debouncer thread (git2::Repository is Send). If it can't be opened we
    // fall back to emitting every non-empty batch.
    let repo = Repository::open(&root).ok();
    let notifier = change_notifier(repo, root, on_change, Instant::now);

    let mut debouncer = new_debouncer_opt(
        DEBOUNCE_WINDOW,
        None,
        notifier,
        RecommendedCache::new(),
        config,
    )?;
    debouncer.watch(path, RecursiveMode::Recursive)?;
    Ok(debouncer)
}

fn start_with_notifier<F>(
    path: &Path,
    on_change: F,
) -> notify::Result<Debouncer<RecommendedWatcher, RecommendedCache>>
where
    F: FnMut() + Send + 'static,
{
    let mut on_change = on_change;
    start_with_watcher(path, Config::default(), move |_| on_change())
}

pub fn start(
    app_handle: AppHandle,
    path: &Path,
) -> notify::Result<Debouncer<RecommendedWatcher, RecommendedCache>> {
    start_with_notifier(path, move || {
        let _ = app_handle.emit("working-tree-changed", ());
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::PollWatcher;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn repo_with_gitignore(rules: &str) -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        std::fs::write(dir.path().join(".gitignore"), rules).unwrap();
        (dir, repo)
    }

    #[test]
    fn ignores_paths_matched_by_gitignore() {
        let (dir, repo) = repo_with_gitignore("target/\nnode_modules/\ndist/\n");
        let root = dir.path();
        assert!(is_noise(
            &repo,
            root,
            &root.join("target/debug/build/foo.rs")
        ));
        assert!(is_noise(
            &repo,
            root,
            &root.join("node_modules/react/index.js")
        ));
        assert!(is_noise(&repo, root, &root.join("dist/assets/app.js")));
    }

    #[test]
    fn keeps_tracked_paths_and_git_changes() {
        let (dir, repo) = repo_with_gitignore("target/\n");
        let root = dir.path();
        assert!(!is_noise(&repo, root, &root.join("src/main.rs")));
        assert!(!is_noise(&repo, root, &root.join("Cargo.toml")));
        // .git changes must register even though git2 may treat .git specially.
        assert!(!is_noise(&repo, root, &root.join(".git/MERGE_HEAD")));
        assert!(!is_noise(&repo, root, &root.join(".git/refs/heads/main")));
    }

    fn debounced_event(path: &Path) -> DebouncedEvent {
        DebouncedEvent::new(
            notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Any))
                .add_path(path.to_path_buf()),
            std::time::Instant::now(),
        )
    }

    fn test_watcher_config() -> Config {
        Config::default()
            .with_poll_interval(Duration::from_millis(50))
            .with_compare_contents(true)
    }

    fn collect_matching_callbacks(
        change_rx: &mpsc::Receiver<Vec<String>>,
        prefix: &str,
        initial_wait: Duration,
    ) -> usize {
        let mut matches = 0usize;
        let first_batch = match change_rx.recv_timeout(initial_wait) {
            Ok(paths) => Some(paths),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                panic!("watcher callback channel disconnected")
            }
        };
        if let Some(paths) = first_batch {
            matches += usize::from(paths.iter().any(|path| path.starts_with(prefix)));
            while let Ok(paths) = change_rx.recv_timeout(DEBOUNCE_WINDOW * 2) {
                matches += usize::from(paths.iter().any(|path| path.starts_with(prefix)));
            }
        }
        matches
    }

    fn wait_for_non_noise_burst(
        dir: &TempDir,
        change_rx: &mpsc::Receiver<Vec<String>>,
        prefix_base: &str,
    ) -> String {
        for attempt in 0..8 {
            while change_rx.recv_timeout(DEBOUNCE_WINDOW).is_ok() {}

            let prefix = format!("{prefix_base}-{attempt}");
            for i in 0..20 {
                std::fs::write(dir.path().join(format!("{prefix}-{i}.txt")), "x").unwrap();
            }

            let matches =
                collect_matching_callbacks(change_rx, &prefix, Duration::from_millis(1500));
            if matches > 0 {
                assert_eq!(
                    matches, 1,
                    "the burst for prefix {prefix} must produce exactly one callback"
                );
                return prefix;
            }
        }

        panic!("watcher never observed a non-noise burst within retry budget");
    }

    #[test]
    fn is_noise_batch_is_false_when_any_event_has_a_non_ignored_path() {
        let (dir, repo) = repo_with_gitignore("target/\n");
        let root = dir.path();
        let events = vec![
            debounced_event(&root.join("target/debug/build/foo.rs")),
            debounced_event(&root.join("src/main.rs")),
        ];
        assert!(!is_noise_batch(&repo, root, &events));
    }

    #[test]
    fn is_noise_batch_is_true_when_every_event_is_ignored_churn() {
        let (dir, repo) = repo_with_gitignore("target/\n");
        let root = dir.path();
        let events = vec![
            debounced_event(&root.join("target/a.rs")),
            debounced_event(&root.join("target/b.rs")),
        ];
        assert!(is_noise_batch(&repo, root, &events));
    }

    #[test]
    fn is_noise_batch_is_false_for_an_empty_batch() {
        let (dir, repo) = repo_with_gitignore("target/\n");
        assert!(!is_noise_batch(&repo, dir.path(), &[]));
    }

    #[test]
    fn is_noise_batch_is_false_for_a_pathless_event() {
        let (dir, repo) = repo_with_gitignore("target/\n");
        let events = vec![DebouncedEvent::new(
            notify::Event::new(notify::EventKind::Other),
            std::time::Instant::now(),
        )];
        assert!(!is_noise_batch(&repo, dir.path(), &events));
    }

    #[test]
    fn notifier_emits_once_for_continuous_non_noise_batches_until_a_quiet_window() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        let first_batch = Instant::now();
        let mut batch_times = [
            first_batch,
            first_batch + Duration::from_millis(200),
            first_batch + Duration::from_millis(300),
            first_batch + Duration::from_millis(600),
        ]
        .into_iter();
        let count = Arc::new(AtomicUsize::new(0));
        let count_handle = Arc::clone(&count);
        let mut notifier = change_notifier(
            None,
            root.clone(),
            move |_| {
                count_handle.fetch_add(1, Ordering::SeqCst);
            },
            move || batch_times.next().unwrap(),
        );

        notifier(Ok(vec![debounced_event(&root.join("first.txt"))]));
        notifier(Ok(vec![debounced_event(&root.join("second.txt"))]));
        notifier(Ok(vec![debounced_event(&root.join("third.txt"))]));
        assert_eq!(
            count.load(Ordering::SeqCst),
            1,
            "continuous batches belong to one filesystem burst"
        );

        notifier(Ok(vec![debounced_event(&root.join("after-lull.txt"))]));
        assert_eq!(
            count.load(Ordering::SeqCst),
            2,
            "a new burst after a full quiet window must emit"
        );
    }

    #[test]
    fn debounced_watcher_collapses_a_burst_of_writes_into_one_emit() {
        let dir = tempfile::tempdir_in(std::env::current_dir().unwrap()).unwrap();
        Repository::init(dir.path()).unwrap();
        let (change_tx, change_rx) = mpsc::channel();

        let debouncer = start_with_watcher::<PollWatcher, _>(
            dir.path(),
            test_watcher_config(),
            move |events| {
                let file_names = events
                    .iter()
                    .flat_map(|event| &event.paths)
                    .filter_map(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .map(str::to_owned)
                    })
                    .collect::<Vec<_>>();
                change_tx.send(file_names).unwrap();
            },
        )
        .unwrap();

        let observed_prefix = wait_for_non_noise_burst(&dir, &change_rx, "burst");
        assert!(
            observed_prefix.starts_with("burst-"),
            "sanity check: helper returned the observed burst prefix"
        );
        debouncer.stop();
    }

    #[test]
    fn debounced_watcher_emits_nothing_for_a_burst_of_pure_noise() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        let repo = Repository::init(dir.path()).unwrap();
        std::fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
        std::fs::create_dir(dir.path().join("ignored")).unwrap();
        // Commit the .gitignore so is_path_ignored has rules to consult
        // (an uncommitted .gitignore is still honoured by git2, but committing
        // keeps this fixture's intent explicit and matches a real repo).
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.add_path(Path::new(".gitignore")).unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "add gitignore", &tree, &[])
            .unwrap();

        let (change_tx, change_rx) = mpsc::channel();
        let debouncer = start_with_watcher::<PollWatcher, _>(
            dir.path(),
            test_watcher_config(),
            move |events| {
                let rel_paths = events
                    .iter()
                    .flat_map(|event| &event.paths)
                    .filter_map(|path| {
                        path.strip_prefix(&root)
                            .ok()
                            .and_then(|rel| rel.to_str())
                            .map(str::to_owned)
                    })
                    .collect::<Vec<_>>();
                change_tx.send(rel_paths).unwrap();
            },
        )
        .unwrap();

        let observed_prefix = wait_for_non_noise_burst(&dir, &change_rx, "control");
        assert!(
            observed_prefix.starts_with("control-"),
            "sanity check: helper returned the observed control prefix"
        );

        while change_rx.recv_timeout(DEBOUNCE_WINDOW).is_ok() {}

        let noise_prefix = "ignored/noise";
        for i in 0..10 {
            std::fs::write(
                dir.path().join("ignored").join(format!("noise-{i}.txt")),
                "x",
            )
            .unwrap();
        }

        let measured_callbacks = collect_matching_callbacks(
            &change_rx,
            noise_prefix,
            DEBOUNCE_WINDOW + Duration::from_millis(750),
        );

        assert_eq!(measured_callbacks, 0);
        debouncer.stop();
    }
}
