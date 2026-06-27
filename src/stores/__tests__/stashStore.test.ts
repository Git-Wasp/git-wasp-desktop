import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStashStore } from "../stashStore";
import { useGraphStore } from "../graphStore";
import { useWorkingTreeStore } from "../workingTreeStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
  useGraphStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
  useWorkingTreeStore.setState({ loadStatus: vi.fn().mockResolvedValue(undefined) });
});

describe("stashStore", () => {
  it("create stashes then refreshes the graph and working tree", async () => {
    await useStashStore.getState().create("my work");
    expect(mockInvoke).toHaveBeenCalledWith("stash_save_cmd", { message: "my work" });
    expect(useGraphStore.getState().refresh).toHaveBeenCalled();
    expect(useWorkingTreeStore.getState().loadStatus).toHaveBeenCalled();
  });

  it("pop / drop / rename call their commands and refresh", async () => {
    await useStashStore.getState().pop(1);
    expect(mockInvoke).toHaveBeenCalledWith("stash_pop_cmd", { index: 1 });

    await useStashStore.getState().drop(2);
    expect(mockInvoke).toHaveBeenCalledWith("stash_drop_cmd", { index: 2 });

    await useStashStore.getState().rename(0, "new name");
    expect(mockInvoke).toHaveBeenCalledWith("stash_rename_cmd", { index: 0, message: "new name" });

    expect(useGraphStore.getState().refresh).toHaveBeenCalledTimes(3);
  });
});
