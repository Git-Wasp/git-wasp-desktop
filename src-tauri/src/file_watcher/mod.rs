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
    last_emit: Option<Instant>,
}

impl EmitGate {
    fn should_emit(&mut self, now: Instant) -> bool {
        if self
            .last_emit
            .is_some_and(|last_emit| now.duration_since(last_emit) < DEBOUNCE_WINDOW)
        {
            return false;
        }

        self.last_emit = Some(now);
        true
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
    mut on_change: F,
) -> notify::Result<Debouncer<T, RecommendedCache>>
where
    T: Watcher,
    F: FnMut() + Send + 'static,
{
    // Canonicalise so event paths (which arrive resolved, e.g. /private/var on
    // macOS) strip cleanly to repo-relative paths for the ignore check.
    let root = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    // A lightweight read-only handle used only to consult gitignore from the
    // debouncer thread (git2::Repository is Send). If it can't be opened we
    // fall back to emitting every non-empty batch.
    let repo = Repository::open(&root).ok();
    let mut emit_gate = EmitGate::default();

    let mut debouncer = new_debouncer_opt(
        DEBOUNCE_WINDOW,
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            if let Some(repo) = &repo {
                if is_noise_batch(repo, &root, &events) {
                    return;
                }
            }
            if emit_gate.should_emit(Instant::now()) {
                on_change();
            }
        },
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
    start_with_watcher(path, Config::default(), on_change)
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
    fn emit_gate_suppresses_a_second_batch_within_the_debounce_window() {
        let first_batch = Instant::now();
        let mut gate = EmitGate::default();

        assert!(gate.should_emit(first_batch));
        assert!(!gate.should_emit(first_batch + DEBOUNCE_WINDOW / 2));
        assert!(gate.should_emit(first_batch + DEBOUNCE_WINDOW));
    }

    #[test]
    fn debounced_watcher_collapses_a_burst_of_writes_into_one_emit() {
        let dir = TempDir::new().unwrap();
        Repository::init(dir.path()).unwrap();
        let (change_tx, change_rx) = mpsc::channel();

        let debouncer = start_with_watcher::<notify::PollWatcher, _>(
            dir.path(),
            Config::default().with_poll_interval(Duration::from_millis(10)),
            move || {
                change_tx.send(()).unwrap();
            },
        )
        .unwrap();

        // Watcher startup is asynchronous. Probe until the callback confirms
        // this directory is being observed before exercising the burst
        // contract.
        let ready_by = Instant::now() + Duration::from_secs(5);
        let mut probe = 0;
        loop {
            std::fs::write(dir.path().join(".watcher-ready"), probe.to_string()).unwrap();
            if change_rx.recv_timeout(Duration::from_millis(100)).is_ok() {
                break;
            }
            assert!(
                Instant::now() < ready_by,
                "watcher did not become ready within 5 seconds"
            );
            probe += 1;
        }

        // Start the measured burst in a fresh output window and discard any
        // already-coalesced probe notification.
        std::thread::sleep(DEBOUNCE_WINDOW);
        while change_rx.try_recv().is_ok() {}

        // A burst of writes, all within one debounce window.
        for i in 0..20 {
            std::fs::write(dir.path().join(format!("f{i}.txt")), "x").unwrap();
        }

        change_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("watcher did not emit after the burst");
        assert!(
            change_rx.recv_timeout(DEBOUNCE_WINDOW).is_err(),
            "watcher emitted more than once within the debounce window"
        );
        debouncer.stop();
    }

    #[test]
    fn debounced_watcher_emits_nothing_for_a_burst_of_pure_noise() {
        let dir = TempDir::new().unwrap();
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

        let count = Arc::new(AtomicUsize::new(0));
        let count_handle = Arc::clone(&count);
        let debouncer = start_with_notifier(dir.path(), move || {
            count_handle.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();

        for i in 0..10 {
            std::fs::write(dir.path().join("ignored").join(format!("f{i}.txt")), "x").unwrap();
        }

        std::thread::sleep(DEBOUNCE_WINDOW + Duration::from_millis(750));

        assert_eq!(count.load(Ordering::SeqCst), 0);
        debouncer.stop();
    }
}
