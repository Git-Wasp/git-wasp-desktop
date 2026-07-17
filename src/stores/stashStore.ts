import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { StashEntry, WorkingTreeStatus } from "../types/workingTree";
import { useGraphStore } from "./graphStore";
import { useWorkingTreeStore } from "./workingTreeStore";

/**
 * Single owner of stash state. Both the sidebar StashPanel and the commit
 * graph's stash actions (pop/rename/delete on the stash node, the
 * "Stash changes…" prompt on the working-tree row) read and write through
 * this store, so an action taken from one surface is reflected in the other
 * instead of each surface holding its own separately-reloaded list.
 *
 * Backend return shapes (confirmed by reading src-tauri/src/commands/stash.rs
 * directly, not assumed):
 *  - stash_save_cmd / stash_apply_cmd / stash_pop_cmd -> WorkingTreeStatus
 *    (they mutate the working tree; the response says nothing about the
 *    stash list itself, so `create`/`pop` re-list separately to refresh
 *    `entries`. `apply` doesn't change the stash list at all — the entry
 *    stays — so it only needs the working-tree status.)
 *  - stash_list_cmd / stash_drop_cmd / stash_rename_cmd -> Vec<StashEntry>
 *    (already the fresh list — `drop`/`rename` can set `entries` straight
 *    from their own response with no follow-up `stash_list_cmd` call)
 */
interface StashStore {
  entries: StashEntry[];
  list: () => Promise<void>;
  /** Clear the list immediately, e.g. when the active repo changes and the
   *  previous repo's stashes shouldn't linger while the fresh list loads. */
  reset: () => void;
  /** Stash the working tree. Pass a name, or omit for git's default message. */
  create: (message?: string) => Promise<void>;
  apply: (index: number) => Promise<void>;
  pop: (index: number) => Promise<void>;
  drop: (index: number) => Promise<void>;
  rename: (index: number, message: string) => Promise<void>;
}

export const useStashStore = create<StashStore>((set, get) => ({
  entries: [],

  list: async () => {
    const entries = await invoke<StashEntry[]>("stash_list_cmd");
    set({ entries });
  },

  reset: () => set({ entries: [] }),

  create: async (message?: string) => {
    const status = await invoke<WorkingTreeStatus>("stash_save_cmd", { message: message ?? null });
    useWorkingTreeStore.setState({ status });
    // A new stash node appears on the graph, and the stash list gains an entry.
    await Promise.all([useGraphStore.getState().refresh(), get().list()]);
  },

  apply: async (index: number) => {
    const status = await invoke<WorkingTreeStatus>("stash_apply_cmd", { index });
    useWorkingTreeStore.setState({ status });
  },

  pop: async (index: number) => {
    const status = await invoke<WorkingTreeStatus>("stash_pop_cmd", { index });
    useWorkingTreeStore.setState({ status });
    // The stash node disappears from the graph, and the list loses an entry.
    await Promise.all([useGraphStore.getState().refresh(), get().list()]);
  },

  drop: async (index: number) => {
    const entries = await invoke<StashEntry[]>("stash_drop_cmd", { index });
    set({ entries });
    await useGraphStore.getState().refresh();
  },

  rename: async (index: number, message: string) => {
    const entries = await invoke<StashEntry[]>("stash_rename_cmd", { index, message });
    set({ entries });
  },
}));
