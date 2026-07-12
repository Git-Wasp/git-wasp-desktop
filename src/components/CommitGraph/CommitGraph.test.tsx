import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitGraph } from "./CommitGraph";
import { useGraphStore, type SelectMode } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useToastStore } from "../../stores/toastStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useStashStore } from "../../stores/stashStore";
import { useTagStore } from "../../stores/tagStore";
import type { GraphNode, GraphViewport } from "../../types/graph";

const node = (over: Partial<GraphNode>): GraphNode => ({
  oid: "a".repeat(40),
  shortOid: "aaaaaaa",
  summary: "first commit",
  body: "",
  authorName: "A",
  authorEmail: "a@a",
  authorTimestamp: 0,
  lane: 0,
  row: 0,
  colorIndex: 0,
  parents: [],
  children: [],
  edges: [],
  branchLabels: [],
  isHead: false,
  onHeadLine: true,
  ...over,
});

const makeViewport = (): GraphViewport => ({
  totalCount: 2,
  offset: 0,
  nodes: [
    node({
      oid: "a".repeat(40),
      summary: "first commit",
      branchLabels: [{ name: "main", isRemote: false, isTag: false }],
      isHead: true,
      row: 0,
    }),
    node({ oid: "b".repeat(40), summary: "second commit", row: 1 }),
  ],
});

const writeText = vi.fn();
let selectCommit: ReturnType<typeof vi.fn<(oid: string, mode?: SelectMode) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no canvas backend; the graph hook early-returns on a null context.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  selectCommit = vi.fn<(oid: string, mode?: SelectMode) => void>();
  useGraphStore.setState({
    viewport: makeViewport(),
    selection: { anchor: null, focus: null, range: new Set() },
    selectedOid: null,
    lastOffset: 0,
    lastLimit: 40,
    graphVariant: "ledger",
    visibleColumns: { author: true, branch: true, hash: true, date: true },
    columnOrder: {
      ledger: ["commit", "author", "branch", "hash", "date"],
      split: ["hash", "commit", "author", "branch", "date"],
    },
    fetchViewport: vi.fn(),
    refresh: vi.fn(),
    selectCommit,
    searchOpen: false,
    searchQuery: "",
    searchHits: [],
    searchMatchOids: new Set(),
    searchIndex: -1,
  });
  useRepoStore.setState({
    currentRepo: { name: "r", path: "/r", headBranch: "main" },
    createBranch: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    renameBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    checkoutCommit: vi.fn().mockResolvedValue(undefined),
    createTag: vi.fn().mockResolvedValue(undefined),
    revertCommit: vi.fn().mockResolvedValue(null),
    squashCommits: vi.fn().mockResolvedValue("c".repeat(40)),
    fastForwardBranch: vi.fn().mockResolvedValue(undefined),
    listFastForwardableBranches: vi.fn().mockResolvedValue([]),
  });
  useGithubStore.setState({ remoteInfo: null });
});

