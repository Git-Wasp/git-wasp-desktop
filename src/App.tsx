import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TabBar } from "./components/TabBar/TabBar";
import { NavBar } from "./components/NavBar/NavBar";
import { CommitGraph } from "./components/CommitGraph/CommitGraph";
import { HistoryToolbar } from "./components/CommitGraph/HistoryToolbar";
import { CommitDetail } from "./components/CommitDetail/CommitDetail";
import { UncommittedPanel } from "./components/WorkingTree/UncommittedPanel";
import { StageFileEditor } from "./components/WorkingTree/StageFileEditor";
import { PRPanel } from "./components/PRPanel/PRPanel";
import { MergeEditor } from "./components/Merge/MergeEditor";
import { SettingsView } from "./components/Settings/SettingsView";
import { ToastContainer } from "./components/ui/Toast";
import { ResizeHandle } from "./components/common/ResizeHandle";
import { usePersistedWidth } from "./lib/usePersistedWidth";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";
import { useGithubStore } from "./stores/githubStore";
import { useMergeStore } from "./stores/mergeStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkingTreeStore } from "./stores/workingTreeStore";

type View = "history" | "prs" | "settings";

export default function App() {
  const { loadCurrentRepo, loadOpenRepos, currentRepo } = useRepoStore();
  const { selectedOid } = useGraphStore();
  const { init, setPrDraft } = useGithubStore();
  const { status: operationStatus, loadStatus } = useMergeStore();
  const { initTheme } = useThemeStore();
  const {
    selectedPath: wtSelectedPath,
    stageDiff: wtStageDiff,
    clearSelectedFile,
    discardFile,
    stageFile,
    applyStagedContent,
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

  const showingUncommittedDiff =
    historyRightMode === "uncommitted" && wtSelectedPath != null && wtStageDiff != null;

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
      <NavBar view={view} onViewChange={setView} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
      <Sidebar width={sidebarWidth} />
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
                {showingUncommittedDiff && wtSelectedPath && wtStageDiff ? (
                  <StageFileEditor
                    path={wtSelectedPath}
                    contents={wtStageDiff}
                    onStage={applyStagedContent}
                    onStageWholeFile={stageFile}
                    onDiscardFile={discardFile}
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
                <UncommittedPanel
                  branch={currentRepo?.headBranch ?? null}
                  onCommitted={exitUncommitted}
                />
              ) : (
                <CommitDetail oid={selectedOid} />
              )}
            </div>
          </>
        ) : view === "prs" ? (
          <PRPanel />
        ) : (
          <SettingsView />
        )}
      </div>
      </div>
      <ToastContainer />
    </div>
  );
}
