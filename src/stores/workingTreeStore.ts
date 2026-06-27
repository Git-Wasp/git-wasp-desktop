import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useGraphStore } from "./graphStore";
import { nextSelectionAfterStaging, unstagedPaths } from "../lib/stagingSelection";
import type {
  HeadCommitInfo,
  Identity,
  StageFileContents,
  WorkingTreeStatus,
} from "../types/workingTree";

interface WorkingTreeStore {
  status: WorkingTreeStatus | null;
  selectedPath: string | null;
  stageDiff: StageFileContents | null;
  identity: Identity | null;
  headCommit: HeadCommitInfo | null;

  loadStatus: () => Promise<void>;
  refreshAll: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  clearSelectedFile: () => void;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  applyStagedContent: (path: string, content: string) => Promise<void>;
  discardFile: (path: string) => Promise<void>;
  discardAll: () => Promise<void>;
  createCommit: (message: string) => Promise<void>;
  amendCommitMessage: (message: string) => Promise<void>;
  loadHeadCommit: () => Promise<void>;
  loadIdentity: () => Promise<void>;
  startWatching: () => Promise<() => void>;
}

// After staging `path` (which was the file open in the diff view), move the
// selection to the next file that still needs staging and load its diff. If
// `path` was only partially staged, or it was the last file, the helper keeps it
// selected (it slots back into `target`). See `nextSelectionAfterStaging`.
async function reselectAfterStaging(
  set: (partial: Partial<WorkingTreeStore>) => void,
  path: string,
  prevChanges: string[],
  status: WorkingTreeStatus,
) {
  const target = nextSelectionAfterStaging(prevChanges, unstagedPaths(status), path);
  set({ selectedPath: target });
  const stageDiff = await invoke<StageFileContents>("get_stage_file_contents", { path: target });
  set({ stageDiff });
}

export const useWorkingTreeStore = create<WorkingTreeStore>((set, get) => ({
  status: null,
  selectedPath: null,
  stageDiff: null,
  identity: null,
  headCommit: null,

  loadStatus: async () => {
    const status = await invoke<WorkingTreeStatus>("get_working_tree_status");
    set({ status });
  },

  // Re-sync everything that reflects the working tree: the staging list, the
  // graph's cached dirty-file count, and the graph viewport. Used by the file
  // watcher, the manual "Refresh" button, and the background poll. The order
  // matters — the backend's cached working-tree count must be refreshed before
  // the viewport is re-fetched (the viewport no longer rescans on every call).
  refreshAll: async () => {
    await get().loadStatus();
    await invoke("refresh_graph_working_tree_status");
    await useGraphStore.getState().refresh();
  },

  // Selecting a file opens it in the line-level staging editor: load its HEAD vs
  // working-tree content. The editor is a single surface for staging/unstaging,
  // so it doesn't matter which list the file was selected from.
  selectFile: async (path: string) => {
    set({ selectedPath: path });
    const stageDiff = await invoke<StageFileContents>("get_stage_file_contents", { path });
    set({ stageDiff });
  },

  clearSelectedFile: () => set({ selectedPath: null, stageDiff: null }),

  stageFile: async (path: string) => {
    const prevChanges = unstagedPaths(get().status);
    const wasSelected = get().selectedPath === path;
    const status = await invoke<WorkingTreeStatus>("stage_file", { path });
    set({ status });
    // If the diff view was open on this file, advance to the next unstaged one.
    if (wasSelected) await reselectAfterStaging(set, path, prevChanges, status);
  },

  unstageFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("unstage_file", { path });
    set({ status });
  },

  // Stage exactly `content` for `path` (the staging editor's result buffer),
  // then refresh status. When the diff view was open on this file, advance to the
  // next file that still needs staging (a partial stage keeps it selected).
  applyStagedContent: async (path: string, content: string) => {
    const prevChanges = unstagedPaths(get().status);
    const wasSelected = get().selectedPath === path;
    const status = await invoke<WorkingTreeStatus>("stage_file_content", { path, content });
    set({ status });
    if (wasSelected) await reselectAfterStaging(set, path, prevChanges, status);
  },

  discardFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("discard_file", { path });
    set({ status, selectedPath: null, stageDiff: null });
  },

  discardAll: async () => {
    const status = await invoke<WorkingTreeStatus>("discard_all");
    set({ status, selectedPath: null, stageDiff: null });
    // Keep the graph's working-tree node in sync after a bulk discard.
    useGraphStore.getState().refresh();
  },

  createCommit: async (message: string) => {
    await invoke("create_commit", { message });
    await get().loadStatus();
    await get().loadHeadCommit();
  },

  amendCommitMessage: async (message: string) => {
    await invoke("amend_commit_message", { message });
    await get().loadHeadCommit();
    // The reworded commit is a new oid, so refresh the graph too.
    useGraphStore.getState().refresh();
  },

  loadHeadCommit: async () => {
    const headCommit = await invoke<HeadCommitInfo | null>("get_head_commit_info");
    set({ headCommit });
  },

  loadIdentity: async () => {
    const identity = await invoke<Identity>("get_commit_identity");
    set({ identity });
  },

  startWatching: async () => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = await listen("working-tree-changed", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Refresh the cached dirty-file count the graph uses for its
        // working-tree node *before* re-fetching — the graph viewport command
        // no longer rescans the working tree on every call (it was costing a
        // full statuses() walk per scroll tick on large repos), so this
        // explicit, debounced refresh is what keeps it in sync now.
        void get().refreshAll();
      }, 300);
    });
    return unlisten;
  },
}));
