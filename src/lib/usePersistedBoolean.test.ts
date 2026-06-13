import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePersistedBoolean } from "./usePersistedBoolean";

beforeEach(() => {
  localStorage.clear();
});

describe("usePersistedBoolean", () => {
  it("uses the initial value when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedBoolean("k", false));
    expect(result.current[0]).toBe(false);
  });

  it("restores a stored value", () => {
    localStorage.setItem("k", "true");
    const { result } = renderHook(() => usePersistedBoolean("k", false));
    expect(result.current[0]).toBe(true);
  });

  it("persists updates", () => {
    const { result } = renderHook(() => usePersistedBoolean("k", false));
    act(() => result.current[1]((v) => !v));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("k")).toBe("true");
  });
});
