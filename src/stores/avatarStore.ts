import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  loadPersistedAvatars,
  savePersistedAvatars,
  type PersistedAvatar,
} from "../lib/avatarPersistence";

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

// Called from both the synchronous "loading" placeholder write (request())
// and the async resolved-entry write (settle()) — a loading placeholder can
// in principle be evicted before its settle() call lands if enough newer
// requests arrive in between; settle() then just re-inserts it as a fresh
// (newest) entry. Accepted as a benign quirk of plain FIFO with no
// touch-on-access semantics, not a correctness bug.
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
 * Snapshot the resolved (non-"loading") entries for persistence, all stamped
 * with the same `now`. The in-memory `AvatarEntry` doesn't carry its own
 * per-entry `savedAt`, so a resolution anywhere in the map refreshes every
 * persisted entry's clock together rather than each independently — in
 * practice this means the local TTL (see avatarPersistence.ts) measures "how
 * long since this app was last used", not "how long since this exact avatar
 * was fetched". That's the intended, simpler bound: it still guarantees a
 * cold start after a long absence discards the local cache and re-verifies
 * against the backend, which is all this warm-start shortcut needs.
 */
const snapshotForPersistence = (
  avatars: Map<string, AvatarEntry>,
  now: number,
): Map<string, PersistedAvatar> => {
  const out = new Map<string, PersistedAvatar>();
  for (const [email, entry] of avatars) {
    if (entry.status === "loading") continue;
    out.set(
      email,
      entry.status === "loaded"
        ? { status: "loaded", url: entry.img?.src, savedAt: now }
        : { status: "none", savedAt: now },
    );
  }
  return out;
};

/**
 * Resolves and holds commit-author avatars. Each email is requested at most once
 * per session (an in-flight/"loading" marker dedupes), and the heavy lifting —
 * the network fetch and the persistent on-disk cache — lives in the Rust
 * `get_avatars` command, so this only ever asks for what it hasn't seen. Avatars
 * arrive asynchronously: when one resolves, `version` bumps and the canvas graph
 * redraws to swap the coloured dot for the image.
 *
 * Known avatars are also mirrored to localStorage (see `lib/avatarPersistence`)
 * and reloaded here at store creation — a perceived-speed optimisation so a
 * freshly-opened app can paint avatars it has seen before immediately, without
 * waiting on a `get_avatars` round trip. The backend's own on-disk cache
 * remains the durable source of truth; this is purely a warm-start shortcut.
 */
export const useAvatarStore = create<AvatarStore>((set, get) => {
  const settle = (email: string, entry: AvatarEntry) => {
    const avatars = new Map(get().avatars);
    avatars.set(email, entry);
    evictOverflow(avatars);
    set({ avatars, version: get().version + 1 });

    if (entry.status !== "loading") {
      savePersistedAvatars(snapshotForPersistence(avatars, Date.now()));
    }
  };

  const initialAvatars = new Map<string, AvatarEntry>();
  for (const [email, persisted] of loadPersistedAvatars(Date.now())) {
    if (persisted.status === "none") {
      initialAvatars.set(email, { status: "none" });
    } else if (persisted.url) {
      initialAvatars.set(email, { status: "loading" });
      const img = new Image();
      img.onload = () => settle(email, { status: "loaded", img });
      img.onerror = () => settle(email, { status: "none" });
      img.src = persisted.url;
    }
  }

  return {
    avatars: initialAvatars,
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

      void (async () => {
        try {
          const urls = await invoke<(string | null)[]>("get_avatars", { emails: unique });
          unique.forEach((email, i) => {
            const url = urls[i];
            if (!url) {
              settle(email, { status: "none" });
              return;
            }
            const img = new Image();
            img.onload = () => settle(email, { status: "loaded", img });
            img.onerror = () => settle(email, { status: "none" });
            img.src = url;
          });
        } catch {
          unique.forEach((email) => settle(email, { status: "none" }));
        }
      })();
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
