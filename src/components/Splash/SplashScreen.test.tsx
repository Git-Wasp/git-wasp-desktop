import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { SplashScreen } from "./SplashScreen";

describe("SplashScreen", () => {
  it("shows the current boot task and a spinner", () => {
    const { container } = render(<SplashScreen task="Loading history…" />);
    expect(screen.getByTestId("splash-task")).toHaveTextContent("Loading history…");
    expect(container.querySelector("[data-spinner]")).not.toBeNull();
  });

  it("shows the Git Wasp brand mark and wordmark", () => {
    render(<SplashScreen task="Starting…" />);
    expect(screen.getByText("Git Wasp")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Git Wasp" })).toBeInTheDocument();
  });

  it("is an accessible live status region", () => {
    render(<SplashScreen task="Starting…" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
