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
  fetchViewport: (offset: number, limit: number) => Promise<void>;
  selectCommit: (oid: string, extend: boolean) => void;
  clearSelection: () => void;
}

const emptySelection = (): Selection => ({
  anchor: null,
  focus: null,
  range: new Set(),
});

export const useGraphStore = create<GraphStore>((set, get) => ({
  viewport: null,
  selection: emptySelection(),
  selectedOid: null,

  fetchViewport: async (offset: number, limit: number) => {
    const viewport = await invoke<GraphViewport>("get_graph_viewport", {
      offset,
      limit,
    });
    set({ viewport });
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

  clearSelection: () => {
    set({ selection: emptySelection(), selectedOid: null });
  },
}));
