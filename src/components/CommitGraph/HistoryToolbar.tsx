import { useRef, useState } from "react";
import { useRemoteStore, type PullMode } from "../../stores/remoteStore";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useMergeStore } from "../../stores/mergeStore";
import { useToastStore } from "../../stores/toastStore";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";
import { PromptDialog } from "../common/PromptDialog";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { BranchFocusIcon, BranchIcon, ColumnsIcon, DensityIcon, PullIcon, PushIcon, RefreshIcon, SearchIcon, SplitViewIcon, TargetIcon } from "../ui/icons";
import { GRAPH_DENSITY, nextDensity } from "../../lib/graphDensity";
import { OPTIONAL_COLUMN_LABELS } from "./columnModel";

const barStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-panel)",
  flexShrink: 0,
};

const PULL_MESSAGE: Record<string, string> = {
  fastForwarded: "Fast-forwarded to latest",
  alreadyUpToDate: "Already up to date",
  merged: "Merged remote changes",
};

export function HistoryToolbar({ onJumpToHead }: { onJumpToHead?: () => void } = {}) {
  const {
    isFetching,
    isPulling,
    isPushing,
    fetch: fetchRemote,
    pull,
    push,
  } = useRemoteStore();
  const refresh = useGraphStore((s) => s.refresh);
  const revealHead = useGraphStore((s) => s.revealHead);
  const searchOpen = useGraphStore((s) => s.searchOpen);
  const openSearch = useGraphStore((s) => s.openSearch);
  const closeSearch = useGraphStore((s) => s.closeSearch);
  const focusCurrentBranch = useGraphStore((s) => s.focusCurrentBranch);
  const setFocusCurrentBranch = useGraphStore((s) => s.setFocusCurrentBranch);
  const graphVariant = useGraphStore((s) => s.graphVariant);
  const setGraphVariant = useGraphStore((s) => s.setGraphVariant);
  const graphDensity = useGraphStore((s) => s.graphDensity);
  const setGraphDensity = useGraphStore((s) => s.setGraphDensity);
  const visibleColumns = useGraphStore((s) => s.visibleColumns);
  const toggleColumn = useGraphStore((s) => s.toggleColumn);
  const { createBranch, checkoutBranch } = useRepoStore();
  const remoteInfo = useGithubStore((s) => s.remoteInfo);
  const loadMergeStatus = useMergeStore((s) => s.loadStatus);
  // Select the stable action methods so toolbar doesn't re-render on every toast.
  const toastSuccess = useToastStore((s) => s.success);
  const toastError = useToastStore((s) => s.error);
  const toastWarning = useToastStore((s) => s.warning);

  const refreshAll = useWorkingTreeStore((s) => s.refreshAll);

  const pullButtonRef = useRef<HTMLButtonElement>(null);
  const [pullMenu, setPullMenu] = useState<{ x: number; y: number } | null>(null);
  const [columnsMenu, setColumnsMenu] = useState<{ x: number; y: number } | null>(null);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAll();
    } catch (e) {
      toastError(`Refresh failed: ${e}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const hasRemote = !!remoteInfo;
  const busy = isFetching || isPulling || isPushing;

  const handlePush = async () => {
    try {
      await push();
      await refresh();
      toastSuccess("Pushed to remote");
    } catch (e) {
      toastError(String(e), { title: "Push failed" });
    }
  };

  const handleFetch = async () => {
    setPullMenu(null);
    try {
      const result = await fetchRemote();
      await refresh();
      const n = result.updatedRefs.length;
      toastSuccess(n > 0 ? `Fetched — ${n} ref${n === 1 ? "" : "s"} updated` : "Already up to date");
    } catch (e) {
      toastError(String(e), { title: "Fetch failed" });
    }
  };

  const handlePull = async (mode: PullMode) => {
    setPullMenu(null);
    try {
      const result = await pull(mode);
      // `undefined` means the pull was blocked by uncommitted changes and the
      // user cancelled the auto-stash prompt — nothing happened, stay quiet.
      if (!result) return;
      // A conflicting merge leaves an in-progress operation; load it so the
      // app swaps in the merge editor.
      if (result.status === "conflicts") {
        await loadMergeStatus();
        toastWarning("Pull stopped on conflicts — resolve them to continue");
      } else if (result.status === "stashReapplyConflict") {
        // Pull succeeded, but reapplying the auto-stashed changes conflicted;
        // the stash is kept for the user to resolve manually.
        toastWarning(
          "Pulled, but your stashed changes conflict with the update — reapply them from the stash panel.",
        );
      } else {
        toastSuccess(PULL_MESSAGE[result.status] ?? "Pulled changes");
      }
      await refresh();
    } catch (e) {
      toastError(String(e), { title: "Pull failed" });
    }
  };

  const openPullMenu = () => {
    const rect = pullButtonRef.current?.getBoundingClientRect();
    setPullMenu({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
  };

  const openColumnsMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setColumnsMenu({ x: rect.right, y: rect.bottom });
  };

  // A tick per optional column; toggling one keeps the menu open so several can
  // be flipped at once. The choice is persisted in the store.
  const columnItems: MenuItem[] = OPTIONAL_COLUMN_LABELS.map(({ kind, label }) => ({
    label,
    checked: visibleColumns[kind],
    closeOnSelect: false,
    onSelect: () => toggleColumn(kind),
  }));

  const handleJumpToHead = () => {
    // Let the host leave the uncommitted-changes view so the selected HEAD
    // commit's detail shows, then select + scroll to it.
    onJumpToHead?.();
    void revealHead();
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
    <div className="elevation-below" style={barStyle}>
      <Button type="button" onClick={handlePush} loading={isPushing} disabled={!hasRemote || busy}>
        {!isPushing && <PushIcon />}
        Push
      </Button>
      <Button
        type="button"
        ref={pullButtonRef}
        onClick={openPullMenu}
        loading={isPulling || isFetching}
        disabled={!hasRemote || busy}
      >
        {!(isPulling || isFetching) && <PullIcon />}
        Pull ▾
      </Button>
      <Button type="button" onClick={() => setShowNewBranch(true)}>
        <BranchIcon />
        New branch
      </Button>

      {/* Right-aligned: columns, layout toggle, focus toggle, check for changes, jump to HEAD. */}
      <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
        <Tooltip label="Show or hide columns">
          <IconButton
            aria-label="Configure columns"
            aria-haspopup="menu"
            aria-expanded={columnsMenu !== null}
            onClick={openColumnsMenu}
          >
            <ColumnsIcon />
          </IconButton>
        </Tooltip>
        <Tooltip label={`Row density: ${GRAPH_DENSITY[graphDensity].label} — click to change`}>
          <IconButton
            aria-label="Change row density"
            onClick={() => setGraphDensity(nextDensity(graphDensity))}
            style={{ color: graphDensity !== "comfortable" ? "var(--color-accent-primary)" : undefined }}
          >
            <DensityIcon />
          </IconButton>
        </Tooltip>
        <Tooltip
          label={
            graphVariant === "split"
              ? "Split Rail layout — click for Ledger Grid (graph on the left)"
              : "Ledger Grid layout — click for Split Rail (graph on the right)"
          }
        >
          <IconButton
            aria-label="Switch graph layout"
            aria-pressed={graphVariant === "split"}
            onClick={() => setGraphVariant(graphVariant === "split" ? "ledger" : "split")}
            style={{ color: graphVariant === "split" ? "var(--color-accent-primary)" : undefined }}
          >
            <SplitViewIcon />
          </IconButton>
        </Tooltip>
        <Tooltip label={searchOpen ? "Close search" : "Search commits (⌘/Ctrl+F)"}>
          <IconButton
            aria-label="Search commits"
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            style={{ color: searchOpen ? "var(--color-accent-primary)" : undefined }}
          >
            <SearchIcon />
          </IconButton>
        </Tooltip>
        <Tooltip
          label={
            focusCurrentBranch
              ? "Focusing current branch — click to show all branches equally"
              : "Focus current branch (dim other branches)"
          }
        >
          <IconButton
            aria-label="Focus current branch"
            aria-pressed={focusCurrentBranch}
            onClick={() => setFocusCurrentBranch(!focusCurrentBranch)}
            style={{ color: focusCurrentBranch ? "var(--color-accent-primary)" : undefined }}
          >
            <BranchFocusIcon />
          </IconButton>
        </Tooltip>
        <Tooltip label="Check for changes">
          <IconButton
            aria-label="Check for changes"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshIcon />
          </IconButton>
        </Tooltip>
        <Tooltip label="Scroll to current HEAD">
          <IconButton aria-label="Scroll to current HEAD" onClick={handleJumpToHead}>
            <TargetIcon />
          </IconButton>
        </Tooltip>
      </div>

      {pullMenu && (
        <ContextMenu x={pullMenu.x} y={pullMenu.y} items={pullItems} onClose={() => setPullMenu(null)} />
      )}

      {columnsMenu && (
        <ContextMenu
          x={columnsMenu.x}
          y={columnsMenu.y}
          align="right"
          items={columnItems}
          onClose={() => setColumnsMenu(null)}
        />
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
