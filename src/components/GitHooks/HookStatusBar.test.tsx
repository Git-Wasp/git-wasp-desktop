import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { RepoHookRun } from "../../stores/hookStore";
import { useHookStore } from "../../stores/hookStore";
import { HookStatusBar } from "./HookStatusBar";

function seedRun(overrides: Partial<RepoHookRun>) {
  useHookStore.setState({
    runs: {
      "/repo": {
        runId: "run-1",
        hook: "pre-commit",
        operation: "commit",
        status: "running",
        chunks: [],
        retainedLength: 0,
        summary: null,
        paneVisible: true,
        following: true,
        ...overrides,
      },
    },
  });
}

beforeEach(() => useHookStore.setState({ runs: {} }));

describe("HookStatusBar", () => {
  it("shows the idle state when the repository has no run", () => {
    render(<HookStatusBar repoPath="/repo" />);
    expect(screen.getByText("Git hooks ready")).toBeInTheDocument();
  });

  it.each([
    ["running", "Running pre-commit…"],
    ["succeeded", "pre-commit succeeded"],
    ["failed", "pre-commit failed; review hook output"],
  ] as const)("shows %s state", (status, expected) => {
    seedRun({ status });
    render(<HookStatusBar repoPath="/repo" />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("reshows retained output", async () => {
    seedRun({
      status: "succeeded",
      paneVisible: false,
      chunks: [{ stream: "stdout", chunk: "kept" }],
      retainedLength: 4,
    });
    render(<HookStatusBar repoPath="/repo" />);
    await userEvent.click(screen.getByRole("button", { name: "Show hook output" }));
    expect(useHookStore.getState().runs["/repo"]?.paneVisible).toBe(true);
  });

  it("hides visible retained output", async () => {
    seedRun({ chunks: [{ stream: "stdout", chunk: "kept" }], retainedLength: 4 });
    render(<HookStatusBar repoPath="/repo" />);
    await userEvent.click(screen.getByRole("button", { name: "Hide hook output" }));
    expect(useHookStore.getState().runs["/repo"]?.paneVisible).toBe(false);
  });
});
