export interface GraphNode {
  oid: string;
  shortOid: string;
  summary: string;
  body?: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  lane: number;
  row: number;
  colorIndex: number;
  parents: string[];
  children: string[];
  edges: GraphEdge[];
  branchLabels: BranchLabel[];
  isHead: boolean;
  // Present on the synthetic working-tree node (see graph layout).
  isWorkingTree?: boolean;
  changeCount?: number | null;
  // Present on stash nodes — drawn dotted, hanging off their base commit.
  isStash?: boolean;
  stashIndex?: number | null;
}

export interface GraphEdge {
  srcLane: number;
  dstLane: number;
  colorIndex: number;
  kind: "Straight" | "Merge" | "Branch" | "Stash";
}

export interface BranchLabel {
  name: string;
  isRemote: boolean;
  isTag: boolean;
}

export interface GraphViewport {
  nodes: GraphNode[];
  totalCount: number;
  offset: number;
  // Absolute row of the HEAD commit (working-tree offset included), or null when
  // HEAD is unborn. Used to draw the dotted working-tree→HEAD connector down to
  // HEAD's dot even when HEAD isn't in the loaded slice.
  headRow?: number | null;
}
