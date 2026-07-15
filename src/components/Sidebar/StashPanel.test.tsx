import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "../../stores/repoStore";
import { StashPanel } from "./StashPanel";
import type { StashEntry } from "../../types/workingTree";

vi.mock("@tauri-apps/api/core");
const mockInvoke = vi.mocked(invoke);

const stashes: StashEntry[] = [{ index: 0, message: "WIP on main: experiment", oid: "a".repeat(40) }];

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({ activeRepoPath: "/repo-a" });
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "stash_list_cmd") return Promise.resolve(stashes);
    if (cmd === "stash_apply_cmd" || cmd === "stash_pop_cmd") {
      return Promise.resolve({ staged: [], unstaged: [], untracked: [] });
    }
    if (cmd === "stash_drop_cmd") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

describe("StashPanel", () => {
  it("renders each stash with Apply / Pop / Drop actions", async () => {
    render(<StashPanel />);
    await screen.findByText("WIP on main: experiment");
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop" })).toBeInTheDocument();
  });

  it("applies a stash immediately without confirmation", async () => {
    render(<StashPanel />);
    await screen.findByText("WIP on main: experiment");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("stash_apply_cmd", { index: 0 }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pops a stash immediately without confirmation", async () => {
    render(<StashPanel />);
    await screen.findByText("WIP on main: experiment");
    fireEvent.click(screen.getByRole("button", { name: "Pop" }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("stash_pop_cmd", { index: 0 }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires confirmation before dropping a stash", async () => {
    render(<StashPanel />);
    await screen.findByText("WIP on main: experiment");
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));

    // The drop does not fire until the modal is confirmed.
    expect(mockInvoke).not.toHaveBeenCalledWith("stash_drop_cmd", expect.anything());
    const dialog = screen.getByRole("dialog", { name: "Drop stash" });
    expect(within(dialog).getByText(/WIP on main: experiment/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Drop" }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("stash_drop_cmd", { index: 0 }),
    );
  });

  it("does not drop a stash when the confirmation is cancelled", async () => {
    render(<StashPanel />);
    await screen.findByText("WIP on main: experiment");
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    fireEvent.click(screen.getByText("Cancel"));

    expect(mockInvoke).not.toHaveBeenCalledWith("stash_drop_cmd", expect.anything());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reloads the stash list when the active repo changes", async () => {
    mockInvoke.mockResolvedValueOnce([{ index: 0, message: "repo A stash", oid: "a".repeat(40) }]);
    const { rerender } = render(<StashPanel />);
    expect(await screen.findByText("repo A stash")).toBeInTheDocument();

    mockInvoke.mockResolvedValueOnce([{ index: 0, message: "repo B stash", oid: "b".repeat(40) }]);
    useRepoStore.setState({ activeRepoPath: "/repo-b" });
    rerender(<StashPanel />);

    expect(await screen.findByText("repo B stash")).toBeInTheDocument();
  });
});
