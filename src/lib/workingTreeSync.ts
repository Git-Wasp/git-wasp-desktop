// Coordinates the background working-tree poll with the file watcher so the
// expensive `git status` scan runs only when it can pay off.
//
// The Rust file watcher (`file_watcher::start`) emits `working-tree-changed`
// whenever the working tree or `.git` actually changes (git-ignored churn is
// already filtered out backend-side). The app records that signal as a "dirty"
// flag. The 8s poll then consults [`shouldScanWorkingTree`] instead of scanning
// unconditionally: on an idle large monorepo — where `git status` is genuinely
// costly — a clean tick skips the scan entirely.
//
// A periodic backstop still forces a scan every `BACKSTOP_EVERY` ticks so any
// event the watcher drops (rare, but possible under heavy bursts, or in the
// brief window while the watcher is being re-pointed at a newly-activated repo)
// still surfaces without needing a restart.

/// Force a full scan every N ticks regardless of the dirty flag. At the 8s poll
/// interval this is ~64s — cheap insurance against a missed watcher event while
/// still skipping the vast majority of idle ticks.
export const BACKSTOP_EVERY = 8;

/// Decide whether the background poll should run a full working-tree scan on
/// this tick. `dirty` is set by the file watcher since the last scan; `tick` is
/// a monotonically increasing tick counter (starting at 0, so the first tick
/// re-affirms the baseline established when the repo was opened).
export function shouldScanWorkingTree(
  dirty: boolean,
  tick: number,
  backstopEvery: number = BACKSTOP_EVERY,
): boolean {
  return dirty || tick % backstopEvery === 0;
}
