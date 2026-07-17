import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { AuthorCell, BranchCell, DateCell, HashCell, MessageCell } from "./columns";
import { columnsForVariant } from "./columnModel";
import type { ColumnVisibility, DataColumn } from "../../stores/graphStore";
import type { GraphNode } from "../../types/graph";

const ALL_VISIBLE: ColumnVisibility = { author: true, branch: true, hash: true, date: true };
const LEDGER_ORDER: DataColumn[] = ["commit", "author", "branch", "hash", "date"];
const SPLIT_ORDER: DataColumn[] = ["hash", "commit", "author", "branch", "date"];

const node = (over: Partial<GraphNode>): GraphNode => ({
  oid: "a".repeat(40),
  shortOid: "aaaaaaa",
  summary: "feat: do a thing",
  body: "with some extra detail",
  authorName: "Priya Natarajan",
  authorEmail: "priya@wasp.dev",
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

describe("columnsForVariant", () => {
  it("orders Ledger Grid graph-first with the data columns after", () => {
    expect(columnsForVariant("ledger", ALL_VISIBLE, LEDGER_ORDER).map((c) => c.kind)).toEqual([
      "graph",
      "commit",
      "author",
      "branch",
      "hash",
      "date",
    ]);
  });

  it("orders Split Rail hash-first with the graph anchored last (right edge)", () => {
    expect(columnsForVariant("split", ALL_VISIBLE, SPLIT_ORDER).map((c) => c.kind)).toEqual([
      "hash",
      "commit",
      "author",
      "branch",
      "date",
      "graph",
    ]);
  });

  it("follows a reordered data-column order, keeping the graph pinned", () => {
    const reordered: DataColumn[] = ["date", "commit", "hash", "author", "branch"];
    expect(columnsForVariant("ledger", ALL_VISIBLE, reordered).map((c) => c.kind)).toEqual([
      "graph",
      "date",
      "commit",
      "hash",
      "author",
      "branch",
    ]);
  });

  it("hides optional columns that are toggled off, keeping graph and commit", () => {
    const cols = columnsForVariant("ledger", { author: false, branch: true, hash: false, date: true }, LEDGER_ORDER);
    expect(cols.map((c) => c.kind)).toEqual(["graph", "commit", "branch", "date"]);
  });

  it("right-aligns hash and date in Ledger Grid only", () => {
    const ledger = columnsForVariant("ledger", ALL_VISIBLE, LEDGER_ORDER);
    expect(ledger.find((c) => c.kind === "hash")!.align).toBe("end");
    expect(ledger.find((c) => c.kind === "date")!.align).toBe("end");
    const split = columnsForVariant("split", ALL_VISIBLE, SPLIT_ORDER);
    expect(split.find((c) => c.kind === "hash")!.align).toBe("start");
  });
});

describe("MessageCell", () => {
  it("renders the summary and the body", () => {
    render(<MessageCell node={node({})} />);
    expect(screen.getByText("feat: do a thing")).toBeInTheDocument();
    expect(screen.getByText(/with some extra detail/)).toBeInTheDocument();
  });

  it("renders only the summary when there is no body", () => {
    render(<MessageCell node={node({ body: "" })} />);
    expect(screen.getByText("feat: do a thing")).toBeInTheDocument();
  });

  it("caps a very long body", () => {
    const long = "x".repeat(300);
    render(<MessageCell node={node({ body: long })} />);
    const body = screen.getByText(/x+…$/);
    expect(body.textContent!.length).toBeLessThan(150);
  });

  it("hides the body line when bodyPlacement is none (Compact)", () => {
    render(<MessageCell node={node({})} bodyPlacement="none" />);
    expect(screen.getByText("feat: do a thing")).toBeInTheDocument();
    expect(screen.queryByText(/with some extra detail/)).not.toBeInTheDocument();
  });

  it("still shows the body inline when bodyPlacement is beside (Cozy)", () => {
    render(<MessageCell node={node({})} bodyPlacement="beside" />);
    expect(screen.getByText("feat: do a thing")).toBeInTheDocument();
    expect(screen.getByText(/with some extra detail/)).toBeInTheDocument();
  });
});

describe("BranchCell", () => {
  it("renders a pill for each branch and a chip for each tag", () => {
    render(
      <BranchCell
        node={node({
          branchLabels: [
            { name: "main", isRemote: false, isTag: false },
            { name: "origin/main", isRemote: true, isTag: false },
            { name: "v1.0", isRemote: false, isTag: true },
          ],
        })}
      />,
    );
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("marks the checked-out branch with a check icon and a current flag", () => {
    const { container } = render(
      <BranchCell
        node={node({
          branchLabels: [
            { name: "main", isRemote: false, isTag: false },
            { name: "feature", isRemote: false, isTag: false },
          ],
        })}
        currentBranch="main"
      />,
    );
    const current = container.querySelector('[data-branch="main"]');
    const other = container.querySelector('[data-branch="feature"]');
    expect(current).toHaveAttribute("data-current", "true");
    expect(other).not.toHaveAttribute("data-current");
    expect(current!.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(current!.querySelector('[data-icon="laptop"]')).toBeNull();
    expect(other!.querySelector('[data-icon="laptop"]')).not.toBeNull();
  });

  it("does not mark a remote branch as current even if the name matches", () => {
    const { container } = render(
      <BranchCell
        node={node({ branchLabels: [{ name: "origin/main", isRemote: true, isTag: false }] })}
        currentBranch="origin/main"
      />,
    );
    expect(container.querySelector('[data-branch="origin/main"]')).not.toHaveAttribute("data-current");
  });

  it("marks local branches with a laptop icon and remotes with a GitHub icon; the tag gets neither", () => {
    const { container } = render(
      <BranchCell
        node={node({
          branchLabels: [
            { name: "main", isRemote: false, isTag: false },
            { name: "origin/main", isRemote: true, isTag: false },
            { name: "v1.0", isRemote: false, isTag: true },
          ],
        })}
      />,
    );
    expect(container.querySelectorAll('[data-icon="laptop"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-icon="github"]')).toHaveLength(1);
    // The tag renders as a notched chip, not a branch pill.
    expect(container.querySelector('[data-tag="v1.0"]')).not.toBeNull();
    expect(container.querySelector('[data-branch="v1.0"]')).toBeNull();
  });

  it("appends a HEAD badge on the checked-out commit's row", () => {
    const { container, rerender } = render(
      <BranchCell
        node={node({ isHead: true, branchLabels: [{ name: "main", isRemote: false, isTag: false }] })}
        currentBranch="main"
      />,
    );
    expect(container.querySelector("[data-head-badge]")).not.toBeNull();
    expect(screen.getByText("HEAD")).toBeInTheDocument();

    rerender(
      <BranchCell
        node={node({ isHead: false, branchLabels: [{ name: "main", isRemote: false, isTag: false }] })}
      />,
    );
    expect(container.querySelector("[data-head-badge]")).toBeNull();
  });
});

describe("BranchCell multiple tags", () => {
  const threeTags = node({
    branchLabels: [
      { name: "v2.0.0", isRemote: false, isTag: true },
      { name: "v2.0", isRemote: false, isTag: true },
      { name: "latest", isRemote: false, isTag: true },
    ],
  });

  it("collapses several tags into one chip: first name + bracketed total count", () => {
    const { container } = render(<BranchCell node={threeTags} />);
    // A single chip, showing the first tag name and the count of all tags.
    const chips = container.querySelectorAll("[data-tag]");
    expect(chips).toHaveLength(1);
    // chips.length === 1, asserted above.
    expect(chips[0]!.getAttribute("data-tag")).toBe("v2.0.0");
    expect(chips[0]!.getAttribute("data-tag-count")).toBe("3");
    expect(chips[0]).toHaveTextContent("v2.0.0");
    expect(chips[0]).toHaveTextContent("(3)");
    // The other tag names are NOT revealed inline (only on hover, over the graph).
    expect(screen.queryByText("latest")).toBeNull();
  });

  it("reveals every tag in a vertical list on hover", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<BranchCell node={threeTags} />);
      const chip = container.querySelector("[data-tag]")!.parentElement!;
      fireEvent.mouseEnter(chip);
      void act(() => vi.advanceTimersByTime(400));

      const tip = screen.getByRole("tooltip");
      expect(tip).toHaveTextContent("v2.0.0");
      expect(tip).toHaveTextContent("v2.0");
      expect(tip).toHaveTextContent("latest");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still renders a single tag as a plain chip (no count)", () => {
    const { container } = render(
      <BranchCell node={node({ branchLabels: [{ name: "v1.0", isRemote: false, isTag: true }] })} />,
    );
    const chips = container.querySelectorAll("[data-tag]");
    expect(chips).toHaveLength(1);
    // chips.length === 1, asserted above.
    expect(chips[0]!.getAttribute("data-tag-count")).toBeNull();
    expect(chips[0]).not.toHaveTextContent("(1)");
  });
});

describe("AuthorCell", () => {
  it("renders computed initials, the name and the email when no photo is available", () => {
    render(<AuthorCell node={node({})} />);
    expect(screen.getByText("PN")).toBeInTheDocument();
    expect(screen.getByText("Priya Natarajan")).toBeInTheDocument();
    expect(screen.getByText("priya@wasp.dev")).toBeInTheDocument();
  });

  it("renders an em dash and no initials on the uncommitted-changes row", () => {
    render(<AuthorCell node={node({ isWorkingTree: true, authorName: "" })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("PN")).toBeNull();
  });

  it("renders an em dash and no '?' avatar on a stash row (author isn't tracked)", () => {
    render(<AuthorCell node={node({ isStash: true, authorName: "", authorEmail: "" })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("?")).toBeNull();
  });
});

describe("HashCell", () => {
  it("renders the short hash for a commit", () => {
    render(<HashCell node={node({ shortOid: "7c02e88" })} />);
    expect(screen.getByText("7c02e88")).toBeInTheDocument();
  });

  it("renders an em dash on the uncommitted-changes row", () => {
    render(<HashCell node={node({ isWorkingTree: true })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("DateCell", () => {
  it("renders 'Now' on the uncommitted-changes row", () => {
    render(<DateCell node={node({ isWorkingTree: true })} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("renders an em dash on a stash row instead of the unix epoch", () => {
    render(<DateCell node={node({ isStash: true, authorTimestamp: 0 })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
