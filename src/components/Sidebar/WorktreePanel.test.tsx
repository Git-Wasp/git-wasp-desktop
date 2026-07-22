import { render, screen } from "@testing-library/react";
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
});
