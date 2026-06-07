export interface DeviceFlowInit {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceFlowPollResult {
  done: boolean;
  token: string | null;
}

export interface RemoteInfo {
  host: string;
  owner: string;
  repo: string;
  protocol: "https" | "ssh";
}

export interface FetchResult {
  updatedRefs: string[];
}

export type PullResult =
  | { status: "FastForwarded" }
  | { status: "AlreadyUpToDate" };

export interface AheadBehind {
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
}

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  cloneUrl: string;
  sshUrl: string;
  description: string | null;
}

export type CiStatus = "success" | "failure" | "pending" | "none";

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  headRef: string;
  baseRef: string;
  url: string;
  ciStatus: CiStatus;
  approvalCount: number;
}
