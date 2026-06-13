import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { CommitGraph } from "./components/CommitGraph/CommitGraph";
import { HistoryToolbar } from "./components/CommitGraph/HistoryToolbar";
import { CommitDetail } from "./components/CommitDetail/CommitDetail";
import { WorkingTreePanel } from "./components/WorkingTree/WorkingTreePanel";
import { PRPanel } from "./components/PRPanel/PRPanel";
import { MergeEditor } from "./components/Merge/MergeEditor";
import { WorkspaceOverview } from "./components/Workspace/WorkspaceOverview";
import { SettingsView } from "./components/Settings/SettingsView";
import { ResizeHandle } from "./components/common/ResizeHandle";
import { usePersistedWidth } from "./lib/usePersistedWidth";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";
import { useGithubStore } from "./stores/githubStore";
import { useMergeStore } from "./stores/mergeStore";
import { useThemeStore } from "./stores/themeStore";

type View = "history" | "working-tree" | "prs" | "workspace" | "settings";

export default function App() {
  const { loadCurrentRepo } = useRepoStore();
  const { selectedOid } = useGraphStore();
  const { init, setPrDraft } = useGithubStore();
  const { status: operationStatus, loadStatus } = useMergeStore();
  const { initTheme } = useThemeStore();
  const [view, setView] = useState<View>("history");
  const [sidebarWidth, setSidebarWidth] = usePersistedWidth("sidebarWidth", 220, 160, 400);
  const [detailWidth, setDetailWidth] = usePersistedWidth("detailWidth", 380, 280, 720);

  const handleStartPullRequest = (head: string, base: string) => {
    setPrDraft({ head, base });
    setView("prs");
  };

  useEffect(() => {
    loadCurrentRepo();
  }, [loadCurrentRepo]);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (operationStatus.kind === "merge") {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          overflow: "hidden",
          background: "var(--color-bg-app)",
          color: "var(--color-text-primary)",
        }}
      >
        <MergeEditor />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--color-bg-app)",
        color: "var(--color-text-primary)",
      }}
    >
      <Sidebar view={view} onViewChange={setView} width={sidebarWidth} />
      <ResizeHandle
        ariaLabel="Resize sidebar"
        onResize={(dx) => setSidebarWidth((w) => w + dx)}
      />

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {view === "history" ? (
          <>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <HistoryToolbar />
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <CommitGraph
                  onStartPullRequest={handleStartPullRequest}
                  onViewChanges={() => setView("working-tree")}
                />
              </div>
            </div>
            <ResizeHandle
              ariaLabel="Resize detail panel"
              onResize={(dx) => setDetailWidth((w) => w - dx)}
            />
            <div
              style={{
                width: detailWidth,
                flexShrink: 0,
                borderLeft: "1px solid var(--color-border-subtle)",
                overflow: "hidden",
              }}
            >
              <CommitDetail oid={selectedOid} />
            </div>
          </>
        ) : view === "working-tree" ? (
          <WorkingTreePanel />
        ) : view === "prs" ? (
          <PRPanel />
        ) : view === "settings" ? (
          <SettingsView />
        ) : (
          <WorkspaceOverview />
        )}
      </div>
    </div>
  );
}
