import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useMergeStore } from "../../stores/mergeStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useAvatarStore } from "../../stores/avatarStore";
import { useToastStore } from "../../stores/toastStore";
import { useStashStore } from "../../stores/stashStore";
import { useTagStore } from "../../stores/tagStore";
import { TagDeleteDialog } from "./TagDeleteDialog";
import { useCommitGraph, GRAPH_PAD_LEFT } from "../../hooks/useCommitGraph";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";
import { PromptDialog } from "../common/PromptDialog";
import { ResizeHandle } from "../common/ResizeHandle";
import { usePersistedWidth } from "../../lib/usePersistedWidth";
import { runMerge } from "./dragDrop";
import { useGraphDragDrop } from "./useGraphDragDrop";
import { MergeConfirmDialog } from "./MergeConfirmDialog";
import { GraphSkeleton } from "./GraphSkeleton";
import { BranchCell, MessageCell } from "./columns";
import {
  COLUMNS,
  ROW_HEIGHT,
  BRANCH_COL_WIDTH,
  GRAPH_COL_WIDTH,
  type GraphColumn,
  type PillHandlers,
} from "./columnModel";
import type { CSSProperties } from "react";
import type { GraphNode } from "../../types/graph";

const BUFFER_ROWS = 20;

interface MenuState {
  x: number;
  y: number;
  node: GraphNode;
}

type PromptState =
  | { kind: "new-branch"; oid: string }
  | { kind: "rename-branch"; branch: string }
  | { kind: "create-tag"; oid: string }
  | { kind: "stash" }
  | { kind: "rename-stash"; index: number; current: string };

/**
 * A single graph row (branch cell · graph gap the canvas shows through · message
 * cell). Memoized and keyed by commit oid so that, when only the selection
 * changes, just the rows whose `selected` flips re-render — not the whole list.
 */
const GraphRow = memo(function GraphRow({
  node,
  rowIndex,
  selected,
  hovered,
  onRowHover,
  branchWidth,
  graphWidth,
  currentBranch,
  isTagOnRemote,
  pillHandlers,
  onRowClick,
  onRowContextMenu,
}: {
  node: GraphNode;
  rowIndex: number;
  selected: boolean;
  branchWidth: number;
  graphWidth: number;
  currentBranch: string | null;
  isTagOnRemote: (name: string) => boolean;
  pillHandlers: PillHandlers;
  onRowClick: (node: GraphNode, shiftKey: boolean) => void;
  onRowContextMenu: (e: React.MouseEvent, node: GraphNode) => void;
  hovered: boolean;
  onRowHover: (oid: string | null) => void;
}) {
  // The checked-out (HEAD) commit's row keeps a permanent muted band so it's
  // obvious which commit is current; hover shows a subtle highlight, and an
  // actual selection takes over with the normal highlight. (The canvas paints
  // the matching band for the graph column.) Priority: selected > hover > HEAD.
  const isHeadRow = node.isHead && !node.isWorkingTree;
  const cellBg = selected
    ? "var(--color-bg-selected)"
    : hovered
      ? "var(--color-bg-hover)"
      : isHeadRow
        ? "var(--color-graph-head-row-bg)"
        : "transparent";
  return (
    <div
      data-oid={node.oid}
      data-head-row={isHeadRow ? "true" : undefined}
      onClick={(e) => onRowClick(node, e.shiftKey)}
      onContextMenu={(e) => onRowContextMenu(e, node)}
      onMouseEnter={() => onRowHover(node.oid)}
      onMouseLeave={() => onRowHover(null)}
      style={{
        position: "absolute",
        top: rowIndex * ROW_HEIGHT,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: branchWidth,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "0 var(--space-2)",
          background: cellBg,
        }}
      >
        <BranchCell
          node={node}
          handlers={pillHandlers}
          currentBranch={currentBranch}
          isTagOnRemote={isTagOnRemote}
        />
      </div>
      {/* graph gap — canvas shows through */}
      <div style={{ width: graphWidth, flexShrink: 0, height: "100%" }} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 var(--space-3)",
          background: cellBg,
        }}
      >
        <MessageCell node={node} />
      </div>
    </div>
  );
});

