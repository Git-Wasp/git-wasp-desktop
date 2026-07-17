import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { FetchResult, PullResult } from "../types/github";
import { logOperationError } from "../lib/logger";
import { withAutoStash } from "../lib/autoStash";

export type PullMode = "ffOnly" | "ffOrMerge";

type AheadBehindEntry = { ahead: number; behind: number } | "loading" | "none";

interface RemoteStore {
  /** Per-branch ahead/behind, fetched on demand (only for branches a row has
   *  actually requested — see `requestAheadBehind`) instead of eagerly for
   *  every branch on every repo load/focus/push/pull/fetch. Absence of a key
   *  means "not yet requested". */
  aheadBehind: Map<string, AheadBehindEntry>;
  /** Bumped by `invalidateAheadBehind`. Included in the effect dependency
   *  that drives `requestAheadBehind` (see Sidebar's branch row) so
   *  currently-rendered rows re-request fresh data after a repo-wide
   *  operation, and guards in-flight requests from a since-invalidated epoch
   *  from writing stale data into the new one. */
  aheadBehindEpoch: number;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  lastError: string | null;

  /** Resolve ahead/behind for one branch. Deduped — a no-op if this branch
   *  was already requested in the current epoch. */
  requestAheadBehind: (name: string) => void;
  /** Discard all cached ahead/behind counts and bump the epoch, so
   *  currently-rendered rows re-request fresh data (e.g. after a fetch/pull/
   *  push/fast-forward, or a repo switch) instead of showing stale counts. */
  invalidateAheadBehind: () => void;
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
  aheadBehind: new Map(),
  aheadBehindEpoch: 0,
  isFetching: false,
  isPulling: false,
  isPushing: false,
  lastError: null,

  requestAheadBehind: (name: string) => {
    const { aheadBehind, aheadBehindEpoch } = get();
    if (aheadBehind.has(name)) return;
    const next = new Map(aheadBehind);
    next.set(name, "loading");
    set({ aheadBehind: next });

    void (async () => {
      try {
        const [ahead, behind] = await invoke<[number, number]>("branch_ahead_behind", { name });
        // Dropped, not written, if invalidateAheadBehind moved the epoch on
        // while this was in flight — a newer request may already own this key.
        if (get().aheadBehindEpoch !== aheadBehindEpoch) return;
        const m = new Map(get().aheadBehind);
        m.set(name, { ahead, behind });
        set({ aheadBehind: m });
      } catch {
        if (get().aheadBehindEpoch !== aheadBehindEpoch) return;
        const m = new Map(get().aheadBehind);
        m.set(name, "none");
        set({ aheadBehind: m });
      }
    })();
  },

  invalidateAheadBehind: () => {
    set((s) => ({ aheadBehind: new Map(), aheadBehindEpoch: s.aheadBehindEpoch + 1 }));
  },

  fetch: async (remoteName?: string, prune?: boolean) => {
    set({ isFetching: true, lastError: null });
    try {
      const result = await invoke<FetchResult>("fetch_remote", {
        remoteName: remoteName ?? null,
        prune: prune ?? false,
      });
      get().invalidateAheadBehind();
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
      get().invalidateAheadBehind();
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
      get().invalidateAheadBehind();
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
      get().invalidateAheadBehind();
    } catch (e) {
      set({ lastError: logOperationError("fast-forward", e) });
      throw e;
    }
  },
}));
