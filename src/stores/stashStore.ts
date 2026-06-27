import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useGraphStore } from "./graphStore";
import { useWorkingTreeStore } from "./workingTreeStore";

/**
 * Stash actions invoked from the commit graph. Each refreshes the graph (so the
 * stash node appears/disappears) and the working-tree status (create and pop
 * change the working tree). The sidebar StashPanel keeps its own list and
 * reloads on its own triggers.
 */
interface StashStore {
  create: (message: string) => Promise<void>;
  pop: (index: number) => Promise<void>;
  drop: (index: number) => Promise<void>;
  rename: (index: number, message: string) => Promise<void>;
}

async function refreshAfterStash() {
  await Promise.all([
    useGraphStore.getState().refresh(),
    useWorkingTreeStore.getState().loadStatus(),
  ]);
}

export const useStashStore = create<StashStore>(() => ({
  create: async (message: string) => {
    await invoke("stash_save_cmd", { message });
    await refreshAfterStash();
  },
  pop: async (index: number) => {
    await invoke("stash_pop_cmd", { index });
    await refreshAfterStash();
  },
  drop: async (index: number) => {
    await invoke("stash_drop_cmd", { index });
    await refreshAfterStash();
  },
  rename: async (index: number, message: string) => {
    await invoke("stash_rename_cmd", { index, message });
    await refreshAfterStash();
  },
}));
