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

function getResultPaneText(container: HTMLElement): string {
  const pane = container.querySelector('[data-testid="result-pane"]');
  if (!pane) throw new Error("result pane not found");
  return pane.textContent ?? "";
}

describe("StageFileEditor", () => {
  it("renders HEAD, working tree, and staged result panes", async () => {
    render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    expect(screen.getByText("HEAD")).toBeInTheDocument();
    expect(screen.getByText("Working Tree")).toBeInTheDocument();
    expect(screen.getByText("Staged result")).toBeInTheDocument();
  });

  it("seeds the staged result with the working-tree content (everything staged)", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    await waitFor(() => {
      expect(getResultPaneText(container)).toContain("b");
    });
  });

  it("shows '−' toggles on changed lines (working-tree pane + result pane)", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    await waitFor(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle");
      // The single added line carries a toggle in the working-tree pane and in
      // the staged-result pane.
      expect(buttons.length).toBe(2);
      expect([...buttons].every((b) => b.textContent === "−")).toBe(true);
    });
  });

  it("reverts the staged result to HEAD when the only change is unstaged", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    const toggle = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(".cm-stage-toggle");
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      // With the insertion unstaged the result equals HEAD: no "b" line, and the
      // line drops out of the result pane so only the working-tree toggle (now
      // "+") remains.
      const text = getResultPaneText(container);
      expect(text).toContain("a");
      expect(text).toContain("c");
      expect(text).not.toContain("b");
      const buttons = container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle");
      expect(buttons.length).toBe(1);
      expect(buttons[0].textContent).toBe("+");
    });
  });

  it("highlights staged additions in the result pane", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    await waitFor(() => {
      const resultPane = container.querySelector('[data-testid="result-pane"]');
      expect(resultPane?.querySelector(".cm-diff-add-line")).not.toBeNull();
    });
  });

  it("renders the change overview ruler", () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);
    const overview = container.querySelector('[data-testid="change-overview"]');
    expect(overview).not.toBeNull();
    // One marker for the single added row.
    expect(overview!.children.length).toBe(1);
  });

  it("invokes onStage with the path and the current staged result content", async () => {
    const onStage = vi.fn();
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={onStage} />);

    await waitFor(() => expect(container.querySelector(".cm-stage-toggle")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    expect(onStage).toHaveBeenCalledTimes(1);
    const [path, content] = onStage.mock.calls[0];
    expect(path).toBe("f.txt");
    expect(content).toBe("a\nb\nc\n");
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
    fireEvent.click(screen.getByRole("button", { name: "Stage whole file" }));
    expect(onStageWholeFile).toHaveBeenCalledWith("logo.png");
  });
});
