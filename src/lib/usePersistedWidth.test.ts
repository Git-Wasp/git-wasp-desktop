import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePersistedWidth } from "./usePersistedWidth";

beforeEach(() => {
  localStorage.clear();
});

describe("usePersistedWidth", () => {
  it("uses the initial width when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedWidth("k", 220, 160, 400));
    expect(result.current[0]).toBe(220);
  });

  it("restores and clamps a stored width", () => {
    localStorage.setItem("k", "9999");
    const { result } = renderHook(() => usePersistedWidth("k", 220, 160, 400));
    expect(result.current[0]).toBe(400); // clamped to max
  });

  it("clamps and persists updates", () => {
    const { result } = renderHook(() => usePersistedWidth("k", 220, 160, 400));

    act(() => result.current[1](300));
    expect(result.current[0]).toBe(300);
    expect(localStorage.getItem("k")).toBe("300");

    act(() => result.current[1]((w) => w + 1000)); // over max
    expect(result.current[0]).toBe(400);

    act(() => result.current[1]((w) => w - 1000)); // under min
    expect(result.current[0]).toBe(160);
  });
});
