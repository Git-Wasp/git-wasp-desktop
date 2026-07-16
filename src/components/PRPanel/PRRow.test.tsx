import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PRRow } from "./PRRow";
import { useToastStore } from "../../stores/toastStore";
import type { PullRequest } from "../../types/github";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const mockOpenUrl = vi.mocked(openUrl);

const basePr: PullRequest = {
  number: 42,
  title: "Add feature",
  author: "mike",
  headRef: "feat/x",
  baseRef: "main",
  url: "https://github.com/mike/gitclient/pull/42",
  ciStatus: "success",
  approvalCount: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOpenUrl.mockResolvedValue(undefined);
});

describe("PRRow", () => {
  it("renders the PR number, title, and author", () => {
    render(<PRRow pr={basePr} />);

    expect(screen.getByText("Add feature")).toBeTruthy();
    expect(screen.getByText(/#42/)).toBeTruthy();
    expect(screen.getByText(/mike/)).toBeTruthy();
  });

  it("shows the approval count", () => {
    render(<PRRow pr={basePr} />);
    expect(screen.getByTitle("Approvals")).toHaveTextContent("✓ 2");
  });

  it.each([
    ["success", /success/i],
    ["failure", /failure/i],
    ["pending", /pending/i],
    ["none", /no checks|none/i],
  ] as const)("renders a CI badge for %s status", (ciStatus, matcher) => {
    render(<PRRow pr={{ ...basePr, ciStatus }} />);
    expect(screen.getByText(matcher)).toBeTruthy();
  });

  it("opens the PR url in the browser when Open is clicked", async () => {
    render(<PRRow pr={basePr} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith(basePr.url));
  });

  it("shows a toast instead of throwing when opening the PR fails", async () => {
    mockOpenUrl.mockRejectedValue(new Error("no browser"));
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<PRRow pr={basePr} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: no browser", { title: "Couldn't open pull request" }),
    );
  });
});
