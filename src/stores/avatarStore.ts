import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

type AvatarStatus = "loading" | "loaded" | "none";

interface AvatarEntry {
  status: AvatarStatus;
  /** A decoded image, ready to draw to the canvas (only when status === "loaded"). */
  img?: HTMLImageElement;
}

interface AvatarStore {
  /** Keyed by normalised (trimmed, lowercased) email. */
  avatars: Map<string, AvatarEntry>;
  /** Bumped whenever an avatar resolves, so the canvas graph knows to redraw. */
  version: number;
  /** Resolve avatars for the given author emails (deduped; only ones not already requested). */
  request: (emails: string[]) => void;
  /** The decoded image for an email, or null if not loaded / no avatar. */
  getImage: (email: string) => HTMLImageElement | null;
  /** The avatar URL for an email (for a DOM `<img>`), or null if none is loaded. */
  getUrl: (email: string) => string | null;
}

const norm = (email: string) => email.trim().toLowerCase();

// Cap on the avatar map so a long session doesn't accumulate one entry per
// author forever. Evicts the oldest-inserted entries first (Map iteration
// order = insertion order) — simple and cheap.
export const AVATAR_CACHE_CAP = 2000;

const evictOverflow = (avatars: Map<string, AvatarEntry>): void => {
  if (avatars.size <= AVATAR_CACHE_CAP) return;
  const excess = avatars.size - AVATAR_CACHE_CAP;
  const keys = avatars.keys();
  for (let i = 0; i < excess; i++) {
    const next = keys.next();
    if (next.done) break;
    avatars.delete(next.value);
  }
};

/**
 * Resolves and holds commit-author avatars. Each email is requested at most once
 * per session (an in-flight/"loading" marker dedupes), and the heavy lifting —
 * the network fetch and the persistent on-disk cache — lives in the Rust
 * `get_avatar` command, so this only ever asks for what it hasn't seen. Avatars
 * arrive asynchronously: when one resolves, `version` bumps and the canvas graph
 * redraws to swap the coloured dot for the image.
 */
export const useAvatarStore = create<AvatarStore>((set, get) => {
  const settle = (email: string, entry: AvatarEntry) => {
    const avatars = new Map(get().avatars);
    avatars.set(email, entry);
    evictOverflow(avatars);
    set({ avatars, version: get().version + 1 });
  };

  return {
    avatars: new Map(),
    version: 0,

    request: (emails) => {
      const { avatars } = get();
      const unique = [...new Set(emails.map(norm))].filter((e) => e && !avatars.has(e));
      if (unique.length === 0) return;

      // Mark as in-flight up front so concurrent/subsequent calls don't refetch.
      const next = new Map(avatars);
      unique.forEach((e) => next.set(e, { status: "loading" }));
      evictOverflow(next);
      set({ avatars: next });

      const fetchOne = async (email: string) => {
        try {
          const url = await invoke<string | null>("get_avatar", { email });
          if (!url) {
            settle(email, { status: "none" });
            return;
          }
          const img = new Image();
          img.onload = () => settle(email, { status: "loaded", img });
          img.onerror = () => settle(email, { status: "none" });
          img.src = url;
        } catch {
          settle(email, { status: "none" });
        }
      };
      unique.forEach((email) => void fetchOne(email));
    },

    getImage: (email) => {
      const entry = get().avatars.get(norm(email));
      return entry?.status === "loaded" ? entry.img ?? null : null;
    },

    getUrl: (email) => {
      const entry = get().avatars.get(norm(email));
      return entry?.status === "loaded" ? (entry.img?.src ?? null) : null;
    },
  };
});
