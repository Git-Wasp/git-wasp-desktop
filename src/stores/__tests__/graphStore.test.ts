import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore } from "../graphStore";
import type { GraphViewport } from "../../types/graph";

const mockInvoke = vi.mocked(invoke);

const makeViewport = (): GraphViewport => ({
  totalCount: 3,
  offset: 0,
  nodes: [
    { oid: "aaa", shortOid: "aaa00000", summary: "first", authorName: "A", authorEmail: "a@a", authorTimestamp: 0, lane: 0, row: 0, colorIndex: 0, parents: [], children: ["bbb"], edges: [], branchLabels: [], isHead: false, onHeadLine: true },
    { oid: "bbb", shortOid: "bbb00000", summary: "second", authorName: "A", authorEmail: "a@a", authorTimestamp: 0, lane: 0, row: 1, colorIndex: 0, parents: ["aaa"], children: ["ccc"], edges: [], branchLabels: [], isHead: true, onHeadLine: true },
    { oid: "ccc", shortOid: "ccc00000", summary: "third", authorName: "A", authorEmail: "a@a", authorTimestamp: 0, lane: 0, row: 2, colorIndex: 0, parents: ["bbb"], children: [], edges: [], branchLabels: [], isHead: false, onHeadLine: false },
  ],
});

