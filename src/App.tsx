import { useEffect, useRef, useState } from "react";
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
import { MergeCommitDialog } from "./components/Merge/MergeCommitDialog";
import { SettingsView } from "./components/Settings/SettingsView";
import { WelcomeView } from "./components/Welcome/WelcomeView";
import { SplashScreen } from "./components/Splash/SplashScreen";
import { ToastContainer } from "./components/ui/Toast";
import { ResizeHandle } from "./components/common/ResizeHandle";
import { usePersistedWidth } from "./lib/usePersistedWidth";
import { usePersistedBoolean } from "./lib/usePersistedBoolean";
import { applyDiagnosticsPref } from "./lib/diagnostics";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";
import { useCommitFileStore } from "./stores/commitFileStore";
import { useGithubStore } from "./stores/githubStore";
import { useRemoteStore } from "./stores/remoteStore";
import { useMergeStore } from "./stores/mergeStore";
import { useTagStore } from "./stores/tagStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkingTreeStore } from "./stores/workingTreeStore";
import type { View, HistoryRightMode } from "./types/view";

// How many history rows to warm during boot so the graph isn't blank on reveal.
const BOOT_GRAPH_LIMIT = 150;

export default function App() {
  const { loadCurrentRepo, loadOpenRepos, currentRepo, loadBranches } = useRepoStore();
  const { selectedOid } = useGraphStore();
  const {
    path: commitFilePath,
    contents: commitFileContents,
    clear: clearCommitFile,
  } = useCommitFileStore();
  const { init, setPrDraft, detectRemote } = useGithubStore();
  const loadAheadBehind = useRemoteStore((s) => s.loadAheadBehind);
  const loadRemoteTags = useTagStore((s) => s.loadRemoteTags);
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
  const [historyRightMode, setHistoryRightMode] = useState<HistoryRightMode>("commit");
  const [sidebarWidth, setSidebarWidth] = usePersistedWidth("sidebarWidth", 220, 160, 400);
  const [detailWidth, setDetailWidth] = usePersistedWidth("detailWidth", 380, 280, 720);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedBoolean("sidebarCollapsed", false);
  const [booted, setBooted] = useState(false);
  const [bootTask, setBootTask] = useState("Starting…");

  // Latches whether the in-progress merge ever had conflicts, so the surface
  // (full-screen editor vs. floating commit dialog) is decided once at merge
  // start and doesn't flip when the last conflict is resolved.
  const [mergeHadConflicts, setMergeHadConflicts] = useState(false);
  const wasMergingRef = useRef(false);
  useEffect(() => {
    const merging = operationStatus.kind === "merge";
    if (merging) {
      if (!wasMergingRef.current) {
        setMergeHadConflicts(operationStatus.conflicts.length > 0);
      } else if (operationStatus.conflicts.length > 0) {
        setMergeHadConflicts(true);
      }
    } else {
      setMergeHadConflicts(false);
    }
    wasMergingRef.current = merging;
  }, [operationStatus]);

  const enterUncommitted = () => {
    clearSelectedFile();
    clearCommitFile();
    setHistoryRightMode("uncommitted");
  };
  const exitUncommitted = () => {
    clearSelectedFile();
    setHistoryRightMode("commit");
  };

  const showingUncommittedDiff =
    historyRightMode === "uncommitted" && wtSelectedPath != null && wtStageDiff != null;
  // A file picked from a commit's changed-files list opens its (read-only) diff in
  // the main panel, the same surface staging uses.
  const showingCommitFileDiff =
    historyRightMode === "commit" && commitFilePath != null && commitFileContents != null;

  // No active repo (initial launch, a "new tab", or the last repo closed) lands
  // on the welcome view — except in Settings, which stands alone.
  const showWelcome = !currentRepo && view !== "settings";

  const handleStartPullRequest = (head: string, base: string) => {
    setPrDraft({ head, base });
    setView("prs");
  };

  // One-time boot: restore state behind the splash screen, then reveal the app.
  // Local/cheap work is awaited so the graph isn't blank on reveal; network-bound
  // work (GitHub) is deferred to after reveal so it can't stall the splash.
  useEffect(() => {
    let cancelled = false;
    const task = (t: string) => {
      if (!cancelled) setBootTask(t);
    };
    (async () => {
      try {
        task("Loading theme…");
        await initTheme();
        task("Restoring session…");
        await Promise.all([loadCurrentRepo(), loadOpenRepos()]);
        // Resolve any in-progress merge before reveal so we don't flash the
        // normal UI and then swap to the merge editor.
        await loadStatus();
        if (useRepoStore.getState().currentRepo) {
          task("Loading history…");
          // The per-repo effect loads branches/remote/ahead-behind; we also warm
          // the first graph slice so the graph has content on reveal.
          await useGraphStore.getState().fetchViewport(0, BOOT_GRAPH_LIMIT).catch(() => {});
        }
      } catch {
        // Boot is best-effort — always reveal the app so the user isn't stuck on
        // the splash if a restore step fails.
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initTheme, loadCurrentRepo, loadOpenRepos, loadStatus]);

  // Network-bound startup work runs after reveal so it can't stall the splash.
  useEffect(() => {
    if (!booted) return;
    init();
    applyDiagnosticsPref().catch(() => {});
  }, [booted, init]);

  // Load everything scoped to the active repo whenever it changes. This lives at
  // the app root (not in the Sidebar) so it runs even when the sidebar is
  // collapsed — otherwise the remote wouldn't be detected and the push/pull
  // buttons (gated on a detected remote) would stay disabled.
  const repoPath = currentRepo?.path ?? null;
  useEffect(() => {
    if (!repoPath) return;
    loadBranches();
    detectRemote();
    loadAheadBehind();
    // Best-effort: populates the tag local/remote indicator (network ls-remote).
    void loadRemoteTags();
  }, [repoPath, loadBranches, detectRemote, loadAheadBehind, loadRemoteTags]);

  // Background poll: while a repo is open, periodically re-sync the working tree
  // and graph so changes made outside the app — or while not on the uncommitted
  // view (where the file watcher runs) — appear without needing a restart. The
  // manual "Check for changes" toolbar button runs the same refresh on demand.
  useEffect(() => {
    if (!repoPath) return;
    let running = false;
    const tick = async () => {
      // Skip when a tick is still in flight or the window is hidden.
      if (running || document.hidden) return;
      running = true;
      try {
        await useWorkingTreeStore.getState().refreshAll();
      } catch {
        // Best-effort: a transient failure must not break the poll.
      } finally {
        running = false;
      }
    };
    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  }, [repoPath]);

  if (!booted) {
    return <SplashScreen task={bootTask} />;
  }

  // A merge with conflicts takes over the whole screen (the full-screen editor);
  // a clean merge keeps the app visible and just floats a commit-message dialog.
  // `mergeHadConflicts` latches so the editor stays put after the last conflict
  // is resolved (rather than flipping to the dialog mid-resolution).
  const mergeInProgress = operationStatus.kind === "merge";
  const conflictCount = mergeInProgress ? operationStatus.conflicts.length : 0;
  const showMergeEditor = mergeInProgress && (conflictCount > 0 || mergeHadConflicts);
  const showMergeCommitDialog = mergeInProgress && !showMergeEditor;

  if (showMergeEditor) {
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
      <NavBar
        view={view}
        onViewChange={setView}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
      {!sidebarCollapsed && (
        <>
          <Sidebar width={sidebarWidth} />
          <ResizeHandle
            ariaLabel="Resize sidebar"
            onResize={(dx) => setSidebarWidth((w) => w + dx)}
          />
        </>
      )}

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {showWelcome ? (
          <WelcomeView />
        ) : view === "history" ? (
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
              <HistoryToolbar onJumpToHead={exitUncommitted} />
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
                ) : showingCommitFileDiff && commitFilePath && commitFileContents ? (
                  <StageFileEditor
                    readOnly
                    path={commitFilePath}
                    contents={commitFileContents}
                    leftLabel="Parent"
                    rightLabel="This commit"
                    onStage={() => {}}
                    onClose={clearCommitFile}
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
      {showMergeCommitDialog && <MergeCommitDialog />}
      <ToastContainer />
    </div>
  );
}
