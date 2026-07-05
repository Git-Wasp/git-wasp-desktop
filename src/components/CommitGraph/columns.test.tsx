import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { BranchCell, MessageCell } from "./columns";
import { COLUMNS } from "./columnModel";
import type { GraphNode } from "../../types/graph";

const node = (over: Partial<GraphNode>): GraphNode => ({
  oid: "a".repeat(40),
  shortOid: "aaaaaaa",
  summary: "feat: do a thing",
  body: "with some extra detail",
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

describe("COLUMNS", () => {
  it("defines branch, graph and message columns in order", () => {
    expect(COLUMNS.map((c) => c.kind)).toEqual(["branch", "graph", "message"]);
    expect(COLUMNS.map((c) => c.header)).toEqual(["Branch / Tag", "Graph", "Commit message"]);
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
});

describe("BranchCell", () => {
  it("renders a pill for each branch label", () => {
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
    // The current pill shows a check; the other keeps its laptop marker.
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

  it("marks local branches with a laptop icon and remotes with a GitHub icon", () => {
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
    // One laptop (local), one GitHub (remote); the tag gets neither.
    expect(container.querySelectorAll('[data-icon="laptop"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-icon="github"]')).toHaveLength(1);
  });
});
