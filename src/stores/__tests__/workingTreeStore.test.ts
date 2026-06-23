import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useWorkingTreeStore } from "../workingTreeStore";
import type { StageFileContents, WorkingTreeStatus } from "../../types/workingTree";

const mockInvoke = vi.mocked(invoke);

const emptyStatus: WorkingTreeStatus = { staged: [], unstaged: [], untracked: [] };

const stageDiff: StageFileContents = {
  headContent: "a\nb\nc\n",
  worktreeContent: "a\nB\nc\n",
  isBinary: false,
  worktreeExists: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkingTreeStore.setState({
    status: null,
    selectedPath: null,
    stageDiff: null,
  });
});

describe("workingTreeStore", () => {
  it("selectFile loads the stage diff via get_stage_file_contents", async () => {
    mockInvoke.mockResolvedValueOnce(stageDiff);

    await useWorkingTreeStore.getState().selectFile("f.txt");

    expect(mockInvoke).toHaveBeenCalledWith("get_stage_file_contents", { path: "f.txt" });
    expect(useWorkingTreeStore.getState().selectedPath).toBe("f.txt");
    expect(useWorkingTreeStore.getState().stageDiff).toEqual(stageDiff);
  });

  it("applyStagedContent invokes stage_file_content and refreshes the diff", async () => {
    useWorkingTreeStore.setState({ selectedPath: "f.txt" });
    const newStatus: WorkingTreeStatus = {
      ...emptyStatus,
      staged: [{ path: "f.txt", originalPath: null, status: "Modified" }],
    };
    mockInvoke
      .mockResolvedValueOnce(newStatus) // stage_file_content
      .mockResolvedValueOnce(stageDiff); // get_stage_file_contents reload

    await useWorkingTreeStore.getState().applyStagedContent("f.txt", "a\nB\nc\n");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "stage_file_content", {
      path: "f.txt",
      content: "a\nB\nc\n",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_stage_file_contents", { path: "f.txt" });
    expect(useWorkingTreeStore.getState().status).toEqual(newStatus);
  });

  it("clearSelectedFile clears the selection and stage diff", () => {
    useWorkingTreeStore.setState({ selectedPath: "f.txt", stageDiff });
    useWorkingTreeStore.getState().clearSelectedFile();
    expect(useWorkingTreeStore.getState().selectedPath).toBeNull();
    expect(useWorkingTreeStore.getState().stageDiff).toBeNull();
  });
});
