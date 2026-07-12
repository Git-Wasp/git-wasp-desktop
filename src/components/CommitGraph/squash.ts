import type { GraphNode } from "../../types/graph";

export interface SquashPlan {
  /** Selected commit oids, newest first. */
  oids: string[];
  /** Default squash message: the commits' messages joined, oldest first. */
  message: string;
}

/** A node's full commit message (summary plus body, when present). */
export function commitFullMessage(node: GraphNode): string {
  const body = node.body?.trim();
  return body ? `${node.summary}\n\n${body}` : node.summary;
}

/**
 * Build the squash plan from the currently loaded graph nodes and the selected
 * oids. Returns `null` when the selection can't be squashed from the frontend's
 * point of view: fewer than two real commits (the working-tree and stash rows
 * are never squashable), or a discontiguous selection (now possible via
 * cmd/ctrl-click) — squash only applies to an unbroken run of commits. The
 * backend still validates that the run is unpushed and tip-anchored; this shapes
 * the request and the pre-filled message.
 *
 * Graph rows increase downward with the newest commit at the top, so `oids` is
 * ordered newest-first and the pre-filled message joins messages oldest-first
 * (matching git's default squash message).
 */
export function buildSquashPlan(
  nodes: GraphNode[],
  selectedOids: ReadonlySet<string>,
): SquashPlan | null {
  // Order the real commits (excluding synthetic working-tree/stash rows) by row
  // so contiguity is judged against the commit sequence, not raw row numbers —
  // a stash row sitting between two commits mustn't read as a gap.
  const commits = nodes
    .filter((n) => !n.isWorkingTree && !n.isStash)
    .sort((a, b) => a.row - b.row);
  const selectedIdxs = commits
    .map((n, i) => (selectedOids.has(n.oid) ? i : -1))
    .filter((i) => i >= 0);
  if (selectedIdxs.length < 2) return null;

  // Contiguous ⇔ the selected commits occupy an unbroken slice of the sequence.
  const first = selectedIdxs[0];
  const last = selectedIdxs[selectedIdxs.length - 1];
  if (last - first + 1 !== selectedIdxs.length) return null;

  const newestFirst = selectedIdxs.map((i) => commits[i]);
  const oldestFirst = [...newestFirst].reverse();

  return {
    oids: newestFirst.map((n) => n.oid),
    message: oldestFirst.map(commitFullMessage).join("\n\n"),
  };
}
