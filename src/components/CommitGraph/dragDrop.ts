// Pure merge sequencing for branch-pill drag-and-drop. (Pill hit-testing now
// lives in the DOM via useGraphDragDrop; this stays store-free and testable.)

interface RunMergeArgs {
  source: string;
  target: string;
  currentBranch: string | null;
  checkoutBranch: (name: string) => Promise<boolean>;
  startMerge: (name: string) => Promise<unknown>;
}

/**
 * Merge `source` into `target`. If `target` is not the currently checked-out
 * branch, check it out first (GitKraken-style), then merge.
 */
export async function runMerge({
  source,
  target,
  currentBranch,
  checkoutBranch,
  startMerge,
}: RunMergeArgs): Promise<void> {
  if (target !== currentBranch) {
    const switched = await checkoutBranch(target);
    if (!switched) return; // auto-stash prompt was cancelled — abort, don't merge into the wrong branch
  }
  await startMerge(source);
}
