import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitGraph } from "./CommitGraph";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
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
  });
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
    expect(screen.getByText("Checkout main")).toBeInTheDocument();
    expect(screen.getByText(/Rename main/)).toBeInTheDocument();
    expect(screen.getByText("Delete main")).toBeInTheDocument();
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
