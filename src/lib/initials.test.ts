import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("takes the first and last word initials", () => {
    expect(initials("Priya Natarajan")).toBe("PN");
    expect(initials("Owen Marsh")).toBe("OM");
  });

  it("uses the outer words for a three-part name", () => {
    expect(initials("Ada King Lovelace")).toBe("AL");
  });

  it("returns a single letter for a one-word name", () => {
    expect(initials("madonna")).toBe("M");
  });

  it("collapses extra whitespace", () => {
    expect(initials("  Grace   Hopper  ")).toBe("GH");
  });

  it("falls back to ? for an empty name", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});
