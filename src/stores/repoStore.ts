import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { BranchInfo, RepoEntry, RepoInfo } from "../types/repo";
import { useGraphStore } from "./graphStore";
import { useMergeStore } from "./mergeStore";
import { useWorkingTreeStore } from "./workingTreeStore";

const INITIAL_LIMIT = 150;

interface RepoStore {
  currentRepo: RepoInfo | null;
  recentRepos: RepoEntry[];
  branches: BranchInfo[];
  openRepos: RepoInfo[];
  activeRepoPath: string | null;
  openRepo: (path: string) => Promise<void>;
  loadCurrentRepo: () => Promise<void>;
  loadOpenRepos: () => Promise<void>;
  activateRepo: (path: string) => Promise<void>;
  closeRepo: (path: string) => Promise<void>;
  loadRecentRepos: () => Promise<void>;
  loadBranches: () => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  createBranch: (name: string, startPoint?: string) => Promise<void>;
  renameBranch: (oldName: string, newName: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
}

export const useRepoStore = create<RepoStore>((set, get) => {
  // Reload everything that's scoped to the active repo: graph, branches, and
  // the working-tree / merge status. Called whenever the active tab changes.
  const reloadActiveRepo = async (repo: RepoInfo) => {
    set({ currentRepo: repo, activeRepoPath: repo.path });
    useGraphStore.getState().clearSelection();
    await Promise.all([
      useGraphStore.getState().fetchViewport(0, INITIAL_LIMIT),
      get().loadBranches(),
      useMergeStore.getState().loadStatus(),
      useWorkingTreeStore.getState().loadStatus(),
    ]);
  };

  return {
    currentRepo: null,
    recentRepos: [],
    branches: [],
    openRepos: [],
    activeRepoPath: null,

    openRepo: async (path: string) => {
      const repo = await invoke<RepoInfo>("open_repo", { path });
      await get().loadOpenRepos();
      await reloadActiveRepo(repo);
    },

    loadCurrentRepo: async () => {
      const repo = await invoke<RepoInfo | null>("get_current_repo");
      set({ currentRepo: repo, activeRepoPath: repo?.path ?? null });
    },

    loadOpenRepos: async () => {
      const repos = await invoke<RepoInfo[]>("list_open_repos");
      set({ openRepos: repos });
    },

    activateRepo: async (path: string) => {
      const repo = await invoke<RepoInfo>("activate_repo", { path });
      await reloadActiveRepo(repo);
    },

    closeRepo: async (path: string) => {
      const next = await invoke<RepoInfo | null>("close_repo", { path });
      await get().loadOpenRepos();
      if (next) {
        await reloadActiveRepo(next);
      } else {
        set({ currentRepo: null, activeRepoPath: null, branches: [] });
        useGraphStore.getState().clearSelection();
      }
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
  };
});
