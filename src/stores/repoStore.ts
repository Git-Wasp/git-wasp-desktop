import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { BranchInfo, RepoEntry, RepoInfo } from "../types/repo";

interface RepoStore {
  currentRepo: RepoInfo | null;
  recentRepos: RepoEntry[];
  branches: BranchInfo[];
  openRepo: (path: string) => Promise<void>;
  loadCurrentRepo: () => Promise<void>;
  loadRecentRepos: () => Promise<void>;
  loadBranches: () => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  createBranch: (name: string, startPoint?: string) => Promise<void>;
  renameBranch: (oldName: string, newName: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
}

export const useRepoStore = create<RepoStore>((set, get) => ({
  currentRepo: null,
  recentRepos: [],
  branches: [],

  openRepo: async (path: string) => {
    const repo = await invoke<RepoInfo>("open_repo", { path });
    set({ currentRepo: repo });
  },

  loadCurrentRepo: async () => {
    const repo = await invoke<RepoInfo | null>("get_current_repo");
    set({ currentRepo: repo });
  },

  loadRecentRepos: async () => {
    const repos = await invoke<RepoEntry[]>("get_recent_repos");
    set({ recentRepos: repos });
  },

  loadBranches: async () => {
    const branches = await invoke<BranchInfo[]>("list_branches");
    set({ branches });
  },

  checkoutBranch: async (name: string) => {
    const repo = await invoke<RepoInfo>("checkout_branch", {
      branchName: name,
    });
    set({ currentRepo: repo });
    await get().loadBranches();
  },

  createBranch: async (name: string, startPoint?: string) => {
    await invoke("create_branch", { name, startPoint: startPoint ?? null });
    await get().loadBranches();
  },

  renameBranch: async (oldName: string, newName: string) => {
    await invoke("rename_branch", { oldName, newName });
    await get().loadBranches();
  },

  deleteBranch: async (name: string) => {
    await invoke("delete_branch", { name });
    await get().loadBranches();
  },
}));
