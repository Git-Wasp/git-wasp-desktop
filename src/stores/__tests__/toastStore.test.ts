import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "../toastStore";

beforeEach(() => {
  localStorage.clear();
  useToastStore.getState().clear();
  useToastStore.setState({ placement: { vertical: "bottom", horizontal: "right" } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toastStore", () => {
  it("show adds a toast and returns its id", () => {
    const id = useToastStore.getState().show({ message: "Hello" });
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id, message: "Hello", variant: "info" });
  });

  it("convenience helpers set the variant", () => {
    useToastStore.getState().success("ok");
    useToastStore.getState().warning("careful");
    const variants = useToastStore.getState().toasts.map((t) => t.variant);
    expect(variants).toEqual(["success", "warning"]);
  });

  it("dismiss removes the matching toast", () => {
    const a = useToastStore.getState().show({ message: "a" });
    const b = useToastStore.getState().show({ message: "b" });
    useToastStore.getState().dismiss(a);
    const ids = useToastStore.getState().toasts.map((t) => t.id);
    expect(ids).toEqual([b]);
  });

  it("auto-dismisses after the duration elapses", () => {
    vi.useFakeTimers();
    useToastStore.getState().show({ message: "bye", duration: 1000 });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("errors are sticky (no auto-dismiss) by default", () => {
    vi.useFakeTimers();
    useToastStore.getState().error("boom");
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]!.duration).toBeNull();
  });

  it("setPlacement updates state and persists to localStorage", () => {
    useToastStore.getState().setPlacement({ vertical: "top", horizontal: "left" });
    expect(useToastStore.getState().placement).toEqual({ vertical: "top", horizontal: "left" });
    expect(JSON.parse(localStorage.getItem("toastPlacement")!)).toEqual({
      vertical: "top",
      horizontal: "left",
    });
  });

  it("clear removes all toasts", () => {
    useToastStore.getState().show({ message: "a" });
    useToastStore.getState().show({ message: "b" });
    useToastStore.getState().clear();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
