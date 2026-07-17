import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AVATAR_CACHE_CAP, useAvatarStore } from "../avatarStore";

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
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("avatarStore", () => {
  it("resolves an avatar to a loaded image and bumps the version", async () => {
    mockInvoke.mockResolvedValueOnce("data:image/png;base64,AAAA");

    useAvatarStore.getState().request(["a@b.com"]);
    expect(mockInvoke).toHaveBeenCalledWith("get_avatar", { email: "a@b.com" });

    await flush();
    expect(useAvatarStore.getState().getImage("a@b.com")).toBeInstanceOf(FakeImage);
    expect(useAvatarStore.getState().version).toBeGreaterThan(0);
  });

  it("records a miss (no gravatar) without an image", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    useAvatarStore.getState().request(["nobody@nowhere.com"]);
    await flush();

    expect(useAvatarStore.getState().getImage("nobody@nowhere.com")).toBeNull();
    expect(useAvatarStore.getState().avatars.get("nobody@nowhere.com")?.status).toBe("none");
  });

  it("requests each email only once, even across calls and casing/whitespace", async () => {
    mockInvoke.mockResolvedValue("data:image/png;base64,AAAA");

    useAvatarStore.getState().request(["a@b.com", "a@b.com"]);
    useAvatarStore.getState().request([" A@B.com "]);
    await flush();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("ignores empty emails", () => {
    useAvatarStore.getState().request(["", "   "]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("marks an entry as none when the invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));

    useAvatarStore.getState().request(["x@y.com"]);
    await flush();

    expect(useAvatarStore.getState().avatars.get("x@y.com")?.status).toBe("none");
  });

  it("caps the avatar map so it doesn't grow unbounded across a long session", () => {
    for (let i = 0; i < 5000; i++) useAvatarStore.getState().request([`author${i}@example.com`]);
    expect(useAvatarStore.getState().avatars.size).toBeLessThanOrEqual(AVATAR_CACHE_CAP);
  });
});
