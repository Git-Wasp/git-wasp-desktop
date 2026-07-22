import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { NavBar } from "./NavBar";
import { useRepoStore } from "../../stores/repoStore";

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({
    currentRepo: { name: "gitclient", path: "/repo", headBranch: "main" },
    recentRepos: [],
    branches: [],
    openRepo: vi.fn().mockResolvedValue(undefined),
    loadRecentRepos: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
  });
});

describe("NavBar", () => {
  it("renders the History, PRs, and Settings tabs", () => {
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PRs" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
  });

  it("gives each tab an icon (accessible name is unchanged as icons are aria-hidden)", () => {
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(
      screen
        .getByRole("tab", { name: "History" })
        .querySelector('[data-icon="history"]'),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("tab", { name: "PRs" })
        .querySelector('[data-icon="pull-request"]'),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("tab", { name: /settings/i })
        .querySelector('[data-icon="settings"]'),
    ).toBeInTheDocument();
  });

  it("no longer renders a Changes tab (the uncommitted section handles changes)", () => {
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
  });

  it("marks the active view tab as selected", () => {
    render(<NavBar view="prs" onViewChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "PRs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("switches the view when a tab is clicked", () => {
    const onViewChange = vi.fn();
    render(<NavBar view="history" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "PRs" }));
    expect(onViewChange).toHaveBeenCalledWith("prs");
  });

  it("hides the view tabs and branch picker when no repo is open, but keeps Settings and the repo picker", () => {
    useRepoStore.setState({ currentRepo: null });
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
    // The repo picker stands in for the removed "Open Repository" button.
    expect(
      screen.getByRole("button", { name: /repository picker/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /branch picker/i })).toBeNull();
  });

  it("shows the sidebar toggle only when an onToggleSidebar handler is given", () => {
    const { rerender } = render(
      <NavBar view="history" onViewChange={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /sidebar/i })).toBeNull();

    rerender(
      <NavBar
        view="history"
        onViewChange={vi.fn()}
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Hide sidebar" }),
    ).toBeInTheDocument();
  });

  it("toggles the sidebar and reflects collapsed state in the label", () => {
    const onToggleSidebar = vi.fn();
    const { rerender } = render(
      <NavBar
        view="history"
        onViewChange={vi.fn()}
        sidebarCollapsed={false}
        onToggleSidebar={onToggleSidebar}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);

    rerender(
      <NavBar
        view="history"
        onViewChange={vi.fn()}
        sidebarCollapsed={true}
        onToggleSidebar={onToggleSidebar}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show sidebar" }),
    ).toBeInTheDocument();
  });

  it("shows the repo and branch pickers when a repo is open", () => {
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /repository picker/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /branch picker/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("gitclient")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows a New worktree button when a repo is open", () => {
    useRepoStore.setState({
      currentRepo: {
        name: "main",
        path: "/repos/main",
        headBranch: "main",
        repoKind: "main",
        parentRepoPath: null,
        commonDirPath: "/repos/main/.git",
        worktreeBranch: "main",
        worktreeLocked: false,
        worktreePrunable: false,
      },
    });

    render(<NavBar view="history" onViewChange={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "New worktree" }),
    ).toBeInTheDocument();
  });
});
