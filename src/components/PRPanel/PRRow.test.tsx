import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { PRRow } from "./PRRow";
import type { PullRequest } from "../../types/github";

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
});