describe("CommitGraph columns", () => {
  it("renders the ledger column headers", () => {
    render(<CommitGraph />);
    expect(screen.getByText("Commit")).toBeInTheDocument();
    expect(screen.getByText("Author")).toBeInTheDocument();
    expect(screen.getByText("Branch")).toBeInTheDocument();
    expect(screen.getByText("Hash")).toBeInTheDocument();
    expect(screen.getByText("Date")).toBeInTheDocument();
  });

  it("renders a branch pill, the commit message, author and hash per row", () => {
    render(<CommitGraph />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
    expect(screen.getByText("second commit")).toBeInTheDocument();
    // The short hash renders in the hash column.
    expect(screen.getAllByText("aaaaaaa").length).toBeGreaterThan(0);
  });

  it("selects a commit when its row is clicked", () => {
    const onCommitSelect = vi.fn();
    render(<CommitGraph onCommitSelect={onCommitSelect} />);
    fireEvent.click(screen.getByText("second commit"));
    expect(selectCommit).toHaveBeenCalledWith("b".repeat(40), "replace");
    expect(onCommitSelect).toHaveBeenCalled();
  });

  it("range-selects on shift-click and toggles on cmd/ctrl-click", () => {
    render(<CommitGraph />);
    fireEvent.click(screen.getByText("second commit"), { shiftKey: true });
    expect(selectCommit).toHaveBeenCalledWith("b".repeat(40), "range");

    fireEvent.click(screen.getByText("second commit"), { metaKey: true });
    expect(selectCommit).toHaveBeenCalledWith("b".repeat(40), "toggle");

    fireEvent.click(screen.getByText("first commit"), { ctrlKey: true });
    expect(selectCommit).toHaveBeenCalledWith("a".repeat(40), "toggle");
  });

  it("highlights a commit row on hover and clears it on leave", () => {
    const { container } = render(<CommitGraph />);
    const row = container.querySelector(`[data-oid="${"b".repeat(40)}"]`) as HTMLElement;
    const cell = row.querySelector('[data-cell="commit"]') as HTMLElement; // a data cell carries the bg
    expect(cell.style.background).toBe("transparent");
    fireEvent.mouseEnter(row);
    expect(cell.style.background).toContain("--color-bg-hover");
    fireEvent.mouseLeave(row);
    expect(cell.style.background).toBe("transparent");
  });

  it("gives a hovered row a border+glow overlay that spans the full row (not just the data cells)", () => {
    const { container } = render(<CommitGraph />);
    const row = container.querySelector(`[data-oid="${"b".repeat(40)}"]`) as HTMLElement;
    const glow = row.querySelector('[data-testid="row-glow"]') as HTMLElement;
    expect(glow.style.boxShadow).toBe("none");
    fireEvent.mouseEnter(row);
    expect(glow.style.boxShadow).toContain("--color-accent-primary");
    fireEvent.mouseLeave(row);
    expect(glow.style.boxShadow).toBe("none");
  });

  it("gives a selected row a stronger border+glow than a hovered one", () => {
    render(<CommitGraph />);
    fireEvent.click(screen.getByText("second commit"));
    expect(selectCommit).toHaveBeenCalledWith("b".repeat(40), "replace");
    // selectCommit is mocked (doesn't update the store), so drive `selected`
    // via store state directly to check the row's own style.
    act(() =>
      useGraphStore.setState({
        selection: { anchor: "b".repeat(40), focus: "b".repeat(40), range: new Set(["b".repeat(40)]) },
      }),
    );
    const row = screen.getByText("second commit").closest("[data-oid]") as HTMLElement;
    const glow = row.querySelector('[data-testid="row-glow"]') as HTMLElement;
    expect(glow.style.boxShadow).toContain("--color-accent-primary");
    expect(glow.style.boxShadow).toContain("0 0 6px");
  });

  it("the glow overlay never intercepts clicks/hover meant for the row", () => {
    const { container } = render(<CommitGraph />);
    const row = container.querySelector(`[data-oid="${"b".repeat(40)}"]`) as HTMLElement;
    const glow = row.querySelector('[data-testid="row-glow"]') as HTMLElement;
    expect(glow.style.pointerEvents).toBe("none");
  });

  it("sits the graph in the recessed --color-graph-bg well (falling back to --color-bg-app)", () => {
    const { container } = render(<CommitGraph />);
    const well = container.firstChild as HTMLElement;
    expect(well.style.background).toContain("--color-graph-bg");
    expect(well.style.background).toContain("--color-bg-app");
  });

  it("persists a resized graph column width to localStorage", () => {
    localStorage.removeItem("graphCol:graph");
    render(<CommitGraph />);
    const handle = screen.getByRole("separator", { name: "Resize graph column" });

    act(() => handle.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true })));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 140, bubbles: true })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { clientX: 140, bubbles: true })));

    expect(localStorage.getItem("graphCol:graph")).toBe("196"); // 156 default + 40
  });

  it("persists a resized data (author) column width to localStorage", () => {
    localStorage.removeItem("graphCol:author");
    render(<CommitGraph />);
    const handle = screen.getByRole("separator", { name: "Resize author column" });

    act(() => handle.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true })));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 130, bubbles: true })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { clientX: 130, bubbles: true })));

    expect(localStorage.getItem("graphCol:author")).toBe("210"); // 180 default + 30
  });

  it("drops a column from the rows when it is toggled off in the store", () => {
    const { container } = render(<CommitGraph />);
    expect(container.querySelector('[data-cell="author"]')).not.toBeNull();
    act(() => useGraphStore.getState().toggleColumn("author"));
    expect(container.querySelector('[data-cell="author"]')).toBeNull();
    // The commit column is structural and stays.
    expect(container.querySelector('[data-cell="commit"]')).not.toBeNull();
  });

  it("reflects a reordered column order in the row's cell order", () => {
    const { container } = render(<CommitGraph />);
    const dataCells = () => {
      const row = container.querySelector(`[data-oid="${"b".repeat(40)}"]`)!;
      return Array.from(row.querySelectorAll("[data-cell]"))
        .map((c) => c.getAttribute("data-cell"))
        .filter((k) => k !== "graph" && k !== "filler");
    };
    expect(dataCells()).toEqual(["commit", "author", "branch", "hash", "date"]);
    act(() =>
      useGraphStore.getState().setColumnOrder("ledger", ["date", "commit", "author", "branch", "hash"]),
    );
    expect(dataCells()).toEqual(["date", "commit", "author", "branch", "hash"]);
  });

  it("reorders columns by dragging a header label (pointer drag)", () => {
    const { container } = render(<CommitGraph />);
    // Window pointer events carry coordinates via MouseEvent (jsdom drops them
    // from PointerEvent) — matches the branch-pill drag tests.
    const fireWindow = (type: string, clientX: number, clientY: number) =>
      act(() => {
        window.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
      });

    // Drag the Date header label onto the Commit header → Date moves before Commit.
    act(() => fireEvent.pointerDown(screen.getByText("Date"), { clientX: 400, clientY: 10 }));
    fireWindow("pointermove", 440, 10); // past the drag threshold
    act(() => fireEvent.pointerEnter(container.querySelector('[data-header="commit"]')!));
    fireWindow("pointerup", 440, 10);

    expect(useGraphStore.getState().columnOrder.ledger).toEqual([
      "date",
      "commit",
      "author",
      "branch",
      "hash",
    ]);
  });
});

