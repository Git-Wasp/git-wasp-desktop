import { describe, expect, it } from "vitest";
import { compareUrl, headBranchIsOnRemote, type BranchRef } from "./githubPr";

describe("headBranchIsOnRemote", () => {
  const ref = (over: Partial<BranchRef>): BranchRef => ({
    name: "x",
    isRemote: false,
    upstream: null,
    ...over,
  });

  it("is true when the local branch has a configured upstream", () => {
    const branches = [ref({ name: "feat/x", upstream: "origin/feat/x" })];
    expect(headBranchIsOnRemote("feat/x", branches)).toBe(true);
  });

  it("is true when a remote-tracking branch of the same short name exists", () => {
    const branches = [
      ref({ name: "feat/x" }),
      ref({ name: "origin/feat/x", isRemote: true }),
    ];
    expect(headBranchIsOnRemote("feat/x", branches)).toBe(true);
  });

  it("is false for a purely local branch with no upstream or remote ref", () => {
    const branches = [
      ref({ name: "feat/x" }),
      ref({ name: "origin/main", isRemote: true }),
    ];
    expect(headBranchIsOnRemote("feat/x", branches)).toBe(false);
  });

  it("is false for an empty head", () => {
    expect(headBranchIsOnRemote("", [])).toBe(false);
  });
});

describe("compareUrl", () => {
  it("builds a github.com compare URL with expand and the draft fields", () => {
    const url = compareUrl({
      host: "github.com",
      owner: "mike",
      repo: "gitclient",
      base: "main",
      head: "feat/x",
      title: "Add feature",
      body: "details",
    });
    expect(url).toContain("https://github.com/mike/gitclient/compare/main...feat%2Fx?");
    expect(url).toContain("expand=1");
    expect(url).toContain("title=Add+feature");
    expect(url).toContain("body=details");
  });

  it("omits title/body when blank and supports GHE hosts", () => {
    const url = compareUrl({
      host: "ghe.example.com",
      owner: "org",
      repo: "app",
      base: "main",
      head: "fix",
    });
    expect(url).toBe("https://ghe.example.com/org/app/compare/main...fix?expand=1");
  });

  it("carries assignees and labels as comma-joined query params", () => {
    const url = compareUrl({
      host: "github.com",
      owner: "mike",
      repo: "gitclient",
      base: "main",
      head: "feat/x",
      assignees: ["mike", "ann"],
      labels: ["bug", "ux"],
    });
    expect(url).toContain("assignees=mike%2Cann");
    expect(url).toContain("labels=bug%2Cux");
  });
});
