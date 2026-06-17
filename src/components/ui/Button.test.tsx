import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a button with its children and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards aria-label, title and type", () => {
    render(
      <Button aria-label="save the file" title="tip" type="submit">
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "save the file" });
    expect(btn).toHaveAttribute("title", "tip");
    expect(btn).toHaveAttribute("type", "submit");
  });

  it("is disabled and shows a busy state while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Push
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a spinner alongside its label while loading", () => {
    const { container } = render(<Button loading>Push</Button>);
    expect(container.querySelector("[data-spinner]")).toBeInTheDocument();
    // The label stays visible next to the spinner.
    expect(screen.getByRole("button", { name: "Push" })).toBeInTheDocument();
  });

  it("applies the danger variant colour", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button").style.color).toContain("--color-danger");
  });
});
