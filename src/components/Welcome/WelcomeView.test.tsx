import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { WelcomeView } from "./WelcomeView";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";

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
});
