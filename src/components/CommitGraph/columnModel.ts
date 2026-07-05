import type { CSSProperties } from "react";
import type { BranchLabel } from "../../types/graph";
import type { GraphVariant } from "../../stores/graphStore";

// Row height and column widths. Kept here so the canvas graph, the header, and
// the DOM rows all agree on geometry. The redesign uses a compact 56px ledger
// row (see _assets/design_handoff_git_graph_view).
export const ROW_HEIGHT = 56;

// Graph column width (resizable + persisted). ~6 lanes at the 24px pitch; deeper
// lanes clip (v1). The other data columns keep fixed widths and the commit
// column flexes to fill, per the handoff.
export const GRAPH_COL_WIDTH = 156;
export const AUTHOR_COL_WIDTH = 168;
export const BRANCH_COL_WIDTH = 236;
export const HASH_COL_WIDTH = 96;
export const DATE_COL_WIDTH = 112;
export const MAX_BODY_CHARS = 120;

export type { GraphVariant } from "../../stores/graphStore";

// The six cell kinds. "commit" flexes; everything else is fixed width. "graph"
// is the canvas gap the DAG paints through.
export type ColumnKind = "graph" | "commit" | "author" | "branch" | "hash" | "date";

export interface GraphColumn {
  id: string;
  header: string;
  kind: ColumnKind;
  width: number | "flex";
  /** Text alignment for the cell's content (defaults to "start"). */
  align?: "start" | "end";
}

/**
 * The ordered columns for a layout variant.
 *
 * - Ledger Grid: graph · commit · author · branch · hash · date (graph left).
 * - Split Rail:  hash · commit · author · branch · date · graph (graph right,
 *   hash read like a log file on the far left).
 *
 * The graph column carries the handoff default width; the caller overrides it
 * with the persisted, resizable width.
 */
export function columnsForVariant(variant: GraphVariant): GraphColumn[] {
  if (variant === "split") {
    return [
      { id: "hash", header: "Hash", kind: "hash", width: 100 },
      { id: "commit", header: "Commit", kind: "commit", width: "flex" },
      { id: "author", header: "Author", kind: "author", width: 160 },
      { id: "branch", header: "Branch", kind: "branch", width: BRANCH_COL_WIDTH },
      { id: "date", header: "Date", kind: "date", width: 96 },
      { id: "graph", header: "", kind: "graph", width: GRAPH_COL_WIDTH },
    ];
  }
  return [
    { id: "graph", header: "", kind: "graph", width: GRAPH_COL_WIDTH },
    { id: "commit", header: "Commit", kind: "commit", width: "flex" },
    { id: "author", header: "Author", kind: "author", width: AUTHOR_COL_WIDTH },
    { id: "branch", header: "Branch", kind: "branch", width: BRANCH_COL_WIDTH },
    { id: "hash", header: "Hash", kind: "hash", width: HASH_COL_WIDTH, align: "end" },
    { id: "date", header: "Date", kind: "date", width: DATE_COL_WIDTH, align: "end" },
  ];
}

export function columnStyle(column: GraphColumn): CSSProperties {
  return column.width === "flex"
    ? { flex: 1, minWidth: 0 }
    : { width: column.width, flexShrink: 0 };
}

export interface PillHandlers {
  onPointerDown: (e: React.PointerEvent, label: BranchLabel) => void;
  onPointerEnter: (label: BranchLabel) => void;
  onPointerLeave: () => void;
  isDropTarget: (branch: string) => boolean;
}
