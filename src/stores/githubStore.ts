import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  DeviceFlowInit,
  DeviceFlowPollResult,
  GithubRepo,
  PullRequest,
  RemoteInfo,
} from "../types/github";

interface GithubStore {
  authStatus: Record<string, boolean>;
  remoteInfo: RemoteInfo | null;
  pullRequests: PullRequest[];
  githubRepos: GithubRepo[];
  deviceFlowInit: DeviceFlowInit | null;
  isAuthenticating: boolean;

  init: () => Promise<void>;
  detectRemote: () => Promise<void>;
  checkAuthStatus: (host: string) => Promise<void>;
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
}

export const useGithubStore = create<GithubStore>((set, get) => ({
  authStatus: {},
  remoteInfo: null,
  pullRequests: [],
  githubRepos: [],
  deviceFlowInit: null,
  isAuthenticating: false,

  init: async () => {
    await get().detectRemote();
  },

  detectRemote: async () => {
    try {
      const remoteInfo = await invoke<RemoteInfo>("detect_remote_info");
      set({ remoteInfo });
      await get().checkAuthStatus(remoteInfo.host);
    } catch {
      set({ remoteInfo: null });
    }
  },

  checkAuthStatus: async (host: string) => {
    const authenticated = await invoke<boolean>("github_auth_status", { host });
    set((state) => ({ authStatus: { ...state.authStatus, [host]: authenticated } }));
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
      return { done: false, token: null };
    }
    const result = await invoke<DeviceFlowPollResult>("github_poll_device_flow", {
      host,
      deviceCode: init.deviceCode,
    });
    if (result.done) {
      set((state) => ({
        deviceFlowInit: null,
        isAuthenticating: false,
        authStatus: { ...state.authStatus, [host]: true },
      }));
    }
    return result;
  },

  cancelDeviceFlow: () => {
    set({ deviceFlowInit: null, isAuthenticating: false });
  },

  logout: async (host: string) => {
    await invoke("github_logout", { host });
    set((state) => ({ authStatus: { ...state.authStatus, [host]: false } }));
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
}));
