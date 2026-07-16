import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { StagingPanel } from "./StagingPanel";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useStashStore } from "../../stores/stashStore";
import { useToastStore } from "../../stores/toastStore";
import type { WorkingTreeStatus } from "../../types/workingTree";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core");

const mockListen = vi.mocked(listen);
const mockInvoke = vi.mocked(invoke);

// Captured before beforeEach overrides `startWatching` with a stub for the
// other tests in this file — the listener-leak test below needs the real
// implementation so it can drive `listen()`'s resolution directly.
const realStartWatching = useWorkingTreeStore.getState().startWatching;
// Captured for the same reason — the serialization tests below need the real
// `stageFile`/`unstageFile` implementations (which call `invoke`) rather than
// the `vi.fn()` stubs the other tests in this file install.
const realStageFile = useWorkingTreeStore.getState().stageFile;
const realUnstageFile = useWorkingTreeStore.getState().unstageFile;

const status: WorkingTreeStatus = {
  staged: [{ path: "staged.ts", originalPath: null, status: "Modified" }],
  unstaged: [{ path: "changed.ts", originalPath: null, status: "Modified" }],
  untracked: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkingTreeStore.setState({
    status,
    selectedPath: null,
    stageDiff: null,
    loadStatus: vi.fn().mockResolvedValue(undefined),
    startWatching: vi.fn().mockResolvedValue(() => {}),
    selectFile: vi.fn().mockResolvedValue(undefined),
    stageFile: vi.fn().mockResolvedValue(undefined),
    unstageFile: vi.fn().mockResolvedValue(undefined),
    discardFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  });
});

function menu() {
  return screen.getByRole("menu");
}

