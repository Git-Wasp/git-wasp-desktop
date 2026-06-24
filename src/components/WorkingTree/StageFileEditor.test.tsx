import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { StageFileEditor } from "./StageFileEditor";
import type { StageFileContents } from "../../types/workingTree";

// A pure insertion: working tree adds line "b" between "a" and "c".
const inserted: StageFileContents = {
  headContent: "a\nc\n",
  worktreeContent: "a\nb\nc\n",
  isBinary: false,
  worktreeExists: true,
};

// A pure deletion: working tree removes line "b".
const removed: StageFileContents = {
  headContent: "a\nb\nc\n",
  worktreeContent: "a\nc\n",
  isBinary: false,
  worktreeExists: true,
};

function pane(container: HTMLElement, testId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`pane ${testId} not found`);
  return el;
}

describe("StageFileEditor", () => {
  it("renders the HEAD and Working Tree panes side by side", () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    expect(screen.getByText("HEAD")).toBeInTheDocument();
    expect(screen.getByText("Working Tree")).toBeInTheDocument();
    expect(pane(container, "head-pane")).toBeInTheDocument();
    expect(pane(container, "worktree-pane")).toBeInTheDocument();
  });

  it("no longer renders the bottom staged-result pane", () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    expect(screen.queryByText("Staged result")).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="result-pane"]')).toBeNull();
  });

  it("shows a single '−' toggle (staged by default) on the inserted line", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    await waitFor(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle");
      // One change ⇒ one toggle (on the working-tree pane, where the text lives).
      expect(buttons.length).toBe(1);
      expect(buttons[0].textContent).toBe("−");
    });
  });

  it("shows an addition solid-green on the right and hatched on the HEAD side", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    await waitFor(() => {
      // The real added text reads solid green on the working-tree side.
      expect(pane(container, "worktree-pane").querySelector(".cm-diff-add-line")).not.toBeNull();
      // The added "b" has no HEAD line, so the HEAD pane shows a neutral hatch
      // gap (not a solid green fill).
      expect(pane(container, "head-pane").querySelector(".cm-diff-placeholder-line")).not.toBeNull();
      expect(pane(container, "head-pane").querySelector(".cm-diff-add-line")).toBeNull();
    });
  });

  it("shows a removal solid-red on the HEAD side and hatched on the right", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={removed} onStage={vi.fn()} />);

    await waitFor(() => {
      // The real removed text reads solid red on the HEAD side.
      expect(pane(container, "head-pane").querySelector(".cm-diff-del-line")).not.toBeNull();
      // The removed "b" has no working-tree line, so that pane shows a hatch gap.
      expect(pane(container, "worktree-pane").querySelector(".cm-diff-placeholder-line")).not.toBeNull();
      expect(pane(container, "worktree-pane").querySelector(".cm-diff-del-line")).toBeNull();
    });
  });

  it("stages the whole file by default", async () => {
    const onStage = vi.fn();
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={onStage} />);

    await waitFor(() => expect(container.querySelector(".cm-stage-toggle")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage.mock.calls[0]).toEqual(["f.txt", "a\nb\nc\n"]);
  });

  it("stages HEAD content once the only change is unstaged", async () => {
    const onStage = vi.fn();
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={onStage} />);

    const toggle = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(".cm-stage-toggle");
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>(".cm-stage-toggle")?.textContent).toBe("+");
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    expect(onStage.mock.calls[0]).toEqual(["f.txt", "a\nc\n"]);
  });

  it("resets the selection back to everything staged", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    const toggle = await waitFor(() => container.querySelector<HTMLButtonElement>(".cm-stage-toggle")!);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(container.querySelector<HTMLButtonElement>(".cm-stage-toggle")?.textContent).toBe("+"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(container.querySelector<HTMLButtonElement>(".cm-stage-toggle")?.textContent).toBe("−"),
    );
  });

  it("renders the change overview ruler", () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);
    const overview = container.querySelector('[data-testid="change-overview"]');
    expect(overview).not.toBeNull();
    // One marker for the single added row.
    expect(overview!.children.length).toBe(1);
  });

  it("falls back to whole-file staging for binary files", async () => {
    const onStageWholeFile = vi.fn();
    const binary: StageFileContents = {
      headContent: "",
      worktreeContent: "",
      isBinary: true,
      worktreeExists: true,
    };
    render(
      <StageFileEditor
        path="logo.png"
        contents={binary}
        onStage={vi.fn()}
        onStageWholeFile={onStageWholeFile}
      />,
    );

    expect(screen.getByText(/binary file/i)).toBeInTheDocument();
    // No line-level Stage/Reset for a non-line-editable file.
    expect(screen.queryByRole("button", { name: "Stage" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stage whole file" }));
    expect(onStageWholeFile).toHaveBeenCalledWith("logo.png");
  });
});
