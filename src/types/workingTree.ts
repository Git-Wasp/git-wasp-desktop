export type StatusCode = "Added" | "Modified" | "Deleted" | "Renamed";

export interface StatusEntry {
  path: string;
  originalPath: string | null;
  status: StatusCode;
}

export interface WorkingTreeStatus {
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  untracked: StatusEntry[];
}

export interface Hunk {
  index: number;
  header: string;
  content: string;
  oldStart: number;
  newStart: number;
}

export interface FileDiffHunks {
  path: string;
  hunks: Hunk[];
}

export interface Identity {
  name: string;
  email: string;
}

export interface HeadCommitInfo {
  oid: string;
  message: string;
  /** True once HEAD is contained in a remote-tracking branch (already pushed). */
  pushed: boolean;
}

export interface StashEntry {
  index: number;
  message: string;
  oid: string;
}