describe("StagingPanel row menu", () => {
  it("offers Stage, Discard and Delete on an unstaged file", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    const m = within(menu());
    expect(m.getByText("Stage")).toBeInTheDocument();
    expect(m.getByText("Discard")).toBeInTheDocument();
    expect(m.getByText("Delete file")).toBeInTheDocument();
    expect(m.queryByText("Unstage")).not.toBeInTheDocument();
  });

  it("offers Unstage and Delete (not Stage/Discard) on a staged file", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("staged.ts"));
    const m = within(menu());
    expect(m.getByText("Unstage")).toBeInTheDocument();
    expect(m.getByText("Delete file")).toBeInTheDocument();
    expect(m.queryByText("Stage")).not.toBeInTheDocument();
    expect(m.queryByText("Discard")).not.toBeInTheDocument();
  });

  it("requires confirmation before discarding a file's changes", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Discard"));

    // The discard does not fire until the modal is confirmed.
    expect(useWorkingTreeStore.getState().discardFile).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Discard changes" });
    expect(within(dialog).getByText(/changed\.ts/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Discard"));
    expect(useWorkingTreeStore.getState().discardFile).toHaveBeenCalledWith("changed.ts");
  });

  it("does not discard when the confirmation is cancelled", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Discard"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(useWorkingTreeStore.getState().discardFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires confirmation before deleting a file", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Delete file"));

    // The delete does not fire until the modal is confirmed.
    expect(useWorkingTreeStore.getState().deleteFile).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete file" });
    expect(within(dialog).getByText(/changed\.ts/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Delete"));
    expect(useWorkingTreeStore.getState().deleteFile).toHaveBeenCalledWith("changed.ts");
  });

  it("does not delete when the confirmation is cancelled", () => {
    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Delete file"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(useWorkingTreeStore.getState().deleteFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("StagingPanel toasts on failed mutations", () => {
  it("shows a toast instead of throwing when staging a file fails", async () => {
    useWorkingTreeStore.setState({ stageFile: vi.fn().mockRejectedValue(new Error("boom")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);
    fireEvent.click(screen.getAllByText("Stage")[0]);

    await waitFor(() => expect(error).toHaveBeenCalledWith("Error: boom", { title: "Stage failed" }));
  });

  it("shows a toast instead of throwing when unstaging a file fails", async () => {
    useWorkingTreeStore.setState({ unstageFile: vi.fn().mockRejectedValue(new Error("boom")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);
    fireEvent.click(screen.getByText("Unstage"));

    await waitFor(() => expect(error).toHaveBeenCalledWith("Error: boom", { title: "Unstage failed" }));
  });

  it("shows a toast instead of throwing when discarding a file fails", async () => {
    useWorkingTreeStore.setState({ discardFile: vi.fn().mockRejectedValue(new Error("boom")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Discard"));
    const dialog = screen.getByRole("dialog", { name: "Discard changes" });
    fireEvent.click(within(dialog).getByText("Discard"));

    await waitFor(() => expect(error).toHaveBeenCalledWith("Error: boom", { title: "Discard failed" }));
  });

  it("shows a toast instead of throwing when deleting a file fails", async () => {
    useWorkingTreeStore.setState({ deleteFile: vi.fn().mockRejectedValue(new Error("boom")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);
    fireEvent.contextMenu(screen.getByText("changed.ts"));
    fireEvent.click(within(menu()).getByText("Delete file"));
    const dialog = screen.getByRole("dialog", { name: "Delete file" });
    fireEvent.click(within(dialog).getByText("Delete"));

    await waitFor(() => expect(error).toHaveBeenCalledWith("Error: boom", { title: "Delete failed" }));
  });

  it("shows a toast instead of throwing when loading a file's diff fails", async () => {
    useWorkingTreeStore.setState({ selectFile: vi.fn().mockRejectedValue(new Error("boom")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);
    fireEvent.click(screen.getByText("changed.ts"));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: boom", { title: "Couldn't load diff" }),
    );
  });

  it("shows a toast instead of throwing when the initial status load fails", async () => {
    useWorkingTreeStore.setState({ loadStatus: vi.fn().mockRejectedValue(new Error("boom")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: boom", { title: "Couldn't load working tree status" }),
    );
  });
});

describe("StagingPanel stash changes", () => {
  it("stashes all changes and toasts on success", async () => {
    const stashCreate = vi.fn().mockResolvedValue(undefined);
    const success = vi.fn();
    useStashStore.setState({ create: stashCreate });
    useToastStore.setState({ success });

    render(<StagingPanel />);
    // The button sits before "Stage all" in the Changes header.
    fireEvent.click(screen.getByText("Stash changes"));

    expect(stashCreate).toHaveBeenCalledWith();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("Stashed changes"));
  });

  it("surfaces a stash failure as an error toast", async () => {
    useStashStore.setState({ create: vi.fn().mockRejectedValue("nothing to stash") });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<StagingPanel />);
    fireEvent.click(screen.getByText("Stash changes"));

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });

  it("hides the stash button when only untracked files are present (nothing git will stash)", () => {
    useWorkingTreeStore.setState({
      status: {
        staged: [],
        unstaged: [],
        untracked: [{ path: "new.ts", originalPath: null, status: "Added" }],
      },
    });
    render(<StagingPanel />);
    expect(screen.queryByText("Stash changes")).not.toBeInTheDocument();
    // Stage all still shows for the untracked file.
    expect(screen.getByText("Stage all")).toBeInTheDocument();
  });
});

describe("StagingPanel file-watcher subscription", () => {
  it("does not leak a listener when the panel unmounts before listen() resolves", async () => {
    useWorkingTreeStore.setState({ startWatching: realStartWatching });
    let resolveListen: (fn: () => void) => void;
    mockListen.mockImplementation(
      () =>
        new Promise((r) => {
          resolveListen = r;
        }),
    );
    const { unmount } = render(<StagingPanel />);
    unmount();

    const innerUnlisten = vi.fn();
    resolveListen!(innerUnlisten);
    // The resolution passes through two promise hops (listen()'s await inside
    // startWatching, then startWatching()'s own promise settling before the
    // component's .then() runs), so wait rather than assume a single microtask
    // tick flushes it.
    await vi.waitFor(() => expect(innerUnlisten).toHaveBeenCalled()); // the late-resolved unlisten must be invoked, not dropped
  });
});

describe("StagingPanel stageAll/unstageAll serialization", () => {
  it("stages files one at a time so an intermediate status can't show a staged file as unstaged", async () => {
    // Fake timers make the ordering assertion load-bearing: `order.push` happens
    // synchronously before each call's artificial delay, so a plain `.forEach`
    // (all invokes fired in the same tick) would push both paths before either
    // delay elapses — indistinguishable from a sequential loop if we only ever
    // advanced time in one big jump. Checking the intermediate state (after 0ms,
    // before a.txt's 20ms delay resolves) is what actually proves b.txt's call
    // hasn't started yet, i.e. that the loop awaited a.txt first.
    vi.useFakeTimers();
    const order: string[] = [];
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "stage_file") {
        const path = (args as { path?: string } | undefined)?.path as string;
        order.push(path);
        return new Promise((resolve) =>
          setTimeout(
            () => resolve({ staged: [{ path, originalPath: null, status: "Modified" }], unstaged: [], untracked: [] }),
            path === "a.txt" ? 20 : 5,
          ),
        );
      }
      return Promise.resolve(undefined);
    });
    useWorkingTreeStore.setState({
      stageFile: realStageFile,
      status: {
        staged: [],
        unstaged: [
          { path: "a.txt", originalPath: null, status: "Modified" },
          { path: "b.txt", originalPath: null, status: "Modified" },
        ],
        untracked: [],
      },
    });
    render(<StagingPanel />);

    try {
      fireEvent.click(screen.getByText("Stage all"));
      await vi.advanceTimersByTimeAsync(0); // flush the synchronous portion of the click handler
      expect(order).toEqual(["a.txt"]); // b.txt's stage_file must not have started yet

      await vi.advanceTimersByTimeAsync(25); // let a.txt's 20ms delay elapse, then b.txt's 5ms
      expect(order).toEqual(["a.txt", "b.txt"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unstages files one at a time rather than firing every unstage_file call concurrently", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "unstage_file") {
        const path = (args as { path?: string } | undefined)?.path as string;
        order.push(path);
        return new Promise((resolve) =>
          setTimeout(() => resolve({ staged: [], unstaged: [], untracked: [] }), path === "a.txt" ? 20 : 5),
        );
      }
      return Promise.resolve(undefined);
    });
    useWorkingTreeStore.setState({
      unstageFile: realUnstageFile,
      status: {
        staged: [
          { path: "a.txt", originalPath: null, status: "Modified" },
          { path: "b.txt", originalPath: null, status: "Modified" },
        ],
        unstaged: [],
        untracked: [],
      },
    });
    render(<StagingPanel />);

    try {
      fireEvent.click(screen.getByText("Unstage all"));
      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual(["a.txt"]); // b.txt's unstage_file must not have started yet

      await vi.advanceTimersByTimeAsync(25);
      expect(order).toEqual(["a.txt", "b.txt"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps going and toasts per-file when one file in stageAll fails", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "stage_file") {
        const path = (args as { path?: string } | undefined)?.path as string;
        if (path === "a.txt") return Promise.reject(new Error("boom"));
        return Promise.resolve({
          staged: [{ path, originalPath: null, status: "Modified" }],
          unstaged: [],
          untracked: [],
        });
      }
      return Promise.resolve(undefined);
    });
    const error = vi.fn();
    useToastStore.setState({ error });
    useWorkingTreeStore.setState({
      stageFile: realStageFile,
      status: {
        staged: [],
        unstaged: [
          { path: "a.txt", originalPath: null, status: "Modified" },
          { path: "b.txt", originalPath: null, status: "Modified" },
        ],
        untracked: [],
      },
    });
    render(<StagingPanel />);

    await userEvent.click(screen.getByText("Stage all"));

    await waitFor(() => expect(error).toHaveBeenCalledWith("Error: boom", { title: "Stage failed" }));
    // b.txt still gets staged despite a.txt failing first.
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("stage_file", { path: "b.txt" }),
    );
  });
});
