import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { NewPRForm } from "./NewPRForm";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    authStatus: { "github.com": true },
    remoteInfo: { host: "github.com", owner: "mike", repo: "gitclient", protocol: "https" },
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
  });
  useRepoStore.setState({
    currentRepo: { name: "gitclient", path: "/repo", headBranch: "feat/x" },
    recentRepos: [],
    branches: [
      { name: "feat/x", isRemote: false, isHead: true, upstream: null, oid: "a", ahead: null, behind: null },
      { name: "main", isRemote: false, isHead: false, upstream: null, oid: "b", ahead: null, behind: null },
    ],
  });
});

describe("NewPRForm", () => {
  it("pre-fills head with the current branch and base with main", () => {
    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByDisplayValue("feat/x")).toBeTruthy();
    expect(screen.getByDisplayValue("main")).toBeTruthy();
  });

  it("submits the form and calls createPullRequest with the entered values", async () => {
    const createdPr = {
      number: 5,
      title: "My PR",
      author: "mike",
      headRef: "feat/x",
      baseRef: "main",
      url: "https://github.com/mike/gitclient/pull/5",
      ciStatus: "none" as const,
      approvalCount: 0,
    };
    mockInvoke.mockResolvedValueOnce(createdPr);
    const onCreated = vi.fn();

    render(<NewPRForm onCreated={onCreated} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "My PR" } });
    fireEvent.change(screen.getByPlaceholderText(/description/i), { target: { value: "details" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_pull_request", {
        host: "github.com",
        title: "My PR",
        body: "details",
        head: "feat/x",
        base: "main",
      });
    });
    expect(onCreated).toHaveBeenCalledWith(createdPr);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<NewPRForm onCreated={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalled();
  });
});
