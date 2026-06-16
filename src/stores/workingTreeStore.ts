import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useGraphStore } from "./graphStore";
import type {
  FileDiffHunks,
  Identity,
  WorkingTreeStatus,
} from "../types/workingTree";

interface WorkingTreeStore {
  status: WorkingTreeStatus | null;
  selectedPath: string | null;
  selectedDiff: FileDiffHunks | null;
  identity: Identity | null;

  loadStatus: () => Promise<void>;
  selectFile: (path: string, kind: "staged" | "unstaged") => Promise<void>;
  clearSelectedFile: () => void;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  stageHunk: (path: string, hunkIndex: number) => Promise<void>;
  unstageHunk: (path: string, hunkIndex: number) => Promise<void>;
  discardFile: (path: string) => Promise<void>;
  discardHunk: (path: string, hunkIndex: number) => Promise<void>;
  discardAll: () => Promise<void>;
  createCommit: (message: string) => Promise<void>;
  loadIdentity: () => Promise<void>;
  startWatching: () => Promise<() => void>;
}

export const useWorkingTreeStore = create<WorkingTreeStore>((set, get) => ({
  status: null,
  selectedPath: null,
  selectedDiff: null,
  identity: null,

  loadStatus: async () => {
    const status = await invoke<WorkingTreeStatus>("get_working_tree_status");
    set({ status });
  },

  selectFile: async (path: string, kind: "staged" | "unstaged") => {
    set({ selectedPath: path });
    const command = kind === "staged" ? "get_staged_diff" : "get_unstaged_diff";
    const diff = await invoke<FileDiffHunks>(command, { path });
    set({ selectedDiff: diff });
  },

  clearSelectedFile: () => set({ selectedPath: null, selectedDiff: null }),

  stageFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("stage_file", { path });
    set({ status });
  },

  unstageFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("unstage_file", { path });
    set({ status });
  },

  stageHunk: async (path: string, hunkIndex: number) => {
    await invoke("stage_hunk", { path, hunkIndex });
    await get().loadStatus();
    if (get().selectedPath === path) {
      await get().selectFile(path, "unstaged");
    }
  },

  unstageHunk: async (path: string, hunkIndex: number) => {
    await invoke("unstage_hunk", { path, hunkIndex });
    await get().loadStatus();
    if (get().selectedPath === path) {
      await get().selectFile(path, "staged");
    }
  },

  discardFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("discard_file", { path });
    set({ status, selectedPath: null, selectedDiff: null });
  },

  discardHunk: async (path: string, hunkIndex: number) => {
    await invoke("discard_hunk", { path, hunkIndex });
    await get().loadStatus();
    if (get().selectedPath === path) {
      await get().selectFile(path, "unstaged");
    }
  },

  discardAll: async () => {
    const status = await invoke<WorkingTreeStatus>("discard_all");
    set({ status, selectedPath: null, selectedDiff: null });
    // Keep the graph's working-tree node in sync after a bulk discard.
    useGraphStore.getState().refresh();
  },

  createCommit: async (message: string) => {
    await invoke("create_commit", { message });
    await get().loadStatus();
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
        get().loadStatus();
        // Keep the graph's working-tree node in sync with the file count.
        useGraphStore.getState().refresh();
      }, 300);
    });
    return unlisten;
  },
}));
