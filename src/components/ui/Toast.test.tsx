import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { ToastContainer } from "./Toast";
import { useToastStore } from "../../stores/toastStore";

beforeEach(() => {
  useToastStore.getState().clear();
  useToastStore.setState({ placement: { vertical: "bottom", horizontal: "right" } });
});

describe("ToastContainer", () => {
  it("renders nothing when there are no toasts", () => {
    const { container } = render(<ToastContainer />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an active toast's message", () => {
    useToastStore.getState().success("Pushed to remote");
    render(<ToastContainer />);
    expect(screen.getByText("Pushed to remote")).toBeInTheDocument();
  });

  it("gives error toasts the alert role", () => {
    useToastStore.getState().error("Push failed");
    render(<ToastContainer />);
    expect(screen.getByRole("alert")).toHaveTextContent("Push failed");
  });

  it("dismiss button removes the toast", () => {
    useToastStore.getState().info("Heads up");
    render(<ToastContainer />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss notification/i }));
    expect(screen.queryByText("Heads up")).not.toBeInTheDocument();
  });

  it("positions the stack per the chosen placement", () => {
    useToastStore.setState({ placement: { vertical: "top", horizontal: "left" } });
    useToastStore.getState().info("hi");
    const { container } = render(<ToastContainer />);
    const stack = container.firstChild as HTMLElement;
    expect(stack.style.top).not.toBe("");
    expect(stack.style.left).not.toBe("");
    expect(stack.style.bottom).toBe("");
    expect(stack.style.right).toBe("");
  });
});
