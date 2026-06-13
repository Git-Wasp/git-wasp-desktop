import { useRef, useState } from "react";
import { useRemoteStore, type PullMode } from "../../stores/remoteStore";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useMergeStore } from "../../stores/mergeStore";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";
import { PromptDialog } from "../common/PromptDialog";

const barStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-panel)",
  flexShrink: 0,
};

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "var(--space-1) var(--space-3)",
    fontSize: "var(--font-size-sm)",
    background: "transparent",
    color: disabled ? "var(--color-text-muted)" : "var(--color-text-secondary)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "var(--radius-sm)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

export function HistoryToolbar() {
  const {
    isFetching,
    isPulling,
    isPushing,
    lastError,
    fetch: fetchRemote,
    pull,
    push,
  } = useRemoteStore();
  const refresh = useGraphStore((s) => s.refresh);
  const { createBranch, checkoutBranch } = useRepoStore();
  const remoteInfo = useGithubStore((s) => s.remoteInfo);
  const loadMergeStatus = useMergeStore((s) => s.loadStatus);

  const pullButtonRef = useRef<HTMLButtonElement>(null);
  const [pullMenu, setPullMenu] = useState<{ x: number; y: number } | null>(null);
  const [showNewBranch, setShowNewBranch] = useState(false);

  const hasRemote = !!remoteInfo;
  const busy = isFetching || isPulling || isPushing;

  const handlePush = async () => {
    try {
      await push();
      await refresh();
    } catch {
      /* error captured in remoteStore.lastError */
    }
  };

  const handleFetch = async () => {
    setPullMenu(null);
    try {
      await fetchRemote();
      await refresh();
    } catch {
      /* lastError */
    }
  };

  const handlePull = async (mode: PullMode) => {
    setPullMenu(null);
    try {
      const result = await pull(mode);
      // A conflicting merge leaves an in-progress operation; load it so the
      // app swaps in the merge editor.
      if (result.status === "conflicts") await loadMergeStatus();
      await refresh();
    } catch {
      /* lastError */
    }
  };

  const openPullMenu = () => {
    const rect = pullButtonRef.current?.getBoundingClientRect();
    setPullMenu({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
  };

  const handleCreateBranch = async (name: string) => {
    setShowNewBranch(false);
    await createBranch(name);
    await checkoutBranch(name);
    await refresh();
  };

  const pullItems: MenuItem[] = [
    { label: "Fetch", onSelect: handleFetch },
    { label: "Pull (fast-forward if possible)", onSelect: () => handlePull("ffOrMerge") },
    { label: "Pull (fast-forward only)", onSelect: () => handlePull("ffOnly") },
  ];

  return (
    <div style={barStyle}>
      <button type="button" onClick={handlePush} disabled={!hasRemote || busy} style={buttonStyle(!hasRemote || busy)}>
        {isPushing ? "Pushing…" : "Push"}
      </button>
      <button
        type="button"
        ref={pullButtonRef}
        onClick={openPullMenu}
        disabled={!hasRemote || busy}
        style={buttonStyle(!hasRemote || busy)}
      >
        {isPulling || isFetching ? "Pulling…" : "Pull ▾"}
      </button>
      <button type="button" onClick={() => setShowNewBranch(true)} style={buttonStyle(false)}>
        New branch
      </button>

      {lastError && (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-danger)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {lastError}
        </span>
      )}

      {pullMenu && (
        <ContextMenu x={pullMenu.x} y={pullMenu.y} items={pullItems} onClose={() => setPullMenu(null)} />
      )}

      {showNewBranch && (
        <PromptDialog
          title="New branch"
          label="Branch name"
          confirmLabel="Create"
          onConfirm={handleCreateBranch}
          onCancel={() => setShowNewBranch(false)}
        />
      )}
    </div>
  );
}
