import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import "@testing-library/jest-dom";
import { StagingPanel } from "./StagingPanel";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import type { WorkingTreeStatus } from "../../types/workingTree";

it("windows the Changes list instead of mounting every row", () => {
  const status: WorkingTreeStatus = {
    staged: [],
    unstaged: Array.from({ length: 4000 }, (_, i) => ({
      path: `src/f_${i}.txt`,
      originalPath: null,
      status: "Modified",
    })),
    untracked: [],
  };
  useWorkingTreeStore.setState({
    status,
    selectedPath: null,
    stageMode: null,
    loadStatus: () => Promise.resolve(),
    startWatching: () => Promise.resolve(() => {}),
  });

  render(<StagingPanel />);
  const rows = screen.getAllByTestId("file-row");
  expect(rows.length).toBeLessThan(100);
});
