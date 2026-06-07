export interface RepoInfo {
  name: string;
  path: string;
  headBranch: string | null;
}

export interface RepoEntry {
  path: string;
  name: string;
  pinned: boolean;
  lastOpened: number;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  upstream: string | null;
  oid: string;
  ahead: number | null;
  behind: number | null;
}

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: "Added" | "Modified" | "Deleted" | "Renamed" | "Copied" | "Untracked";
  additions: number;
  deletions: number;
}

export interface CommitDetail {
  oid: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  committerName: string;
  committerTimestamp: number;
  parentOids: string[];
  changedFiles: ChangedFile[];
}
