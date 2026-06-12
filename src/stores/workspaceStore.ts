import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  CrossRepoSearchResult,
  RepoOperationResult,
  RepoStatusSummary,
  Workspace,
} from "../types/workspace";

interface WorkspaceStore {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  repoStatuses: RepoStatusSummary[];
  searchResults: CrossRepoSearchResult[];
  operationResults: RepoOperationResult[];
  isLoadingStatus: boolean;
  isSearching: boolean;
  isFetchingAll: boolean;
  isPullingAll: boolean;
  lastError: string | null;

  loadWorkspaces: () => Promise<void>;
  loadActiveWorkspace: () => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  addRepoToWorkspace: (workspaceId: string, path: string) => Promise<void>;
  removeRepoFromWorkspace: (workspaceId: string, path: string) => Promise<void>;
  setActiveWorkspace: (id: string | null) => Promise<void>;
  loadStatus: (workspaceId: string) => Promise<void>;
  search: (workspaceId: string, query: string) => Promise<void>;
  fetchAll: (workspaceId: string) => Promise<void>;
  pullAll: (workspaceId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  repoStatuses: [],
  searchResults: [],
  operationResults: [],
  isLoadingStatus: false,
  isSearching: false,
  isFetchingAll: false,
  isPullingAll: false,
  lastError: null,

  loadWorkspaces: async () => {
    const workspaces = await invoke<Workspace[]>("list_workspaces");
    set({ workspaces });
  },

  loadActiveWorkspace: async () => {
    const activeWorkspace = await invoke<Workspace | null>("get_active_workspace");
    set({ activeWorkspace });
  },

  createWorkspace: async (name: string) => {
    const workspace = await invoke<Workspace>("create_workspace", { name });
    await get().loadWorkspaces();
    return workspace;
  },

  renameWorkspace: async (id: string, name: string) => {
    await invoke("rename_workspace", { id, name });
    await get().loadWorkspaces();
  },

  deleteWorkspace: async (id: string) => {
    await invoke("delete_workspace", { id });
    await Promise.all([get().loadWorkspaces(), get().loadActiveWorkspace()]);
  },

  addRepoToWorkspace: async (workspaceId: string, path: string) => {
    await invoke("add_repo_to_workspace", { workspaceId, path });
    await get().loadWorkspaces();
  },

  removeRepoFromWorkspace: async (workspaceId: string, path: string) => {
    await invoke("remove_repo_from_workspace", { workspaceId, path });
    await get().loadWorkspaces();
  },

  setActiveWorkspace: async (id: string | null) => {
    await invoke("set_active_workspace", { id });
    await get().loadActiveWorkspace();
    const active = get().activeWorkspace;
    if (active) {
      await get().loadStatus(active.id);
    }
  },

  loadStatus: async (workspaceId: string) => {
    set({ isLoadingStatus: true, lastError: null });
    try {
      const repoStatuses = await invoke<RepoStatusSummary[]>("get_workspace_status", { workspaceId });
      set({ repoStatuses });
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isLoadingStatus: false });
    }
  },

  search: async (workspaceId: string, query: string) => {
    set({ isSearching: true, lastError: null });
    try {
      const searchResults = await invoke<CrossRepoSearchResult[]>("search_workspace", { workspaceId, query });
      set({ searchResults });
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isSearching: false });
    }
  },

  fetchAll: async (workspaceId: string) => {
    set({ isFetchingAll: true, lastError: null });
    try {
      const operationResults = await invoke<RepoOperationResult[]>("workspace_fetch_all", { workspaceId });
      set({ operationResults });
      await get().loadStatus(workspaceId);
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isFetchingAll: false });
    }
  },

  pullAll: async (workspaceId: string) => {
    set({ isPullingAll: true, lastError: null });
    try {
      const operationResults = await invoke<RepoOperationResult[]>("workspace_pull_all", { workspaceId });
      set({ operationResults });
      await get().loadStatus(workspaceId);
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isPullingAll: false });
    }
  },
}));
