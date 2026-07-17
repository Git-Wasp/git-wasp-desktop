import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import "@testing-library/jest-dom";
import { FileList } from "./FileList";
import type { ChangedFile } from "../../types/repo";

const many = (n: number): ChangedFile[] =>
  Array.from({ length: n }, (_, i) => ({
    path: `src/file_${i}.txt`,
    oldPath: null,
    status: "Modified",
    additions: 1,
    deletions: 0,
  }));

it("does not render every row into the DOM for a large changeset", () => {
  render(<FileList files={many(5000)} selectedPath={null} onSelect={() => {}} />);
  const rows = screen.getAllByRole("listitem");
  // react-window keeps only the visible window (+overscan) mounted.
  expect(rows.length).toBeLessThan(100);
});
