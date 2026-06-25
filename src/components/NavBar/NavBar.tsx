import type { CSSProperties } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { IconButton } from "../ui/IconButton";
import { SidebarIcon } from "../ui/icons";
import { RepoPicker } from "./RepoPicker";
import { BranchPicker } from "./BranchPicker";

export type View = "history" | "prs" | "settings";

const VIEW_TABS: { id: View; label: string }[] = [
  { id: "history", label: "History" },
  { id: "prs", label: "PRs" },
];

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  flexShrink: 0,
  height: 44,
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

const dividerStyle: CSSProperties = {
  alignSelf: "center",
  width: 1,
  height: 18,
  margin: "0 var(--space-1)",
  background: "var(--color-border-subtle)",
  flexShrink: 0,
};

/**
 * Primary navigation strip beneath the repo tab bar: a repo picker (current repo
 * + recents + open) and branch picker (current branch + checkout) on the left,
 * then the view tabs (History / PRs) and Settings. Always rendered, so a repo
 * can be opened (and Settings reached) even with nothing open yet; the
 * repo-specific view tabs and branch picker only appear once a repo is open.
 */
export function NavBar({
  view,
  onViewChange,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  view: View;
  onViewChange: (v: View) => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}) {
  const currentRepo = useRepoStore((s) => s.currentRepo);

  return (
    <div style={barStyle} role="tablist" aria-label="Views">
      {onToggleSidebar && (
        <div style={{ display: "flex", alignItems: "center", paddingRight: "var(--space-1)" }}>
          <IconButton
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!sidebarCollapsed}
            onClick={onToggleSidebar}
          >
            <SidebarIcon />
          </IconButton>
        </div>
      )}

      {/* Repo + branch pickers (top-left). */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", minWidth: 0 }}>
        <RepoPicker />
        <BranchPicker />
      </div>

      {currentRepo && <div style={dividerStyle} />}

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
    </div>
  );
}
