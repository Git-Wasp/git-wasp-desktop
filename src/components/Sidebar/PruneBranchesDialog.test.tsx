import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { PruneBranchesDialog } from "./PruneBranchesDialog";
import { useToastStore } from "../../stores/toastStore";
import type { PrunableBranch } from "../../types/repo";

const mockInvoke = vi.mocked(invoke);

function routeInvoke(prunable: PrunableBranch[], over: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    fetch_remote: { updatedRefs: [] },
    list_prunable_branches: prunable,
    get_ahead_behind: [],
    list_branches: [],
    delete_branch: undefined,
    ...over,
  };
  mockInvoke.mockImplementation(async (cmd: string) => table[cmd]);
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

const gone = (name: string, upstream: string): PrunableBranch => ({
  name,
  kind: "gone",
  upstream,
  merged: false,
});
const localOnly = (name: string, merged: boolean): PrunableBranch => ({
  name,
  kind: "localOnly",
  upstream: null,
  merged,
});

describe("PruneBranchesDialog", () => {
  it("fetches with prune, then lists the gone branches (all selected)", async () => {
    routeInvoke([gone("feat/old", "origin/feat/old"), gone("bugfix", "origin/bugfix")]);

    render(<PruneBranchesDialog onClose={vi.fn()} />);

    expect(await screen.findByLabelText("feat/old")).toBeChecked();
    expect(screen.getByLabelText("bugfix")).toBeChecked();
    // A prune fetch ran before listing.
    expect(mockInvoke).toHaveBeenCalledWith("fetch_remote", { remoteName: null, prune: true });
    expect(screen.getByRole("button", { name: /delete 2 branches/i })).toBeEnabled();
  });

  it("pre-selects a merged local-only branch but not an unmerged one", async () => {
    routeInvoke([localOnly("merged-feature", true), localOnly("wip", false)]);

    render(<PruneBranchesDialog onClose={vi.fn()} />);

    expect(await screen.findByLabelText("merged-feature")).toBeChecked();
    expect(screen.getByLabelText("wip")).not.toBeChecked();
    // Only the merged one is pre-selected.
    expect(screen.getByRole("button", { name: /delete 1 branch$/i })).toBeInTheDocument();
  });

  it("shows an empty state when nothing is prunable", async () => {
    routeInvoke([]);
    render(<PruneBranchesDialog onClose={vi.fn()} />);

    expect(await screen.findByText(/no branches to prune/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("deletes only the selected branches and closes", async () => {
    routeInvoke([gone("feat/old", "origin/feat/old"), gone("bugfix", "origin/bugfix")]);
    const onClose = vi.fn();
    render(<PruneBranchesDialog onClose={onClose} />);

    // Deselect one, leaving only "bugfix".
    fireEvent.click(await screen.findByLabelText("feat/old"));
    expect(screen.getByRole("button", { name: /delete 1 branch$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete 1 branch$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockInvoke).toHaveBeenCalledWith("delete_branch", { name: "bugfix" });
    expect(mockInvoke).not.toHaveBeenCalledWith("delete_branch", { name: "feat/old" });
  });

  it("still lists branches when the prune fetch fails (offline)", async () => {
    routeInvoke([gone("feat/old", "origin/feat/old")], {
      fetch_remote: undefined,
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_remote") throw new Error("offline");
      if (cmd === "list_prunable_branches") return [gone("feat/old", "origin/feat/old")];
      return undefined;
    });

    render(<PruneBranchesDialog onClose={vi.fn()} />);

    expect(await screen.findByLabelText("feat/old")).toBeInTheDocument();
  });
});
