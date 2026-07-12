import type { CSSProperties } from "react";

// Shared by StageFileEditor's pane headings ("Parent" / "This commit" in split
// view) and ChangeOverview's matching invisible spacer — the panes' headings
// push their scrollable content down by this box's height, so the overview
// strip needs the same offset to stay aligned with what it's tracking.
export const paneLabelStyle: CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border-subtle)",
};
