import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./safeUrl";

describe("isHttpUrl", () => {
  it("returns true for a valid https URL", () => {
    expect(isHttpUrl("https://github.com/login/device")).toBe(true);
  });

  it("returns true for a valid http URL", () => {
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("returns false for a file:// URL", () => {
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("returns false for a javascript: URL", () => {
    expect(isHttpUrl("javascript:alert('xss')")).toBe(false);
  });

  it("returns false for a malformed/unparseable string", () => {
    expect(isHttpUrl("not a valid url at all")).toBe(false);
  });
});
