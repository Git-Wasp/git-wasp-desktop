import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { AheadBehind, FetchResult, PullResult } from "../types/github";
import { logOperationError } from "../lib/logger";
import { withAutoStash } from "../lib/autoStash";

export type PullMode = "ffOnly" | "ffOrMerge";

interface RemoteStore {
  aheadBehind: AheadBehind[];
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  lastError: string | null;

  loadAheadBehind: () => Promise<void>;
  fetch: (remoteName?: string, prune?: boolean) => Promise<FetchResult>;
  // Resolves to `undefined` when a pull is blocked by uncommitted changes and
  // the user cancels the auto-stash prompt.
  pull: (mode?: PullMode, remoteName?: string, branch?: string) => Promise<PullResult | undefined>;
  push: (remoteName?: string, branch?: string) => Promise<void>;
  /** Fast-forward a local branch to its upstream using the already-fetched
   *  remote state (no network). For advancing a branch that isn't checked out,
   *  e.g. local `main` to `origin/main` while on a feature branch. */
  fastForwardToUpstream: (branch: string) => Promise<void>;
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

  fetch: async (remoteName?: string, prune?: boolean) => {
    set({ isFetching: true, lastError: null });
    try {
      const result = await invoke<FetchResult>("fetch_remote", {
        remoteName: remoteName ?? null,
        prune: prune ?? false,
      });
      await get().loadAheadBehind();
      return result;
    } catch (e) {
      set({ lastError: logOperationError("fetch", e) });
      throw e;
    } finally {
      set({ isFetching: false });
    }
  },

  pull: async (mode?: PullMode, remoteName?: string, branch?: string) => {
    set({ isPulling: true, lastError: null });
    try {
      // On a dirty tree the pull is auto-stashed (with confirmation) then the
      // changes are reapplied — "reapply on pull". `undefined` = user cancelled.
      const result = await withAutoStash(
        (autoStash) =>
          invoke<PullResult>("pull_branch", {
            remoteName: remoteName ?? null,
            branch: branch ?? null,
            mode: mode ?? null,
            autoStash,
          }),
        {
          title: "Uncommitted changes",
          message:
            "You have uncommitted changes that would be lost by pulling. Stash them, pull, then reapply them?",
          confirmLabel: "Stash & pull",
        },
      );
      await get().loadAheadBehind();
      return result;
    } catch (e) {
      set({ lastError: logOperationError("pull", e) });
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
      set({ lastError: logOperationError("push", e) });
      throw e;
    } finally {
      set({ isPushing: false });
    }
  },

  fastForwardToUpstream: async (branch: string) => {
    set({ lastError: null });
    try {
      await invoke("fast_forward_to_upstream", { branch });
      await get().loadAheadBehind();
    } catch (e) {
      set({ lastError: logOperationError("fast-forward", e) });
      throw e;
    }
  },
}));
