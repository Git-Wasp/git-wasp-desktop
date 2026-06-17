import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { TabBar } from "./TabBar";
import { useRepoStore } from "../../stores/repoStore";

const repoA = { name: "alpha", path: "/repos/alpha", headBranch: "main" };
const repoB = { name: "beta", path: "/repos/beta", headBranch: "dev" };

let activateRepo: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let closeRepo: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();
  activateRepo = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
  closeRepo = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
  useRepoStore.setState({
    openRepos: [repoA, repoB],
    activeRepoPath: repoB.path,
    activateRepo,
    closeRepo,
  });
});

describe("TabBar", () => {
  it("renders a tab per open repo and marks the active one", () => {
    render(<TabBar />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    const betaTab = screen.getByRole("tab", { name: /beta/ });
    expect(betaTab).toHaveAttribute("aria-selected", "true");
  });

  it("activates a repo when its tab is clicked", () => {
    render(<TabBar />);

    fireEvent.click(screen.getByText("alpha"));

    expect(activateRepo).toHaveBeenCalledWith(repoA.path);
  });

  it("closes a repo via the ✕ without activating it", () => {
    render(<TabBar />);

    fireEvent.click(screen.getByRole("button", { name: "Close alpha" }));

    expect(closeRepo).toHaveBeenCalledWith(repoA.path);
    expect(activateRepo).not.toHaveBeenCalled();
  });

  it("renders nothing when no repositories are open", () => {
    useRepoStore.setState({ openRepos: [] });
    const { container } = render(<TabBar />);

    expect(container).toBeEmptyDOMElement();
  });
});
