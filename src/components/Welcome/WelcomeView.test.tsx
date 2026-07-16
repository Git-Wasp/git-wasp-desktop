import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { WelcomeView } from "./WelcomeView";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useToastStore } from "../../stores/toastStore";

const mockOpen = vi.mocked(open);

let openRepo: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();
  openRepo = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
  useRepoStore.setState({
    openRepo,
    loadRecentRepos: vi.fn().mockResolvedValue(undefined),
    recentRepos: [
      { name: "alpha", path: "/repos/alpha", pinned: false, lastOpened: 2 },
      { name: "beta", path: "/repos/beta", pinned: false, lastOpened: 1 },
    ],
  });
  useGithubStore.setState({ remoteInfo: null });
});

describe("WelcomeView", () => {
  it("offers open-repository and clone actions", () => {
    render(<WelcomeView />);
    expect(screen.getByRole("button", { name: /open repository/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clone from github/i })).toBeInTheDocument();
  });

  it("lists recent repos and opens one when clicked", () => {
    render(<WelcomeView />);
    fireEvent.click(screen.getByRole("button", { name: /alpha/ }));
    expect(openRepo).toHaveBeenCalledWith("/repos/alpha");
  });

  it("loads recent repos on mount", () => {
    render(<WelcomeView />);
    expect(useRepoStore.getState().loadRecentRepos).toHaveBeenCalled();
  });

  it("shows a toast instead of throwing when opening a folder fails (e.g. a since-deleted folder)", async () => {
    mockOpen.mockResolvedValue("/repos/deleted");
    openRepo.mockRejectedValue(new Error("no such file or directory"));
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<WelcomeView />);
    fireEvent.click(screen.getByRole("button", { name: /open repository/i }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: no such file or directory", {
        title: "Couldn't open repository",
      }),
    );
  });

  it("shows a toast instead of throwing when opening a recent repo fails", async () => {
    openRepo.mockRejectedValue(new Error("no such file or directory"));
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<WelcomeView />);
    fireEvent.click(screen.getByRole("button", { name: /alpha/ }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: no such file or directory", {
        title: "Couldn't open repository",
      }),
    );
  });
});
