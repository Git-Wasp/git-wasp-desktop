import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  DeviceFlowInit,
  DeviceFlowPollResult,
  GithubConnection,
  GithubRepo,
  PullRequest,
  RemoteInfo,
} from "../types/github";

interface GithubStore {
  connections: Record<string, GithubConnection>;
  remoteInfo: RemoteInfo | null;
  pullRequests: PullRequest[];
  githubRepos: GithubRepo[];
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
  createPullRequest: (
    host: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ) => Promise<PullRequest>;
  setPrDraft: (draft: { head: string; base: string } | null) => void;
}

export const useGithubStore = create<GithubStore>((set, get) => ({
  connections: {},
  remoteInfo: null,
  pullRequests: [],
  githubRepos: [],
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
    try {
      const remoteInfo = await invoke<RemoteInfo>("detect_remote_info");
      set({ remoteInfo });
      await get().checkConnection(remoteInfo.host);
    } catch {
      set({ remoteInfo: null });
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

  createPullRequest: async (
    host: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ) => {
    const pr = await invoke<PullRequest>("create_pull_request", { host, title, body, head, base });
    set((state) => ({ pullRequests: [pr, ...state.pullRequests] }));
    return pr;
  },

  setPrDraft: (draft) => set({ prDraft: draft }),
}));