describe("CommitGraph loading skeleton", () => {
  it("shows the animated skeleton while the viewport is loading (null)", () => {
    useGraphStore.setState({ viewport: null });
    render(<CommitGraph />);
    expect(screen.getByTestId("graph-skeleton")).toBeInTheDocument();
    // The header stays visible; real rows do not render yet.
    expect(screen.getByText("Commit")).toBeInTheDocument();
    expect(screen.queryByText("first commit")).not.toBeInTheDocument();
  });

  it("hides the skeleton once the viewport has loaded", () => {
    render(<CommitGraph />);
    expect(screen.queryByTestId("graph-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
  });
});

describe("CommitGraph checked-out indicators", () => {
  it("marks the checked-out branch pill and pulses the HEAD dot", () => {
    const { container } = render(<CommitGraph />);
    // The "main" pill (HEAD's local branch) is flagged as current.
    expect(container.querySelector('[data-branch="main"]')).toHaveAttribute("data-current", "true");
    // A pulse overlay marks the HEAD commit dot.
    expect(screen.getByTestId("head-pulse")).toBeInTheDocument();
  });

  it("marks the checked-out (HEAD) commit row with a permanent muted band", () => {
    const { container } = render(<CommitGraph />);
    // The HEAD commit's row carries the head-row flag; non-HEAD rows don't.
    const headRows = container.querySelectorAll('[data-head-row="true"]');
    expect(headRows.length).toBe(1);
    const row = headRows[0] as HTMLElement;
    // Its cells use the head-row background token (not transparent).
    expect(row.innerHTML).toContain("var(--color-graph-head-row-bg)");
  });

  it("shows no HEAD pulse when the loaded slice has no HEAD commit", () => {
    useGraphStore.setState({
      viewport: {
        totalCount: 1,
        offset: 0,
        nodes: [node({ oid: "c".repeat(40), summary: "no head here", row: 0 })],
      },
    });
    render(<CommitGraph />);
    expect(screen.queryByTestId("head-pulse")).toBeNull();
  });

  it("remounts the HEAD pulse (not just restyles it) when the row density changes", () => {
    // The pulse is a CSS-animated element (expanding ring, `transform:
    // translate(-50%,-50%)`); switching density mid-animation only restyles
    // left/top/width/height on the same DOM node unless it carries a
    // density-keyed `key`, which stale-restyle-only render lets the browser
    // resolve the ring's centring against the wrong (previous) box size —
    // fixed centring requires a fresh element per density.
    render(<CommitGraph />);
    const before = screen.getByTestId("head-pulse");
    act(() => useGraphStore.getState().setGraphDensity("compact"));
    const after = screen.getByTestId("head-pulse");
    expect(after).not.toBe(before);
  });
});

describe("CommitGraph focus-current-branch mode", () => {
  const focusViewport = (): GraphViewport => ({
    totalCount: 2,
    offset: 0,
    nodes: [
      node({ oid: "a".repeat(40), summary: "on branch", isHead: true, onHeadLine: true, row: 0 }),
      node({ oid: "b".repeat(40), summary: "off branch", onHeadLine: false, row: 1 }),
    ],
  });

  const cellsOf = (container: HTMLElement, oid: string) => {
    const row = container.querySelector(`[data-oid="${oid}"]`) as HTMLElement;
    // The content data cells carry the dimming class (not the graph spacer or
    // the decorative trailing filler).
    return Array.from(row.querySelectorAll<HTMLElement>("[data-cell]")).filter(
      (c) => !["graph", "filler"].includes(c.getAttribute("data-cell") ?? ""),
    );
  };

  it("dims off-line commits and leaves on-line commits fully opaque when on", () => {
    useGraphStore.setState({ viewport: focusViewport(), focusCurrentBranch: true });
    const { container } = render(<CommitGraph />);

    // The off-line row carries the muted flag + dimming class on its cells.
    const offRow = container.querySelector(`[data-oid="${"b".repeat(40)}"]`);
    expect(offRow).toHaveAttribute("data-muted", "true");
    for (const cell of cellsOf(container, "b".repeat(40))) {
      expect(cell).toHaveClass("graph-row-muted");
    }
    // The on-line (HEAD) row is not muted.
    const onRow = container.querySelector(`[data-oid="${"a".repeat(40)}"]`);
    expect(onRow).not.toHaveAttribute("data-muted");
    for (const cell of cellsOf(container, "a".repeat(40))) {
      expect(cell).not.toHaveClass("graph-row-muted");
    }
  });

  it("does not dim anything when focus mode is off", () => {
    useGraphStore.setState({ viewport: focusViewport(), focusCurrentBranch: false });
    const { container } = render(<CommitGraph />);

    const offRow = container.querySelector(`[data-oid="${"b".repeat(40)}"]`);
    expect(offRow).not.toHaveAttribute("data-muted");
    for (const cell of cellsOf(container, "b".repeat(40))) {
      expect(cell).not.toHaveClass("graph-row-muted");
    }
  });
});

describe("CommitGraph context menu", () => {
  it("opens a context menu with branch actions on right-click", () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("first commit"));

    expect(screen.getByText("Copy commit hash")).toBeInTheDocument();
    // "main" is the checked-out branch: it offers push/rename but not the
    // invalid checkout/delete-current-branch actions.
    expect(screen.getByText("Push main")).toBeInTheDocument();
    expect(screen.getByText(/Rename main/)).toBeInTheDocument();
    expect(screen.queryByText("Checkout main")).toBeNull();
    expect(screen.queryByText("Delete main")).toBeNull();
  });

  it("offers checkout/push/merge/delete for a non-current branch", () => {
    useGraphStore.setState({
      viewport: {
        totalCount: 2,
        offset: 0,
        nodes: [
          node({
            oid: "a".repeat(40),
            summary: "first commit",
            branchLabels: [{ name: "main", isRemote: false, isTag: false }],
            isHead: true,
            row: 0,
          }),
          node({
            oid: "b".repeat(40),
            summary: "second commit",
            branchLabels: [{ name: "feature", isRemote: false, isTag: false }],
            row: 1,
          }),
        ],
      },
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));

    expect(screen.getByText("Checkout feature")).toBeInTheDocument();
    expect(screen.getByText("Push feature")).toBeInTheDocument();
    expect(screen.getByText("Merge feature into current")).toBeInTheDocument();
    expect(screen.getByText("Delete feature")).toBeInTheDocument();
  });

  it("pushes a branch from the menu with a success toast", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const success = vi.fn();
    useRemoteStore.setState({ push });
    useToastStore.setState({ success });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("first commit"));
    fireEvent.click(screen.getByText("Push main"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(undefined, "main"));
    expect(success).toHaveBeenCalled();
  });

  it("copies the full commit hash", () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("first commit"));
    fireEvent.click(screen.getByText("Copy commit hash"));
    expect(writeText).toHaveBeenCalledWith("a".repeat(40));
  });

  it("copies the commit message (summary plus body)", () => {
    useGraphStore.setState({
      viewport: {
        totalCount: 1,
        offset: 0,
        nodes: [node({ oid: "a".repeat(40), summary: "the subject", body: "the body", row: 0 })],
      },
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("the subject"));
    fireEvent.click(screen.getByText("Copy message"));
    expect(writeText).toHaveBeenCalledWith("the subject\n\nthe body");
  });

  it("does not offer squash for a discontiguous multi-selection", () => {
    // Three commits loaded; select the outer two (gap in the middle).
    useGraphStore.setState({
      viewport: {
        totalCount: 3,
        offset: 0,
        nodes: [
          node({ oid: "a".repeat(40), summary: "first commit", isHead: true, row: 0 }),
          node({ oid: "b".repeat(40), summary: "second commit", row: 1 }),
          node({ oid: "c".repeat(40), summary: "third commit", row: 2 }),
        ],
      },
      selection: {
        anchor: "a".repeat(40),
        focus: "c".repeat(40),
        range: new Set(["a".repeat(40), "c".repeat(40)]),
      },
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("third commit"));
    expect(screen.queryByText(/Squash/)).toBeNull();
  });

  it("does not offer squash for a single-commit selection", () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("first commit"));
    expect(screen.queryByText(/Squash/)).toBeNull();
  });

  it("offers squash when several commits are selected and keeps the selection", () => {
    const aOid = "a".repeat(40);
    const bOid = "b".repeat(40);
    useGraphStore.setState({
      selection: { anchor: aOid, focus: bOid, range: new Set([aOid, bOid]) },
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));

    expect(screen.getByText(/Squash 2 commits/)).toBeInTheDocument();
    // Right-clicking within the multi-selection must not collapse it.
    expect(selectCommit).not.toHaveBeenCalled();
  });

  it("squashes the selected commits with the edited message", async () => {
    const aOid = "a".repeat(40);
    const bOid = "b".repeat(40);
    const squashCommits = vi.fn().mockResolvedValue("c".repeat(40));
    useRepoStore.setState({ squashCommits });
    useGraphStore.setState({
      selection: { anchor: aOid, focus: bOid, range: new Set([aOid, bOid]) },
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    fireEvent.click(screen.getByText(/Squash 2 commits/));

    // The dialog opens pre-filled with the joined message (oldest first).
    const textarea = screen.getByRole("textbox", { name: "Squash commit message" });
    fireEvent.change(textarea, { target: { value: "combined message" } });
    fireEvent.click(screen.getByRole("button", { name: /^squash$/i }));

    await waitFor(() =>
      expect(squashCommits).toHaveBeenCalledWith([aOid, bOid], "combined message"),
    );
  });

  it("creates and checks out a new branch at the commit", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    fireEvent.click(screen.getByText(/New branch here/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "feature/x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(useRepoStore.getState().createBranch).toHaveBeenCalledWith("feature/x", "b".repeat(40)),
    );
    expect(useRepoStore.getState().checkoutBranch).toHaveBeenCalledWith("feature/x");
  });

  it("offers to fast-forward only the branches the backend reports as eligible", async () => {
    const fastForwardBranch = vi.fn().mockResolvedValue(undefined);
    useRepoStore.setState({
      fastForwardBranch,
      listFastForwardableBranches: vi.fn().mockResolvedValue(["main"]),
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));

    const ffItem = await screen.findByText("Fast-forward main to here");
    fireEvent.click(ffItem);
    await waitFor(() => expect(fastForwardBranch).toHaveBeenCalledWith("main", "b".repeat(40)));
  });

  it("omits fast-forward items when no branch is eligible", async () => {
    useRepoStore.setState({ listFastForwardableBranches: vi.fn().mockResolvedValue([]) });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    // Give the (empty) eligibility fetch a chance to resolve.
    await waitFor(() => expect(screen.getByText("Checkout this commit")).toBeInTheDocument());
    expect(screen.queryByText(/Fast-forward .* to here/)).not.toBeInTheDocument();
  });

  it("offers commit-level actions (checkout this commit, create tag)", () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    expect(screen.getByText("Checkout this commit")).toBeInTheDocument();
    expect(screen.getByText("Create tag here…")).toBeInTheDocument();
  });

  it("checks out a commit (detached) from the menu", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    fireEvent.click(screen.getByText("Checkout this commit"));
    await waitFor(() =>
      expect(useRepoStore.getState().checkoutCommit).toHaveBeenCalledWith("b".repeat(40)),
    );
  });

  it("surfaces a refused checkout as an error toast (no silent failure)", async () => {
    const error = vi.fn();
    useToastStore.setState({ error });
    useRepoStore.setState({
      checkoutCommit: vi.fn().mockRejectedValue("uncommitted changes would be overwritten"),
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    fireEvent.click(screen.getByText("Checkout this commit"));
    await waitFor(() => expect(error).toHaveBeenCalled());
  });

  it("reverts a commit (auto-commit) from the menu", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    fireEvent.click(screen.getByText("Revert commit"));
    await waitFor(() =>
      expect(useRepoStore.getState().revertCommit).toHaveBeenCalledWith("b".repeat(40), true),
    );
  });

  it("reverts a commit without committing (leaves uncommitted changes)", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    fireEvent.click(screen.getByText("Revert without committing"));
    await waitFor(() =>
      expect(useRepoStore.getState().revertCommit).toHaveBeenCalledWith("b".repeat(40), false),
    );
  });

  it("creates a tag at the commit via the prompt", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("second commit"));
    fireEvent.click(screen.getByText("Create tag here…"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "v1.0" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(useRepoStore.getState().createTag).toHaveBeenCalledWith("v1.0", "b".repeat(40)),
    );
  });

  it("shows a copy-link action only when a remote is detected, and copies the URL", () => {
    // No remote → no link action.
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("first commit"));
    expect(screen.queryByText("Copy link to commit")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    useGithubStore.setState({
      remoteInfo: { host: "github.com", owner: "o", repo: "r", protocol: "https" },
    });
    fireEvent.contextMenu(screen.getByText("first commit"));
    fireEvent.click(screen.getByText("Copy link to commit"));
    expect(writeText).toHaveBeenCalledWith(`https://github.com/o/r/commit/${"a".repeat(40)}`);
  });
});

