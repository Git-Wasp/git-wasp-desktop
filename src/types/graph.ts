export interface GraphNode {
  oid: string;
  shortOid: string;
  summary: string;
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
