import { describe, expect, it } from "vitest";
import { compareUrl } from "./githubPr";

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
