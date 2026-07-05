import { describe, expect, it } from "vitest";
import { formatRelativeDate } from "./formatDate";

// Fixed "now": 2026-07-05T12:00:00Z
const NOW = Date.UTC(2026, 6, 5, 12, 0, 0);
const sec = (ms: number) => Math.floor(ms / 1000);

describe("formatRelativeDate", () => {
  it("shows 'just now' for very recent commits", () => {
    expect(formatRelativeDate(sec(NOW - 5 * 1000), NOW)).toBe("just now");
    expect(formatRelativeDate(sec(NOW), NOW)).toBe("just now");
  });

  it("shows minutes and hours", () => {
    expect(formatRelativeDate(sec(NOW - 1 * 60_000), NOW)).toBe("1 minute ago");
    expect(formatRelativeDate(sec(NOW - 5 * 60_000), NOW)).toBe("5 minutes ago");
    expect(formatRelativeDate(sec(NOW - 2 * 3_600_000), NOW)).toBe("2 hours ago");
  });

  it("shows Yesterday and day counts under a week", () => {
    expect(formatRelativeDate(sec(NOW - 26 * 3_600_000), NOW)).toBe("Yesterday");
    expect(formatRelativeDate(sec(NOW - 3 * 86_400_000), NOW)).toBe("3 days ago");
  });

  it("falls back to an absolute date beyond a week", () => {
    const out = formatRelativeDate(sec(NOW - 40 * 86_400_000), NOW);
    expect(out).not.toMatch(/ago|Yesterday|just now/);
    expect(out).toMatch(/\d/);
  });

  it("treats future timestamps (clock skew) as 'just now'", () => {
    expect(formatRelativeDate(sec(NOW + 10_000), NOW)).toBe("just now");
  });
});
