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
}

export interface GraphEdge {
  srcLane: number;
  dstLane: number;
  colorIndex: number;
  kind: "Straight" | "Merge" | "Branch";
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
}
