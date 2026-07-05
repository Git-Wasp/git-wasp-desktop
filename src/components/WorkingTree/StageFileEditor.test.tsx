import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// A modification: "b" → "B" (a removed + an added line).
const modified: StageFileContents = {
  headContent: "a\nb\nc\n",
  worktreeContent: "a\nB\nc\n",
  isBinary: false,
  worktreeExists: true,
};

// The view-mode preference persists to localStorage; reset it between tests so
// each starts from the default (split) view.
beforeEach(() => localStorage.clear());

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

  it("defaults to the split view with both panes and a view-mode toggle", () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    expect(pane(container, "head-pane")).toBeInTheDocument();
    expect(pane(container, "worktree-pane")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="inline-pane"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Side-by-side view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inline view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hunk view" })).toBeInTheDocument();
  });

  it("switches to a single unified pane in inline view", () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));

    expect(pane(container, "inline-pane")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="head-pane"]')).toBeNull();
    expect(container.querySelector('[data-testid="worktree-pane"]')).toBeNull();
  });

  it("shows added and removed lines together in the inline pane", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={modified} onStage={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));

    await waitFor(() => {
      const inline = pane(container, "inline-pane");
      expect(inline.querySelector(".cm-diff-add-line")).not.toBeNull();
      expect(inline.querySelector(".cm-diff-del-line")).not.toBeNull();
      // No hatched placeholders in the unified view.
      expect(inline.querySelector(".cm-diff-placeholder-line")).toBeNull();
    });
  });

  it("stages line-by-line from the inline view", async () => {
    const onStage = vi.fn();
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={onStage} />);
    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));

    const toggle = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="inline-pane"] .cm-stage-toggle');
      expect(button).not.toBeNull();
      return button!;
    });
    expect(toggle.textContent).toBe("−");
    fireEvent.click(toggle); // unstage the only change
    await waitFor(() =>
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="inline-pane"] .cm-stage-toggle')?.textContent,
      ).toBe("+"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(onStage.mock.calls[0]).toEqual(["f.txt", "a\nc\n"]);
  });

  it("remembers the chosen view mode across remounts", () => {
    const first = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));
    first.unmount();

    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);
    expect(pane(container, "inline-pane")).toBeInTheDocument();
  });

  it("switches to a hunk view with an @@ header and change decorations", async () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={modified} onStage={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Hunk view" }));

    const hunk = pane(container, "hunk-pane");
    expect(container.querySelector('[data-testid="head-pane"]')).toBeNull();
    await waitFor(() => {
      expect(hunk.querySelector(".cm-diff-hunk-header")).not.toBeNull();
      expect(hunk.querySelector(".cm-diff-add-line")).not.toBeNull();
      expect(hunk.querySelector(".cm-diff-del-line")).not.toBeNull();
    });
    expect(hunk.textContent).toContain("@@");
  });

  it("stages line-by-line from the hunk view", async () => {
    const onStage = vi.fn();
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={onStage} />);
    fireEvent.click(screen.getByRole("button", { name: "Hunk view" }));

    const toggle = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="hunk-pane"] .cm-stage-toggle');
      expect(button).not.toBeNull();
      return button!;
    });
    expect(toggle.textContent).toBe("−");
    fireEvent.click(toggle); // unstage the only change
    await waitFor(() =>
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="hunk-pane"] .cm-stage-toggle')?.textContent,
      ).toBe("+"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(onStage.mock.calls[0]).toEqual(["f.txt", "a\nc\n"]);
  });

  it("remembers the hunk view across remounts", () => {
    const first = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hunk view" }));
    first.unmount();

    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);
    expect(pane(container, "hunk-pane")).toBeInTheDocument();
  });

  it("renders the change overview ruler", () => {
    const { container } = render(<StageFileEditor path="f.txt" contents={inserted} onStage={vi.fn()} />);
    const overview = container.querySelector('[data-testid="change-overview"]');
    expect(overview).not.toBeNull();
    // One marker for the single added row.
    expect(overview!.children.length).toBe(1);
  });

  describe("diff-view options", () => {
    // A change that is only leading/trailing whitespace on line 2.
    const whitespaceOnly: StageFileContents = {
      headContent: "a\nfoo\nc\n",
      worktreeContent: "a\n  foo  \nc\n",
      isBinary: false,
      worktreeExists: true,
    };

    it("wrap toggle defaults on and flips + persists when clicked", () => {
      render(<StageFileEditor path="f.txt" contents={modified} onStage={vi.fn()} />);
      const btn = screen.getByRole("button", { name: "Wrap long lines" });

      expect(btn).toHaveAttribute("aria-pressed", "true"); // wraps by default
      fireEvent.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "false");
      expect(localStorage.getItem("stageFileEditor.wrap")).toBe("false");
    });

    it("remembers the wrap preference across remounts", () => {
      const first = render(<StageFileEditor path="f.txt" contents={modified} onStage={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Wrap long lines" }));
      first.unmount();

      render(<StageFileEditor path="f.txt" contents={modified} onStage={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Wrap long lines" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("hides whitespace-only changes when the whitespace toggle is on", async () => {
      const { container } = render(
        <StageFileEditor path="f.txt" contents={whitespaceOnly} onStage={vi.fn()} />,
      );

      // Shown by default: the whitespace-only change has stage toggles.
      await waitFor(() =>
        expect(container.querySelectorAll(".cm-stage-toggle").length).toBeGreaterThan(0),
      );

      const btn = screen.getByRole("button", { name: "Hide whitespace-only changes" });
      expect(btn).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(btn);

      // Collapsed to context — nothing left to stage.
      await waitFor(() => expect(container.querySelectorAll(".cm-stage-toggle").length).toBe(0));
      expect(btn).toHaveAttribute("aria-pressed", "true");
      expect(localStorage.getItem("stageFileEditor.ignoreWhitespace")).toBe("true");
    });

    it("keeps a real change visible with the whitespace toggle on", async () => {
      localStorage.setItem("stageFileEditor.ignoreWhitespace", "true");
      const { container } = render(
        <StageFileEditor path="f.txt" contents={modified} onStage={vi.fn()} />,
      );

      // "b" → "B" is a genuine change, so it still shows even while ignoring ws.
      await waitFor(() =>
        expect(container.querySelectorAll(".cm-stage-toggle").length).toBeGreaterThan(0),
      );
    });
  });

  describe("image preview", () => {
    // An added image: only the new (worktree) side has a data URI.
    const addedImage: StageFileContents = {
      headContent: "",
      worktreeContent: "",
      isBinary: true,
      worktreeExists: true,
      headImage: null,
      worktreeImage: "data:image/png;base64,AAAA",
    };
    // A modified image: both sides preview.
    const modifiedImage: StageFileContents = {
      headContent: "",
      worktreeContent: "",
      isBinary: true,
      worktreeExists: true,
      headImage: "data:image/png;base64,OLD0",
      worktreeImage: "data:image/png;base64,NEW1",
    };

    it("previews an image instead of a text diff, offering whole-file staging", () => {
      const onStageWholeFile = vi.fn();
      const { container } = render(
        <StageFileEditor
          path="logo.png"
          contents={addedImage}
          onStage={vi.fn()}
          onStageWholeFile={onStageWholeFile}
        />,
      );

      expect(container.querySelector('[data-testid="image-diff"]')).not.toBeNull();
      // No text/line panes and no view-mode toggle for an image.
      expect(container.querySelector('[data-testid="head-pane"]')).toBeNull();
      expect(screen.queryByRole("button", { name: "Inline view" })).toBeNull();

      const img = screen.getByAltText(/preview/i) as HTMLImageElement;
      expect(img.src).toBe("data:image/png;base64,AAAA");

      fireEvent.click(screen.getByRole("button", { name: /stage whole file/i }));
      expect(onStageWholeFile).toHaveBeenCalledWith("logo.png");
    });

    it("shows both before/after images for a modified image", () => {
      render(<StageFileEditor path="logo.png" contents={modifiedImage} onStage={vi.fn()} />);

      const imgs = screen.getAllByAltText(/preview/i) as HTMLImageElement[];
      expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
        "data:image/png;base64,OLD0",
        "data:image/png;base64,NEW1",
      ]);
    });

    it("has no staging controls when read-only (commit view)", () => {
      render(
        <StageFileEditor readOnly path="logo.png" contents={modifiedImage} onStage={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: /stage whole file/i })).toBeNull();
    });
  });

  describe("read-only mode", () => {
    it("renders the diff with custom labels and no staging controls", async () => {
      const { container } = render(
        <StageFileEditor
          readOnly
          path="f.txt"
          contents={modified}
          leftLabel="Parent"
          rightLabel="This commit"
          onStage={vi.fn()}
        />,
      );

      expect(screen.getByText("Parent")).toBeInTheDocument();
      expect(screen.getByText("This commit")).toBeInTheDocument();
      // No staging affordances.
      expect(screen.queryByRole("button", { name: "Stage" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
      await waitFor(() => {
        expect(pane(container, "head-pane").querySelector(".cm-diff-del-line")).not.toBeNull();
        expect(pane(container, "worktree-pane").querySelector(".cm-diff-add-line")).not.toBeNull();
      });
      expect(container.querySelector(".cm-stage-toggle")).toBeNull();
    });

    it("keeps the split/inline view toggle", () => {
      render(<StageFileEditor readOnly path="f.txt" contents={modified} onStage={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Side-by-side view" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Inline view" })).toBeInTheDocument();
    });

    it("renders a deletion (empty new side) as a diff rather than a fallback", async () => {
      const deleted: StageFileContents = {
        headContent: "a\nb\n",
        worktreeContent: "",
        isBinary: false,
        worktreeExists: false,
      };
      const { container } = render(
        <StageFileEditor readOnly path="f.txt" contents={deleted} onStage={vi.fn()} />,
      );

      expect(screen.queryByText(/can't be staged/i)).not.toBeInTheDocument();
      await waitFor(() =>
        expect(pane(container, "head-pane").querySelector(".cm-diff-del-line")).not.toBeNull(),
      );
    });

    it("shows a no-preview message (no stage button) for binary files", () => {
      const binary: StageFileContents = {
        headContent: "",
        worktreeContent: "",
        isBinary: true,
        worktreeExists: true,
      };
      render(
        <StageFileEditor
          readOnly
          path="logo.png"
          contents={binary}
          onStage={vi.fn()}
          onStageWholeFile={vi.fn()}
        />,
      );

      expect(screen.getByText(/no preview/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stage whole file" })).not.toBeInTheDocument();
    });
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
