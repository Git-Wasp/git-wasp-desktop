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

/** HEAD vs working-tree content for the line-level staging editor. */
export interface StageFileContents {
  headContent: string;
  worktreeContent: string;
  /** Either side contains a NUL byte — fall back to whole-file staging. */
  isBinary: boolean;
  /** False when the file is a deletion (absent on disk). */
  worktreeExists: boolean;
}

export interface Identity {
  name: string;
  email: string;
}

/** Git commit identity across config levels (see `get_identity_config`). */
export interface IdentityConfig {
  /** What a commit here would actually use. */
  effective: Identity;
  /** The repo-local override, when set. */
  local: Identity | null;
  /** The global identity, when set. */
  global: Identity | null;
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
