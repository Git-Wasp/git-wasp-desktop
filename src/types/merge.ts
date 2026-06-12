export type ConflictKind =
  | "normalEdit"
  | "addAdd"
  | "deleteModify"
  | "modifyDelete"
  | "binaryOrUnmergeable";

export type ConflictSide = "ours" | "theirs";

export interface ConflictBlock {
  startLine: number;
  midLine: number;
  endLine: number;
  oursText: string;
  theirsText: string;
}

export interface ConflictedFile {
  path: string;
  kind: ConflictKind;
  oursContent: string | null;
  theirsContent: string | null;
  baseContent: string | null;
  seededResult: string | null;
  conflictBlocks: ConflictBlock[];
}

export type MergeOutcome =
  | { status: "clean" }
  | { status: "conflicts"; conflicts: ConflictedFile[] };

export type OperationStatus =
  | { kind: "none" }
  | { kind: "merge"; sourceBranch: string | null; conflicts: ConflictedFile[] };
