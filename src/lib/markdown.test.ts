import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("escapes HTML before applying markdown (no XSS)", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders bold and italic", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("_italic_")).toContain("<em>italic</em>");
  });

  it("renders inline code", () => {
    expect(renderMarkdown("use `git add`")).toContain("<code>git add</code>");
  });

  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
    expect(renderMarkdown("## Sub")).toContain("<h2>Sub</h2>");
  });

  it("renders an unordered list", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders links with safe attributes", () => {
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("ignores javascript: link schemes", () => {
    const html = renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("renders paragraphs separated by blank lines", () => {
    const html = renderMarkdown("first\n\nsecond");
    expect(html).toContain("<p>first</p>");
    expect(html).toContain("<p>second</p>");
  });

  it("returns an empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   ")).toBe("");
  });

  it("a literal 'MD0MD' in the source is not corrupted by the stash mechanism", () => {
    const html = renderMarkdown("see MD0MD in the logs");
    expect(html).toContain("MD0MD");
  });

  it("does not italicise an underscore inside a snake_case identifier", () => {
    const html = renderMarkdown("call foo_bar_baz()");
    expect(html).toContain("foo_bar_baz");
    expect(html).not.toContain("<em>");
  });
});
