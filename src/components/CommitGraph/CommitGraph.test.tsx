import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { CommitGraph } from "./CommitGraph";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import type { GraphViewport } from "../../types/graph";

const makeViewport = (): GraphViewport => ({
  totalCount: 2,
  offset: 0,
  nodes: [
    {
      oid: "a".repeat(40),
      shortOid: "aaaaaaa",
      summary: "first",
      authorName: "A",
      authorEmail: "a@a",
      authorTimestamp: 0,
      lane: 0,
      row: 0,
      colorIndex: 0,
      parents: [],
      children: [],
      edges: [],
      branchLabels: [{ name: "main", isRemote: false, isTag: false }],
      isHead: true,
    },
    {
      oid: "b".repeat(40),
      shortOid: "bbbbbbb",
      summary: "second",
      authorName: "A",
      authorEmail: "a@a",
      authorTimestamp: 0,
      lane: 0,
      row: 1,
      colorIndex: 0,
      parents: ["a".repeat(40)],
      children: [],
      edges: [],
      branchLabels: [],
      isHead: false,
    },
  ],
});

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no canvas backend; the graph hook early-returns on a null context.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  useGraphStore.setState({
    viewport: makeViewport(),
    selection: { anchor: null, focus: null, range: new Set() },
    selectedOid: null,
    lastOffset: 0,
    lastLimit: 40,
    fetchViewport: vi.fn(),
    refresh: vi.fn(),
  });
  useRepoStore.setState({
    createBranch: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    renameBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
  });
});

function openMenuOnRow(clientY: number) {
  const canvas = document.querySelector("canvas")!;
  fireEvent.contextMenu(canvas, { clientY });
}

describe("CommitGraph context menu", () => {
  it("opens a context menu with the expected actions on right-click", () => {
    render(<CommitGraph />);
    openMenuOnRow(5); // row 0 — the commit carrying branch "main"

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Copy commit hash")).toBeTruthy();
    expect(screen.getByText(/New branch here/)).toBeTruthy();
    expect(screen.getByText("Checkout main")).toBeTruthy();
    expect(screen.getByText(/Rename main/)).toBeTruthy();
    expect(screen.getByText("Delete main")).toBeTruthy();
  });

  it("copies the full commit hash to the clipboard", () => {
    render(<CommitGraph />);
    openMenuOnRow(5);

    fireEvent.click(screen.getByText("Copy commit hash"));

    expect(writeText).toHaveBeenCalledWith("a".repeat(40));
  });

  it("creates and checks out a new branch at the commit", async () => {
    render(<CommitGraph />);
    openMenuOnRow(5);

    fireEvent.click(screen.getByText(/New branch here/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "feature/x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(useRepoStore.getState().createBranch).toHaveBeenCalledWith("feature/x", "a".repeat(40));
    });
    expect(useRepoStore.getState().checkoutBranch).toHaveBeenCalledWith("feature/x");
    await waitFor(() => {
      expect(useGraphStore.getState().refresh).toHaveBeenCalled();
    });
  });

  it("renames a branch via the prompt", async () => {
    render(<CommitGraph />);
    openMenuOnRow(5);

    fireEvent.click(screen.getByText(/Rename main/));
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("main");
    fireEvent.change(input, { target: { value: "trunk" } });
    fireEvent.click(screen.getByRole("button", { name: /^rename$/i }));

    await waitFor(() => {
      expect(useRepoStore.getState().renameBranch).toHaveBeenCalledWith("main", "trunk");
    });
    await waitFor(() => {
      expect(useGraphStore.getState().refresh).toHaveBeenCalled();
    });
  });

  it("checks out an existing branch from the menu", async () => {
    render(<CommitGraph />);
    openMenuOnRow(5);

    fireEvent.click(screen.getByText("Checkout main"));

    await waitFor(() => {
      expect(useRepoStore.getState().checkoutBranch).toHaveBeenCalledWith("main");
    });
  });

  it("deletes a branch after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CommitGraph />);
    openMenuOnRow(5);

    fireEvent.click(screen.getByText("Delete main"));

    await waitFor(() => {
      expect(useRepoStore.getState().deleteBranch).toHaveBeenCalledWith("main");
    });
  });

  it("does not show branch actions for a commit without local branches", () => {
    render(<CommitGraph />);
    openMenuOnRow(33); // row 1 — no branch labels

    expect(screen.getByText("Copy commit hash")).toBeTruthy();
    expect(screen.queryByText(/Rename/)).toBeNull();
    expect(screen.queryByText(/^Checkout /)).toBeNull();
  });
});
