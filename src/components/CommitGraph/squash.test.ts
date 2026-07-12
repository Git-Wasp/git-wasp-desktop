import { describe, expect, it } from "vitest";
import { buildSquashPlan } from "./squash";
import type { GraphNode } from "../../types/graph";

function node(partial: Partial<GraphNode> & { oid: string; row: number }): GraphNode {
  return {
    shortOid: partial.oid.slice(0, 7),
    summary: partial.oid,
    authorName: "Test",
    authorEmail: "test@test.com",
    authorTimestamp: 0,
    lane: 0,
    colorIndex: 0,
    parents: [],
    children: [],
    edges: [],
    branchLabels: [],
    isHead: false,
    onHeadLine: true,
    ...partial,
  };
}

describe("buildSquashPlan", () => {
  // Rows increase downward with the newest commit on top.
  const nodes = [
    node({ oid: "c3", row: 0, summary: "third" }),
    node({ oid: "c2", row: 1, summary: "second", body: "body two" }),
    node({ oid: "c1", row: 2, summary: "first" }),
  ];

  it("returns null for fewer than two selected commits", () => {
    expect(buildSquashPlan(nodes, new Set(["c3"]))).toBeNull();
    expect(buildSquashPlan(nodes, new Set())).toBeNull();
  });

  it("orders oids newest-first and joins the message oldest-first", () => {
    const plan = buildSquashPlan(nodes, new Set(["c1", "c2", "c3"]));
    expect(plan).not.toBeNull();
    expect(plan!.oids).toEqual(["c3", "c2", "c1"]);
    // Oldest first; the body of c2 is appended under its summary.
    expect(plan!.message).toBe("first\n\nsecond\n\nbody two\n\nthird");
  });

  it("returns null for a discontiguous selection (gap between commits)", () => {
    // c3 and c1 selected, c2 skipped — not an unbroken run.
    expect(buildSquashPlan(nodes, new Set(["c3", "c1"]))).toBeNull();
  });

  it("treats a stash row between commits as not a gap", () => {
    // A stash hangs between two otherwise-adjacent commits; selecting just the
    // two commits is still contiguous.
    const withStash = [
      node({ oid: "c2", row: 0, summary: "second" }),
      node({ oid: "stash", row: 1, isStash: true }),
      node({ oid: "c1", row: 2, summary: "first" }),
    ];
    const plan = buildSquashPlan(withStash, new Set(["c2", "c1"]));
    expect(plan!.oids).toEqual(["c2", "c1"]);
  });

  it("ignores working-tree and stash rows", () => {
    const withSynthetic = [
      node({ oid: "wt", row: 0, isWorkingTree: true }),
      ...nodes,
      node({ oid: "stash", row: 3, isStash: true }),
    ];
    const plan = buildSquashPlan(
      withSynthetic,
      new Set(["wt", "stash", "c3", "c2"]),
    );
    expect(plan!.oids).toEqual(["c3", "c2"]);
  });
});
