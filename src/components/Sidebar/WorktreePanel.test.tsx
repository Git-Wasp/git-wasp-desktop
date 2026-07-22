import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { WorktreePanel } from "./WorktreePanel";

describe("WorktreePanel", () => {
  it("renders the main repo and sibling worktrees, highlighting the current entry", () => {
    const activate = vi.fn();

    render(
      <WorktreePanel
        currentRepoPath="/repos/main-feature"
        worktrees={[
          {
            path: "/repos/main",
            name: "main",
            repoKind: "main",
            branch: "main",
            isCurrent: false,
            isOpen: true,
            isLocked: false,
            hasUncommittedChanges: false,
            parentRepoPath: null,
          },
          {
            path: "/repos/main-feature",
            name: "main-feature",
            repoKind: "worktree",
            branch: "feature/worktree",
            isCurrent: true,
            isOpen: true,
            isLocked: true,
            hasUncommittedChanges: true,
            parentRepoPath: "/repos/main",
          },
        ]}
        onOpenOrActivate={activate}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onOpenParent={vi.fn()}
        onLock={vi.fn()}
        onUnlock={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Worktrees" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New worktree" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("/repos/main")).toBeInTheDocument();
    expect(screen.getByTitle("/repos/main-feature")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Dirty")).toBeInTheDocument();
  });

  it("shows remove only for a clean unlocked linked worktree", async () => {
    render(
      <WorktreePanel
        currentRepoPath="/repos/main"
        worktrees={[
          {
            path: "/repos/main-clean",
            name: "main-clean",
            repoKind: "worktree",
            branch: "feature/clean",
            isCurrent: false,
            isOpen: false,
            isLocked: false,
            isPrunable: false,
            hasUncommittedChanges: false,
            parentRepoPath: "/repos/main",
          },
        ]}
        onOpenOrActivate={vi.fn()}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onOpenParent={vi.fn()}
        onLock={vi.fn()}
        onUnlock={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "main-clean actions" }));
    expect(await screen.findByText("Remove worktree")).toBeInTheDocument();
  });

  it("passes the row path when opening a parent repo", async () => {
    const onOpenParent = vi.fn();

    render(
      <WorktreePanel
        currentRepoPath="/repos/main-feature"
        worktrees={[
          {
            path: "/repos/main-feature",
            name: "main-feature",
            repoKind: "worktree",
            branch: "feature/worktree",
            isCurrent: true,
            isOpen: true,
            isLocked: false,
            isPrunable: false,
            hasUncommittedChanges: false,
            parentRepoPath: "/repos/main",
          },
        ]}
        onOpenOrActivate={vi.fn()}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onOpenParent={onOpenParent}
        onLock={vi.fn()}
        onUnlock={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "main-feature actions" }),
    );
    fireEvent.click(await screen.findByText("Open parent repo"));

    expect(onOpenParent).toHaveBeenCalledWith("/repos/main-feature");
  });

  it("renders prunable worktrees as non-openable rows with no unsafe actions", async () => {
    const onOpenOrActivate = vi.fn();

    render(
      <WorktreePanel
        currentRepoPath="/repos/main"
        worktrees={[
          {
            path: "/repos/missing-worktree",
            name: "missing-worktree",
            repoKind: "worktree",
            branch: "feature/missing",
            isCurrent: false,
            isOpen: false,
            isLocked: false,
            isPrunable: true,
            hasUncommittedChanges: false,
            parentRepoPath: "/repos/main",
          },
        ]}
        onOpenOrActivate={onOpenOrActivate}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onOpenParent={vi.fn()}
        onLock={vi.fn()}
        onUnlock={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("/repos/missing-worktree"));
    expect(onOpenOrActivate).not.toHaveBeenCalled();
    expect(screen.getByText("Prunable")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "missing-worktree actions" }),
    );
    expect(await screen.findByText("Open parent repo")).toBeInTheDocument();
    expect(screen.queryByText("Open worktree")).toBeNull();
    expect(screen.queryByText("Lock worktree")).toBeNull();
    expect(screen.queryByText("Unlock worktree")).toBeNull();
    expect(screen.queryByText("Remove worktree")).toBeNull();
  });
});
