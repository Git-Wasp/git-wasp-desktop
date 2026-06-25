import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { Dropdown, DropdownItem } from "./Dropdown";

function Example({ onOpenChange }: { onOpenChange?: (o: boolean) => void } = {}) {
  return (
    <Dropdown ariaLabel="Picker" trigger={<span>Trigger</span>} onOpenChange={onOpenChange}>
      {(close) => (
        <DropdownItem onSelect={close}>Item one</DropdownItem>
      )}
    </Dropdown>
  );
}

describe("Dropdown", () => {
  it("is closed initially and opens on trigger click", () => {
    render(<Example />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Picker" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Item one")).toBeInTheDocument();
  });

  it("closes when an item calls close()", () => {
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Picker" }));
    fireEvent.click(screen.getByText("Item one"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on outside click and Escape", () => {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Picker" });

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("notifies onOpenChange when toggled", () => {
    const onOpenChange = vi.fn();
    render(<Example onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Picker" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reflects open state via aria-expanded", () => {
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Picker" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
