import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useGraphStore } from "./graphStore";
import { useRepoStore } from "./repoStore";

/**
 * Tag actions + the set of tags known to exist on the remote (for the
 * local/remote/"both" indicator on tag pills and to gate "Push tag"). The graph
 * only knows local refs, so a visible tag is either local-only or "both"
 * (present on the remote too); remote-only tags aren't shown.
 */
interface TagStore {
  /** Short names of tags present on the remote. */
  remoteTags: string[];
  /** Whether `remoteTags` reflects a completed remote query (vs. not-yet-loaded). */
  loaded: boolean;
  loadRemoteTags: () => Promise<void>;
  isOnRemote: (name: string) => boolean;
  pushTag: (name: string) => Promise<void>;
  /** Delete a tag locally, and from the remote when `alsoRemote`. */
  deleteTag: (name: string, alsoRemote: boolean) => Promise<void>;
}

export const useTagStore = create<TagStore>((set, get) => ({
  remoteTags: [],
  loaded: false,

  loadRemoteTags: async () => {
    const epoch = useRepoStore.getState().activationEpoch;
    try {
      const remoteTags = await invoke<string[]>("list_remote_tags");
      if (useRepoStore.getState().activationEpoch !== epoch) return; // superseded by a repo switch
      set({ remoteTags, loaded: true });
    } catch {
      // Best-effort (offline / no remote): leave the indicator unknown, and
      // clear any stale tags from a previously-loaded repo/remote.
      if (useRepoStore.getState().activationEpoch !== epoch) return;
      set({ remoteTags: [], loaded: false });
    }
  },

  isOnRemote: (name: string) => get().remoteTags.includes(name),

  pushTag: async (name: string) => {
    await invoke("push_tag", { tag: name });
    await get().loadRemoteTags();
    await useGraphStore.getState().refresh();
  },

  deleteTag: async (name: string, alsoRemote: boolean) => {
    await invoke("delete_tag", { name });
    if (alsoRemote) {
      await invoke("delete_remote_tag", { tag: name });
    }
    await get().loadRemoteTags();
    await useGraphStore.getState().refresh();
  },
}));
