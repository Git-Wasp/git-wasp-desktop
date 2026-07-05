import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitGraph } from "./CommitGraph";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import type { GraphNode, GraphViewport } from "../../types/graph";

const node = (oid: string, summary: string, branch: string): GraphNode => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
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
  branchLabels: [{ name: branch, isRemote: false, isTag: false }],
  isHead: false,
  onHeadLine: true,
});

const viewport: GraphViewport = {
  totalCount: 2,
  offset: 0,
  nodes: [
    { ...node("a".repeat(40), "first", "main"), row: 0 },
    { ...node("b".repeat(40), "second", "feat"), row: 1 },
  ],
};

let selectCommit: ReturnType<typeof vi.fn<(oid: string, extend: boolean) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  selectCommit = vi.fn<(oid: string, extend: boolean) => void>();
  useGraphStore.setState({
    viewport,
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

// Window pointer events carry coordinates via MouseEvent (jsdom PointerEvent drops them).
function fireWindow(type: string, clientX: number, clientY: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
  });
}

describe("CommitGraph drag-and-drop (DOM pills)", () => {
  it("opens the merge confirmation modal when a branch pill is dragged onto another", () => {
    render(<CommitGraph onStartPullRequest={vi.fn()} />);

    fireEvent.pointerDown(screen.getByText("main"), { clientX: 10, clientY: 8 });
    fireWindow("pointermove", 10, 30); // start drag (past threshold)
    fireEvent.pointerEnter(screen.getByText("feat"));
    fireWindow("pointerup", 10, 30);

    const dialog = screen.getByRole("dialog", { name: /merge branch/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Merge" })).toBeInTheDocument();
  });

  it("invokes onStartPullRequest from the modal", () => {
    const onStartPullRequest = vi.fn();
    render(<CommitGraph onStartPullRequest={onStartPullRequest} />);

    fireEvent.pointerDown(screen.getByText("main"), { clientX: 10, clientY: 8 });
    fireWindow("pointermove", 10, 30);
    fireEvent.pointerEnter(screen.getByText("feat"));
    fireWindow("pointerup", 10, 30);
    fireEvent.click(screen.getByRole("button", { name: /start pull request/i }));

    expect(onStartPullRequest).toHaveBeenCalledWith("main", "feat");
  });

  it("does not select a commit on the click that ends a drag", () => {
    render(<CommitGraph onStartPullRequest={vi.fn()} />);

    fireEvent.pointerDown(screen.getByText("main"), { clientX: 10, clientY: 8 });
    fireWindow("pointermove", 10, 30);
    fireEvent.pointerEnter(screen.getByText("feat"));
    fireWindow("pointerup", 10, 30);
    fireEvent.click(screen.getByText("first")); // the row that owned the source pill

    expect(selectCommit).not.toHaveBeenCalled();
  });
});
