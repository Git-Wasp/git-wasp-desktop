import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { RowMenu } from "./RowMenu";

describe("RowMenu", () => {
  it("does not show menu items until the trigger is clicked", () => {
    render(<RowMenu label="Branch actions" items={[{ label: "Checkout branch", onSelect: vi.fn() }]} />);

    expect(screen.queryByRole("menuitem", { name: "Checkout branch" })).toBeNull();
  });

  it("shows menu items after the trigger is clicked", () => {
    render(<RowMenu label="Branch actions" items={[{ label: "Checkout branch", onSelect: vi.fn() }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Branch actions" }));

    expect(screen.getByRole("menuitem", { name: "Checkout branch" })).toBeTruthy();
  });

  it("calls onSelect and closes the menu when an item is chosen", () => {
    const onSelect = vi.fn();
    render(<RowMenu label="Branch actions" items={[{ label: "Checkout branch", onSelect }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Branch actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Checkout branch" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Checkout branch" })).toBeNull();
  });

  it("closes the menu when clicking outside", () => {
    render(
      <div>
        <RowMenu label="Branch actions" items={[{ label: "Checkout branch", onSelect: vi.fn() }]} />
        <button>elsewhere</button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Branch actions" }));
    expect(screen.getByRole("menuitem", { name: "Checkout branch" })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.queryByRole("menuitem", { name: "Checkout branch" })).toBeNull();
  });

  it("renders nothing when there are no items", () => {
    const { container } = render(<RowMenu label="Branch actions" items={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("maps a destructive item to the shared menu's danger styling", () => {
    render(
      <RowMenu
        label="Branch actions"
        items={[{ label: "Delete branch", onSelect: vi.fn(), destructive: true }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Branch actions" }));
    const item = screen.getByRole("menuitem", { name: "Delete branch" });
    expect(item.style.color).toBe("var(--color-danger)");
  });
});
