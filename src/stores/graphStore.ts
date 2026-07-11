import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { GraphNode, GraphViewport } from "../types/graph";
import { DEFAULT_DENSITY, isGraphDensity, type GraphDensity } from "../lib/graphDensity";

// Sentinel oid of the synthetic working-tree (uncommitted changes) node — must
// match the backend graph layout (`graph/layout.rs`). Selecting it highlights
// that row without pointing the commit-detail panel at a real commit.
export const WORKING_TREE_OID = "WORKING_TREE";

// Rows to load on the first graph fetch (offset 0) — enough to fill the viewport
// with headroom before scrolling triggers more. Shared by every "reload the
// graph" call site (repo activation, sidebar refresh, post-commit) so they agree.
export const GRAPH_INITIAL_LIMIT = 150;

interface Selection {
  anchor: string | null;
  focus: string | null;
  range: Set<string>;
}

// Persisted "focus current branch" view preference. On by default: the graph
// keeps the checked-out branch and its ancestors coloured and mutes everything
// else. Persisted to localStorage so it survives reloads.
const FOCUS_BRANCH_KEY = "graphFocusCurrentBranch";

const loadFocusCurrentBranch = (): boolean => {
  try {
    // Default on — only an explicit "false" turns it off.
    return localStorage.getItem(FOCUS_BRANCH_KEY) !== "false";
  } catch {
    return true;
  }
};

// The two graph layout variants from the redesign: "ledger" (graph anchored
// left) and "split" (Split Rail — graph mirrored to the right edge, hash read
// like a log file on the left). Persisted so the choice survives reloads.
export type GraphVariant = "ledger" | "split";
const VARIANT_KEY = "graphVariant";

// Row-density preset (Comfortable / Cozy / Compact — see lib/graphDensity).
// Persisted alongside the layout variant so the choice survives reloads.
const DENSITY_KEY = "graphDensity";

const loadGraphDensity = (): GraphDensity => {
  try {
    const stored = localStorage.getItem(DENSITY_KEY);
    return isGraphDensity(stored) ? stored : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
};

const loadGraphVariant = (): GraphVariant => {
  try {
    return localStorage.getItem(VARIANT_KEY) === "split" ? "split" : "ledger";
  } catch {
    return "ledger";
  }
};

// The optional (hideable) data columns and their persisted on/off state. The
// graph and commit columns are structural and always shown, so they aren't
// listed here. Persisted to localStorage; all default on.
export type OptionalColumn = "author" | "branch" | "hash" | "date";
export type ColumnVisibility = Record<OptionalColumn, boolean>;
const OPTIONAL_COLUMNS: OptionalColumn[] = ["author", "branch", "hash", "date"];
const COLUMNS_KEY = "graphVisibleColumns";

const loadColumnVisibility = (): ColumnVisibility => {
  const all = Object.fromEntries(OPTIONAL_COLUMNS.map((c) => [c, true])) as ColumnVisibility;
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    if (!raw) return all;
    const parsed = JSON.parse(raw) as Partial<Record<OptionalColumn, boolean>>;
    for (const c of OPTIONAL_COLUMNS) {
      if (typeof parsed[c] === "boolean") all[c] = parsed[c] as boolean;
    }
    return all;
  } catch {
    return all;
  }
};

// The reorderable data columns (the graph column is always pinned to its edge
// and isn't part of the order). Each layout variant keeps its own order — Ledger
// Grid and Split Rail default to different arrangements — and both persist.
export type DataColumn = "commit" | OptionalColumn;
export type ColumnOrder = Record<GraphVariant, DataColumn[]>;
const DATA_COLUMNS: DataColumn[] = ["commit", "author", "branch", "hash", "date"];
const DEFAULT_ORDER: ColumnOrder = {
  ledger: ["commit", "author", "branch", "hash", "date"],
  split: ["hash", "commit", "author", "branch", "date"],
};
const ORDER_KEY = "graphColumnOrder";

