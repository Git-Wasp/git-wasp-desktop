import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { FontSettings } from "./FontSettings";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("FontSettings", () => {
  it("renders the UI font, code font, and UI size controls", () => {
    render(<FontSettings />);
    expect(screen.getByLabelText("UI font")).toBeInTheDocument();
    expect(screen.getByLabelText("Code font")).toBeInTheDocument();
    expect(screen.getByLabelText("UI size")).toBeInTheDocument();
  });

  it("applies and persists a code-font change immediately", () => {
    render(<FontSettings />);

    fireEvent.change(screen.getByLabelText("Code font"), { target: { value: "menlo" } });

    expect(document.documentElement.style.getPropertyValue("--font-family-mono")).toContain("Menlo");
    expect(JSON.parse(localStorage.getItem("fontPrefs")!).monoFontId).toBe("menlo");
  });

  it("applies and persists a UI size change", () => {
    render(<FontSettings />);

    fireEvent.change(screen.getByLabelText("UI size"), { target: { value: "large" } });

    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.12");
    expect(JSON.parse(localStorage.getItem("fontPrefs")!).sizeId).toBe("large");
  });

  it("restores the persisted selection on mount", () => {
    localStorage.setItem(
      "fontPrefs",
      JSON.stringify({ uiFontId: "georgia", monoFontId: "consolas", sizeId: "small" }),
    );
    render(<FontSettings />);
    expect((screen.getByLabelText("UI font") as HTMLSelectElement).value).toBe("georgia");
    expect((screen.getByLabelText("Code font") as HTMLSelectElement).value).toBe("consolas");
    expect((screen.getByLabelText("UI size") as HTMLSelectElement).value).toBe("small");
  });
});
