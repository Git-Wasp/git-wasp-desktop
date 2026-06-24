import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { PRPanel } from "./PRPanel";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";

const mockInvoke = vi.mocked(invoke);

const fakePrs = [
  {
    number: 1,
    title: "Add feature",
    author: "mike",
    headRef: "feat/x",
    baseRef: "main",
    url: "https://github.com/mike/gitclient/pull/1",
    ciStatus: "success" as const,
    approvalCount: 1,
  },
  {
    number: 2,
    title: "Fix bug",
    author: "alice",
    headRef: "fix/y",
    baseRef: "main",
    url: "https://github.com/mike/gitclient/pull/2",
    ciStatus: "failure" as const,
    approvalCount: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    connections: {},
    remoteInfo: { host: "github.com", owner: "mike", repo: "gitclient", protocol: "https" },
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
    prDraft: null,
  });
});

describe("PRPanel", () => {
  it("loads and renders open pull requests", async () => {
    mockInvoke.mockResolvedValueOnce(fakePrs);

    render(<PRPanel />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_pull_requests", { host: "github.com" });
    });
    expect(await screen.findByText("Add feature")).toBeTruthy();
    expect(screen.getByText("Fix bug")).toBeTruthy();
  });

  it("shows an empty state when there are no open PRs", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(<PRPanel />);

    expect(await screen.findByText(/no open pull requests/i)).toBeTruthy();
  });

  it("shows the New PR form when the button is clicked", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(<PRPanel />);

    await screen.findByText(/no open pull requests/i);
    fireEvent.click(screen.getByRole("button", { name: /new pull request/i }));

    expect(screen.getByPlaceholderText(/title/i)).toBeTruthy();
  });

  it("auto-opens the New PR form pre-seeded from a pr draft and clears it on cancel", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    useGithubStore.setState({ prDraft: { head: "feat/x", base: "develop" } });
    useRepoStore.setState({
      currentRepo: { name: "gitclient", path: "/repo", headBranch: "feat/x" },
      recentRepos: [],
      branches: [],
    });

    render(<PRPanel />);

    expect(await screen.findByDisplayValue("feat/x")).toBeTruthy();
    expect(screen.getByDisplayValue("develop")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useGithubStore.getState().prDraft).toBeNull();
  });

  it("shows a message when no GitHub remote is detected", () => {
    useGithubStore.setState({ remoteInfo: null });

    render(<PRPanel />);

    expect(screen.getByText(/no github remote/i)).toBeTruthy();
  });
});
