import type { CSSProperties } from "react";
import type { BranchLabel } from "../../types/graph";

// Row height and column widths. Kept here so the canvas graph, the header, and
// the DOM rows all agree on geometry.
export const ROW_HEIGHT = 34;
export const BRANCH_COL_WIDTH = 180;
export const GRAPH_COL_WIDTH = 160; // ~7 lanes; deeper lanes clip (v1)
export const MAX_BODY_CHARS = 100;

export type ColumnKind = "branch" | "graph" | "message";

export interface GraphColumn {
  id: string;
  header: string;
  width: number | "flex";
  kind: ColumnKind;
}

// The visible columns, in order. Adding a column later (date, author, hash) is
// a descriptor here plus a `renderCell` branch in columns.tsx — and, eventually,
// a persisted show/hide preference.
export const COLUMNS: GraphColumn[] = [
  { id: "branch", header: "Branch / Tag", width: BRANCH_COL_WIDTH, kind: "branch" },
  { id: "graph", header: "Graph", width: GRAPH_COL_WIDTH, kind: "graph" },
  { id: "message", header: "Commit message", width: "flex", kind: "message" },
];

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
