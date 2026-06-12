import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../workspaceStore";

const mockInvoke = vi.mocked(invoke);

const sampleWorkspace = { id: "ws-1", name: "My Workspace", repoPaths: ["/repos/a"] };

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspace: null,
    repoStatuses: [],
    searchResults: [],
    operationResults: [],
    isLoadingStatus: false,
    isSearching: false,
    isFetchingAll: false,
    isPullingAll: false,
    lastError: null,
  });
});

describe("workspaceStore", () => {
  it("loadWorkspaces populates workspaces from list_workspaces", async () => {
    mockInvoke.mockResolvedValueOnce([sampleWorkspace]);

    await useWorkspaceStore.getState().loadWorkspaces();

    expect(mockInvoke).toHaveBeenCalledWith("list_workspaces");
    expect(useWorkspaceStore.getState().workspaces).toEqual([sampleWorkspace]);
  });

  it("loadActiveWorkspace populates activeWorkspace from get_active_workspace", async () => {
    mockInvoke.mockResolvedValueOnce(sampleWorkspace);

    await useWorkspaceStore.getState().loadActiveWorkspace();

    expect(mockInvoke).toHaveBeenCalledWith("get_active_workspace");
    expect(useWorkspaceStore.getState().activeWorkspace).toEqual(sampleWorkspace);
  });

  it("createWorkspace calls create_workspace and reloads workspaces", async () => {
    mockInvoke.mockResolvedValueOnce(sampleWorkspace); // create_workspace
    mockInvoke.mockResolvedValueOnce([sampleWorkspace]); // list_workspaces

    const result = await useWorkspaceStore.getState().createWorkspace("My Workspace");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "create_workspace", { name: "My Workspace" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "list_workspaces");
    expect(result).toEqual(sampleWorkspace);
    expect(useWorkspaceStore.getState().workspaces).toEqual([sampleWorkspace]);
  });

  it("renameWorkspace calls rename_workspace and reloads workspaces", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // rename_workspace
    mockInvoke.mockResolvedValueOnce([{ ...sampleWorkspace, name: "Renamed" }]); // list_workspaces

    await useWorkspaceStore.getState().renameWorkspace("ws-1", "Renamed");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "rename_workspace", { id: "ws-1", name: "Renamed" });
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe("Renamed");
  });

  it("deleteWorkspace calls delete_workspace and clears activeWorkspace if it was deleted", async () => {
    useWorkspaceStore.setState({ activeWorkspace: sampleWorkspace, workspaces: [sampleWorkspace] });
    mockInvoke.mockResolvedValueOnce(undefined); // delete_workspace
    mockInvoke.mockResolvedValueOnce([]); // list_workspaces
    mockInvoke.mockResolvedValueOnce(null); // get_active_workspace

    await useWorkspaceStore.getState().deleteWorkspace("ws-1");

    expect(mockInvoke).toHaveBeenCalledWith("delete_workspace", { id: "ws-1" });
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull();
  });

  it("addRepoToWorkspace calls add_repo_to_workspace and reloads workspaces", async () => {
    mockInvoke.mockResolvedValueOnce(sampleWorkspace); // add_repo_to_workspace
    mockInvoke.mockResolvedValueOnce([sampleWorkspace]); // list_workspaces

    await useWorkspaceStore.getState().addRepoToWorkspace("ws-1", "/repos/a");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "add_repo_to_workspace", { workspaceId: "ws-1", path: "/repos/a" });
    expect(useWorkspaceStore.getState().workspaces).toEqual([sampleWorkspace]);
  });

  it("removeRepoFromWorkspace calls remove_repo_from_workspace and reloads workspaces", async () => {
    mockInvoke.mockResolvedValueOnce({ ...sampleWorkspace, repoPaths: [] }); // remove_repo_from_workspace
    mockInvoke.mockResolvedValueOnce([{ ...sampleWorkspace, repoPaths: [] }]); // list_workspaces

    await useWorkspaceStore.getState().removeRepoFromWorkspace("ws-1", "/repos/a");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "remove_repo_from_workspace", {
      workspaceId: "ws-1",
      path: "/repos/a",
    });
    expect(useWorkspaceStore.getState().workspaces[0].repoPaths).toEqual([]);
  });

  it("setActiveWorkspace calls set_active_workspace, updates activeWorkspace, and triggers loadStatus", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // set_active_workspace
    mockInvoke.mockResolvedValueOnce(sampleWorkspace); // get_active_workspace
    mockInvoke.mockResolvedValueOnce([]); // get_workspace_status

    await useWorkspaceStore.getState().setActiveWorkspace("ws-1");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "set_active_workspace", { id: "ws-1" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_active_workspace");
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "get_workspace_status", { workspaceId: "ws-1" });
    expect(useWorkspaceStore.getState().activeWorkspace).toEqual(sampleWorkspace);
  });

  it("loadStatus populates repoStatuses and toggles isLoadingStatus", async () => {
    const statuses = [
      { path: "/repos/a", name: "a", headBranch: "main", ahead: 0, behind: 0, uncommittedCount: 0, error: null },
    ];
    mockInvoke.mockResolvedValueOnce(statuses);

    const promise = useWorkspaceStore.getState().loadStatus("ws-1");
    expect(useWorkspaceStore.getState().isLoadingStatus).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenCalledWith("get_workspace_status", { workspaceId: "ws-1" });
    expect(useWorkspaceStore.getState().repoStatuses).toEqual(statuses);
    expect(useWorkspaceStore.getState().isLoadingStatus).toBe(false);
  });

  it("search populates searchResults and toggles isSearching", async () => {
    const results = [{ repoPath: "/repos/a", repoName: "a", kind: "Branch", label: "feature", oid: null }];
    mockInvoke.mockResolvedValueOnce(results);

    const promise = useWorkspaceStore.getState().search("ws-1", "feature");
    expect(useWorkspaceStore.getState().isSearching).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenCalledWith("search_workspace", { workspaceId: "ws-1", query: "feature" });
    expect(useWorkspaceStore.getState().searchResults).toEqual(results);
    expect(useWorkspaceStore.getState().isSearching).toBe(false);
  });

  it("search records lastError and resets isSearching on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("search failed"));

    await expect(useWorkspaceStore.getState().search("ws-1", "feature")).rejects.toThrow("search failed");

    expect(useWorkspaceStore.getState().isSearching).toBe(false);
    expect(useWorkspaceStore.getState().lastError).toContain("search failed");
  });

  it("fetchAll calls workspace_fetch_all, stores operationResults, and reloads status", async () => {
    const results = [{ path: "/repos/a", name: "a", success: true, message: "fetched (1 ref(s) updated)" }];
    mockInvoke.mockResolvedValueOnce(results); // workspace_fetch_all
    mockInvoke.mockResolvedValueOnce([]); // get_workspace_status

    const promise = useWorkspaceStore.getState().fetchAll("ws-1");
    expect(useWorkspaceStore.getState().isFetchingAll).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "workspace_fetch_all", { workspaceId: "ws-1" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_workspace_status", { workspaceId: "ws-1" });
    expect(useWorkspaceStore.getState().operationResults).toEqual(results);
    expect(useWorkspaceStore.getState().isFetchingAll).toBe(false);
  });

  it("pullAll calls workspace_pull_all, stores operationResults, and reloads status", async () => {
    const results = [{ path: "/repos/a", name: "a", success: true, message: "already up to date" }];
    mockInvoke.mockResolvedValueOnce(results); // workspace_pull_all
    mockInvoke.mockResolvedValueOnce([]); // get_workspace_status

    const promise = useWorkspaceStore.getState().pullAll("ws-1");
    expect(useWorkspaceStore.getState().isPullingAll).toBe(true);
    await promise;

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "workspace_pull_all", { workspaceId: "ws-1" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_workspace_status", { workspaceId: "ws-1" });
    expect(useWorkspaceStore.getState().operationResults).toEqual(results);
    expect(useWorkspaceStore.getState().isPullingAll).toBe(false);
  });
});
