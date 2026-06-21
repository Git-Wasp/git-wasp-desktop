import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { GraphViewport } from "../types/graph";

interface Selection {
  anchor: string | null;
  focus: string | null;
  range: Set<string>;
}

interface GraphStore {
  viewport: GraphViewport | null;
  selection: Selection;
  selectedOid: string | null;
  lastOffset: number | null;
  lastLimit: number | null;
  // A row the graph should scroll into view (set by revealCommit); the graph
  // consumes and resets it. Null when there's nothing pending.
  scrollToRow: number | null;
  fetchViewport: (offset: number, limit: number) => Promise<void>;
  refresh: () => Promise<void>;
  selectCommit: (oid: string, extend: boolean) => void;
  revealCommit: (oid: string) => Promise<void>;
  clearSelection: () => void;
}

const emptySelection = (): Selection => ({
  anchor: null,
  focus: null,
  range: new Set(),
});

export const useGraphStore = create<GraphStore>((set, get) => {
  // Monotonic id so only the newest in-flight viewport fetch is applied. Rapid
  // scrolling fires overlapping fetches; without this, an older slice resolving
  // late could clobber a newer one and make the graph jump ("flash").
  let fetchId = 0;

  return {
  viewport: null,
  selection: emptySelection(),
  selectedOid: null,
  lastOffset: null,
  lastLimit: null,
  scrollToRow: null,

  fetchViewport: async (offset: number, limit: number) => {
    const id = ++fetchId;
    const viewport = await invoke<GraphViewport>("get_graph_viewport", {
      offset,
      limit,
    });
    if (id !== fetchId) return; // superseded by a newer fetch
    set({ viewport, lastOffset: offset, lastLimit: limit });
  },

  refresh: async () => {
    const { lastOffset, lastLimit, fetchViewport } = get();
    if (lastOffset === null || lastLimit === null) return;
    await fetchViewport(lastOffset, lastLimit);
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

  clearSelection: () => {
    set({ selection: emptySelection(), selectedOid: null });
  },
  };
});
