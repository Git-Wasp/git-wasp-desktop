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

// Which side of the index the open file is being edited from. "unstaged" = the
// Changes panel (index → working tree; toggling a line stages it); "staged" =
// the Staged panel (HEAD → index; toggling a line unstages it). Drives which two
// blobs `get_stage_file_contents` returns and how the editor interprets a toggle.
export type StageMode = "staged" | "unstaged";

interface WorkingTreeStore {
  status: WorkingTreeStatus | null;
  selectedPath: string | null;
  stageMode: StageMode | null;
  stageDiff: StageFileContents | null;
  identity: Identity | null;
  headCommit: HeadCommitInfo | null;

  loadStatus: () => Promise<void>;
  refreshAll: () => Promise<void>;
  selectFile: (path: string, mode: StageMode) => Promise<void>;
  clearSelectedFile: () => void;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  /** Write `content` as the file's index blob (line-level stage/unstage) and
   *  re-fetch the open file's diff in its current mode so the editor updates. */
  applyIndexContent: (path: string, content: string) => Promise<void>;
  discardFile: (path: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  discardAll: () => Promise<void>;
  createCommit: (message: string) => Promise<void>;
  amendCommitMessage: (message: string) => Promise<void>;
  loadHeadCommit: () => Promise<void>;
  loadIdentity: () => Promise<void>;
  startWatching: () => Promise<() => void>;
  /** Clear everything repo-scoped (selection, staging diff, status, HEAD info)
   *  so a previous repo's state can't linger into a newly-activated one.
   *  `identity` is user-level, not repo-scoped, so it's left alone. */
  reset: () => void;
}

// After staging `path` (which was the file open in the diff view), move the
// selection to the next file that still needs staging and load its diff. If
// `path` was only partially staged, or it was the last file, the helper keeps it
// selected (it slots back into `target`). See `nextSelectionAfterStaging`.
async function reselectAfterStaging(
  set: (partial: Partial<WorkingTreeStore>) => void,
  get: () => WorkingTreeStore,
  path: string,
  prevChanges: string[],
  status: WorkingTreeStatus,
) {
  const target = nextSelectionAfterStaging(prevChanges, unstagedPaths(status), path);
  // The next file to stage is, by definition, still unstaged — open it in that view.
  set({ selectedPath: target, stageMode: "unstaged" });
  const stageDiff = await invoke<StageFileContents>("get_stage_file_contents", {
    path: target,
    staged: false,
  });
  if (get().selectedPath === target && get().stageMode === "unstaged") set({ stageDiff });
}

export const useWorkingTreeStore = create<WorkingTreeStore>((set, get) => ({
  status: null,
  selectedPath: null,
  stageMode: null,
  stageDiff: null,
  identity: null,
  headCommit: null,

  loadStatus: async () => {
    const status = await invoke<WorkingTreeStatus>("get_working_tree_status");
    set({ status });
  },

  // Re-sync everything that reflects the working tree: the staging list, the
  // graph's cached dirty-file count, and the graph viewport. Used by the file
  // watcher, the manual "Refresh" button, and the background poll. A single
  // `refresh_working_tree` scan yields both the detailed status and the graph's
  // dirty count (one `git status` instead of two), then the viewport re-fetch
  // slices the cache with the freshly-updated count.
  refreshAll: async () => {
    const status = await invoke<WorkingTreeStatus>("refresh_working_tree");
    set({ status });
    const { selectedPath, stageMode } = get();
    if (selectedPath && stageMode) {
      const stageDiff = await invoke<StageFileContents>("get_stage_file_contents", {
        path: selectedPath,
        staged: stageMode === "staged",
      });
      if (get().selectedPath === selectedPath && get().stageMode === stageMode) set({ stageDiff });
    }
    await useGraphStore.getState().refresh();
  },

  // Open a file in the line-level staging editor. `mode` says which panel it came
  // from: "unstaged" shows the index→working-tree diff (toggling a line stages
  // it), "staged" shows HEAD→index (toggling unstages). The same file can be open
  // from either side when it's partially staged.
  selectFile: async (path: string, mode: StageMode) => {
    set({ selectedPath: path, stageMode: mode });
    const staged = mode === "staged";
    const stageDiff = await invoke<StageFileContents>("get_stage_file_contents", { path, staged });
    // Drop a late response if the selection has since moved on (mirrors commitFileStore.selectFile).
    if (get().selectedPath === path && get().stageMode === mode) set({ stageDiff });
  },

  clearSelectedFile: () => set({ selectedPath: null, stageMode: null, stageDiff: null }),

  stageFile: async (path: string) => {
    const prevChanges = unstagedPaths(get().status);
    const wasSelected = get().selectedPath === path;
    const status = await invoke<WorkingTreeStatus>("stage_file", { path });
    set({ status });
    // If the diff view was open on this file, advance to the next unstaged one.
    if (wasSelected) await reselectAfterStaging(set, get, path, prevChanges, status);
  },

  unstageFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("unstage_file", { path });
    set({ status });
  },

  // Write `content` as `path`'s index blob — the mechanism behind an immediate
  // per-line stage/unstage: the editor composes the new index content for the one
  // toggled line and calls this. Afterwards, re-fetch the same file's diff in its
  // current mode so the editor reflects the new index (the toggled line moves out
  // of this view) and refresh the graph's dirty-file node.
  applyIndexContent: async (path: string, content: string) => {
    const mode = get().stageMode ?? "unstaged";
    const status = await invoke<WorkingTreeStatus>("stage_file_content", { path, content });
    set({ status });
    if (get().selectedPath === path) {
      const stageDiff = await invoke<StageFileContents>("get_stage_file_contents", {
        path,
        staged: mode === "staged",
      });
      set({ stageDiff });
    }
    await useGraphStore.getState().refresh();
  },

  discardFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("discard_file", { path });
    set({ status, selectedPath: null, stageDiff: null });
  },

  // Delete a file from the working tree. Only closes the open diff if it was
  // this file's (deleting some other file shouldn't dismiss the current view).
  deleteFile: async (path: string) => {
    const status = await invoke<WorkingTreeStatus>("delete_file", { path });
    const wasSelected = get().selectedPath === path;
    set({
      status,
      ...(wasSelected ? { selectedPath: null, stageDiff: null } : {}),
    });
  },

  discardAll: async () => {
    const status = await invoke<WorkingTreeStatus>("discard_all");
    set({ status, selectedPath: null, stageDiff: null });
    // Keep the graph's working-tree node in sync after a bulk discard.
    await useGraphStore.getState().refresh();
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
    await useGraphStore.getState().refresh();
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
        debounceTimer = null;
        void get().refreshAll();
      }, 300);
    });
    // The debounce timer must be torn down alongside the listener — otherwise
    // a fs event that arrives just before unlisten() still fires a refresh
    // (and setState) after the caller (e.g. an unmounting StagingPanel) has
    // moved on.
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unlisten();
    };
  },

  reset: () =>
    set({
      status: null,
      selectedPath: null,
      stageMode: null,
      stageDiff: null,
      headCommit: null,
    }),
}));
