import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { NonTextConflictPicker } from "./NonTextConflictPicker";
import type { ConflictedFile, ConflictKind } from "../../types/merge";

function fileOfKind(kind: ConflictKind): ConflictedFile {
  return {
    path: "assets/logo.png",
    kind,
    oursContent: null,
    theirsContent: null,
    baseContent: null,
    seededResult: null,
    conflictBlocks: [],
  };
}

describe("NonTextConflictPicker", () => {
  it("renders the conflicted file's path", () => {
    render(
      <NonTextConflictPicker file={fileOfKind("addAdd")} onResolveWithSide={vi.fn()} onResolveWithDeletion={vi.fn()} />,
    );

    expect(screen.getByText("assets/logo.png")).toBeInTheDocument();
  });

  it("offers to keep either side for an add/add conflict", () => {
    const onResolveWithSide = vi.fn();
    render(
      <NonTextConflictPicker
        file={fileOfKind("addAdd")}
        onResolveWithSide={onResolveWithSide}
        onResolveWithDeletion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep current version" }));
    expect(onResolveWithSide).toHaveBeenCalledWith("assets/logo.png", "ours");

    fireEvent.click(screen.getByRole("button", { name: "Keep source version" }));
    expect(onResolveWithSide).toHaveBeenCalledWith("assets/logo.png", "theirs");
  });

  it("offers to keep either side for a binary conflict", () => {
    const onResolveWithSide = vi.fn();
    render(
      <NonTextConflictPicker
        file={fileOfKind("binaryOrUnmergeable")}
        onResolveWithSide={onResolveWithSide}
        onResolveWithDeletion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep current version" }));
    expect(onResolveWithSide).toHaveBeenCalledWith("assets/logo.png", "ours");

    fireEvent.click(screen.getByRole("button", { name: "Keep source version" }));
    expect(onResolveWithSide).toHaveBeenCalledWith("assets/logo.png", "theirs");
  });

  it("offers to keep the deletion or the source's version for a delete/modify conflict", () => {
    const onResolveWithSide = vi.fn();
    const onResolveWithDeletion = vi.fn();
    render(
      <NonTextConflictPicker
        file={fileOfKind("deleteModify")}
        onResolveWithSide={onResolveWithSide}
        onResolveWithDeletion={onResolveWithDeletion}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep deletion" }));
    expect(onResolveWithDeletion).toHaveBeenCalledWith("assets/logo.png");

    fireEvent.click(screen.getByRole("button", { name: "Keep source's version" }));
    expect(onResolveWithSide).toHaveBeenCalledWith("assets/logo.png", "theirs");
  });

  it("offers to keep the current version or the deletion for a modify/delete conflict", () => {
    const onResolveWithSide = vi.fn();
    const onResolveWithDeletion = vi.fn();
    render(
      <NonTextConflictPicker
        file={fileOfKind("modifyDelete")}
        onResolveWithSide={onResolveWithSide}
        onResolveWithDeletion={onResolveWithDeletion}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep current's version" }));
    expect(onResolveWithSide).toHaveBeenCalledWith("assets/logo.png", "ours");

    fireEvent.click(screen.getByRole("button", { name: "Keep deletion" }));
    expect(onResolveWithDeletion).toHaveBeenCalledWith("assets/logo.png");
  });
});