// Sanitise a persisted order: keep only known columns (deduped) and append any
// that are missing, so a stored order always covers every data column.
const sanitizeOrder = (saved: unknown, fallback: DataColumn[]): DataColumn[] => {
  const seen = new Set<DataColumn>();
  const out: DataColumn[] = [];
  if (Array.isArray(saved)) {
    for (const k of saved) {
      if (DATA_COLUMNS.includes(k as DataColumn) && !seen.has(k as DataColumn)) {
        seen.add(k as DataColumn);
        out.push(k as DataColumn);
      }
    }
  }
  for (const k of fallback) if (!seen.has(k)) out.push(k);
  return out;
};

const loadColumnOrder = (): ColumnOrder => {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ColumnOrder>) : {};
    return {
      ledger: sanitizeOrder(parsed.ledger, DEFAULT_ORDER.ledger),
      split: sanitizeOrder(parsed.split, DEFAULT_ORDER.split),
    };
  } catch {
    return { ledger: [...DEFAULT_ORDER.ledger], split: [...DEFAULT_ORDER.split] };
  }
};

interface GraphStore {
  viewport: GraphViewport | null;
  selection: Selection;
  selectedOid: string | null;
  lastOffset: number | null;
  lastLimit: number | null;
  // A row the graph should scroll into view (set by revealCommit); the graph
  // consumes and resets it. Null when there's nothing pending.
  scrollToRow: number | null;
  // Every node fetched this session, keyed by row. Scrolling back to a range
  // we've already loaded is served from here instead of round-tripping
  // through invoke() — without this, scrolling up after scrolling down
  // re-fetched (and on a large repo, re-paid for) the same rows every time.
  // Cleared by refresh(), since a refresh means the underlying history or
  // working-tree state may have moved.
  nodesByRow: Map<number, GraphNode>;
  // "Focus current branch" view mode — mutes commits/edges not on HEAD's line
  // of history. Persisted to localStorage; defaults on.
  focusCurrentBranch: boolean;
  setFocusCurrentBranch: (value: boolean) => void;
  // Graph layout variant (Ledger Grid vs Split Rail). Persisted to localStorage.
  graphVariant: GraphVariant;
  setGraphVariant: (value: GraphVariant) => void;
  // Row-density preset (Comfortable / Cozy / Compact). Persisted to localStorage.
  graphDensity: GraphDensity;
  setGraphDensity: (value: GraphDensity) => void;
  // Which optional data columns are shown. Persisted to localStorage.
  visibleColumns: ColumnVisibility;
  toggleColumn: (column: OptionalColumn) => void;
  // Per-variant data-column order (drag-to-reorder in the header). Persisted.
  columnOrder: ColumnOrder;
  setColumnOrder: (variant: GraphVariant, order: DataColumn[]) => void;
  fetchViewport: (offset: number, limit: number) => Promise<void>;
  refresh: () => Promise<void>;
  selectCommit: (oid: string, extend: boolean) => void;
  selectWorkingTree: () => void;
  revealCommit: (oid: string) => Promise<void>;
  revealHead: () => Promise<void>;
  clearSelection: () => void;
  // Clear all graph state (viewport, row cache, selection). Called when the
  // active repo changes so the next fetch starts from scratch — otherwise the
  // previous repo's cached rows would be served for the new one, and the graph
  // renders its loading skeleton (viewport === null) until the fetch lands.
  reset: () => void;
}

const emptySelection = (): Selection => ({
  anchor: null,
  focus: null,
  range: new Set(),
});

const isRangeCached = (
  cache: Map<number, GraphNode>,
  offset: number,
  limit: number,
  totalCount: number,
): boolean => {
  const end = Math.min(offset + limit, totalCount);
  // An empty clipped range only counts as "cached" when there's truly
  // nothing to load (totalCount 0) — not when offset is past a totalCount
  // that's stale (e.g. read right after refresh() clears the cache).
  if (end <= offset) return totalCount === 0;
  for (let row = offset; row < end; row++) {
    if (!cache.has(row)) return false;
  }
  return true;
};

