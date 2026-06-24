import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { NavBar } from "./NavBar";
import { useRepoStore } from "../../stores/repoStore";

const mockOpen = vi.mocked(open);

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({
    currentRepo: { name: "gitclient", path: "/repo", headBranch: "main" },
    openRepo: vi.fn().mockResolvedValue(undefined),
  });
});

describe("NavBar", () => {
  it("renders the History, PRs, and Settings tabs", () => {
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PRs" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
  });

  it("no longer renders a Changes tab (the uncommitted section handles changes)", () => {
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
  });

  it("marks the active view tab as selected", () => {
    render(<NavBar view="prs" onViewChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "PRs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the view when a tab is clicked", () => {
    const onViewChange = vi.fn();
    render(<NavBar view="history" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "PRs" }));
    expect(onViewChange).toHaveBeenCalledWith("prs");
  });

  it("hides the repo-specific view tabs when no repo is open, but keeps Settings and Open Repository", () => {
    useRepoStore.setState({ currentRepo: null });
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open repository/i })).toBeInTheDocument();
  });

  it("shows the sidebar toggle only when an onToggleSidebar handler is given", () => {
    const { rerender } = render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /sidebar/i })).toBeNull();

    rerender(
      <NavBar view="history" onViewChange={vi.fn()} sidebarCollapsed={false} onToggleSidebar={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeInTheDocument();
  });

  it("toggles the sidebar and reflects collapsed state in the label", () => {
    const onToggleSidebar = vi.fn();
    const { rerender } = render(
      <NavBar view="history" onViewChange={vi.fn()} sidebarCollapsed={false} onToggleSidebar={onToggleSidebar} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);

    rerender(
      <NavBar view="history" onViewChange={vi.fn()} sidebarCollapsed={true} onToggleSidebar={onToggleSidebar} />,
    );
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
  });

  it("opens a chosen folder as a repo", async () => {
    mockOpen.mockResolvedValueOnce("/picked/repo");
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /open repository/i }));
    await waitFor(() =>
      expect(useRepoStore.getState().openRepo).toHaveBeenCalledWith("/picked/repo"),
    );
  });
});
