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
  it("renders the History, Changes, PRs, and Settings tabs", () => {
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Changes" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PRs" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
  });

  it("marks the active view tab as selected", () => {
    render(<NavBar view="prs" onViewChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "PRs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the view when a tab is clicked", () => {
    const onViewChange = vi.fn();
    render(<NavBar view="history" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(onViewChange).toHaveBeenCalledWith("working-tree");
  });

  it("hides the repo-specific view tabs when no repo is open, but keeps Settings and Open Repository", () => {
    useRepoStore.setState({ currentRepo: null });
    render(<NavBar view="history" onViewChange={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open repository/i })).toBeInTheDocument();
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
