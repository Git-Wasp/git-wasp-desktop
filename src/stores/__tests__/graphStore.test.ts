import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore } from "../graphStore";
import type { GraphViewport } from "../../types/graph";

const mockInvoke = vi.mocked(invoke);

const makeViewport = (): GraphViewport => ({
  totalCount: 3,
  offset: 0,
  nodes: [
    { oid: "aaa", shortOid: "aaa00000", summary: "first", authorName: "A", authorEmail: "a@a", authorTimestamp: 0, lane: 0, row: 0, colorIndex: 0, parents: [], children: ["bbb"], edges: [], branchLabels: [], isHead: false },
    { oid: "bbb", shortOid: "bbb00000", summary: "second", authorName: "A", authorEmail: "a@a", authorTimestamp: 0, lane: 0, row: 1, colorIndex: 0, parents: ["aaa"], children: ["ccc"], edges: [], branchLabels: [], isHead: true },
    { oid: "ccc", shortOid: "ccc00000", summary: "third", authorName: "A", authorEmail: "a@a", authorTimestamp: 0, lane: 0, row: 2, colorIndex: 0, parents: ["bbb"], children: [], edges: [], branchLabels: [], isHead: false },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.setState({ viewport: null, selection: { anchor: null, focus: null, range: new Set() }, selectedOid: null, lastOffset: null, lastLimit: null, scrollToRow: null });
});

describe("graphStore", () => {
  it("fetchViewport calls get_graph_viewport and updates viewport", async () => {
    const vp = makeViewport();
    mockInvoke.mockResolvedValueOnce(vp);

    await useGraphStore.getState().fetchViewport(0, 10);

    expect(mockInvoke).toHaveBeenCalledWith("get_graph_viewport", { offset: 0, limit: 10 });
    expect(useGraphStore.getState().viewport).toEqual(vp);
  });

  it("fetchViewport drops a stale response when a newer fetch supersedes it", async () => {
    const older: GraphViewport = { ...makeViewport(), offset: 0 };
    const newer: GraphViewport = { ...makeViewport(), offset: 50 };

    // First call stays pending; the second resolves immediately.
    let resolveOlder: (v: GraphViewport) => void = () => {};
    mockInvoke
      .mockImplementationOnce(() => new Promise((res) => { resolveOlder = res as (v: GraphViewport) => void; }))
      .mockResolvedValueOnce(newer);

    const p1 = useGraphStore.getState().fetchViewport(0, 10); // id 1, pending
    const p2 = useGraphStore.getState().fetchViewport(50, 10); // id 2, resolves now
    await p2;
    expect(useGraphStore.getState().viewport?.offset).toBe(50);

    // The superseded older fetch resolves late — it must not overwrite.
    resolveOlder(older);
    await p1;
    expect(useGraphStore.getState().viewport?.offset).toBe(50);
  });

  it("selectCommit sets anchor, focus, range, and selectedOid", () => {
    useGraphStore.setState({ viewport: makeViewport() });
    useGraphStore.getState().selectCommit("bbb", false);

    const { selection, selectedOid } = useGraphStore.getState();
    expect(selectedOid).toBe("bbb");
    expect(selection.anchor).toBe("bbb");
    expect(selection.range.has("bbb")).toBe(true);
    expect(selection.range.size).toBe(1);
  });

  it("selectCommit with extend=true selects range between anchor and focus", () => {
    const vp = makeViewport();
    useGraphStore.setState({ viewport: vp });

    // Select first commit as anchor.
    useGraphStore.getState().selectCommit("aaa", false);
    // Shift-click last commit — should select all three.
    useGraphStore.getState().selectCommit("ccc", true);

    const { selection } = useGraphStore.getState();
    expect(selection.range.has("aaa")).toBe(true);
    expect(selection.range.has("bbb")).toBe(true);
    expect(selection.range.has("ccc")).toBe(true);
    expect(selection.range.size).toBe(3);
  });

  it("refresh re-fetches the last requested range", async () => {
    const vp = makeViewport();
    mockInvoke.mockResolvedValue(vp);

    await useGraphStore.getState().fetchViewport(5, 30);
    mockInvoke.mockClear();

    await useGraphStore.getState().refresh();

    expect(mockInvoke).toHaveBeenCalledWith("get_graph_viewport", { offset: 5, limit: 30 });
  });

  it("refresh is a no-op before any fetch", async () => {
    await useGraphStore.getState().refresh();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("revealCommit selects the commit and sets scrollToRow from find_commit_row", async () => {
    mockInvoke.mockResolvedValueOnce(2);

    await useGraphStore.getState().revealCommit("ccc");

    expect(mockInvoke).toHaveBeenCalledWith("find_commit_row", { oid: "ccc" });
    const { selection, selectedOid, scrollToRow } = useGraphStore.getState();
    expect(selectedOid).toBe("ccc");
    expect(selection.range.has("ccc")).toBe(true);
    expect(scrollToRow).toBe(2);
  });

  it("revealCommit still selects when the commit isn't reachable (row null)", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    await useGraphStore.getState().revealCommit("zzz");

    expect(useGraphStore.getState().selectedOid).toBe("zzz");
    expect(useGraphStore.getState().scrollToRow).toBeNull();
  });

  it("clearSelection resets to empty", () => {
    useGraphStore.setState({ viewport: makeViewport() });
    useGraphStore.getState().selectCommit("aaa", false);
    useGraphStore.getState().clearSelection();

    const { selection, selectedOid } = useGraphStore.getState();
    expect(selectedOid).toBeNull();
    expect(selection.range.size).toBe(0);
  });
});
