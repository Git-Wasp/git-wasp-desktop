import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_PERSIST_CAP,
  AVATAR_PERSIST_TTL_MS,
  AVATAR_STORAGE_KEY,
  loadPersistedAvatars,
  savePersistedAvatars,
  type PersistedAvatar,
} from "./avatarPersistence";

beforeEach(() => {
  localStorage.clear();
});

describe("loadPersistedAvatars", () => {
  it("returns an empty map when nothing is stored", () => {
    expect(loadPersistedAvatars(Date.now()).size).toBe(0);
  });

  it("returns an empty map for corrupt JSON instead of throwing", () => {
    localStorage.setItem(AVATAR_STORAGE_KEY, "{not json");
    expect(loadPersistedAvatars(Date.now()).size).toBe(0);
  });

  it("loads a fresh entry", () => {
    const now = Date.now();
    const entry: PersistedAvatar = { status: "loaded", url: "data:image/png;base64,AAAA", savedAt: now };
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify({ "a@b.com": entry }));

    const loaded = loadPersistedAvatars(now);

    expect(loaded.get("a@b.com")).toEqual(entry);
  });

  it("drops an entry older than the local TTL", () => {
    const now = Date.now();
    const stale: PersistedAvatar = {
      status: "loaded",
      url: "data:image/png;base64,AAAA",
      savedAt: now - AVATAR_PERSIST_TTL_MS - 1,
    };
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify({ "old@b.com": stale }));

    expect(loadPersistedAvatars(now).has("old@b.com")).toBe(false);
  });

  it("keeps an entry exactly at the TTL boundary (age strictly less than TTL is the cutoff)", () => {
    const now = Date.now();
    const entry: PersistedAvatar = { status: "none", savedAt: now - (AVATAR_PERSIST_TTL_MS - 1) };
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify({ "a@b.com": entry }));

    expect(loadPersistedAvatars(now).has("a@b.com")).toBe(true);
  });
});

describe("savePersistedAvatars", () => {
  it("round-trips through loadPersistedAvatars", () => {
    const now = Date.now();
    const entries = new Map<string, PersistedAvatar>([
      ["a@b.com", { status: "loaded", url: "data:image/png;base64,AAAA", savedAt: now }],
      ["nobody@nowhere.com", { status: "none", savedAt: now }],
    ]);

    savePersistedAvatars(entries);

    const loaded = loadPersistedAvatars(now);
    expect(loaded.get("a@b.com")).toEqual(entries.get("a@b.com"));
    expect(loaded.get("nobody@nowhere.com")).toEqual(entries.get("nobody@nowhere.com"));
  });

  it("caps to the most-recently-inserted AVATAR_PERSIST_CAP entries", () => {
    const now = Date.now();
    const entries = new Map<string, PersistedAvatar>();
    for (let i = 0; i < AVATAR_PERSIST_CAP + 50; i++) {
      entries.set(`author${i}@example.com`, { status: "none", savedAt: now });
    }

    savePersistedAvatars(entries);

    const loaded = loadPersistedAvatars(now);
    expect(loaded.size).toBe(AVATAR_PERSIST_CAP);
    // The earliest-inserted entries were dropped, the latest kept.
    expect(loaded.has("author0@example.com")).toBe(false);
    expect(loaded.has(`author${AVATAR_PERSIST_CAP + 49}@example.com`)).toBe(true);
  });

  it("does not throw when localStorage.setItem fails (e.g. quota exceeded)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(() => savePersistedAvatars(new Map())).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
