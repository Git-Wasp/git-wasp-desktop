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
  it("selectFile loads the unstaged (index→worktree) diff and records the mode", async () => {
    mockInvoke.mockResolvedValueOnce(stageDiff);

    await useWorkingTreeStore.getState().selectFile("f.txt", "unstaged");

    expect(mockInvoke).toHaveBeenCalledWith("get_stage_file_contents", {
      path: "f.txt",
      staged: false,
    });
    expect(useWorkingTreeStore.getState().selectedPath).toBe("f.txt");
    expect(useWorkingTreeStore.getState().stageMode).toBe("unstaged");
    expect(useWorkingTreeStore.getState().stageDiff).toEqual(stageDiff);
  });

  it("selectFile loads the staged (HEAD→index) diff when opened from the Staged panel", async () => {
    mockInvoke.mockResolvedValueOnce(stageDiff);

    await useWorkingTreeStore.getState().selectFile("f.txt", "staged");

    expect(mockInvoke).toHaveBeenCalledWith("get_stage_file_contents", {
      path: "f.txt",
      staged: true,
    });
    expect(useWorkingTreeStore.getState().stageMode).toBe("staged");
  });

  it("applyIndexContent writes the index blob then reloads the open file in its mode", async () => {
    useWorkingTreeStore.setState({ selectedPath: "f.txt", stageMode: "unstaged" });
    const newStatus: WorkingTreeStatus = {
      ...emptyStatus,
      staged: [{ path: "f.txt", originalPath: null, status: "Modified" }],
    };
    mockInvoke
      .mockResolvedValueOnce(newStatus) // stage_file_content
      .mockResolvedValueOnce(stageDiff); // get_stage_file_contents reload

    await useWorkingTreeStore.getState().applyIndexContent("f.txt", "a\nB\nc\n");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "stage_file_content", {
      path: "f.txt",
      content: "a\nB\nc\n",
    });
    // Reloads the same file in the same (unstaged) view — stays put, no advance.
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_stage_file_contents", {
      path: "f.txt",
      staged: false,
    });
    expect(useWorkingTreeStore.getState().selectedPath).toBe("f.txt");
    expect(useWorkingTreeStore.getState().status).toEqual(newStatus);
  });

  it("applyIndexContent reloads with staged:true when unstaging from the Staged view", async () => {
    useWorkingTreeStore.setState({ selectedPath: "f.txt", stageMode: "staged" });
    mockInvoke.mockResolvedValueOnce(emptyStatus).mockResolvedValueOnce(stageDiff);

    await useWorkingTreeStore.getState().applyIndexContent("f.txt", "a\nc\n");

    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_stage_file_contents", {
      path: "f.txt",
      staged: true,
    });
  });

  const entry = (path: string) => ({ path, originalPath: null, status: "Modified" as const });

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
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_stage_file_contents", {
      path: "b.txt",
      staged: false,
    });
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

  it("selectFile drops a stale response when the selection moved on before it resolved", async () => {
    let resolveA: (v: StageFileContents) => void;
    const pendingA = new Promise<StageFileContents>((r) => { resolveA = r; });
    mockInvoke.mockImplementationOnce(() => pendingA); // fileA: slow
    mockInvoke.mockResolvedValueOnce({ ...stageDiff, headContent: "B\n" }); // fileB: fast

    const selectA = useWorkingTreeStore.getState().selectFile("fileA.txt", "unstaged");
    await useWorkingTreeStore.getState().selectFile("fileB.txt", "unstaged"); // resolves first
    resolveA!(stageDiff); // fileA's late response
    await selectA;

    expect(useWorkingTreeStore.getState().selectedPath).toBe("fileB.txt");
    expect(useWorkingTreeStore.getState().stageDiff?.headContent).toBe("B\n");
  });

  it("clearSelectedFile clears the selection and stage diff", () => {
    useWorkingTreeStore.setState({ selectedPath: "f.txt", stageDiff });
    useWorkingTreeStore.getState().clearSelectedFile();
    expect(useWorkingTreeStore.getState().selectedPath).toBeNull();
    expect(useWorkingTreeStore.getState().stageDiff).toBeNull();
  });

  it("refreshAll does one combined working-tree scan, then re-fetches the viewport", async () => {
    const status = { staged: [], unstaged: [], untracked: [] };
    mockInvoke.mockImplementation((cmd) =>
      cmd === "get_graph_viewport"
        ? Promise.resolve({ nodes: [], totalCount: 0, offset: 0 })
        : Promise.resolve(cmd === "refresh_working_tree" ? status : undefined),
    );
    useGraphStore.setState({ lastOffset: 0, lastLimit: 50, nodesByRow: new Map() });

    await useWorkingTreeStore.getState().refreshAll();

    // A single scan (status + graph dirty-count in one), then the viewport — no
    // separate count-refresh call (that was a second `git status`).
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "refresh_working_tree");
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_graph_viewport", { offset: 0, limit: 50 });
    expect(mockInvoke).not.toHaveBeenCalledWith("refresh_graph_working_tree_status");
    expect(useWorkingTreeStore.getState().status).toEqual(status);
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

    // The debounced refresh does the combined single scan, then the viewport.
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "refresh_working_tree");
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_graph_viewport", { offset: 0, limit: 50 });

    vi.useRealTimers();
  });
});
