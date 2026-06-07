import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { CommitGraph } from "./components/CommitGraph/CommitGraph";
import { CommitDetail } from "./components/CommitDetail/CommitDetail";
import { WorkingTreePanel } from "./components/WorkingTree/WorkingTreePanel";
import { PRPanel } from "./components/PRPanel/PRPanel";
import { MergeEditor } from "./components/Merge/MergeEditor";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";
import { useGithubStore } from "./stores/githubStore";
import { useMergeStore } from "./stores/mergeStore";

type View = "history" | "working-tree" | "prs";

export default function App() {
  const { loadCurrentRepo } = useRepoStore();
  const { selectedOid } = useGraphStore();
  const { init } = useGithubStore();
  const { status: operationStatus, loadStatus } = useMergeStore();
  const [view, setView] = useState<View>("history");

  useEffect(() => {
    loadCurrentRepo();
  }, [loadCurrentRepo]);

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
      <Sidebar view={view} onViewChange={setView} />

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {view === "history" ? (
          <>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <CommitGraph />
            </div>
            <div
              style={{
                width: 380,
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
        ) : (
          <PRPanel />
        )}
      </div>
    </div>
  );
}
