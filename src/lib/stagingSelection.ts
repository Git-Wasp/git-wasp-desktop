// Pure helpers for deciding which file the staging diff view should show after a
// file is staged. Kept framework-free so it is cheap to unit test.

import type { WorkingTreeStatus } from "../types/workingTree";

/**
 * The "Changes" list (files that still need staging), in the same order the
 * staging panel shows them: modified/deleted (`unstaged`) then `untracked`.
 */
export function unstagedPaths(status: WorkingTreeStatus | null): string[] {
  return [...(status?.unstaged ?? []), ...(status?.untracked ?? [])].map((e) => e.path);
}

/**
 * Which file the diff view should show after staging `path`.
 *
 * - If `path` still has unstaged changes (a partial stage) it stays selected.
 * - If nothing is left to stage, `path` stays selected (leave the last file
 *   shown).
 * - Otherwise advance to the next file that still needs staging: the one that
 *   took `path`'s slot in the list (clamped to the last entry if `path` was at
 *   the end).
 *
 * `prevChanges`/`newChanges` are the unstaged lists from before/after staging
 * (see {@link unstagedPaths}).
 */
export function nextSelectionAfterStaging(
  prevChanges: string[],
  newChanges: string[],
  path: string,
): string {
  if (newChanges.includes(path) || newChanges.length === 0) return path;
  const k = prevChanges.indexOf(path);
  return newChanges[Math.min(k < 0 ? 0 : k, newChanges.length - 1)];
}
