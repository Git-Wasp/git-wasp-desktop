import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitGraph } from "./CommitGraph";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useToastStore } from "../../stores/toastStore";
import { useRemoteStore } from "../../stores/remoteStore";
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
let selectCommit: ReturnType<typeof vi.fn<(oid: string, extend: boolean) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no canvas backend; the graph hook early-returns on a null context.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  selectCommit = vi.fn<(oid: string, extend: boolean) => void>();
  useGraphStore.setState({
    viewport: makeViewport(),
    selection: { anchor: null, focus: null, range: new Set() },
    selectedOid: null,
    lastOffset: 0,
    lastLimit: 40,
    fetchViewport: vi.fn(),
    refresh: vi.fn(),
    selectCommit,
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
  });
  useGithubStore.setState({ remoteInfo: null });
});

describe("CommitGraph columns", () => {
  it("renders the column headers", () => {
    render(<CommitGraph />);
    expect(screen.getByText("Branch / Tag")).toBeInTheDocument();
    expect(screen.getByText("Graph")).toBeInTheDocument();
    expect(screen.getByText("Commit message")).toBeInTheDocument();
  });

  it("renders a branch pill and the commit message per row", () => {
    render(<CommitGraph />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
    expect(screen.getByText("second commit")).toBeInTheDocument();
  });

  it("selects a commit when its row is clicked", () => {
    const onCommitSelect = vi.fn();
    render(<CommitGraph onCommitSelect={onCommitSelect} />);
    fireEvent.click(screen.getByText("second commit"));
    expect(selectCommit).toHaveBeenCalledWith("b".repeat(40), false);
    expect(onCommitSelect).toHaveBeenCalled();
  });

  it("persists a resized branch column width to localStorage", () => {
    localStorage.removeItem("graphBranchColWidth");
    render(<CommitGraph />);
    const handle = screen.getByRole("separator", { name: "Resize branch column" });

    act(() => handle.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true })));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 140, bubbles: true })));
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { clientX: 140, bubbles: true })));

    expect(localStorage.getItem("graphBranchColWidth")).toBe("220"); // 180 default + 40
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

  it("does not open a context menu on the working-tree row", () => {
    useGraphStore.setState({
      viewport: {
        totalCount: 1,
        offset: 0,
        nodes: [node({ oid: "WORKING_TREE", summary: "1 uncommitted changes", isWorkingTree: true })],
      },
    });
    render(<CommitGraph onViewChanges={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("1 uncommitted changes"));
    expect(screen.queryByText("Copy commit hash")).toBeNull();
  });
});