const headerCellStyle: React.CSSProperties = {
  padding: "0 var(--space-3)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export function CommitGraph({
  onStartPullRequest,
  onViewChanges,
  onCommitSelect,
}: {
  onStartPullRequest?: (head: string, base: string) => void;
  onViewChanges?: () => void;
  onCommitSelect?: () => void;
} = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { viewport, selection, fetchViewport, selectCommit, selectWorkingTree, refresh } =
    useGraphStore();
  const scrollToRow = useGraphStore((s) => s.scrollToRow);
  const { currentRepo, createBranch, checkoutBranch, renameBranch, deleteBranch, checkoutCommit, createTag, revertCommit } =
    useRepoStore();
  const remoteInfo = useGithubStore((s) => s.remoteInfo);
  const startMerge = useMergeStore((s) => s.startMerge);
  const operationStatus = useMergeStore((s) => s.status);
  const pushBranch = useRemoteStore((s) => s.push);
  const requestAvatars = useAvatarStore((s) => s.request);
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);
  const stash = useStashStore();
  const remoteTags = useTagStore((s) => s.remoteTags);
  const pushTag = useTagStore((s) => s.pushTag);
  const deleteTag = useTagStore((s) => s.deleteTag);
  const isTagOnRemote = useCallback((name: string) => remoteTags.includes(name), [remoteTags]);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [tagDelete, setTagDelete] = useState<{ name: string; onRemote: boolean } | null>(null);
  // The row the pointer is over, for a subtle hover highlight. Stable setter, so
  // memoized rows only re-render when their own hovered flag flips.
  const [hoveredOid, setHoveredOid] = useState<string | null>(null);
  const handleRowHover = useCallback((oid: string | null) => setHoveredOid(oid), []);

  // Resizable, persisted column widths (the message column flexes to fill).
  const [branchWidth, setBranchWidth] = usePersistedWidth("graphBranchColWidth", BRANCH_COL_WIDTH, 100, 400);
  const [graphWidth, setGraphWidth] = usePersistedWidth("graphGraphColWidth", GRAPH_COL_WIDTH, 60, 400);

  const colStyle = (col: GraphColumn): CSSProperties => {
    if (col.kind === "branch") return { width: branchWidth, flexShrink: 0 };
    if (col.kind === "graph") return { width: graphWidth, flexShrink: 0 };
    return { flex: 1, minWidth: 0 };
  };

  // Initial load.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const limit = Math.ceil(container.clientHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    fetchViewport(0, limit);
  }, [fetchViewport]);

  // Resolve gravatars for the authors in view (deduped + cached in the store).
  useEffect(() => {
    if (!viewport) return;
    requestAvatars(viewport.nodes.filter((n) => !n.isWorkingTree).map((n) => n.authorEmail));
  }, [viewport, requestAvatars]);

  // Scroll fetches are throttled to one per animation frame and skipped entirely
  // when the rows already loaded cover the viewport — so most scrolling triggers
  // no IPC at all, and the rest at most once per frame.
  const scrollRaf = useRef<number | null>(null);
  const pendingScroll = useRef<{ scrollTop: number; clientHeight: number } | null>(null);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      pendingScroll.current = {
        scrollTop: e.currentTarget.scrollTop,
        clientHeight: e.currentTarget.clientHeight,
      };
      if (scrollRaf.current !== null) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        const m = pendingScroll.current;
        if (!m) return;
        const offset = Math.max(0, Math.floor(m.scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
        const limit = Math.ceil(m.clientHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;

        // Already-loaded coverage: skip the fetch unless we'd reveal unloaded
        // rows (loadedEnd reaching totalCount means everything below is present).
        const vp = useGraphStore.getState().viewport;
        if (vp) {
          const loadedStart = vp.offset;
          const loadedEnd = vp.offset + vp.nodes.length;
          const covered =
            offset >= loadedStart && (offset + limit <= loadedEnd || loadedEnd >= vp.totalCount);
          if (covered) return;
        }
        fetchViewport(offset, limit);
      });
    },
    [fetchViewport],
  );

  useEffect(() => {
    return () => {
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  // Scroll a revealed commit (a branch head clicked in the sidebar) into view,
  // centring it, then load the slice around it. Consumes the pending row.
  useEffect(() => {
    if (scrollToRow === null) return;
    const container = containerRef.current;
    if (!container) return;
    const target = Math.max(0, scrollToRow * ROW_HEIGHT - container.clientHeight / 2);
    container.scrollTop = target;
    const offset = Math.max(0, Math.floor(target / ROW_HEIGHT) - BUFFER_ROWS);
    const limit = Math.ceil(container.clientHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    fetchViewport(offset, limit);
    useGraphStore.setState({ scrollToRow: null });
  }, [scrollToRow, fetchViewport]);

  // Merge source into target (auto-checking-out target first), then refresh.
  const handleMerge = useCallback(
    (source: string, target: string) => {
      void (async () => {
        await runMerge({
          source,
          target,
          currentBranch: currentRepo?.headBranch ?? null,
          checkoutBranch,
          startMerge,
        });
        await refresh();
      })();
    },
    [currentRepo, checkoutBranch, startMerge, refresh],
  );

  const drag = useGraphDragDrop({
    onMerge: handleMerge,
    onStartPullRequest: onStartPullRequest ?? (() => {}),
  });

  // Stable across renders (so memoized rows don't re-render) except while a drag
  // is changing the drop target.
  const pillHandlers: PillHandlers = useMemo(
    () => ({
      onPointerDown: drag.onPillPointerDown,
      onPointerEnter: drag.onPillPointerEnter,
      onPointerLeave: drag.onPillPointerLeave,
      isDropTarget: (name) => drag.dropTarget === name,
    }),
    [drag.onPillPointerDown, drag.onPillPointerEnter, drag.onPillPointerLeave, drag.dropTarget],
  );

  const handleRowClick = useCallback(
    (node: GraphNode, shiftKey: boolean) => {
      // Swallow the click that ends a drag so it doesn't also select.
      if (drag.consumeClick()) return;
      if (node.isWorkingTree) {
        // Highlight the uncommitted-changes row (and clear any commit selection)
        // so it reads as the current selection, then open the changes view.
        selectWorkingTree();
        onViewChanges?.();
        return;
      }
      // A stash node is a real commit (its `oid` is the stash commit); select it
      // like a commit so the detail panel shows its changes vs its base — i.e.
      // the stash commit diffed against its first parent (right-click still drives
      // the pop/rename/delete actions). Range-select doesn't apply to a stash.
      selectCommit(node.oid, node.isStash ? false : shiftKey);
      onCommitSelect?.();
    },
    [drag, selectCommit, selectWorkingTree, onViewChanges, onCommitSelect],
  );

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, node: GraphNode) => {
      e.preventDefault();
      // The working-tree and stash rows get their own menus; they aren't real
      // commits, so don't select them as one.
      if (!node.isWorkingTree && !node.isStash) {
        selectCommit(node.oid, false);
      }
      setMenu({ x: e.clientX, y: e.clientY, node });
    },
    [selectCommit],
  );

  const runStashOp = async (op: () => Promise<void>, success: string) => {
    try {
      await op();
      toastSuccess(success);
    } catch (e) {
      toastError(String(e));
    }
  };

  // Tag ops share the stash-style success/error toasting.
  const runTagOp = runStashOp;

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  const runBranchOp = async (op: () => Promise<void>) => {
    try {
      await op();
      await refresh();
    } catch (e) {
      // Surface failures (e.g. a checkout refused because it would overwrite
      // uncommitted changes) instead of swallowing them.
      toastError(String(e));
    }
  };

  const handlePushBranch = async (name: string) => {
    try {
      await pushBranch(undefined, name);
      toastSuccess(`Pushed ${name}`);
      await refresh();
    } catch (e) {
      toastError(String(e), { title: "Push failed" });
    }
  };

  const handleRevertCommit = async (oid: string, autoCommit: boolean) => {
    try {
      await revertCommit(oid, autoCommit);
      toastSuccess(autoCommit ? "Reverted commit" : "Reverted — changes are uncommitted");
    } catch (e) {
      toastError(String(e), { title: "Revert failed" });
    }
  };

  const commitUrl = (oid: string): string | null =>
    remoteInfo ? `https://${remoteInfo.host}/${remoteInfo.owner}/${remoteInfo.repo}/commit/${oid}` : null;

  const buildMenuItems = useCallback(
    (node: GraphNode): MenuItem[] => {
      // The uncommitted-changes row: offer to stash the working tree.
      if (node.isWorkingTree) {
        return [{ label: "Stash changes…", onSelect: () => setPrompt({ kind: "stash" }) }];
      }
      // A stash node: pop / rename / delete.
      if (node.isStash) {
        const index = node.stashIndex ?? 0;
        return [
          {
            label: "Pop stash",
            onSelect: () => runStashOp(() => stash.pop(index), "Popped stash"),
          },
          {
            label: "Rename stash…",
            onSelect: () => setPrompt({ kind: "rename-stash", index, current: node.summary }),
          },
          { separator: true },
          {
            label: "Delete stash",
            danger: true,
            onSelect: () => {
              if (window.confirm(`Delete stash "${node.summary}"?`)) {
                void runStashOp(() => stash.drop(index), "Deleted stash");
              }
            },
          },
        ];
      }
      const items: MenuItem[] = [
        { label: "Checkout this commit", onSelect: () => runBranchOp(() => checkoutCommit(node.oid)) },
        { separator: true },
        { label: "Copy commit hash", onSelect: () => copy(node.oid) },
        { label: "Copy short hash", onSelect: () => copy(node.shortOid) },
      ];
      const url = commitUrl(node.oid);
      if (url) {
        items.push({ label: "Copy link to commit", onSelect: () => copy(url) });
      }
      items.push(
        { separator: true },
        { label: "New branch here…", onSelect: () => setPrompt({ kind: "new-branch", oid: node.oid }) },
        { label: "Create tag here…", onSelect: () => setPrompt({ kind: "create-tag", oid: node.oid }) },
        { separator: true },
        { label: "Revert commit", onSelect: () => handleRevertCommit(node.oid, true) },
        {
          label: "Revert without committing",
          onSelect: () => handleRevertCommit(node.oid, false),
        },
      );

      const localBranches = node.branchLabels.filter((l) => !l.isRemote && !l.isTag);
      if (localBranches.length > 0) {
        items.push({ separator: true });
        for (const branch of localBranches) {
          const isCurrent = branch.name === currentRepo?.headBranch;
          if (!isCurrent) {
            items.push({
              label: `Checkout ${branch.name}`,
              onSelect: () => runBranchOp(() => checkoutBranch(branch.name)),
            });
          }
          items.push({
            label: `Push ${branch.name}`,
            onSelect: () => handlePushBranch(branch.name),
          });
          if (!isCurrent && operationStatus.kind !== "merge") {
            items.push({
              label: `Merge ${branch.name} into current`,
              onSelect: () => startMerge(branch.name),
            });
          }
          items.push({
            label: `Rename ${branch.name}…`,
            onSelect: () => setPrompt({ kind: "rename-branch", branch: branch.name }),
          });
          if (!isCurrent) {
            items.push({
              label: `Delete ${branch.name}`,
              danger: true,
              onSelect: () => {
                if (window.confirm(`Delete branch "${branch.name}"?`)) {
                  runBranchOp(() => deleteBranch(branch.name));
                }
              },
            });
          }
        }
      }

      const tags = node.branchLabels.filter((l) => l.isTag);
      if (tags.length > 0) {
        items.push({ separator: true });
        for (const tag of tags) {
          const onRemote = isTagOnRemote(tag.name);
          items.push({ label: `Copy tag name (${tag.name})`, onSelect: () => copy(tag.name) });
          // Only offer push when the tag isn't already on the remote.
          if (!onRemote) {
            items.push({
              label: `Push tag ${tag.name}`,
              onSelect: () => runTagOp(() => pushTag(tag.name), `Pushed tag ${tag.name}`),
            });
          }
          items.push({
            label: `Delete tag ${tag.name}`,
            danger: true,
            onSelect: () => setTagDelete({ name: tag.name, onRemote }),
          });
        }
      }
      return items;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutBranch, deleteBranch, checkoutCommit, remoteInfo, currentRepo, operationStatus.kind, startMerge, isTagOnRemote],
  );

  const handlePromptConfirm = async (value: string) => {
    const current = prompt;
    setPrompt(null);
    if (!current) return;
    if (current.kind === "new-branch") {
      await runBranchOp(async () => {
        await createBranch(value, current.oid);
        await checkoutBranch(value);
      });
    } else if (current.kind === "create-tag") {
      await runBranchOp(() => createTag(value, current.oid));
    } else if (current.kind === "stash") {
      await runStashOp(() => stash.create(value), "Stashed changes");
    } else if (current.kind === "rename-stash") {
      await runStashOp(() => stash.rename(current.index, value), "Renamed stash");
    } else {
      await runBranchOp(() => renameBranch(current.branch, value));
    }
  };

  useCommitGraph(canvasRef, viewport, selection, graphWidth, hoveredOid);

  const offset = viewport?.offset ?? 0;
  const totalHeight = (viewport?.totalCount ?? 0) * ROW_HEIGHT;
  const canvasTop = offset * ROW_HEIGHT;
  const sliceHeight = (viewport?.nodes.length ?? 0) * ROW_HEIGHT;

  // Position of the HEAD commit dot (when it's in the loaded slice), so a CSS
  // pulse overlay can draw expanding rings on it — a clear "you are here" cue.
  const headPulse = useMemo(() => {
    const nodes = viewport?.nodes ?? [];
    const idx = nodes.findIndex((n) => n.isHead && !n.isWorkingTree);
    if (idx < 0) return null;
    const laneWidth =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--graph-lane-width")) ||
      20;
    const x = branchWidth + GRAPH_PAD_LEFT + nodes[idx].lane * laneWidth + laneWidth / 2;
    const y = (offset + idx) * ROW_HEIGHT + ROW_HEIGHT / 2;
    return { x, y };
  }, [viewport, offset, branchWidth]);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--color-bg-app)" }}>
      {/* Column header */}
      <div
        role="row"
        style={{
          display: "flex",
          alignItems: "center",
          height: 28,
          flexShrink: 0,
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-panel)",
        }}
      >
        {COLUMNS.map((col) => (
          <div key={col.id} style={{ ...colStyle(col), ...headerCellStyle }}>
            {col.header}
          </div>
        ))}
      </div>

      {/* Draggable column dividers (full height, overlaid on the boundaries). */}
      <ResizeHandle
        ariaLabel="Resize branch column"
        onResize={(dx) => setBranchWidth((w) => w + dx)}
        style={{ position: "absolute", top: 0, bottom: 0, left: branchWidth - 3, zIndex: 5 }}
      />
      <ResizeHandle
        ariaLabel="Resize graph column"
        onResize={(dx) => setGraphWidth((w) => w + dx)}
        style={{ position: "absolute", top: 0, bottom: 0, left: branchWidth + graphWidth - 3, zIndex: 5 }}
      />

      {/* Scrollable rows */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }} onScroll={handleScroll}>
        {viewport === null ? (
          <GraphSkeleton
            branchWidth={branchWidth}
            graphWidth={graphWidth}
            rowCount={Math.ceil(window.innerHeight / ROW_HEIGHT)}
          />
        ) : (
        <div style={{ height: totalHeight, position: "relative" }}>
          {/* Canvas draws the graph column only */}
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              left: branchWidth,
              top: canvasTop,
              width: graphWidth,
              height: sliceHeight,
              pointerEvents: "none",
            }}
          />

          {viewport?.nodes.map((node, i) => (
            <GraphRow
              key={node.oid}
              node={node}
              rowIndex={offset + i}
              selected={selection.range.has(node.oid)}
              hovered={hoveredOid === node.oid}
              onRowHover={handleRowHover}
              branchWidth={branchWidth}
              graphWidth={graphWidth}
              currentBranch={currentRepo?.headBranch ?? null}
              isTagOnRemote={isTagOnRemote}
              pillHandlers={pillHandlers}
              onRowClick={handleRowClick}
              onRowContextMenu={handleRowContextMenu}
            />
          ))}
          {headPulse && (
            <span
              data-testid="head-pulse"
              className="graph-head-pulse"
              aria-hidden
              style={{ left: headPulse.x, top: headPulse.y }}
            />
          )}
        </div>
        )}
      </div>

      {/* Drag ghost following the cursor */}
      {drag.dragging && drag.dragSource && drag.ghostPos && (
        <div
          style={{
            position: "fixed",
            left: drag.ghostPos.x + 8,
            top: drag.ghostPos.y + 8,
            padding: "var(--space-1) var(--space-2)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-family-mono)",
            background: "var(--color-accent-primary)",
            color: "#fff",
            borderRadius: "var(--radius-sm)",
            pointerEvents: "none",
            zIndex: 150,
          }}
        >
          {drag.dragSource}
        </div>
      )}

      {drag.menu && (
        <MergeConfirmDialog
          source={drag.menu.source}
          target={drag.menu.target}
          onConfirm={drag.confirmMerge}
          onStartPullRequest={onStartPullRequest ? drag.confirmStartPullRequest : undefined}
          onCancel={drag.closeMenu}
        />
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={buildMenuItems(menu.node)} onClose={() => setMenu(null)} />
      )}

      {tagDelete && (
        <TagDeleteDialog
          name={tagDelete.name}
          onRemote={tagDelete.onRemote}
          onConfirm={(alsoRemote) => {
            const { name } = tagDelete;
            setTagDelete(null);
            void runTagOp(() => deleteTag(name, alsoRemote), `Deleted tag ${name}`);
          }}
          onCancel={() => setTagDelete(null)}
        />
      )}

      {prompt && (
        <PromptDialog
          title={
            prompt.kind === "rename-branch"
              ? "Rename branch"
              : prompt.kind === "create-tag"
                ? "New tag"
                : prompt.kind === "stash"
                  ? "Stash changes"
                  : prompt.kind === "rename-stash"
                    ? "Rename stash"
                    : "New branch"
          }
          label={
            prompt.kind === "create-tag"
              ? "Tag name"
              : prompt.kind === "stash" || prompt.kind === "rename-stash"
                ? "Stash name"
                : "Branch name"
          }
          initialValue={
            prompt.kind === "rename-branch"
              ? prompt.branch
              : prompt.kind === "rename-stash"
                ? prompt.current
                : ""
          }
          confirmLabel={
            prompt.kind === "rename-branch" || prompt.kind === "rename-stash"
              ? "Rename"
              : prompt.kind === "stash"
                ? "Stash"
                : "Create"
          }
          onConfirm={handlePromptConfirm}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}
