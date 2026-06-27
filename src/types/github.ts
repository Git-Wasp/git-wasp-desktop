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
  slowDown: boolean;
}

/**
 * A validated GitHub connection state for a host. `connected`/`expired`/`error`
 * come from a real `GET /user` check; `checking` is a transient client state
 * while that request is in flight.
 */
export type GithubConnectionState =
  | "disconnected"
  | "connected"
  | "expired"
  | "error"
  | "checking";

export interface GithubConnection {
  state: GithubConnectionState;
  login: string | null;
  message: string | null;
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
  | { status: "fastForwarded" }
  | { status: "alreadyUpToDate" }
  | { status: "merged" }
  | { status: "conflicts" };

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

export interface RepoLabel {
  name: string;
  /** GitHub's 6-hex-digit colour, without a leading "#". */
  color: string;
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
