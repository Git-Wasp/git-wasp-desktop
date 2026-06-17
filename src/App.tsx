import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TabBar } from "./components/TabBar/TabBar";
import { CommitGraph } from "./components/CommitGraph/CommitGraph";
import { HistoryToolbar } from "./components/CommitGraph/HistoryToolbar";
import { CommitDetail } from "./components/CommitDetail/CommitDetail";
import { WorkingTreePanel } from "./components/WorkingTree/WorkingTreePanel";
import { UncommittedPanel } from "./components/WorkingTree/UncommittedPanel";
import { HunkDiffViewer } from "./components/WorkingTree/HunkDiffViewer";
import { PRPanel } from "./components/PRPanel/PRPanel";
import { MergeEditor } from "./components/Merge/MergeEditor";
import { SettingsView } from "./components/Settings/SettingsView";
import { ResizeHandle } from "./components/common/ResizeHandle";
import { usePersistedWidth } from "./lib/usePersistedWidth";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";
import { useGithubStore } from "./stores/githubStore";
import { useMergeStore } from "./stores/mergeStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkingTreeStore } from "./stores/workingTreeStore";

type View = "history" | "working-tree" | "prs" | "settings";

export default function App() {
  const { loadCurrentRepo, loadOpenRepos, currentRepo } = useRepoStore();
  const { selectedOid } = useGraphStore();
  const { init, setPrDraft } = useGithubStore();
  const { status: operationStatus, loadStatus } = useMergeStore();
  const { initTheme } = useThemeStore();
  const {
    status: wtStatus,
    selectedPath: wtSelectedPath,
    selectedDiff: wtSelectedDiff,
    clearSelectedFile,
    discardFile,
  } = useWorkingTreeStore();
  const [view, setView] = useState<View>("history");
  // In the history view, the right panel shows commit details or the
  // uncommitted-changes list (when the working-tree node is active).
  const [historyRightMode, setHistoryRightMode] = useState<"commit" | "uncommitted">("commit");
  const [sidebarWidth, setSidebarWidth] = usePersistedWidth("sidebarWidth", 220, 160, 400);
  const [detailWidth, setDetailWidth] = usePersistedWidth("detailWidth", 380, 280, 720);

  const enterUncommitted = () => {
    clearSelectedFile();
    setHistoryRightMode("uncommitted");
  };
  const exitUncommitted = () => {
    clearSelectedFile();
    setHistoryRightMode("commit");
  };

  const showingUncommittedDiff = historyRightMode === "uncommitted" && wtSelectedDiff != null;
  const diffKind = wtStatus?.staged.some((e) => e.path === wtSelectedPath) ? "staged" : "unstaged";

  const handleStartPullRequest = (head: string, base: string) => {
    setPrDraft({ head, base });
    setView("prs");
  };

  useEffect(() => {
    loadCurrentRepo();
    loadOpenRepos();
  }, [loadCurrentRepo, loadOpenRepos]);

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
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--color-bg-app)",
        color: "var(--color-text-primary)",
      }}
    >
      <TabBar />
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
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
                {showingUncommittedDiff && wtSelectedDiff ? (
                  <HunkDiffViewer
                    diffHunks={wtSelectedDiff}
                    kind={diffKind}
                    onDiscardFile={
                      diffKind === "unstaged" && wtSelectedPath
                        ? () => discardFile(wtSelectedPath)
                        : undefined
                    }
                    onClose={clearSelectedFile}
                  />
                ) : (
                  <CommitGraph
                    onStartPullRequest={handleStartPullRequest}
                    onViewChanges={enterUncommitted}
                    onCommitSelect={exitUncommitted}
                  />
                )}
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
              {historyRightMode === "uncommitted" ? (
                <UncommittedPanel branch={currentRepo?.headBranch ?? null} />
              ) : (
                <CommitDetail oid={selectedOid} />
              )}
            </div>
          </>
        ) : view === "working-tree" ? (
          <WorkingTreePanel />
        ) : view === "prs" ? (
          <PRPanel />
        ) : (
          <SettingsView />
        )}
      </div>
      </div>
    </div>
  );
}
