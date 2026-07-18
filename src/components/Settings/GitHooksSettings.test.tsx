import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "../../stores/repoStore";
import { GitHooksSettings } from "./GitHooksSettings";

const mockInvoke = vi.mocked(invoke);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({
    currentRepo: { name: "repo", path: "/repo", headBranch: "main" },
  });
});

describe("GitHooksSettings", () => {
  it("explains that a repository is required", () => {
    useRepoStore.setState({ currentRepo: null });

    render(<GitHooksSettings />);

    expect(screen.getByText(/open a repository/i)).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("loads default-on preferences for the current repository", async () => {
    mockInvoke.mockResolvedValueOnce({ preCommit: true, prePush: true });

    render(<GitHooksSettings />);

    expect(await screen.findByLabelText("Run pre-commit")).toBeChecked();
    expect(screen.getByLabelText("Run pre-push")).toBeChecked();
    expect(mockInvoke).toHaveBeenCalledWith("get_hook_preferences", {
      repoPath: "/repo",
    });
  });

  it("persists one toggle without changing the other", async () => {
    mockInvoke
      .mockResolvedValueOnce({ preCommit: true, prePush: true })
      .mockResolvedValueOnce({ preCommit: false, prePush: true });

    render(<GitHooksSettings />);
    await userEvent.click(await screen.findByLabelText("Run pre-commit"));

    expect(mockInvoke).toHaveBeenLastCalledWith("set_hook_preferences", {
      repoPath: "/repo",
      preferences: { preCommit: false, prePush: true },
    });
  });

  it("normalizes the repository path and only reloads when it changes", async () => {
    mockInvoke.mockResolvedValue({ preCommit: true, prePush: true });
    const { rerender } = render(<GitHooksSettings />);
    await screen.findByLabelText("Run pre-commit");

    useRepoStore.setState({
      currentRepo: { name: "renamed", path: "/repo/", headBranch: "develop" },
    });
    rerender(<GitHooksSettings />);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("discards a stale load after the current repository changes", async () => {
    const first = deferred<{ preCommit: boolean; prePush: boolean }>();
    const second = deferred<{ preCommit: boolean; prePush: boolean }>();
    mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<GitHooksSettings />);

    useRepoStore.setState({
      currentRepo: { name: "other", path: "/other", headBranch: "main" },
    });
    second.resolve({ preCommit: false, prePush: true });
    expect(await screen.findByLabelText("Run pre-commit")).not.toBeChecked();

    first.resolve({ preCommit: true, prePush: false });
    await waitFor(() =>
      expect(screen.getByLabelText("Run pre-push")).toBeChecked(),
    );
  });

  it("disables both toggles while loading and saving", async () => {
    const load = deferred<{ preCommit: boolean; prePush: boolean }>();
    const save = deferred<{ preCommit: boolean; prePush: boolean }>();
    mockInvoke.mockReturnValueOnce(load.promise).mockReturnValueOnce(save.promise);
    render(<GitHooksSettings />);

    expect(screen.getByLabelText("Run pre-commit")).toBeDisabled();
    expect(screen.getByLabelText("Run pre-push")).toBeDisabled();

    load.resolve({ preCommit: true, prePush: true });
    const preCommit = await screen.findByLabelText("Run pre-commit");
    await waitFor(() => expect(preCommit).toBeEnabled());
    await userEvent.click(preCommit);

    expect(preCommit).toBeDisabled();
    expect(screen.getByLabelText("Run pre-push")).toBeDisabled();
    save.resolve({ preCommit: false, prePush: true });
    await waitFor(() => expect(preCommit).toBeEnabled());
  });

  it("restores backend-confirmed preferences and shows an inline error when saving fails", async () => {
    mockInvoke
      .mockResolvedValueOnce({ preCommit: true, prePush: false })
      .mockRejectedValueOnce(new Error("permission denied"));
    render(<GitHooksSettings />);

    const preCommit = await screen.findByLabelText("Run pre-commit");
    await userEvent.click(preCommit);

    expect(await screen.findByText(/permission denied/i)).toHaveStyle({
      color: "var(--color-danger)",
    });
    expect(preCommit).toBeChecked();
    expect(screen.getByLabelText("Run pre-push")).not.toBeChecked();
  });
});
