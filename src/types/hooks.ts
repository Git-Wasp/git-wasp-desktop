export type HookName = "pre-commit" | "pre-push";
export type HookRunStatus = "idle" | "running" | "succeeded" | "failed";
export type HookStream = "stdout" | "stderr";

export interface HookPreferences {
  preCommit: boolean;
  prePush: boolean;
}

export interface HookStarted {
  repoPath: string;
  runId: string;
  hook: HookName;
  operation: "commit" | "push";
}

export interface HookOutput {
  repoPath: string;
  runId: string;
  stream: HookStream;
  chunk: string;
}

export interface HookFinished {
  repoPath: string;
  runId: string;
  hook: HookName;
  outcome: "succeeded" | "failed";
  exitCode: number | null;
  summary: string;
}
