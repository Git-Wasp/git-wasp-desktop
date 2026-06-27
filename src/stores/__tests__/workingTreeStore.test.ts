import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkingTreeStore } from "../workingTreeStore";
import { useGraphStore } from "../graphStore";
import type { StageFileContents, WorkingTreeStatus } from "../../types/workingTree";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

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

  const entry = (path: string) => ({ path, originalPath: null, status: "Modified" as const });

  it("applyStagedContent advances to the next unstaged file once a file is fully staged", async () => {
    useWorkingTreeStore.setState({
      selectedPath: "a.txt",
      status: { staged: [], unstaged: [entry("a.txt"), entry("b.txt")], untracked: [] },
    });
    const newStatus: WorkingTreeStatus = {
      staged: [entry("a.txt")],
      unstaged: [entry("b.txt")],
      untracked: [],
    };
    mockInvoke
      .mockResolvedValueOnce(newStatus) // stage_file_content
      .mockResolvedValueOnce(stageDiff); // get_stage_file_contents for the next file

    await useWorkingTreeStore.getState().applyStagedContent("a.txt", "...");

    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_stage_file_contents", { path: "b.txt" });
    expect(useWorkingTreeStore.getState().selectedPath).toBe("b.txt");
  });

  it("stageFile advances to the next unstaged file when staging the open file", async () => {
    useWorkingTreeStore.setState({
      selectedPath: "a.txt",
      status: { staged: [], unstaged: [entry("a.txt"), entry("b.txt")], untracked: [] },
    });
    const newStatus: WorkingTreeStatus = {
      staged: [entry("a.txt")],
      unstaged: [entry("b.txt")],
      untracked: [],
    };
    mockInvoke
      .mockResolvedValueOnce(newStatus) // stage_file
      .mockResolvedValueOnce(stageDiff); // get_stage_file_contents for the next file

    await useWorkingTreeStore.getState().stageFile("a.txt");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "stage_file", { path: "a.txt" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_stage_file_contents", { path: "b.txt" });
    expect(useWorkingTreeStore.getState().selectedPath).toBe("b.txt");
  });

  it("stageFile leaves the selection alone when staging a file other than the open one", async () => {
    useWorkingTreeStore.setState({
      selectedPath: "b.txt",
      status: { staged: [], unstaged: [entry("a.txt"), entry("b.txt")], untracked: [] },
    });
    mockInvoke.mockResolvedValueOnce({
      staged: [entry("a.txt")],
      unstaged: [entry("b.txt")],
      untracked: [],
    });

    await useWorkingTreeStore.getState().stageFile("a.txt");

    // Only stage_file ran — no reselect / diff reload for the untouched selection.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(useWorkingTreeStore.getState().selectedPath).toBe("b.txt");
  });

  it("keeps the last file shown when nothing remains to stage", async () => {
    useWorkingTreeStore.setState({
      selectedPath: "a.txt",
      status: { staged: [], unstaged: [entry("a.txt")], untracked: [] },
    });
    mockInvoke
      .mockResolvedValueOnce({ staged: [entry("a.txt")], unstaged: [], untracked: [] }) // stage_file_content
      .mockResolvedValueOnce(stageDiff); // reload of the same file

    await useWorkingTreeStore.getState().applyStagedContent("a.txt", "...");

    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_stage_file_contents", { path: "a.txt" });
    expect(useWorkingTreeStore.getState().selectedPath).toBe("a.txt");
  });

  it("clearSelectedFile clears the selection and stage diff", () => {
    useWorkingTreeStore.setState({ selectedPath: "f.txt", stageDiff });
    useWorkingTreeStore.getState().clearSelectedFile();
    expect(useWorkingTreeStore.getState().selectedPath).toBeNull();
    expect(useWorkingTreeStore.getState().stageDiff).toBeNull();
  });

  it("refreshAll re-syncs status, the graph's cached working-tree count, then the viewport in order", async () => {
    mockInvoke.mockImplementation((cmd) =>
      cmd === "get_graph_viewport"
        ? Promise.resolve({ nodes: [], totalCount: 0, offset: 0 })
        : Promise.resolve(undefined),
    );
    useGraphStore.setState({ lastOffset: 0, lastLimit: 50, nodesByRow: new Map() });

    await useWorkingTreeStore.getState().refreshAll();

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_working_tree_status");
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "refresh_graph_working_tree_status");
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "get_graph_viewport", { offset: 0, limit: 50 });
  });

  it("startWatching refreshes the graph's cached working-tree status before re-fetching the viewport, debounced", async () => {
    vi.useFakeTimers();
    let handler: () => void = () => {};
    mockListen.mockImplementation(async (_event, cb) => {
      handler = cb as unknown as () => void;
      return () => {};
    });
    mockInvoke.mockImplementation((cmd) =>
      cmd === "get_graph_viewport"
        ? Promise.resolve({ nodes: [], totalCount: 0, offset: 0 })
        : Promise.resolve(undefined),
    );
    useGraphStore.setState({ lastOffset: 0, lastLimit: 50, nodesByRow: new Map() });

    await useWorkingTreeStore.getState().startWatching();
    handler();
    handler(); // a second fs event within the debounce window collapses into one refresh
    expect(mockInvoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_working_tree_status");
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "refresh_graph_working_tree_status");
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "get_graph_viewport", { offset: 0, limit: 50 });

    vi.useRealTimers();
  });
});
