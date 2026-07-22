export interface RepoInfo {
  name: string;
  path: string;
  headBranch: string | null;
  repoKind?: "main" | "worktree";
  parentRepoPath?: string | null;
  commonDirPath?: string;
  worktreeBranch?: string | null;
  worktreeLocked?: boolean;
  worktreePrunable?: boolean;
}

export type RepoKind = "main" | "worktree";

export type CreateWorktreeMode = "existingBranch" | "newBranchFromBase";

export interface CreateWorktreeRequest {
  targetPath: string;
  mode: CreateWorktreeMode;
  branchName?: string | null;
  startPoint?: string | null;
}

export interface WorktreeEntry {
  path: string;
  name: string;
  repoKind: RepoKind;
  branch: string | null;
  isCurrent: boolean;
  isOpen: boolean;
  isLocked: boolean;
  isPrunable?: boolean;
  hasUncommittedChanges: boolean;
  parentRepoPath: string | null;
}

export interface RemoveWorktreeResult {
  removedPath: string;
  closedTab: boolean;
  activeRepo: RepoInfo | null;
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
}

/** A local branch whose upstream remote-tracking branch is gone — a prune candidate. */
/** Why a local branch is offered for pruning (see the backend `PrunableKind`).
 *  "gone" tracked a now-deleted remote branch (safe); "localOnly" never had a
 *  remote counterpart, so deleting it may discard unpushed commits. */
export type PrunableKind = "gone" | "localOnly";

export interface PrunableBranch {
  name: string;
  kind: PrunableKind;
  /** The remote-tracking branch it followed, now gone (e.g. "origin/feature").
   *  Null for local-only branches, which never had one. */
  upstream: string | null;
  /** Whether the branch's commits are already contained in the base branch
   *  (main/master). A merged local-only branch is safe to delete. */
  merged: boolean;
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
