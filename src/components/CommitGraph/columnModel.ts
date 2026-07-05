import type { BranchLabel } from "../../types/graph";
import type { ColumnVisibility, DataColumn, GraphVariant, OptionalColumn } from "../../stores/graphStore";

// Row height. Kept here so the canvas graph, the header, and the DOM rows all
// agree on geometry. The redesign uses a compact 56px ledger row (see
// _assets/design_handoff_git_graph_view).
export const ROW_HEIGHT = 56;

// Cap the secondary (body) line in the commit cell so a huge body can't blow out
// layout; it's truncated to one line anyway.
export const MAX_BODY_CHARS = 120;

export type { GraphVariant, OptionalColumn, ColumnVisibility, DataColumn } from "../../stores/graphStore";

// The six cell kinds. "graph" is the frozen canvas column; the rest are
// fixed-width, resizable data columns (the commit column just starts wider).
export type ColumnKind = "graph" | "commit" | "author" | "branch" | "hash" | "date";

export interface ColumnMeta {
  kind: ColumnKind;
  header: string;
  /** Starting (resizable) width in px. */
  defaultWidth: number;
  /** The column never shrinks below this — the basis for horizontal scroll. */
  minWidth: number;
  /** Fixed columns with a persisted, drag-resizable width (all of them). */
  resizable: boolean;
  /** Optional columns can be hidden from the columns menu. */
  optional: boolean;
}

// Per-kind metadata, independent of variant/order.
export const COLUMN_META: Record<ColumnKind, ColumnMeta> = {
  graph: { kind: "graph", header: "", defaultWidth: 156, minWidth: 90, resizable: true, optional: false },
  commit: { kind: "commit", header: "Commit", defaultWidth: 360, minWidth: 220, resizable: true, optional: false },
  author: { kind: "author", header: "Author", defaultWidth: 180, minWidth: 120, resizable: true, optional: true },
  branch: { kind: "branch", header: "Branch", defaultWidth: 236, minWidth: 120, resizable: true, optional: true },
  hash: { kind: "hash", header: "Hash", defaultWidth: 104, minWidth: 76, resizable: true, optional: true },
  date: { kind: "date", header: "Date", defaultWidth: 120, minWidth: 92, resizable: true, optional: true },
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

/**
 * The ordered, currently-visible columns for a layout variant. The graph column
 * is pinned to its edge — left in Ledger Grid, right in Split Rail — while the
 * data columns follow the (reorderable, per-variant) `order`. The commit column
 * is always present; optional columns are filtered by `visibility`. Hash and
 * date are right-aligned in Ledger Grid only.
 */
export function columnsForVariant(
  variant: GraphVariant,
  visibility: ColumnVisibility,
  order: DataColumn[],
): GraphColumn[] {
  const dataCols = order
    .filter((kind) => kind === "commit" || visibility[kind])
    .map(
      (kind): GraphColumn => ({
        id: kind,
        kind,
        header: COLUMN_META[kind].header,
        align: variant === "ledger" && (kind === "hash" || kind === "date") ? "end" : "start",
      }),
    );
  const graph: GraphColumn = { id: "graph", kind: "graph", header: COLUMN_META.graph.header, align: "start" };
  return variant === "split" ? [...dataCols, graph] : [graph, ...dataCols];
}

export interface PillHandlers {
  onPointerDown: (e: React.PointerEvent, label: BranchLabel) => void;
  onPointerEnter: (label: BranchLabel) => void;
  onPointerLeave: () => void;
  isDropTarget: (branch: string) => boolean;
}
