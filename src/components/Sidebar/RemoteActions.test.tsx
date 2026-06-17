import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { RemoteActions } from "./RemoteActions";

describe("RemoteActions", () => {
  it("calls onOpenClone when Clone from GitHub is clicked", () => {
    const onOpenClone = vi.fn();
    render(<RemoteActions onOpenClone={onOpenClone} />);

    fireEvent.click(screen.getByRole("button", { name: /clone from github/i }));

    expect(onOpenClone).toHaveBeenCalled();
  });

  it("no longer renders fetch/pull/push buttons (those live in the toolbar)", () => {
    render(<RemoteActions onOpenClone={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /^fetch$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^pull$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^push$/i })).toBeNull();
  });
});
