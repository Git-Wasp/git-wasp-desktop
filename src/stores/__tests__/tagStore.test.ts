import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTagStore } from "../tagStore";
import { useGraphStore } from "../graphStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useTagStore.setState({ remoteTags: [], loaded: false });
  useGraphStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
});

describe("tagStore", () => {
  it("loadRemoteTags stores the remote tag names", async () => {
    mockInvoke.mockResolvedValueOnce(["v1.0", "v2.0"]);
    await useTagStore.getState().loadRemoteTags();
    expect(useTagStore.getState().remoteTags).toEqual(["v1.0", "v2.0"]);
    expect(useTagStore.getState().isOnRemote("v1.0")).toBe(true);
    expect(useTagStore.getState().isOnRemote("v9")).toBe(false);
  });

  it("loadRemoteTags is best-effort (offline leaves it unloaded)", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("offline"));
    await useTagStore.getState().loadRemoteTags();
    expect(useTagStore.getState().loaded).toBe(false);
    expect(useTagStore.getState().remoteTags).toEqual([]);
  });

  it("pushTag pushes then reloads remote tags and refreshes the graph", async () => {
    mockInvoke.mockResolvedValue(undefined); // push_tag + list_remote_tags
    await useTagStore.getState().pushTag("v1.0");
    expect(mockInvoke).toHaveBeenCalledWith("push_tag", { tag: "v1.0" });
    expect(mockInvoke).toHaveBeenCalledWith("list_remote_tags");
    expect(useGraphStore.getState().refresh).toHaveBeenCalled();
  });

  it("deleteTag deletes locally and, when asked, from the remote", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await useTagStore.getState().deleteTag("v1.0", true);
    expect(mockInvoke).toHaveBeenCalledWith("delete_tag", { name: "v1.0" });
    expect(mockInvoke).toHaveBeenCalledWith("delete_remote_tag", { tag: "v1.0" });
  });

  it("deleteTag without alsoRemote skips the remote delete", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await useTagStore.getState().deleteTag("v1.0", false);
    expect(mockInvoke).toHaveBeenCalledWith("delete_tag", { name: "v1.0" });
    expect(mockInvoke).not.toHaveBeenCalledWith("delete_remote_tag", expect.anything());
  });
});
