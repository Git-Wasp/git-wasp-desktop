// Cross-session avatar cache in localStorage — a perceived-speed optimisation
// only. The Rust backend already has a durable, TTL'd on-disk cache (see
// `avatar/mod.rs`), so this local copy doesn't need to be authoritative: it
// just needs to survive long enough to paint known avatars the instant the
// app opens, before any `get_avatars` round trip completes. Kept as pure
// functions (no zustand/localStorage-global coupling) so the cap/TTL/parsing
// logic is cheap to unit test.

/** What we persist per email — no `HTMLImageElement`, just enough to rebuild one. */
export interface PersistedAvatar {
  status: "loaded" | "none";
  /** Only present when `status === "loaded"`. */
  url?: string;
  /** `Date.now()` when this entry was last written. */
  savedAt: number;
}

export const AVATAR_STORAGE_KEY = "avatarCache";

// localStorage is a few MB per origin and avatar data: URLs run a few KB each,
// so this is capped far below the in-memory `AVATAR_CACHE_CAP` in avatarStore.
export const AVATAR_PERSIST_CAP = 300;

// A local-only TTL, distinct from (and shorter than) the backend's 14-day
// cache: bounds how long a stale entry can suppress a genuine re-fetch after
// an author updates their Gravatar, while still covering same-day reopens —
// the common case this exists for.
export const AVATAR_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

/** Read and freshness-filter the persisted cache. Never throws. */
export function loadPersistedAvatars(now: number): Map<string, PersistedAvatar> {
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return new Map();
    const fresh = Object.entries(parsed as Record<string, PersistedAvatar>).filter(
      ([, entry]) => now - entry.savedAt < AVATAR_PERSIST_TTL_MS,
    );
    return new Map(fresh);
  } catch {
    return new Map();
  }
}

/** Write the most-recent (insertion order) `AVATAR_PERSIST_CAP` entries. Never throws. */
export function savePersistedAvatars(entries: Map<string, PersistedAvatar>): void {
  try {
    const capped = [...entries.entries()].slice(-AVATAR_PERSIST_CAP);
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(Object.fromEntries(capped)));
  } catch {
    // Quota exceeded, storage disabled, etc. — the backend's own cache still
    // has this avatar, so just skip persisting this round.
  }
}
