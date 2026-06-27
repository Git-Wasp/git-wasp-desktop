import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { MultiSelect } from "./MultiSelect";

const options = [{ value: "alice" }, { value: "bob" }, { value: "carol" }];

describe("MultiSelect", () => {
  it("summarises the current selection on the trigger", () => {
    render(
      <MultiSelect ariaLabel="people" options={options} selected={["alice", "bob"]} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "people" })).toHaveTextContent("alice, bob");
  });

  it("shows the placeholder when nothing is selected", () => {
    render(
      <MultiSelect
        ariaLabel="people"
        options={options}
        selected={[]}
        onChange={vi.fn()}
        placeholder="Pick someone"
      />,
    );
    expect(screen.getByRole("button", { name: "people" })).toHaveTextContent("Pick someone");
  });

  it("toggles an option on, then off, without closing", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MultiSelect ariaLabel="people" options={options} selected={[]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "people" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "bob" }));
    expect(onChange).toHaveBeenLastCalledWith(["bob"]);

    rerender(
      <MultiSelect ariaLabel="people" options={options} selected={["bob"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "bob" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("is disabled and cannot be opened when disabled", () => {
    render(
      <MultiSelect ariaLabel="people" options={options} selected={[]} onChange={vi.fn()} disabled />,
    );
    const trigger = screen.getByRole("button", { name: "people" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("shows the empty label when there are no options", () => {
    render(
      <MultiSelect
        ariaLabel="people"
        options={[]}
        selected={[]}
        onChange={vi.fn()}
        emptyLabel="Nobody here"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "people" }));
    expect(screen.getByText("Nobody here")).toBeInTheDocument();
  });
});
