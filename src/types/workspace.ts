export interface Workspace {
  id: string;
  name: string;
  repoPaths: string[];
}

export interface RepoStatusSummary {
  path: string;
  name: string;
  headBranch: string | null;
  ahead: number;
  behind: number;
  uncommittedCount: number;
  error: string | null;
}

export type CrossRepoSearchResultKind = "Branch" | "Commit";

export interface CrossRepoSearchResult {
  repoPath: string;
  repoName: string;
  kind: CrossRepoSearchResultKind;
  label: string;
  oid: string | null;
}

export interface RepoOperationResult {
  path: string;
  name: string;
  success: boolean;
  message: string;
}
