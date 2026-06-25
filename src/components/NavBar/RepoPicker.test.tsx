import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { RepoPicker } from "./RepoPicker";
import { useRepoStore } from "../../stores/repoStore";
import type { RepoEntry } from "../../types/repo";

const mockOpen = vi.mocked(open);

const recents: RepoEntry[] = [
  { path: "/repo", name: "gitclient", pinned: false, lastOpened: 2 },
  { path: "/other", name: "other-repo", pinned: false, lastOpened: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({
    currentRepo: { name: "gitclient", path: "/repo", headBranch: "main" },
    recentRepos: recents,
    loadRecentRepos: vi.fn().mockResolvedValue(undefined),
    openRepo: vi.fn().mockResolvedValue(undefined),
  });
});

describe("RepoPicker", () => {
  it("shows the current repo name on the trigger", () => {
    render(<RepoPicker />);
    expect(screen.getByRole("button", { name: /repository picker/i })).toHaveTextContent("gitclient");
  });

  it("shows a prompt when no repo is open", () => {
    useRepoStore.setState({ currentRepo: null });
    render(<RepoPicker />);
    expect(screen.getByRole("button", { name: /repository picker/i })).toHaveTextContent(
      "Open a repository",
    );
  });

  it("lists recent repos and opens a chosen one", async () => {
    render(<RepoPicker />);
    fireEvent.click(screen.getByRole("button", { name: /repository picker/i }));

    fireEvent.click(screen.getByText("other-repo"));

    await waitFor(() => expect(useRepoStore.getState().openRepo).toHaveBeenCalledWith("/other"));
  });

  it("does not re-open the already-active repo", () => {
    render(<RepoPicker />);
    fireEvent.click(screen.getByRole("button", { name: /repository picker/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /gitclient/i }));
    expect(useRepoStore.getState().openRepo).not.toHaveBeenCalled();
  });

  it("opens a folder via the Open repository… action", async () => {
    mockOpen.mockResolvedValueOnce("/picked/repo");
    render(<RepoPicker />);
    fireEvent.click(screen.getByRole("button", { name: /repository picker/i }));
    fireEvent.click(screen.getByText("Open repository…"));

    await waitFor(() =>
      expect(useRepoStore.getState().openRepo).toHaveBeenCalledWith("/picked/repo"),
    );
  });
});
