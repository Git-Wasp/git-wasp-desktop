import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { AheadBehind, FetchResult, PullResult } from "../types/github";

export type PullMode = "ffOnly" | "ffOrMerge";

interface RemoteStore {
  aheadBehind: AheadBehind[];
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  lastError: string | null;

  loadAheadBehind: () => Promise<void>;
  fetch: (remoteName?: string) => Promise<FetchResult>;
  pull: (mode?: PullMode, remoteName?: string, branch?: string) => Promise<PullResult>;
  push: (remoteName?: string, branch?: string) => Promise<void>;
}

export const useRemoteStore = create<RemoteStore>((set, get) => ({
  aheadBehind: [],
  isFetching: false,
  isPulling: false,
  isPushing: false,
  lastError: null,

  loadAheadBehind: async () => {
    const aheadBehind = await invoke<AheadBehind[]>("get_ahead_behind");
    set({ aheadBehind });
  },

  fetch: async (remoteName?: string) => {
    set({ isFetching: true, lastError: null });
    try {
      const result = await invoke<FetchResult>("fetch_remote", { remoteName: remoteName ?? null });
      await get().loadAheadBehind();
      return result;
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isFetching: false });
    }
  },

  pull: async (mode?: PullMode, remoteName?: string, branch?: string) => {
    set({ isPulling: true, lastError: null });
    try {
      const result = await invoke<PullResult>("pull_branch", {
        remoteName: remoteName ?? null,
        branch: branch ?? null,
        mode: mode ?? null,
      });
      await get().loadAheadBehind();
      return result;
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isPulling: false });
    }
  },

  push: async (remoteName?: string, branch?: string) => {
    set({ isPushing: true, lastError: null });
    try {
      await invoke("push_branch", { remoteName: remoteName ?? null, branch: branch ?? null });
      await get().loadAheadBehind();
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isPushing: false });
    }
  },
}));