const makeNode = (row: number, oid: string): import("../../types/graph").GraphNode => ({
  oid,
  shortOid: oid,
  summary: `commit ${row}`,
  authorName: "A",
  authorEmail: "a@a",
  authorTimestamp: 0,
  lane: 0,
  row,
  colorIndex: 0,
  parents: [],
  children: [],
  edges: [],
  branchLabels: [],
  isHead: false,
  onHeadLine: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.setState({
    viewport: null,
    selection: { anchor: null, focus: null, range: new Set() },
    selectedOid: null,
    lastOffset: null,
    lastLimit: null,
    scrollToRow: null,
    nodesByRow: new Map(),
    searchOpen: false,
    searchQuery: "",
    searchHits: [],
    searchMatchOids: new Set<string>(),
    searchIndex: -1,
  });
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

  it("fetchViewport serves an already-loaded range from cache without calling invoke again", async () => {
    const vp = makeViewport(); // rows 0-2, totalCount 3
    mockInvoke.mockResolvedValueOnce(vp);

    await useGraphStore.getState().fetchViewport(0, 10);
    mockInvoke.mockClear();

    await useGraphStore.getState().fetchViewport(0, 10); // same range — should hit cache

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useGraphStore.getState().viewport?.nodes.map((n) => n.oid)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("fetchViewport serves a previously-loaded range from cache when scrolling back up", async () => {
    const top: GraphViewport = { totalCount: 10, offset: 0, nodes: [0, 1, 2].map((r) => makeNode(r, `o${r}`)) };
    const further: GraphViewport = { totalCount: 10, offset: 5, nodes: [5, 6, 7].map((r) => makeNode(r, `o${r}`)) };
    mockInvoke.mockResolvedValueOnce(top).mockResolvedValueOnce(further);

    await useGraphStore.getState().fetchViewport(0, 3); // scroll to top
    await useGraphStore.getState().fetchViewport(5, 3); // scroll down
    mockInvoke.mockClear();

    await useGraphStore.getState().fetchViewport(0, 3); // scroll back up — already loaded

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useGraphStore.getState().viewport?.nodes.map((n) => n.oid)).toEqual(["o0", "o1", "o2"]);
  });

  it("fetchViewport calls invoke again when the requested range isn't fully cached", async () => {
    const top: GraphViewport = { totalCount: 10, offset: 0, nodes: [0, 1, 2].map((r) => makeNode(r, `o${r}`)) };
    const further: GraphViewport = { totalCount: 10, offset: 3, nodes: [3, 4, 5].map((r) => makeNode(r, `o${r}`)) };
    mockInvoke.mockResolvedValueOnce(top).mockResolvedValueOnce(further);

    await useGraphStore.getState().fetchViewport(0, 3);
    await useGraphStore.getState().fetchViewport(3, 3); // new, uncached rows

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(useGraphStore.getState().viewport?.nodes.map((n) => n.oid)).toEqual(["o3", "o4", "o5"]);
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

  it("selectWorkingTree highlights the working-tree row and clears the commit selection", () => {
    useGraphStore.setState({ viewport: makeViewport() });
    // Start with a commit selected (e.g. HEAD).
    useGraphStore.getState().selectCommit("bbb", false);

    useGraphStore.getState().selectWorkingTree();

    const { selection, selectedOid } = useGraphStore.getState();
    expect(selection.range.has("WORKING_TREE")).toBe(true);
    expect(selection.range.has("bbb")).toBe(false);
    expect(selection.range.size).toBe(1);
    // No real commit is selected, so the detail panel won't resolve the sentinel.
    expect(selectedOid).toBeNull();
  });

  it("revealHead resolves HEAD's oid and reveals it (selects + scrolls)", async () => {
    mockInvoke
      .mockResolvedValueOnce({ oid: "bbb", message: "head", pushed: false }) // get_head_commit_info
      .mockResolvedValueOnce(1); // find_commit_row

    await useGraphStore.getState().revealHead();

    expect(mockInvoke).toHaveBeenCalledWith("get_head_commit_info");
    const { selectedOid, scrollToRow } = useGraphStore.getState();
    expect(selectedOid).toBe("bbb");
    expect(scrollToRow).toBe(1);
  });

  it("revealHead is a no-op on an unborn branch (no HEAD)", async () => {
    mockInvoke.mockResolvedValueOnce(null); // get_head_commit_info

    await useGraphStore.getState().revealHead();

    expect(useGraphStore.getState().selectedOid).toBeNull();
  });

  it("clearSelection resets to empty", () => {
    useGraphStore.setState({ viewport: makeViewport() });
    useGraphStore.getState().selectCommit("aaa", false);
    useGraphStore.getState().clearSelection();

    const { selection, selectedOid } = useGraphStore.getState();
    expect(selectedOid).toBeNull();
    expect(selection.range.size).toBe(0);
  });

  it("reset clears the viewport, row cache and selection (so the skeleton shows)", () => {
    useGraphStore.setState({
      viewport: makeViewport(),
      lastOffset: 0,
      lastLimit: 10,
      scrollToRow: 5,
      nodesByRow: new Map([[0, makeNode(0, "aaa")]]),
    });
    useGraphStore.getState().selectCommit("aaa", false);

    useGraphStore.getState().reset();

    const s = useGraphStore.getState();
    expect(s.viewport).toBeNull();
    expect(s.nodesByRow.size).toBe(0);
    expect(s.lastOffset).toBeNull();
    expect(s.lastLimit).toBeNull();
    expect(s.scrollToRow).toBeNull();
    expect(s.selection.range.size).toBe(0);
    expect(s.selectedOid).toBeNull();
  });

  it("reset drops a fetch that was already in flight (e.g. the previous repo's)", async () => {
    let resolve!: (vp: GraphViewport) => void;
    mockInvoke.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const inFlight = useGraphStore.getState().fetchViewport(0, 10);
    // The active repo changes mid-fetch.
    useGraphStore.getState().reset();
    // The stale response lands afterwards and must be ignored.
    resolve(makeViewport());
    await inFlight;

    expect(useGraphStore.getState().viewport).toBeNull();
  });

  it("setFocusCurrentBranch updates state and persists to localStorage", () => {
    // Defaults on.
    expect(useGraphStore.getState().focusCurrentBranch).toBe(true);

    useGraphStore.getState().setFocusCurrentBranch(false);
    expect(useGraphStore.getState().focusCurrentBranch).toBe(false);
    expect(localStorage.getItem("graphFocusCurrentBranch")).toBe("false");

    useGraphStore.getState().setFocusCurrentBranch(true);
    expect(useGraphStore.getState().focusCurrentBranch).toBe(true);
    expect(localStorage.getItem("graphFocusCurrentBranch")).toBe("true");
  });

  it("setGraphDensity updates state and persists to localStorage", () => {
    // Defaults to the spacious Comfortable preset.
    expect(useGraphStore.getState().graphDensity).toBe("comfortable");

    useGraphStore.getState().setGraphDensity("compact");
    expect(useGraphStore.getState().graphDensity).toBe("compact");
    expect(localStorage.getItem("graphDensity")).toBe("compact");
  });

  it("setColumnOrder updates the variant's order and persists it", () => {
    useGraphStore.getState().setColumnOrder("ledger", ["date", "commit", "author", "branch", "hash"]);
    expect(useGraphStore.getState().columnOrder.ledger).toEqual([
      "date",
      "commit",
      "author",
      "branch",
      "hash",
    ]);
    // The split order is untouched.
    expect(useGraphStore.getState().columnOrder.split[0]).toBe("hash");
    const persisted = JSON.parse(localStorage.getItem("graphColumnOrder")!);
    expect(persisted.ledger[0]).toBe("date");
  });

  it("setColumnOrder sanitises a partial/dirty order (drops unknown, appends missing)", () => {
    // Only some columns provided, plus a bogus one — the rest are appended.
    useGraphStore.getState().setColumnOrder("ledger", ["date", "bogus", "commit"] as never);
    const order = useGraphStore.getState().columnOrder.ledger;
    expect(order.slice(0, 2)).toEqual(["date", "commit"]);
    expect([...order].sort()).toEqual(["author", "branch", "commit", "date", "hash"]);
  });

  describe("search", () => {
    const hits = [
      { row: 1, oid: "bbb" },
      { row: 4, oid: "eee" },
    ];

    it("runSearch queries the backend, stores hits, and reveals the first match", async () => {
      mockInvoke.mockResolvedValueOnce(hits);

      await useGraphStore.getState().runSearch("fix");

      expect(mockInvoke).toHaveBeenCalledWith("search_graph", { query: "fix" });
      const s = useGraphStore.getState();
      expect(s.searchHits).toEqual(hits);
      expect(s.searchMatchOids).toEqual(new Set(["bbb", "eee"]));
      expect(s.searchIndex).toBe(0);
      // First hit is selected and scrolled to.
      expect(s.selectedOid).toBe("bbb");
      expect(s.scrollToRow).toBe(1);
    });

    it("runSearch with a blank query clears matches without calling the backend", async () => {
      await useGraphStore.getState().runSearch("   ");
      expect(mockInvoke).not.toHaveBeenCalled();
      const s = useGraphStore.getState();
      expect(s.searchHits).toEqual([]);
      expect(s.searchIndex).toBe(-1);
    });

    it("nextMatch and prevMatch wrap around and scroll to the hit", async () => {
      mockInvoke.mockResolvedValueOnce(hits);
      await useGraphStore.getState().runSearch("x"); // index 0 (bbb)

      useGraphStore.getState().nextMatch(); // -> index 1 (eee)
      expect(useGraphStore.getState().searchIndex).toBe(1);
      expect(useGraphStore.getState().scrollToRow).toBe(4);

      useGraphStore.getState().nextMatch(); // wraps -> index 0 (bbb)
      expect(useGraphStore.getState().searchIndex).toBe(0);
      expect(useGraphStore.getState().selectedOid).toBe("bbb");

      useGraphStore.getState().prevMatch(); // wraps back -> index 1 (eee)
      expect(useGraphStore.getState().searchIndex).toBe(1);
      expect(useGraphStore.getState().scrollToRow).toBe(4);
    });

    it("closeSearch clears the query, hits and index", async () => {
      mockInvoke.mockResolvedValueOnce(hits);
      await useGraphStore.getState().runSearch("x");

      useGraphStore.getState().closeSearch();
      const s = useGraphStore.getState();
      expect(s.searchOpen).toBe(false);
      expect(s.searchQuery).toBe("");
      expect(s.searchHits).toEqual([]);
      expect(s.searchMatchOids.size).toBe(0);
      expect(s.searchIndex).toBe(-1);
    });
  });
});
