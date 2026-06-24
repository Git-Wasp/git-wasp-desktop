import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "@testing-library/jest-dom";
import { CloneDialog } from "./CloneDialog";
import { useGithubStore } from "../../stores/githubStore";

const mockInvoke = vi.mocked(invoke);
const mockOpen = vi.mocked(open);

const fakeRepos = [
  {
    id: 1,
    name: "gitclient",
    fullName: "mike/gitclient",
    private: false,
    cloneUrl: "https://github.com/mike/gitclient.git",
    sshUrl: "git@github.com:mike/gitclient.git",
    description: "a git client",
  },
  {
    id: 2,
    name: "dotfiles",
    fullName: "mike/dotfiles",
    private: true,
    cloneUrl: "https://github.com/mike/dotfiles.git",
    sshUrl: "git@github.com:mike/dotfiles.git",
    description: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    connections: {},
    remoteInfo: null,
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
  });
});

describe("CloneDialog", () => {
  it("loads and renders the user's GitHub repos on mount", async () => {
    mockInvoke.mockResolvedValueOnce(fakeRepos); // list_github_repos

    render(<CloneDialog host="github.com" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_github_repos", { host: "github.com" });
    });
    expect(await screen.findByText("mike/gitclient")).toBeTruthy();
    expect(screen.getByText("mike/dotfiles")).toBeTruthy();
  });

  it("filters the repo list by search text", async () => {
    mockInvoke.mockResolvedValueOnce(fakeRepos);

    render(<CloneDialog host="github.com" onClose={vi.fn()} />);

    await screen.findByText("mike/gitclient");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "dot" } });

    expect(screen.queryByText("mike/gitclient")).toBeNull();
    expect(screen.getByText("mike/dotfiles")).toBeTruthy();
  });

  it("clones the selected repo into the chosen directory", async () => {
    mockInvoke.mockResolvedValueOnce(fakeRepos); // list_github_repos
    mockOpen.mockResolvedValueOnce("/Users/mike/code");
    mockInvoke.mockResolvedValueOnce({ name: "gitclient", path: "/Users/mike/code/gitclient", headBranch: "main" }); // clone_repo
    const onClose = vi.fn();

    render(<CloneDialog host="github.com" onClose={onClose} />);

    fireEvent.click(await screen.findByText("mike/gitclient"));
    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });

    // Wait for the chosen folder to land in state (async setDestDir) so the
    // destination path is computed and the Clone button becomes enabled.
    await screen.findByText("/Users/mike/code/gitclient");

    fireEvent.click(screen.getByRole("button", { name: /^clone$/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("clone_repo", {
        url: "https://github.com/mike/gitclient.git",
        destPath: "/Users/mike/code/gitclient",
      });
    });
    expect(onClose).toHaveBeenCalled();
  });
});
