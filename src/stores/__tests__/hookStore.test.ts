import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookFinished, HookOutput, HookStarted } from "../../types/hooks";
import {
  initHookListeners,
  MAX_RETAINED_OUTPUT,
  selectHookRun,
  TRUNCATION_NOTICE,
  useHookStore,
} from "../hookStore";

const mockListen = vi.mocked(listen);

function started(repoPath: string, runId: string): HookStarted {
  return { repoPath, runId, hook: "pre-commit", operation: "commit" };
}

function output(repoPath: string, runId: string, chunk: string): HookOutput {
  return { repoPath, runId, stream: "stdout", chunk };
}

function finished(repoPath: string, runId: string, outcome: "succeeded" | "failed"): HookFinished {
  return {
    repoPath,
    runId,
    hook: "pre-commit",
    outcome,
    exitCode: outcome === "succeeded" ? 0 : 1,
    summary: outcome,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useHookStore.setState({ runs: {} });
});

describe("hookStore", () => {
  it("selects Windows repository paths using the normalized event key", () => {
    useHookStore.getState().started(started("C:\\work\\repo\\", "run-win"));

    expect(selectHookRun("C:\\work\\repo")(useHookStore.getState())?.status).toBe("running");
  });

  it("isolates repositories and rejects stale events", () => {
    const store = useHookStore.getState();
    store.started(started("/a", "run-2"));
    store.appendOutput(output("/a", "run-1", "stale"));
    store.appendOutput(output("/b", "run-2", "other"));
    store.appendOutput(output("/a", "run-2", "current"));

    expect(useHookStore.getState().runs["/a"]!.chunks.map((chunk) => chunk.chunk)).toEqual([
      "current",
    ]);
    expect(useHookStore.getState().runs["/b"]).toBeUndefined();
  });

  it("opens on start, preserves output while hidden, and clears one repo", () => {
    const store = useHookStore.getState();
    store.started(started("/a", "run-1"));
    store.started(started("/b", "run-b"));
    store.setPaneVisible("/a", false);
    store.appendOutput(output("/a", "run-1", "kept"));

    expect(useHookStore.getState().runs["/a"]!.paneVisible).toBe(false);
    expect(useHookStore.getState().runs["/a"]!.chunks[0]!.chunk).toBe("kept");
    store.clearRepo("/a");
    expect(useHookStore.getState().runs["/a"]).toBeUndefined();
    expect(useHookStore.getState().runs["/b"]?.runId).toBe("run-b");
  });

  it("normalizes repository keys and a new run replaces previous output", () => {
    const store = useHookStore.getState();
    store.started(started("/repo/", "run-1"));
    store.appendOutput(output("/repo", "run-1", "old"));
    store.setFollowing("/repo/", false);
    store.started(started("/repo", "run-2"));

    expect(Object.keys(useHookStore.getState().runs)).toEqual(["/repo"]);
    expect(selectHookRun("/repo/")(useHookStore.getState())).toMatchObject({
      runId: "run-2",
      chunks: [],
      paneVisible: true,
      following: true,
    });
    expect(selectHookRun(null)(useHookStore.getState())).toBeUndefined();
  });

  it("accepts only the current run's finish event", () => {
    const store = useHookStore.getState();
    store.started(started("/a", "run-2"));
    store.finished(finished("/a", "run-1", "failed"));
    expect(useHookStore.getState().runs["/a"]!.status).toBe("running");

    store.finished(finished("/a", "run-2", "succeeded"));
    expect(useHookStore.getState().runs["/a"]).toMatchObject({
      status: "succeeded",
      summary: "succeeded",
    });
  });

  it("retains newest whole chunks under the cap with exactly one truncation notice", () => {
    const store = useHookStore.getState();
    const chunkLength = Math.floor(MAX_RETAINED_OUTPUT / 2);
    const first = "a".repeat(chunkLength);
    const second = "b".repeat(chunkLength);
    const newest = "c".repeat(chunkLength);
    store.started(started("/a", "run-1"));
    store.appendOutput(output("/a", "run-1", first));
    store.appendOutput(output("/a", "run-1", second));
    store.appendOutput(output("/a", "run-1", newest));
    store.appendOutput(output("/a", "run-1", "tail"));

    const run = useHookStore.getState().runs["/a"]!;
    expect(run.chunks.map((chunk) => chunk.chunk)).toEqual([
      TRUNCATION_NOTICE,
      newest,
      "tail",
    ]);
    expect(run.chunks.filter((chunk) => chunk.chunk === TRUNCATION_NOTICE)).toHaveLength(1);
    expect(run.retainedLength).toBe(run.chunks.reduce((sum, chunk) => sum + chunk.chunk.length, 0));
    expect(run.retainedLength).toBeLessThanOrEqual(MAX_RETAINED_OUTPUT);
  });

  it("ignores empty output chunks instead of retaining unbounded entries", () => {
    const store = useHookStore.getState();
    store.started(started("/a", "run-1"));

    for (let index = 0; index < 10_000; index += 1) {
      store.appendOutput(output("/a", "run-1", ""));
    }

    expect(useHookStore.getState().runs["/a"]).toMatchObject({
      chunks: [],
      retainedLength: 0,
    });
  });

  it("subscribes to exact backend events and cleanup removes every listener", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const unlisten = [vi.fn(), vi.fn(), vi.fn()];
    mockListen.mockImplementation((event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return Promise.resolve(unlisten[handlers.size - 1]!);
    });

    const cleanup = await initHookListeners();
    handlers.get("git-hook://started")?.({ payload: started("/a", "run-1") });
    handlers.get("git-hook://output")?.({ payload: output("/a", "run-1", "hello") });
    handlers.get("git-hook://finished")?.({ payload: finished("/a", "run-1", "succeeded") });

    expect(useHookStore.getState().runs["/a"]).toMatchObject({
      status: "succeeded",
      summary: "succeeded",
    });
    cleanup();
    expect(unlisten.every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });

  it("cleans up earlier subscriptions when listener initialization partially fails", async () => {
    const firstUnlisten = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const secondUnlisten = vi.fn();
    mockListen
      .mockResolvedValueOnce(firstUnlisten)
      .mockResolvedValueOnce(secondUnlisten)
      .mockRejectedValueOnce(new Error("subscription failed"));

    await expect(initHookListeners()).rejects.toThrow("subscription failed");
    expect(firstUnlisten).toHaveBeenCalledOnce();
    expect(secondUnlisten).toHaveBeenCalledOnce();
  });
});
