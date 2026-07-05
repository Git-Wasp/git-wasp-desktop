import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_STASH_SENTINEL, isAutoStashError, withAutoStash } from "../autoStash";
import { useAutoStashStore } from "../../stores/autoStashStore";

const prompt = { title: "t", message: "m", confirmLabel: "Stash" };

beforeEach(() => {
  useAutoStashStore.setState({ pending: null });
});

describe("isAutoStashError", () => {
  it("matches the sentinel as a string or an Error message", () => {
    expect(isAutoStashError(AUTO_STASH_SENTINEL)).toBe(true);
    expect(isAutoStashError(new Error(AUTO_STASH_SENTINEL))).toBe(true);
  });

  it("does not match other errors", () => {
    expect(isAutoStashError("boom")).toBe(false);
    expect(isAutoStashError(new Error("boom"))).toBe(false);
  });
});

describe("withAutoStash", () => {
  it("returns the first result without prompting when the op succeeds", async () => {
    let calls = 0;
    const result = await withAutoStash(async (autoStash) => {
      calls++;
      expect(autoStash).toBe(false);
      return "ok";
    }, prompt);
    expect(result).toBe("ok");
    expect(calls).toBe(1);
    expect(useAutoStashStore.getState().pending).toBeNull();
  });

  it("rethrows non-sentinel errors without opening a prompt", async () => {
    await expect(
      withAutoStash(async () => {
        throw "nope";
      }, prompt),
    ).rejects.toBe("nope");
    expect(useAutoStashStore.getState().pending).toBeNull();
  });

  it("prompts on the sentinel and retries with autoStash when confirmed", async () => {
    const seen: boolean[] = [];
    const p = withAutoStash(async (autoStash) => {
      seen.push(autoStash);
      if (!autoStash) throw AUTO_STASH_SENTINEL;
      return "done";
    }, prompt);

    // A prompt is now pending; confirm it.
    await Promise.resolve();
    expect(useAutoStashStore.getState().pending).not.toBeNull();
    useAutoStashStore.getState().respond(true);

    expect(await p).toBe("done");
    expect(seen).toEqual([false, true]);
  });

  it("returns undefined and does not retry when the prompt is cancelled", async () => {
    let calls = 0;
    const p = withAutoStash(async (autoStash) => {
      calls++;
      if (!autoStash) throw AUTO_STASH_SENTINEL;
      return "done";
    }, prompt);

    await Promise.resolve();
    useAutoStashStore.getState().respond(false);

    expect(await p).toBeUndefined();
    expect(calls).toBe(1);
  });
});

describe("useAutoStashStore", () => {
  it("cancels a prior pending prompt when a new one is requested", async () => {
    const store = useAutoStashStore.getState();
    const first = store.requestConfirm(prompt);
    const second = store.requestConfirm(prompt);
    // The first request is auto-resolved false when replaced.
    expect(await first).toBe(false);
    useAutoStashStore.getState().respond(true);
    expect(await second).toBe(true);
  });
});
