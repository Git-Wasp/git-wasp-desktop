import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { GraphColorSettings } from "./GraphColorSettings";
import { getPalette } from "../../lib/graphPalettes";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("GraphColorSettings", () => {
  it("defaults to the theme palette", () => {
    render(<GraphColorSettings />);
    expect((screen.getByLabelText("Graph palette") as HTMLSelectElement).value).toBe("theme");
  });

  it("applies and persists a chosen palette", () => {
    render(<GraphColorSettings />);

    fireEvent.change(screen.getByLabelText("Graph palette"), { target: { value: "bright" } });

    const bright = getPalette("bright").colors!;
    expect(document.documentElement.style.getPropertyValue("--color-lane-0")).toBe(bright[0]);
    expect(localStorage.getItem("graphPalette")).toBe("bright");
  });

  it("restores the persisted palette on mount", () => {
    localStorage.setItem("graphPalette", "pastel");
    render(<GraphColorSettings />);
    expect((screen.getByLabelText("Graph palette") as HTMLSelectElement).value).toBe("pastel");
  });
});
