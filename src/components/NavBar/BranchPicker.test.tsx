import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { BranchPicker } from "./BranchPicker";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import type { BranchInfo } from "../../types/repo";

const branch = (name: string, isHead = false, isRemote = false): BranchInfo => ({
  name,
  isRemote,
  isHead,
  upstream: null,
  oid: name,
});

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({
    currentRepo: { name: "gitclient", path: "/repo", headBranch: "main" },
    branches: [branch("main", true), branch("feat/x"), branch("fix/y")],
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
    checkoutRemoteBranch: vi.fn().mockResolvedValue(undefined),
  });
  useGraphStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
});

describe("BranchPicker", () => {
  it("renders nothing when no repo is open", () => {
    useRepoStore.setState({ currentRepo: null });
    const { container } = render(<BranchPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the current branch on the trigger", () => {
    render(<BranchPicker />);
    expect(screen.getByRole("button", { name: /branch picker/i })).toHaveTextContent("main");
  });

  it("lists local branches and checks out the chosen one", async () => {
    render(<BranchPicker />);
    fireEvent.click(screen.getByRole("button", { name: /branch picker/i }));

    expect(screen.getByText("feat/x")).toBeInTheDocument();
    expect(screen.getByText("fix/y")).toBeInTheDocument();

    fireEvent.click(screen.getByText("feat/x"));

    await waitFor(() =>
      expect(useRepoStore.getState().checkoutBranch).toHaveBeenCalledWith("feat/x"),
    );
    // checkoutBranch now refreshes the graph internally — BranchPicker no
    // longer needs (or issues) its own explicit refresh for a local checkout.
    expect(useGraphStore.getState().refresh).not.toHaveBeenCalled();
  });

  it("does not check out the already-current branch", () => {
    render(<BranchPicker />);
    fireEvent.click(screen.getByRole("button", { name: /branch picker/i }));
    // "main" appears both on the trigger and as the active item; click the menu item.
    const items = screen.getAllByText("main");
    // getAllByText throws if it finds nothing, so items is always non-empty.
    fireEvent.click(items[items.length - 1]!);
    expect(useRepoStore.getState().checkoutBranch).not.toHaveBeenCalled();
  });

  it("lists the current branch first", () => {
    useRepoStore.setState({
      currentRepo: { name: "gitclient", path: "/repo", headBranch: "fix/y" },
      branches: [branch("main"), branch("feat/x"), branch("fix/y", true)],
    });
    render(<BranchPicker />);
    fireEvent.click(screen.getByRole("button", { name: /branch picker/i }));

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items[0]).toBe("fix/y");
  });

  it("shows remote-only branches with a remote icon and checks them out as tracking branches", async () => {
    useRepoStore.setState({
      branches: [
        branch("main", true),
        branch("origin/main", false, true), // duplicate of local — hidden
        branch("origin/release", false, true), // remote-only — shown
      ],
    });
    render(<BranchPicker />);
    fireEvent.click(screen.getByRole("button", { name: /branch picker/i }));

    // The remote duplicate of a local branch is not listed twice.
    expect(screen.queryByText("origin/main")).toBeNull();
    // The remote-only branch is shown.
    const remote = screen.getByText("origin/release");
    fireEvent.click(remote);

    await waitFor(() =>
      expect(useRepoStore.getState().checkoutRemoteBranch).toHaveBeenCalledWith("origin/release"),
    );
    expect(useRepoStore.getState().checkoutBranch).not.toHaveBeenCalled();
    // checkoutRemoteBranch isn't one of the self-refreshing repoStore actions,
    // so BranchPicker still refreshes explicitly on this path.
    expect(useGraphStore.getState().refresh).toHaveBeenCalled();
  });

  it("hides the symbolic origin/HEAD ref", () => {
    useRepoStore.setState({
      branches: [branch("main", true), branch("origin/HEAD", false, true)],
    });
    render(<BranchPicker />);
    fireEvent.click(screen.getByRole("button", { name: /branch picker/i }));
    expect(screen.queryByText("origin/HEAD")).toBeNull();
  });

  it("filters the list once there are many branches", () => {
    const many = Array.from({ length: 10 }, (_, i) => branch(`branch-${i}`));
    useRepoStore.setState({ branches: [branch("main", true), ...many] });
    render(<BranchPicker />);
    fireEvent.click(screen.getByRole("button", { name: /branch picker/i }));

    const filter = screen.getByRole("textbox", { name: /filter branches/i });
    fireEvent.change(filter, { target: { value: "branch-3" } });

    expect(screen.getByText("branch-3")).toBeInTheDocument();
    expect(screen.queryByText("branch-4")).toBeNull();
  });
});
