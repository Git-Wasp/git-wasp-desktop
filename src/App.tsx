import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { CommitGraph } from "./components/CommitGraph/CommitGraph";
import { CommitDetail } from "./components/CommitDetail/CommitDetail";
import { WorkingTreePanel } from "./components/WorkingTree/WorkingTreePanel";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";

type View = "history" | "working-tree";

export default function App() {
  const { loadCurrentRepo } = useRepoStore();
  const { selectedOid } = useGraphStore();
  const [view, setView] = useState<View>("history");

  useEffect(() => {
    loadCurrentRepo();
  }, [loadCurrentRepo]);

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
        ) : (
          <WorkingTreePanel />
        )}
      </div>
    </div>
  );
}
