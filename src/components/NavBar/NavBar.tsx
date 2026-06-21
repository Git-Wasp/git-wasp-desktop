import { open } from "@tauri-apps/plugin-dialog";
import type { CSSProperties } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { Button } from "../ui/Button";

export type View = "history" | "working-tree" | "prs" | "settings";

const VIEW_TABS: { id: View; label: string }[] = [
  { id: "history", label: "History" },
  { id: "working-tree", label: "Changes" },
  { id: "prs", label: "PRs" },
];

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  flexShrink: 0,
  height: 36,
  padding: "0 var(--space-2)",
  gap: "var(--space-1)",
  background: "var(--color-bg-panel)",
  borderBottom: "1px solid var(--color-border-subtle)",
};

function tabStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "0 var(--space-3)",
    fontSize: "var(--font-size-sm)",
    background: "transparent",
    border: "none",
    borderBottom: active
      ? "2px solid var(--color-accent-primary)"
      : "2px solid transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
    fontWeight: active ? "var(--font-weight-semibold)" : "var(--font-weight-normal)",
    cursor: "pointer",
  };
}

/**
 * Primary navigation strip beneath the repo tab bar: view tabs (History /
 * Changes / PRs / Settings) plus the Open Repository action. Always rendered, so
 * a repo can be opened (and Settings reached) even with nothing open yet; the
 * repo-specific view tabs only appear once a repo is open.
 */
export function NavBar({
  view,
  onViewChange,
}: {
  view: View;
  onViewChange: (v: View) => void;
}) {
  const currentRepo = useRepoStore((s) => s.currentRepo);
  const openRepo = useRepoStore((s) => s.openRepo);

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await openRepo(selected);
    }
  };

  return (
    <div style={barStyle} role="tablist" aria-label="Views">
      {currentRepo &&
        VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={view === tab.id}
            style={tabStyle(view === tab.id)}
            onClick={() => onViewChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}

      <div style={{ flex: 1 }} />

      <button
        role="tab"
        aria-selected={view === "settings"}
        style={tabStyle(view === "settings")}
        onClick={() => onViewChange("settings")}
      >
        ⚙ Settings
      </button>
      <div style={{ display: "flex", alignItems: "center", paddingLeft: "var(--space-2)" }}>
        <Button variant="primary" size="sm" onClick={handleOpenFolder}>
          Open Repository…
        </Button>
      </div>
    </div>
  );
}
