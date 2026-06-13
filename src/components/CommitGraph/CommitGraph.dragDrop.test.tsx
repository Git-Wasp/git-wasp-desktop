import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitGraph } from "./CommitGraph";
import { useGraphStore } from "../../stores/graphStore";
import type { GraphViewport } from "../../types/graph";
import type { BranchLabelHit } from "./dragDrop";

// Pill rects the (mocked) render hook will expose for hit-testing. jsdom's
// canvas has no context, so we inject geometry instead of measuring it.
let testHits: BranchLabelHit[] = [];

vi.mock("../../hooks/useCommitGraph", () => ({
  useCommitGraph: (
    _canvasRef: unknown,
    _viewport: unknown,
    _selection: unknown,
    labelHitsRef?: { current: BranchLabelHit[] },
  ) => {
    if (labelHitsRef) labelHitsRef.current = testHits;
  },
}));

const node = (oid: string, row: number) => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary: oid,
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
  isHead: row === 0,
});

const viewport: GraphViewport = {
  totalCount: 2,
  offset: 0,
  nodes: [node("a".repeat(40), 0), node("b".repeat(40), 1)],
};

const pill = (over: Partial<BranchLabelHit>): BranchLabelHit => ({
  name: "main",
  isRemote: false,
  isTag: false,
  x: 0,
  y: 0,
  w: 60,
  h: 16,
  ...over,
});

let selectCommit: ReturnType<typeof vi.fn<(oid: string, extend: boolean) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  selectCommit = vi.fn<(oid: string, extend: boolean) => void>();
  testHits = [
    pill({ name: "main", x: 0, y: 0, w: 60, h: 16 }),
    pill({ name: "feat", x: 0, y: 30, w: 60, h: 16 }),
  ];
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
});

function canvas() {
  return document.querySelector("canvas")!;
}

// jsdom's PointerEvent ignores clientX/clientY; MouseEvent honors them and
// React dispatches by event-type name, so this drives the pointer handlers.
function firePointer(type: string, clientX: number, clientY: number) {
  act(() => {
    canvas().dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }),
    );
  });
}

describe("CommitGraph drag-and-drop", () => {
  it("opens a drop menu when a branch pill is dragged onto another branch", () => {
    render(<CommitGraph onStartPullRequest={vi.fn()} />);

    firePointer("pointerdown", 10, 8);
    firePointer("pointermove", 10, 38);
    firePointer("pointerup", 10, 38);

    expect(screen.getByText("Merge main into feat")).toBeTruthy();
    expect(screen.getByText(/Start pull request main → feat/)).toBeTruthy();
  });

  it("invokes onStartPullRequest from the drop menu", () => {
    const onStartPullRequest = vi.fn();
    render(<CommitGraph onStartPullRequest={onStartPullRequest} />);

    firePointer("pointerdown", 10, 8);
    firePointer("pointermove", 10, 38);
    firePointer("pointerup", 10, 38);
    fireEvent.click(screen.getByText(/Start pull request main → feat/));

    expect(onStartPullRequest).toHaveBeenCalledWith("main", "feat");
  });

  it("does not select a commit on the click that follows a drag", () => {
    render(<CommitGraph onStartPullRequest={vi.fn()} />);

    firePointer("pointerdown", 10, 8);
    firePointer("pointermove", 10, 38);
    firePointer("pointerup", 10, 38);
    firePointer("click", 10, 38);

    expect(selectCommit).not.toHaveBeenCalled();
  });

  it("shows a grab cursor when hovering a branch pill", () => {
    render(<CommitGraph onStartPullRequest={vi.fn()} />);

    expect(canvas().style.cursor).toBe("default");

    firePointer("pointermove", 10, 8); // over the 'main' pill
    expect(canvas().style.cursor).toBe("grab");

    firePointer("pointermove", 300, 300); // off any pill
    expect(canvas().style.cursor).toBe("default");
  });

  it("still selects a commit on a plain click (no drag)", () => {
    render(<CommitGraph onStartPullRequest={vi.fn()} />);

    firePointer("pointerdown", 200, 8); // not on a pill
    firePointer("pointerup", 200, 8);
    firePointer("click", 200, 8);

    expect(selectCommit).toHaveBeenCalledWith("a".repeat(40), false);
  });
});