describe("CommitGraph working-tree row", () => {
  it("opens the changes view instead of selecting", () => {
    const onViewChanges = vi.fn();
    useGraphStore.setState({
      viewport: {
        totalCount: 1,
        offset: 0,
        nodes: [
          node({
            oid: "WORKING_TREE",
            summary: "3 uncommitted changes",
            isWorkingTree: true,
            changeCount: 3,
          }),
        ],
      },
    });
    render(<CommitGraph onViewChanges={onViewChanges} />);

    fireEvent.click(screen.getByText("3 uncommitted changes"));
    expect(onViewChanges).toHaveBeenCalled();
    expect(selectCommit).not.toHaveBeenCalled();
  });

  it("highlights the working-tree row as selected and clears any commit selection", () => {
    useGraphStore.setState({
      viewport: {
        totalCount: 1,
        offset: 0,
        nodes: [
          node({
            oid: "WORKING_TREE",
            summary: "3 uncommitted changes",
            isWorkingTree: true,
            changeCount: 3,
          }),
        ],
      },
      // A commit was previously selected (e.g. HEAD) — it should stop reading as
      // selected once the working-tree row is chosen.
      selection: { anchor: "x", focus: "x", range: new Set(["x"]) },
      selectedOid: "x",
    });
    render(<CommitGraph onViewChanges={vi.fn()} />);

    fireEvent.click(screen.getByText("3 uncommitted changes"));

    const { selection, selectedOid } = useGraphStore.getState();
    expect(selection.range.has("WORKING_TREE")).toBe(true);
    expect(selection.range.has("x")).toBe(false);
    expect(selectedOid).toBeNull();
  });

  it("offers Stash changes (not commit actions) on the working-tree row", () => {
    useGraphStore.setState({
      viewport: {
        totalCount: 1,
        offset: 0,
        nodes: [node({ oid: "WORKING_TREE", summary: "1 uncommitted changes", isWorkingTree: true })],
      },
    });
    render(<CommitGraph onViewChanges={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("1 uncommitted changes"));
    expect(screen.getByText("Stash changes…")).toBeInTheDocument();
    expect(screen.queryByText("Copy commit hash")).toBeNull();
  });
});

describe("CommitGraph stash", () => {
  const stashViewport = (): GraphViewport => ({
    totalCount: 2,
    offset: 0,
    nodes: [
      node({ oid: "a".repeat(40), summary: "base commit", isHead: true, row: 0 }),
      node({
        oid: "c".repeat(40),
        summary: "WIP on main: experiment",
        isStash: true,
        stashIndex: 0,
        lane: 1,
        row: 1,
      }),
    ],
  });

  beforeEach(() => {
    useStashStore.setState({
      create: vi.fn().mockResolvedValue(undefined),
      pop: vi.fn().mockResolvedValue(undefined),
      drop: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    });
    useGraphStore.setState({ viewport: stashViewport() });
  });

  it("renders a stash node with the stash badge and message", () => {
    render(<CommitGraph />);
    expect(screen.getByText("stash")).toBeInTheDocument();
    expect(screen.getByText("WIP on main: experiment")).toBeInTheDocument();
  });

  it("offers pop / rename / delete on a stash node and does not select it", () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("WIP on main: experiment"));
    expect(screen.getByText("Pop stash")).toBeInTheDocument();
    expect(screen.getByText("Rename stash…")).toBeInTheDocument();
    expect(screen.getByText("Delete stash")).toBeInTheDocument();
    expect(selectCommit).not.toHaveBeenCalled();
  });

  it("selects a stash on left-click so its diff (vs its base) shows like a commit", () => {
    const onCommitSelect = vi.fn();
    render(<CommitGraph onCommitSelect={onCommitSelect} />);
    fireEvent.click(screen.getByText("WIP on main: experiment"));
    // Selected by its (real) stash commit oid, single-select (no range for a stash).
    expect(selectCommit).toHaveBeenCalledWith("c".repeat(40), "replace");
    expect(onCommitSelect).toHaveBeenCalled();
  });

  it("pops a stash from the menu", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("WIP on main: experiment"));
    fireEvent.click(screen.getByText("Pop stash"));
    await waitFor(() => expect(useStashStore.getState().pop).toHaveBeenCalledWith(0));
  });

  it("stashes the working tree via the prompt", async () => {
    useGraphStore.setState({
      viewport: {
        totalCount: 1,
        offset: 0,
        nodes: [node({ oid: "WORKING_TREE", summary: "2 uncommitted changes", isWorkingTree: true })],
      },
    });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("2 uncommitted changes"));
    fireEvent.click(screen.getByText("Stash changes…"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "my work" } });
    fireEvent.click(screen.getByRole("button", { name: /^stash$/i }));
    await waitFor(() => expect(useStashStore.getState().create).toHaveBeenCalledWith("my work"));
  });

  it("renames a stash via the prompt (prefilled with the current name)", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("WIP on main: experiment"));
    fireEvent.click(screen.getByText("Rename stash…"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("WIP on main: experiment");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    await waitFor(() => expect(useStashStore.getState().rename).toHaveBeenCalledWith(0, "renamed"));
  });
});

