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

/** Route invoke by command name so the form's data loads resolve in tests. */
function routeInvoke(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    list_assignable_users: ["mike", "ann"],
    list_repo_labels: [
      { name: "bug", color: "d73a4a" },
      { name: "ux", color: "0e8a16" },
    ],
  };
  const table = { ...defaults, ...overrides };
  mockInvoke.mockImplementation(async (cmd: string) => table[cmd]);
}

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    connections: {},
    remoteInfo: { host: "github.com", owner: "mike", repo: "gitclient", protocol: "https" },
    pullRequests: [],
    githubRepos: [],
    assignableUsers: [],
    repoLabels: [],
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

/** Mark the github.com connection as connected (with a login). */
function connectAs(login: string) {
  useGithubStore.setState({
    connections: { "github.com": { state: "connected", login, message: null } },
  });
}

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
    routeInvoke({ create_pull_request: createdPr });
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

  it("disables the assignees and labels pickers when GitHub is not connected", () => {
    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: "assignees" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "labels" })).toBeDisabled();
    expect(screen.getByText(/connect your github account/i)).toBeInTheDocument();
  });

  it("loads assignable users and labels from GitHub when connected", async () => {
    connectAs("mike");
    routeInvoke();

    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_assignable_users", { host: "github.com" });
      expect(mockInvoke).toHaveBeenCalledWith("list_repo_labels", { host: "github.com" });
    });
    // Assignees picker is enabled and defaults to the connected user (@me).
    const assignees = screen.getByRole("button", { name: "assignees" });
    expect(assignees).toBeEnabled();
    expect(assignees).toHaveTextContent("mike");
  });

  it("sends the chosen assignees (default @me) and a picked label", async () => {
    connectAs("mike");
    const createdPr = {
      number: 6,
      title: "T",
      author: "mike",
      headRef: "feat/x",
      baseRef: "main",
      url: "u",
      ciStatus: "none" as const,
      approvalCount: 0,
    };
    routeInvoke({ create_pull_request: createdPr });

    render(<NewPRForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "T" } });

    // Open the labels picker and choose "bug" (loaded from GitHub).
    fireEvent.click(screen.getByRole("button", { name: "labels" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "bug" }));

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "create_pull_request",
        expect.objectContaining({ assignees: ["mike"], labels: ["bug"] }),
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