const sliceFromCache = (
  cache: Map<number, GraphNode>,
  offset: number,
  limit: number,
  totalCount: number,
  // Layout-wide (constant across slices while HEAD is unchanged); preserved so
  // the working-tree→HEAD connector can reach HEAD even from a cached slice.
  headRow: number | null | undefined,
): GraphViewport => {
  const end = Math.min(offset + limit, totalCount);
  const nodes: GraphNode[] = [];
  for (let row = offset; row < end; row++) {
    const node = cache.get(row);
    if (node) nodes.push(node);
  }
  return { nodes, totalCount, offset, headRow };
};

const mergeIntoCache = (cache: Map<number, GraphNode>, viewport: GraphViewport): void => {
  for (const node of viewport.nodes) {
    cache.set(node.row, node);
  }
};

export const useGraphStore = create<GraphStore>((set, get) => {
  // Monotonic id so only the newest in-flight viewport fetch is applied. Rapid
  // scrolling fires overlapping fetches; without this, an older slice resolving
  // late could clobber a newer one and make the graph jump ("flash").
  let fetchId = 0;

  // Always hits the backend and merges the result into the row cache —
  // bypasses the cache-hit check entirely. refresh() needs this: it clears
  // the cache because the underlying data may have moved, so it must not
  // turn around and ask the (just-cleared) cache whether the range is
  // already loaded.
  const fetchAndCache = async (offset: number, limit: number) => {
    const id = ++fetchId;
    const fetched = await invoke<GraphViewport>("get_graph_viewport", { offset, limit });
    if (id !== fetchId) return; // superseded by a newer fetch
    mergeIntoCache(get().nodesByRow, fetched);
    set({ viewport: fetched, lastOffset: offset, lastLimit: limit });
  };

  return {
  viewport: null,
  selection: emptySelection(),
  selectedOid: null,
  lastOffset: null,
  lastLimit: null,
  scrollToRow: null,
  nodesByRow: new Map(),
  focusCurrentBranch: loadFocusCurrentBranch(),
  graphVariant: loadGraphVariant(),

  setFocusCurrentBranch: (value: boolean) => {
    try {
      localStorage.setItem(FOCUS_BRANCH_KEY, String(value));
    } catch {
      // Ignore storage failures (private mode etc.) — state still updates.
    }
    set({ focusCurrentBranch: value });
  },

  setGraphVariant: (value: GraphVariant) => {
    try {
      localStorage.setItem(VARIANT_KEY, value);
    } catch {
      // Ignore storage failures (private mode etc.) — state still updates.
    }
    set({ graphVariant: value });
  },

  graphDensity: loadGraphDensity(),

  setGraphDensity: (value: GraphDensity) => {
    try {
      localStorage.setItem(DENSITY_KEY, value);
    } catch {
      // Ignore storage failures (private mode etc.) — state still updates.
    }
    set({ graphDensity: value });
  },

  visibleColumns: loadColumnVisibility(),

  toggleColumn: (column: OptionalColumn) => {
    const next = { ...get().visibleColumns, [column]: !get().visibleColumns[column] };
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures (private mode etc.) — state still updates.
    }
    set({ visibleColumns: next });
  },

  columnOrder: loadColumnOrder(),

  setColumnOrder: (variant: GraphVariant, order: DataColumn[]) => {
    const next = { ...get().columnOrder, [variant]: sanitizeOrder(order, DEFAULT_ORDER[variant]) };
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures (private mode etc.) — state still updates.
    }
    set({ columnOrder: next });
  },

  fetchViewport: async (offset: number, limit: number) => {
    const { viewport, nodesByRow } = get();
    if (viewport && isRangeCached(nodesByRow, offset, limit, viewport.totalCount)) {
      ++fetchId; // supersede any fetch still in flight so it can't clobber this
      set({
        viewport: sliceFromCache(nodesByRow, offset, limit, viewport.totalCount, viewport.headRow),
        lastOffset: offset,
        lastLimit: limit,
      });
      return;
    }
    await fetchAndCache(offset, limit);
  },

  refresh: async () => {
    const { lastOffset, lastLimit, nodesByRow } = get();
    if (lastOffset === null || lastLimit === null) return;
    nodesByRow.clear();
    await fetchAndCache(lastOffset, lastLimit);
  },

  selectCommit: (oid: string, extend: boolean) => {
    const { viewport, selection } = get();
    if (!viewport) return;

    if (!extend) {
      set({
        selection: { anchor: oid, focus: oid, range: new Set([oid]) },
        selectedOid: oid,
      });
      return;
    }

    const anchorOid = selection.anchor ?? oid;
    const anchorNode = viewport.nodes.find((n) => n.oid === anchorOid);
    const focusNode = viewport.nodes.find((n) => n.oid === oid);

    if (!anchorNode || !focusNode) {
      set({
        selection: { anchor: oid, focus: oid, range: new Set([oid]) },
        selectedOid: oid,
      });
      return;
    }

    const minRow = Math.min(anchorNode.row, focusNode.row);
    const maxRow = Math.max(anchorNode.row, focusNode.row);
    const range = new Set(
      viewport.nodes
        .filter((n) => n.row >= minRow && n.row <= maxRow)
        .map((n) => n.oid)
    );

    set({
      selection: { anchor: anchorOid, focus: oid, range },
      selectedOid: oid,
    });
  },

  // Select the working-tree (uncommitted changes) row: highlight it like a
  // commit, but clear `selectedOid` so the commit-detail panel doesn't try to
  // resolve the sentinel oid. This is what makes the uncommitted row read as
  // "currently selected" instead of leaving the previously selected commit
  // (often HEAD) looking selected.
  selectWorkingTree: () => {
    set({
      selection: {
        anchor: WORKING_TREE_OID,
        focus: WORKING_TREE_OID,
        range: new Set([WORKING_TREE_OID]),
      },
      selectedOid: null,
    });
  },

  // Select a commit by oid (e.g. a branch head from the sidebar) and ask the
  // graph to scroll to it. Selecting happens immediately so the detail panel
  // updates even if the commit isn't in the loaded slice; the row lookup then
  // drives the scroll (skipped when the commit isn't reachable from HEAD).
  revealCommit: async (oid: string) => {
    set({
      selection: { anchor: oid, focus: oid, range: new Set([oid]) },
      selectedOid: oid,
    });
    try {
      const row = await invoke<number | null>("find_commit_row", { oid });
      if (row !== null) set({ scrollToRow: row });
    } catch {
      // No row (detached/unreachable) — selection still stands.
    }
  },

  // Select the checked-out (HEAD) commit and scroll it into view, wherever the
  // user has scrolled to. Resolves HEAD's oid from the backend (it may not be in
  // the loaded slice) and delegates to revealCommit.
  revealHead: async () => {
    try {
      const head = await invoke<{ oid: string } | null>("get_head_commit_info");
      if (head?.oid) await get().revealCommit(head.oid);
    } catch {
      // No HEAD (unborn branch) — nothing to reveal.
    }
  },

  clearSelection: () => {
    set({ selection: emptySelection(), selectedOid: null });
  },

  reset: () => {
    // Supersede any fetch still in flight (e.g. the previous repo's) so a late
    // response can't populate the freshly-cleared graph.
    ++fetchId;
    set({
      viewport: null,
      selection: emptySelection(),
      selectedOid: null,
      lastOffset: null,
      lastLimit: null,
      scrollToRow: null,
      nodesByRow: new Map(),
    });
  },
  };
});
