import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ConflictFileEditor } from "./ConflictFileEditor";
import type { ConflictedFile } from "../../types/merge";

const seededResult = [
  "shared line",
  "<<<<<<< HEAD",
  "current text",
  "=======",
  "source text",
  ">>>>>>> feature",
  "trailing line",
].join("\n");

const file: ConflictedFile = {
  path: "src/lib.rs",
  kind: "normalEdit",
  oursContent: "shared line\ncurrent text\ntrailing line",
  theirsContent: "shared line\nsource text\ntrailing line",
  baseContent: "shared line\nbase text\ntrailing line",
  seededResult,
  conflictBlocks: [
    { startLine: 2, midLine: 4, endLine: 6, oursText: "current text\n", theirsText: "source text\n" },
  ],
};

function getResultPaneText(container: HTMLElement): string {
  const resultPane = container.querySelector('[data-testid="result-pane"]');
  if (!resultPane) throw new Error("result pane not found");
  return resultPane.textContent ?? "";
}

describe("ConflictFileEditor", () => {
  it("renders the source, current, and result panes seeded with the right content", async () => {
    const { container } = render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();

    await waitFor(() => {
      expect(container.textContent).toContain("source text");
      expect(container.textContent).toContain("current text");
      expect(getResultPaneText(container)).toContain("<<<<<<< HEAD");
    });
  });

  it("renders Accept source / Accept current actions for each conflict block", async () => {
    render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Accept source" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Accept current" })).toBeInTheDocument();
    });
  });

  it("replaces the conflict markers with the current side's text when Accept current is clicked", async () => {
    const { container } = render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept current" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Accept current" }));

    await waitFor(() => {
      const resultText = getResultPaneText(container);
      expect(resultText).not.toContain("<<<<<<< HEAD");
      expect(resultText).toContain("current text");
      expect(resultText).not.toContain("source text");
    });
  });

  it("replaces the conflict markers with the source side's text when Accept source is clicked", async () => {
    const { container } = render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept source" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Accept source" }));

    await waitFor(() => {
      const resultText = getResultPaneText(container);
      expect(resultText).not.toContain("<<<<<<< HEAD");
      expect(resultText).toContain("source text");
      expect(resultText).not.toContain("current text");
    });
  });

  it("decorates the changed characters on the source and current sides", async () => {
    const { container } = render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector(".cm-diff-add")).toBeInTheDocument(); // source side
      expect(container.querySelector(".cm-diff-del")).toBeInTheDocument(); // current side
    });
  });

  it("renders per-line selection checkboxes on the conflict lines", async () => {
    const { container } = render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    await waitFor(() => {
      const boxes = container.querySelectorAll(".cm-select-checkbox");
      // one source line + one current line for this single-line conflict
      expect(boxes.length).toBe(2);
    });
  });

  it("composes the result from an individually selected source line", async () => {
    const { container } = render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    const sourceBox = await waitFor(() => {
      const boxes = container.querySelectorAll<HTMLInputElement>(".cm-select-checkbox");
      expect(boxes.length).toBe(2);
      return boxes[0]; // Source pane renders first
    });

    fireEvent.click(sourceBox);

    await waitFor(() => {
      const resultText = getResultPaneText(container);
      expect(resultText).not.toContain("<<<<<<< HEAD");
      expect(resultText).toContain("source text");
      expect(resultText).not.toContain("current text");
    });
  });

  it("calls onMarkResolved with the file path and the current result content", async () => {
    const onMarkResolved = vi.fn();
    render(<ConflictFileEditor file={file} onMarkResolved={onMarkResolved} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept current" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Accept current" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));

    await waitFor(() => {
      expect(onMarkResolved).toHaveBeenCalledTimes(1);
      const [path, content] = onMarkResolved.mock.calls[0];
      expect(path).toBe("src/lib.rs");
      expect(content).toBe(["shared line", "current text", "trailing line"].join("\n"));
    });
  });
});
