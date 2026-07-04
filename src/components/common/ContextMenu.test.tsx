import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  it("renders the given action items", () => {
    render(
      <ContextMenu
        x={10}
        y={20}
        items={[
          { label: "Copy hash", onSelect: vi.fn() },
          { separator: true },
          { label: "Delete branch", onSelect: vi.fn(), danger: true },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Copy hash")).toBeTruthy();
    expect(screen.getByText("Delete branch")).toBeTruthy();
  });

  it("calls onSelect and onClose when an item is clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ label: "Copy hash", onSelect }]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("Copy hash"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking outside the menu", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ label: "Copy hash", onSelect: vi.fn() }]}
        onClose={onClose}
      />,
    );

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ label: "Copy hash", onSelect: vi.fn() }]}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("styles a danger item with the danger token", () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ label: "Delete branch", onSelect: vi.fn(), danger: true }]}
        onClose={vi.fn()}
      />,
    );

    const item = screen.getByText("Delete branch");
    expect(item.style.color).toBe("var(--color-danger)");
  });

  it("is positioned at the given coordinates", () => {
    render(
      <ContextMenu
        x={42}
        y={84}
        items={[{ label: "Copy hash", onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("42px");
    expect(menu.style.top).toBe("84px");
  });

  it("right-aligns its right edge at x when align='right'", () => {
    render(
      <ContextMenu
        x={200}
        y={50}
        align="right"
        items={[{ label: "Copy hash", onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("200px");
    expect(menu.style.transform).toBe("translateX(-100%)");
  });
});
