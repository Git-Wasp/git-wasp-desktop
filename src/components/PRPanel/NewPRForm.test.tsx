import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@testing-library/jest-dom";
import { NewPRForm } from "./NewPRForm";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockOpenUrl = vi.mocked(openUrl);

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    connections: {},
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
      { name: "origin/main", isRemote: true, isHead: false, upstream: null, oid: "c", ahead: null, behind: null },
    ],
  });
});

describe("NewPRForm", () => {
  it("pre-fills head with the current branch and base with main", () => {
    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText("head branch")).toHaveValue("feat/x");
    expect(screen.getByLabelText("base branch")).toHaveValue("main");
  });

  it("offers only local branches in the pickers", () => {
    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    const headOptions = Array.from(
      screen.getByLabelText("head branch").querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(headOptions).toEqual(["feat/x", "main"]);
    expect(headOptions).not.toContain("origin/main");
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
        assignees: [],
        labels: [],
      });
    });
    expect(onCreated).toHaveBeenCalledWith(createdPr);
  });

  it("defaults the assignee to the connected user and sends assignees + labels", async () => {
    useGithubStore.setState({
      connections: { "github.com": { state: "connected", login: "mike", message: null } },
    });
    mockInvoke.mockResolvedValueOnce({
      number: 6,
      title: "T",
      author: "mike",
      headRef: "feat/x",
      baseRef: "main",
      url: "u",
      ciStatus: "none" as const,
      approvalCount: 0,
    });

    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByDisplayValue("mike")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "T" } });
    fireEvent.change(screen.getByPlaceholderText(/labels/i), { target: { value: "bug, ux" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "create_pull_request",
        expect.objectContaining({ assignees: ["mike"], labels: ["bug", "ux"] }),
      );
    });
  });

  it("opens GitHub's compare page with the draft when Continue on GitHub is clicked", () => {
    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "My PR" } });
    fireEvent.click(screen.getByRole("button", { name: /continue on github/i }));

    expect(mockOpenUrl).toHaveBeenCalledTimes(1);
    const url = mockOpenUrl.mock.calls[0][0] as string;
    expect(url).toContain("https://github.com/mike/gitclient/compare/main...feat%2Fx");
    expect(url).toContain("title=My+PR");
  });

  it("pre-fills head and base from initial props when provided", () => {
    render(
      <NewPRForm initialHead="feat/x" initialBase="develop" onCreated={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByLabelText("head branch")).toHaveValue("feat/x");
    expect(screen.getByLabelText("base branch")).toHaveValue("develop");
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<NewPRForm onCreated={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalled();
  });
});
