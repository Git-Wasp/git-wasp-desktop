import type { BranchLabel } from "../../types/graph";
import type { ColumnVisibility, GraphVariant, OptionalColumn } from "../../stores/graphStore";

// Row height. Kept here so the canvas graph, the header, and the DOM rows all
// agree on geometry. The redesign uses a compact 56px ledger row (see
// _assets/design_handoff_git_graph_view).
export const ROW_HEIGHT = 56;

// Cap the secondary (body) line in the commit cell so a huge body can't blow out
// layout; it's truncated to one line anyway.
export const MAX_BODY_CHARS = 120;

export type { GraphVariant, OptionalColumn, ColumnVisibility } from "../../stores/graphStore";

// The six cell kinds. "commit" flexes to fill; "graph" is the frozen canvas
// column; the rest are fixed-width, resizable data columns.
export type ColumnKind = "graph" | "commit" | "author" | "branch" | "hash" | "date";

export interface ColumnMeta {
  kind: ColumnKind;
  header: string;
  /** Starting width (px) for fixed columns; the flex column ignores it. */
  defaultWidth: number;
  /** The column never shrinks below this — the basis for horizontal scroll. */
  minWidth: number;
  /** Fixed columns with a persisted, drag-resizable width. */
  resizable: boolean;
  /** Optional columns can be hidden from the columns menu. */
  optional: boolean;
  /** The commit column grows to fill leftover space. */
  flex: boolean;
}

// Per-kind metadata, independent of variant/order.
export const COLUMN_META: Record<ColumnKind, ColumnMeta> = {
  graph: { kind: "graph", header: "", defaultWidth: 156, minWidth: 90, resizable: true, optional: false, flex: false },
  commit: { kind: "commit", header: "Commit", defaultWidth: 320, minWidth: 220, resizable: false, optional: false, flex: true },
  author: { kind: "author", header: "Author", defaultWidth: 180, minWidth: 120, resizable: true, optional: true, flex: false },
  branch: { kind: "branch", header: "Branch", defaultWidth: 236, minWidth: 120, resizable: true, optional: true, flex: false },
  hash: { kind: "hash", header: "Hash", defaultWidth: 104, minWidth: 76, resizable: true, optional: true, flex: false },
  date: { kind: "date", header: "Date", defaultWidth: 120, minWidth: 92, resizable: true, optional: true, flex: false },
};

// The optional columns shown in the toolbar's columns menu, in display order.
export const OPTIONAL_COLUMN_LABELS: { kind: OptionalColumn; label: string }[] = [
  { kind: "author", label: "Author" },
  { kind: "branch", label: "Branch" },
  { kind: "hash", label: "Hash" },
  { kind: "date", label: "Date" },
];

export interface GraphColumn {
  id: string;
  kind: ColumnKind;
  header: string;
  /** Right-aligned content (hash/date in Ledger Grid). */
  align: "start" | "end";
}

// Column order per variant. Ledger Grid keeps the graph on the left and reads
// left-to-right; Split Rail mirrors it — hash first (log-file style), graph last
// (anchored to the right edge).
const LEDGER_ORDER: ColumnKind[] = ["graph", "commit", "author", "branch", "hash", "date"];
const SPLIT_ORDER: ColumnKind[] = ["hash", "commit", "author", "branch", "date", "graph"];

/**
 * The ordered, currently-visible columns for a layout variant. The graph and
 * commit columns are always present; optional columns are filtered by
 * `visibility`. Hash and date are right-aligned in Ledger Grid only.
 */
export function columnsForVariant(variant: GraphVariant, visibility: ColumnVisibility): GraphColumn[] {
  const order = variant === "split" ? SPLIT_ORDER : LEDGER_ORDER;
  return order
    .filter((kind) => {
      const meta = COLUMN_META[kind];
      return !meta.optional || visibility[kind as OptionalColumn];
    })
    .map((kind) => ({
      id: kind,
      kind,
      header: COLUMN_META[kind].header,
      align: variant === "ledger" && (kind === "hash" || kind === "date") ? "end" : "start",
    }));
}

export interface PillHandlers {
  onPointerDown: (e: React.PointerEvent, label: BranchLabel) => void;
  onPointerEnter: (label: BranchLabel) => void;
  onPointerLeave: () => void;
  isDropTarget: (branch: string) => boolean;
}