describe("CommitGraph tags", () => {
  const taggedViewport = (): GraphViewport => ({
    totalCount: 1,
    offset: 0,
    nodes: [
      node({
        oid: "a".repeat(40),
        summary: "release commit",
        branchLabels: [{ name: "v1.0", isRemote: false, isTag: true }],
        isHead: true,
        row: 0,
      }),
    ],
  });

  beforeEach(() => {
    useTagStore.setState({
      remoteTags: [],
      loaded: true,
      pushTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
    });
    useGraphStore.setState({ viewport: taggedViewport() });
  });

  it("offers Push tag (local-only) and Delete tag", () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("release commit"));
    expect(screen.getByText("Push tag v1.0")).toBeInTheDocument();
    expect(screen.getByText("Delete tag v1.0")).toBeInTheDocument();
    expect(screen.getByText("Copy tag name (v1.0)")).toBeInTheDocument();
  });

  it("hides Push tag when the tag is already on the remote", () => {
    useTagStore.setState({ remoteTags: ["v1.0"] });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("release commit"));
    expect(screen.queryByText("Push tag v1.0")).toBeNull();
    expect(screen.getByText("Delete tag v1.0")).toBeInTheDocument();
  });

  it("pushes a tag from the menu", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("release commit"));
    fireEvent.click(screen.getByText("Push tag v1.0"));
    await waitFor(() => expect(useTagStore.getState().pushTag).toHaveBeenCalledWith("v1.0"));
  });

  it("deletes a tag (local only) via the confirm dialog", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("release commit"));
    fireEvent.click(screen.getByText("Delete tag v1.0"));
    // Local-only tag → no "also remote" checkbox.
    expect(screen.queryByText(/also delete from the remote/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(useTagStore.getState().deleteTag).toHaveBeenCalledWith("v1.0", false));
  });

  it("deletes a tag and the remote copy when on the remote and the box is checked", async () => {
    useTagStore.setState({ remoteTags: ["v1.0"] });
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByText("release commit"));
    fireEvent.click(screen.getByText("Delete tag v1.0"));
    // On-remote tag → the checkbox is present and checked by default.
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(useTagStore.getState().deleteTag).toHaveBeenCalledWith("v1.0", true));
  });
});

describe("CommitGraph search", () => {
  it("mounts the floating search panel when search is open", () => {
    useGraphStore.setState({ searchOpen: true });
    render(<CommitGraph />);
    expect(screen.getByLabelText("Search commits")).toBeInTheDocument();
  });

  it("dims non-matching rows while a search is active", () => {
    useGraphStore.setState({
      searchOpen: true,
      searchQuery: "first",
      searchMatchOids: new Set(["a".repeat(40)]),
      searchHits: [{ row: 0, oid: "a".repeat(40) }],
      searchIndex: 0,
    });
    const { container } = render(<CommitGraph />);
    const matchRow = container.querySelector(`[data-oid="${"a".repeat(40)}"]`);
    const otherRow = container.querySelector(`[data-oid="${"b".repeat(40)}"]`);
    expect(matchRow).not.toHaveAttribute("data-muted");
    expect(otherRow).toHaveAttribute("data-muted", "true");
  });
});
