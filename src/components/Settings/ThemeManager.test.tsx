import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ThemeManager } from "./ThemeManager";
import { useThemeStore, BUILT_IN_THEMES, type ThemeInfo } from "../../stores/themeStore";

const solar: ThemeInfo = {
  id: "solar",
  name: "Solar",
  author: "Jane",
  version: "1.0.0",
  appearance: "dark",
  css: ":root {}",
  builtin: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
  useThemeStore.setState({
    themes: [...BUILT_IN_THEMES, solar],
    activeThemeId: "dark",
    loadThemes: vi.fn().mockResolvedValue(undefined),
    setActiveTheme: vi.fn().mockResolvedValue(undefined),
    importTheme: vi.fn().mockResolvedValue(undefined),
    deleteTheme: vi.fn().mockResolvedValue(undefined),
    previewTheme: vi.fn(),
    clearPreview: vi.fn(),
  });
});

describe("ThemeManager", () => {
  it("lists built-in and custom themes", () => {
    render(<ThemeManager />);
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Solar")).toBeInTheDocument();
  });

  it("activates a theme on click", async () => {
    render(<ThemeManager />);
    fireEvent.click(screen.getByRole("button", { name: /activate light/i }));
    await waitFor(() => {
      expect(useThemeStore.getState().setActiveTheme).toHaveBeenCalledWith("light");
    });
  });

  it("imports a theme via the Import button", async () => {
    render(<ThemeManager />);
    fireEvent.click(screen.getByRole("button", { name: /import theme/i }));
    await waitFor(() => {
      expect(useThemeStore.getState().importTheme).toHaveBeenCalled();
    });
  });

  it("deletes a custom theme after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ThemeManager />);
    fireEvent.click(screen.getByRole("button", { name: /delete solar/i }));
    await waitFor(() => {
      expect(useThemeStore.getState().deleteTheme).toHaveBeenCalledWith("solar");
    });
  });

  it("does not offer delete for built-in themes", () => {
    render(<ThemeManager />);
    expect(screen.queryByRole("button", { name: /delete dark/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete light/i })).toBeNull();
  });

  it("previews a theme on hover and clears on leave", () => {
    render(<ThemeManager />);
    const row = screen.getByText("Light").closest("[data-theme-row]") as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(useThemeStore.getState().previewTheme).toHaveBeenCalledWith("light");
    fireEvent.mouseLeave(row);
    expect(useThemeStore.getState().clearPreview).toHaveBeenCalled();
  });
});
