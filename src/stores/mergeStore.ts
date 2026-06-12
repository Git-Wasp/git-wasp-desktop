import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ConflictedFile, ConflictSide, MergeOutcome, OperationStatus } from "../types/merge";

interface MergeStore {
  status: OperationStatus;
  isLoading: boolean;
  lastError: string | null;

  loadStatus: () => Promise<void>;
  startMerge: (branchName: string) => Promise<MergeOutcome>;
  resolveFile: (path: string, content: string) => Promise<ConflictedFile[]>;
  resolveWithSide: (path: string, side: ConflictSide) => Promise<ConflictedFile[]>;
  resolveWithDeletion: (path: string) => Promise<ConflictedFile[]>;
  completeMerge: (message: string) => Promise<string>;
  abortMerge: () => Promise<void>;
}

export const useMergeStore = create<MergeStore>((set, get) => ({
  status: { kind: "none" },
  isLoading: false,
  lastError: null,

  loadStatus: async () => {
    const status = await invoke<OperationStatus>("operation_status");
    set({ status });
  },

  startMerge: async (branchName: string) => {
    set({ isLoading: true, lastError: null });
    try {
      const result = await invoke<MergeOutcome>("merge_start", { branchName });
      await get().loadStatus();
      return result;
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  resolveFile: async (path: string, content: string) => {
    set({ isLoading: true, lastError: null });
    try {
      const result = await invoke<ConflictedFile[]>("merge_resolve_file", { path, content });
      await get().loadStatus();
      return result;
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  resolveWithSide: async (path: string, side: ConflictSide) => {
    set({ isLoading: true, lastError: null });
    try {
      const result = await invoke<ConflictedFile[]>("merge_resolve_with_side", { path, side });
      await get().loadStatus();
      return result;
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  resolveWithDeletion: async (path: string) => {
    set({ isLoading: true, lastError: null });
    try {
      const result = await invoke<ConflictedFile[]>("merge_resolve_with_deletion", { path });
      await get().loadStatus();
      return result;
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  completeMerge: async (message: string) => {
    set({ isLoading: true, lastError: null });
    try {
      const result = await invoke<string>("merge_complete", { message });
      await get().loadStatus();
      return result;
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  abortMerge: async () => {
    set({ isLoading: true, lastError: null });
    try {
      await invoke("merge_abort");
      await get().loadStatus();
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },
}));
