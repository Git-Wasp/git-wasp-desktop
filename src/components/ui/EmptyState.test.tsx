import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message="No open pull requests." />);
    expect(screen.getByText("No open pull requests.")).toBeInTheDocument();
  });

  it("renders an optional action", () => {
    render(<EmptyState message="Nothing here" action={<button>Open</button>} />);
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
});
