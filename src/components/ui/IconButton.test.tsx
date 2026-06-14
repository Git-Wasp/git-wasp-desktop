import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("exposes its aria-label and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="More actions" onClick={onClick}>
        ⋯
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});
