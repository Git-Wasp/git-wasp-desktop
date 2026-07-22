import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AVATAR_CACHE_CAP, useAvatarStore } from "../avatarStore";
import {
  AVATAR_STORAGE_KEY,
  type PersistedAvatar,
} from "../../lib/avatarPersistence";

const mockInvoke = vi.mocked(invoke);

// jsdom's Image never "loads", so stub one that fires onload on the next tick
// once a src is assigned.
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Image", FakeImage);
  useAvatarStore.setState({ avatars: new Map(), version: 0 });
  localStorage.clear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("avatarStore", () => {
  it("resolves an avatar to a loaded image and bumps the version", async () => {
    mockInvoke.mockResolvedValueOnce(["data:image/png;base64,AAAA"]);

    useAvatarStore.getState().request(["a@b.com"]);
    expect(mockInvoke).toHaveBeenCalledWith("get_avatars", {
      emails: ["a@b.com"],
    });

    await flush();
    expect(useAvatarStore.getState().getImage("a@b.com")).toBeInstanceOf(
      FakeImage,
    );
    expect(useAvatarStore.getState().version).toBeGreaterThan(0);
  });

  it("records a miss (no gravatar) without an image", async () => {
    mockInvoke.mockResolvedValueOnce([null]);

    useAvatarStore.getState().request(["nobody@nowhere.com"]);
    await flush();

    expect(useAvatarStore.getState().getImage("nobody@nowhere.com")).toBeNull();
    expect(
      useAvatarStore.getState().avatars.get("nobody@nowhere.com")?.status,
    ).toBe("none");
  });

  it("resolves a batch of distinct emails in a single invoke, in order", async () => {
    mockInvoke.mockResolvedValueOnce(["data:image/png;base64,AAAA", null]);

    useAvatarStore.getState().request(["a@b.com", "nobody@nowhere.com"]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("get_avatars", {
      emails: ["a@b.com", "nobody@nowhere.com"],
    });

    await flush();
    expect(useAvatarStore.getState().getImage("a@b.com")).toBeInstanceOf(
      FakeImage,
    );
    expect(
      useAvatarStore.getState().avatars.get("nobody@nowhere.com")?.status,
    ).toBe("none");
  });

  it("requests each email only once, even across calls and casing/whitespace", async () => {
    mockInvoke.mockResolvedValue(["data:image/png;base64,AAAA"]);

    useAvatarStore.getState().request(["a@b.com", "a@b.com"]);
    useAvatarStore.getState().request([" A@B.com "]);
    await flush();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("ignores empty emails", () => {
    useAvatarStore.getState().request(["", "   "]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("marks every requested email as none when the invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));

    useAvatarStore.getState().request(["x@y.com", "z@y.com"]);
    await flush();

    expect(useAvatarStore.getState().avatars.get("x@y.com")?.status).toBe(
      "none",
    );
    expect(useAvatarStore.getState().avatars.get("z@y.com")?.status).toBe(
      "none",
    );
  });

  it("caps the avatar map so it doesn't grow unbounded across a long session", () => {
    mockInvoke.mockResolvedValue(Array(5000).fill(null));
    useAvatarStore
      .getState()
      .request(
        Array.from({ length: 5000 }, (_, i) => `author${i}@example.com`),
      );

    expect(useAvatarStore.getState().avatars.size).toBeLessThanOrEqual(
      AVATAR_CACHE_CAP,
    );
  });
});

describe("avatarStore cross-session persistence", () => {
  it("persists a resolved avatar to localStorage so it survives a reload", async () => {
    mockInvoke.mockResolvedValueOnce(["data:image/png;base64,AAAA"]);

    useAvatarStore.getState().request(["a@b.com"]);
    await flush();

    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, PersistedAvatar>;
    expect(parsed["a@b.com"]).toMatchObject({
      status: "loaded",
      url: "data:image/png;base64,AAAA",
    });
  });

  it("persists a miss too, so a known no-avatar author isn't re-requested next reload", async () => {
    mockInvoke.mockResolvedValueOnce([null]);

    useAvatarStore.getState().request(["nobody@nowhere.com"]);
    await flush();

    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    const parsed = JSON.parse(raw!) as Record<string, PersistedAvatar>;
    expect(parsed["nobody@nowhere.com"]).toMatchObject({ status: "none" });
  });

  // The store hydrates from localStorage at module-creation time, so this
  // needs a fresh module instance — `vi.resetModules()` plus a dynamic
  // re-import. That also re-instantiates the `@tauri-apps/api/core` mock, so
  // this test grabs its own fresh `invoke` reference rather than reusing the
  // top-level `mockInvoke` (which would point at the now-stale instance).
  it("hydrates a previously-persisted avatar, painting it before any invoke resolves", async () => {
    const entry: PersistedAvatar = {
      status: "loaded",
      url: "data:image/png;base64,BBBB",
      savedAt: Date.now(),
    };
    localStorage.setItem(
      AVATAR_STORAGE_KEY,
      JSON.stringify({ "a@b.com": entry }),
    );

    vi.resetModules();
    const core = await import("@tauri-apps/api/core");
    const freshMockInvoke = vi.mocked(core.invoke);
    const { useAvatarStore: freshStore } = await import("../avatarStore");

    // Already resolved from the hydrated entry — no backend round trip needed.
    freshStore.getState().request(["a@b.com"]);
    expect(freshMockInvoke).not.toHaveBeenCalled();

    await flush();
    expect(freshStore.getState().getImage("a@b.com")).toBeInstanceOf(FakeImage);
  });

  it("drops a persisted avatar older than the local TTL, so it gets re-requested", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const stale: PersistedAvatar = {
      status: "loaded",
      url: "data:image/png;base64,BBBB",
      savedAt: Date.now() - dayMs - 1,
    };
    localStorage.setItem(
      AVATAR_STORAGE_KEY,
      JSON.stringify({ "old@b.com": stale }),
    );

    vi.resetModules();
    const core = await import("@tauri-apps/api/core");
    const freshMockInvoke = vi.mocked(core.invoke);
    freshMockInvoke.mockResolvedValueOnce(["data:image/png;base64,CCCC"]);
    const { useAvatarStore: freshStore } = await import("../avatarStore");

    freshStore.getState().request(["old@b.com"]);

    expect(freshMockInvoke).toHaveBeenCalledWith("get_avatars", {
      emails: ["old@b.com"],
    });
  });
});
