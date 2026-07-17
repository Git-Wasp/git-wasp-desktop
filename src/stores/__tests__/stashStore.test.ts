import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStashStore } from "../stashStore";
import { useGraphStore } from "../graphStore";
import { useWorkingTreeStore } from "../workingTreeStore";

const mockInvoke = vi.mocked(invoke);

const emptyStatus = { staged: [], unstaged: [], untracked: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
  useGraphStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
  useStashStore.setState({ entries: [] });
});

describe("stashStore", () => {
  it("list populates entries from stash_list_cmd", async () => {
    mockInvoke.mockResolvedValueOnce([{ index: 0, message: "a", oid: "a".repeat(40) }]);

    await useStashStore.getState().list();

    expect(mockInvoke).toHaveBeenCalledWith("stash_list_cmd");
    expect(useStashStore.getState().entries).toEqual([{ index: 0, message: "a", oid: "a".repeat(40) }]);
  });

  it("reset clears entries immediately", () => {
    useStashStore.setState({ entries: [{ index: 0, message: "x", oid: "a".repeat(40) }] });

    useStashStore.getState().reset();

    expect(useStashStore.getState().entries).toEqual([]);
  });

  // stash_save_cmd returns WorkingTreeStatus (confirmed against
  // src-tauri/src/commands/stash.rs), not the stash list — so `create` must
  // apply that status directly and separately re-list to pick up the new entry.
  it("create saves the stash, applies the returned working-tree status, and refreshes the graph + entries", async () => {
    mockInvoke
      .mockResolvedValueOnce(emptyStatus) // stash_save_cmd
      .mockResolvedValueOnce([{ index: 0, message: "my work", oid: "a".repeat(40) }]); // stash_list_cmd

    await useStashStore.getState().create("my work");

    expect(mockInvoke).toHaveBeenCalledWith("stash_save_cmd", { message: "my work" });
    expect(mockInvoke).toHaveBeenCalledWith("stash_list_cmd");
    expect(useWorkingTreeStore.getState().status).toEqual(emptyStatus);
    expect(useGraphStore.getState().refresh).toHaveBeenCalled();
    expect(useStashStore.getState().entries).toEqual([
      { index: 0, message: "my work", oid: "a".repeat(40) },
    ]);
  });

  // stash_apply_cmd also returns WorkingTreeStatus, but unlike pop it doesn't
  // remove the stash entry, so apply doesn't need to re-list or refresh the graph.
  it("apply applies the returned working-tree status without touching entries or the graph", async () => {
    useStashStore.setState({ entries: [{ index: 0, message: "keep me", oid: "a".repeat(40) }] });
    mockInvoke.mockResolvedValueOnce(emptyStatus); // stash_apply_cmd

    await useStashStore.getState().apply(0);

    expect(mockInvoke).toHaveBeenCalledWith("stash_apply_cmd", { index: 0 });
    expect(mockInvoke).not.toHaveBeenCalledWith("stash_list_cmd");
    expect(useWorkingTreeStore.getState().status).toEqual(emptyStatus);
    expect(useGraphStore.getState().refresh).not.toHaveBeenCalled();
    expect(useStashStore.getState().entries).toEqual([
      { index: 0, message: "keep me", oid: "a".repeat(40) },
    ]);
  });

  it("pop updates entries from a follow-up stash_list_cmd call and refreshes the graph/working tree", async () => {
    mockInvoke
      .mockResolvedValueOnce(emptyStatus) // stash_pop_cmd
      .mockResolvedValueOnce([{ index: 0, message: "remaining", oid: "b".repeat(40) }]); // stash_list_cmd

    await useStashStore.getState().pop(0);

    expect(mockInvoke).toHaveBeenCalledWith("stash_pop_cmd", { index: 0 });
    expect(useWorkingTreeStore.getState().status).toEqual(emptyStatus);
    expect(useGraphStore.getState().refresh).toHaveBeenCalled();
    expect(useStashStore.getState().entries).toEqual([
      { index: 0, message: "remaining", oid: "b".repeat(40) },
    ]);
  });

  it("drop sets entries directly from stash_drop_cmd's response and refreshes the graph", async () => {
    mockInvoke.mockResolvedValueOnce([{ index: 0, message: "other", oid: "c".repeat(40) }]); // stash_drop_cmd

    await useStashStore.getState().drop(1);

    expect(mockInvoke).toHaveBeenCalledWith("stash_drop_cmd", { index: 1 });
    expect(mockInvoke).not.toHaveBeenCalledWith("stash_list_cmd");
    expect(useStashStore.getState().entries).toEqual([
      { index: 0, message: "other", oid: "c".repeat(40) },
    ]);
    expect(useGraphStore.getState().refresh).toHaveBeenCalled();
  });

  it("rename sets entries directly from stash_rename_cmd's response without refreshing the graph", async () => {
    mockInvoke.mockResolvedValueOnce([{ index: 0, message: "renamed", oid: "d".repeat(40) }]); // stash_rename_cmd

    await useStashStore.getState().rename(0, "renamed");

    expect(mockInvoke).toHaveBeenCalledWith("stash_rename_cmd", { index: 0, message: "renamed" });
    expect(useStashStore.getState().entries).toEqual([
      { index: 0, message: "renamed", oid: "d".repeat(40) },
    ]);
    expect(useGraphStore.getState().refresh).not.toHaveBeenCalled();
  });
});
