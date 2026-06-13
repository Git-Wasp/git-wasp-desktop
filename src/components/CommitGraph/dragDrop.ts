// Pure drag-and-drop helpers for the commit graph. Kept free of React and
// stores so the hit-testing and merge sequencing are unit-testable without a
// real canvas (jsdom cannot measure canvas text).

export interface BranchLabelHit {
  name: string;
  isRemote: boolean;
  isTag: boolean;
  // Canvas-local CSS pixel rect of the rendered branch pill.
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Topmost (last-drawn) pill whose rect contains the point, if any. */
export function hitTestLabel(
  hits: BranchLabelHit[],
  x: number,
  y: number,
): BranchLabelHit | undefined {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      return h;
    }
  }
  return undefined;
}

/** Only local branches may be dragged or used as a merge/PR target. */
export function isLocalBranch(hit: BranchLabelHit): boolean {
  return !hit.isRemote && !hit.isTag;
}

interface RunMergeArgs {
  source: string;
  target: string;
  currentBranch: string | null;
  checkoutBranch: (name: string) => Promise<void>;
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
    await checkoutBranch(target);
  }
  await startMerge(source);
}
