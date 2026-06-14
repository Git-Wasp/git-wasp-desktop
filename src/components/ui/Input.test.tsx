import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { Input } from "./Input";

describe("Input", () => {
  it("forwards value, placeholder and onChange", () => {
    const onChange = vi.fn();
    render(<Input value="hi" placeholder="branch name" onChange={onChange} />);
    const input = screen.getByPlaceholderText("branch name");
    expect(input).toHaveValue("hi");
    fireEvent.change(input, { target: { value: "feat" } });
    expect(onChange).toHaveBeenCalled();
  });
});
