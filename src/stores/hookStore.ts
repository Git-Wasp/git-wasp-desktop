import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type {
  HookFinished,
  HookName,
  HookOutput,
  HookStarted,
  HookStream,
  HookRunStatus,
} from "../types/hooks";

export const MAX_RETAINED_OUTPUT = 1024 * 1024;
export const TRUNCATION_NOTICE = "\r\n[Earlier hook output truncated]\r\n";

export interface HookChunk {
  stream: HookStream;
  chunk: string;
}

export interface RepoHookRun {
  runId: string | null;
  hook: HookName | null;
  operation: "commit" | "push" | null;
  status: HookRunStatus;
  chunks: HookChunk[];
  retainedLength: number;
  summary: string | null;
  paneVisible: boolean;
  following: boolean;
}

interface HookStore {
  runs: Record<string, RepoHookRun>;
  started: (event: HookStarted) => void;
  appendOutput: (event: HookOutput) => void;
  finished: (event: HookFinished) => void;
  setPaneVisible: (repoPath: string, visible: boolean) => void;
  setFollowing: (repoPath: string, following: boolean) => void;
  clearRepo: (repoPath: string) => void;
}

function normalizeRepoPath(repoPath: string): string {
  const normalized = repoPath.replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function retainOutput(chunks: HookChunk[], incoming: HookChunk): {
  chunks: HookChunk[];
  retainedLength: number;
} {
  const hadNotice = chunks.some((chunk) => chunk.chunk === TRUNCATION_NOTICE);
  const retained = chunks
    .filter((chunk) => chunk.chunk !== TRUNCATION_NOTICE)
    .concat(incoming);
  let retainedLength = retained.reduce((sum, chunk) => sum + chunk.chunk.length, 0);
  let truncated = hadNotice;

  while (
    retained.length > 0 &&
    retainedLength + (truncated ? TRUNCATION_NOTICE.length : 0) > MAX_RETAINED_OUTPUT
  ) {
    const removed = retained.shift();
    retainedLength -= removed?.chunk.length ?? 0;
    truncated = true;
  }

  if (truncated) {
    retained.unshift({ stream: "stderr", chunk: TRUNCATION_NOTICE });
    retainedLength += TRUNCATION_NOTICE.length;
  }

  return { chunks: retained, retainedLength };
}

export const useHookStore = create<HookStore>((set) => ({
  runs: {},

  started: (event) => {
    const repoPath = normalizeRepoPath(event.repoPath);
    set((state) => ({
      runs: {
        ...state.runs,
        [repoPath]: {
          runId: event.runId,
          hook: event.hook,
          operation: event.operation,
          status: "running",
          chunks: [],
          retainedLength: 0,
          summary: null,
          paneVisible: true,
          following: true,
        },
      },
    }));
  },

  appendOutput: (event) => {
    const repoPath = normalizeRepoPath(event.repoPath);
    set((state) => {
      const run = state.runs[repoPath];
      if (!run || run.runId !== event.runId) return state;
      const retained = retainOutput(run.chunks, { stream: event.stream, chunk: event.chunk });
      return {
        runs: {
          ...state.runs,
          [repoPath]: { ...run, ...retained },
        },
      };
    });
  },

  finished: (event) => {
    const repoPath = normalizeRepoPath(event.repoPath);
    set((state) => {
      const run = state.runs[repoPath];
      if (!run || run.runId !== event.runId || run.hook !== event.hook) return state;
      return {
        runs: {
          ...state.runs,
          [repoPath]: {
            ...run,
            status: event.outcome,
            summary: event.summary,
          },
        },
      };
    });
  },

  setPaneVisible: (repoPath, paneVisible) => {
    const key = normalizeRepoPath(repoPath);
    set((state) => {
      const run = state.runs[key];
      if (!run) return state;
      return { runs: { ...state.runs, [key]: { ...run, paneVisible } } };
    });
  },

  setFollowing: (repoPath, following) => {
    const key = normalizeRepoPath(repoPath);
    set((state) => {
      const run = state.runs[key];
      if (!run) return state;
      return { runs: { ...state.runs, [key]: { ...run, following } } };
    });
  },

  clearRepo: (repoPath) => {
    const key = normalizeRepoPath(repoPath);
    set((state) => {
      if (!(key in state.runs)) return state;
      const runs = { ...state.runs };
      delete runs[key];
      return { runs };
    });
  },
}));

export const selectHookRun =
  (repoPath: string | null) =>
  (state: HookStore): RepoHookRun | undefined =>
    repoPath === null ? undefined : state.runs[normalizeRepoPath(repoPath)];

function cleanupListeners(unlisten: UnlistenFn[]): Error | undefined {
  let firstError: Error | undefined;
  for (const cleanup of unlisten) {
    try {
      cleanup();
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  return firstError;
}

export async function initHookListeners(): Promise<() => void> {
  const unlisten: UnlistenFn[] = [];
  try {
    unlisten.push(
      await listen<HookStarted>("git-hook://started", ({ payload }) => {
        useHookStore.getState().started(payload);
      }),
    );
    unlisten.push(
      await listen<HookOutput>("git-hook://output", ({ payload }) => {
        useHookStore.getState().appendOutput(payload);
      }),
    );
    unlisten.push(
      await listen<HookFinished>("git-hook://finished", ({ payload }) => {
        useHookStore.getState().finished(payload);
      }),
    );
  } catch (error) {
    cleanupListeners(unlisten);
    throw error;
  }

  return () => {
    const error = cleanupListeners(unlisten);
    if (error !== undefined) throw error;
  };
}
