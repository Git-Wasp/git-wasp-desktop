import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  DeviceFlowInit,
  DeviceFlowPollResult,
  GithubConnection,
  GithubRepo,
  PullRequest,
  RemoteInfo,
  RepoLabel,
} from "../types/github";
import { useRepoStore } from "./repoStore";

// Whether two RemoteInfo values point at the same GitHub repo (used to decide
// whether stale `pullRequests` from the previous remote need clearing).
const sameRepo = (a: RemoteInfo | null, b: RemoteInfo | null): boolean =>
  a !== null && b !== null && a.host === b.host && a.owner === b.owner && a.repo === b.repo;

interface GithubStore {
  connections: Record<string, GithubConnection>;
  remoteInfo: RemoteInfo | null;
  pullRequests: PullRequest[];
  githubRepos: GithubRepo[];
  assignableUsers: string[];
  repoLabels: RepoLabel[];
  deviceFlowInit: DeviceFlowInit | null;
  isAuthenticating: boolean;
  prDraft: { head: string; base: string } | null;

  init: () => Promise<void>;
  detectRemote: () => Promise<void>;
  checkConnection: (host: string) => Promise<void>;
  startDeviceFlow: (host: string) => Promise<void>;
  pollDeviceFlow: (host: string) => Promise<DeviceFlowPollResult>;
  cancelDeviceFlow: () => void;
  logout: (host: string) => Promise<void>;
  loadGithubRepos: (host: string) => Promise<void>;
  loadPullRequests: (host: string) => Promise<void>;
  loadAssignableUsers: (host: string) => Promise<void>;
  loadRepoLabels: (host: string) => Promise<void>;
  createPullRequest: (
    host: string,
    title: string,
    body: string,
    head: string,
    base: string,
    assignees?: string[],
    labels?: string[],
  ) => Promise<PullRequest>;
  setPrDraft: (draft: { head: string; base: string } | null) => void;
}

export const useGithubStore = create<GithubStore>((set, get) => ({
  connections: {},
  remoteInfo: null,
  pullRequests: [],
  githubRepos: [],
  assignableUsers: [],
  repoLabels: [],
  deviceFlowInit: null,
  isAuthenticating: false,
  prDraft: null,

  init: async () => {
    // Validate the default host's connection up front — detectRemote only
    // checks a host once a repo with a matching remote is open, which would
    // otherwise leave a freshly-launched app showing "Not connected" even
    // though a token from a previous session is sitting in the keychain.
    await get().checkConnection("github.com");
    await get().detectRemote();
  },

  detectRemote: async () => {
    const epoch = useRepoStore.getState().activationEpoch;
    try {
      const remoteInfo = await invoke<RemoteInfo>("detect_remote_info");
      if (useRepoStore.getState().activationEpoch !== epoch) return; // superseded by a repo switch
      // A different repo (even on the same host) invalidates the previous
      // repo's PR list — otherwise it can linger on screen until the new
      // repo's own list_pull_requests call resolves.
      const changed = !sameRepo(get().remoteInfo, remoteInfo);
      set({ remoteInfo, ...(changed ? { pullRequests: [] } : {}) });
      await get().checkConnection(remoteInfo.host);
    } catch {
      if (useRepoStore.getState().activationEpoch !== epoch) return;
      set({ remoteInfo: null, pullRequests: [] });
    }
  },

  // Validate the stored token against the API (GET /user) so the status reflects
  // a *working* connection, catching a revoked/expired token. Keeps the previous
  // login visible while a re-check is in flight so it doesn't flicker.
  checkConnection: async (host: string) => {
    set((state) => ({
      connections: {
        ...state.connections,
        [host]: { state: "checking", login: state.connections[host]?.login ?? null, message: null },
      },
    }));
    try {
      const status = await invoke<GithubConnection>("github_connection_status", { host });
      set((state) => ({ connections: { ...state.connections, [host]: status } }));
    } catch (e) {
      set((state) => ({
        connections: {
          ...state.connections,
          [host]: { state: "error", login: null, message: String(e) },
        },
      }));
    }
  },

  startDeviceFlow: async (host: string) => {
    if (get().isAuthenticating) return;
    set({ isAuthenticating: true });
    try {
      const init = await invoke<DeviceFlowInit>("github_start_device_flow", { host });
      set({ deviceFlowInit: init });
    } catch (e) {
      set({ isAuthenticating: false });
      throw e;
    }
  },

  pollDeviceFlow: async (host: string) => {
    const init = get().deviceFlowInit;
    if (!init) {
      return { done: false, token: null, slowDown: false };
    }
    const result = await invoke<DeviceFlowPollResult>("github_poll_device_flow", {
      host,
      deviceCode: init.deviceCode,
    });
    if (result.done) {
      set({ deviceFlowInit: null, isAuthenticating: false });
      // Validate the fresh token to populate the connected user (login).
      await get().checkConnection(host);
    }
    return result;
  },

  cancelDeviceFlow: () => {
    set({ deviceFlowInit: null, isAuthenticating: false });
  },

  logout: async (host: string) => {
    await invoke("github_logout", { host });
    set((state) => ({
      connections: {
        ...state.connections,
        [host]: { state: "disconnected", login: null, message: null },
      },
    }));
  },

  loadGithubRepos: async (host: string) => {
    const githubRepos = await invoke<GithubRepo[]>("list_github_repos", { host });
    set({ githubRepos });
  },

  loadPullRequests: async (host: string) => {
    const pullRequests = await invoke<PullRequest[]>("list_pull_requests", { host });
    set({ pullRequests });
  },

  loadAssignableUsers: async (host: string) => {
    const assignableUsers = await invoke<string[]>("list_assignable_users", { host });
    set({ assignableUsers });
  },

  loadRepoLabels: async (host: string) => {
    const repoLabels = await invoke<RepoLabel[]>("list_repo_labels", { host });
    set({ repoLabels });
  },

  createPullRequest: async (
    host: string,
    title: string,
    body: string,
    head: string,
    base: string,
    assignees: string[] = [],
    labels: string[] = [],
  ) => {
    const pr = await invoke<PullRequest>("create_pull_request", {
      host,
      title,
      body,
      head,
      base,
      assignees,
      labels,
    });
    set((state) => ({ pullRequests: [pr, ...state.pullRequests] }));
    return pr;
  },

  setPrDraft: (draft) => set({ prDraft: draft }),
}));
