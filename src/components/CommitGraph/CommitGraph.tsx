import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGraphStore, type SelectMode } from "../../stores/graphStore";
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
import { SquashDialog } from "./SquashDialog";
import { buildSquashPlan, commitFullMessage } from "./squash";
import { GraphSearch } from "./GraphSearch";
import { GraphSkeleton } from "./GraphSkeleton";
import { AuthorCell, BranchCell, DateCell, HashCell, MessageCell } from "./columns";
import {
  columnsForVariant,
  COLUMN_META,
  type ColumnKind,
  type DataColumn,
  type GraphColumn,
  type PillHandlers,
} from "./columnModel";
import type { CSSProperties } from "react";
import type { GraphNode } from "../../types/graph";
import { GRAPH_DENSITY, type BodyPlacement } from "../../lib/graphDensity";

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

// Resolved, resizable widths keyed by column kind.
export type ColWidths = Partial<Record<GraphColumn["kind"], number>>;

// Flex style for a cell: fixed to its (resizable) width, never shrinking below
// it — that fixed floor is what drives the horizontal scroll when the pane is
// narrow. A trailing filler (rendered separately) absorbs any leftover width.
function cellFlex(col: GraphColumn, widths: ColWidths): CSSProperties {
  const w = widths[col.kind] ?? COLUMN_META[col.kind].defaultWidth;
  return { flex: `0 0 ${w}px`, minWidth: 0 };
}

/**
 * A single graph row, laid out as the variant's ordered columns. The graph
 * column is an empty spacer the (frozen) canvas paints over; every other column
 * renders its cell. Memoized and keyed by commit oid so that, when only the
 * selection changes, just the rows whose `selected` flips re-render — not the
 * whole list.
 */
const GraphRow = memo(function GraphRow({
  node,
  rowIndex,
  selected,
  hovered,
  matched,
  muted,
  onRowHover,
  columns,
  widths,
  currentBranch,
  isTagOnRemote,
  pillHandlers,
  onRowClick,
  onRowContextMenu,
  graphOnRight,
  rowHeight,
  bodyPlacement,
}: {
  node: GraphNode;
  rowIndex: number;
  selected: boolean;
  columns: GraphColumn[];
  widths: ColWidths;
  graphOnRight: boolean;
  rowHeight: number;
  bodyPlacement: BodyPlacement;
  currentBranch: string | null;
  isTagOnRemote: (name: string) => boolean;
  pillHandlers: PillHandlers;
  onRowClick: (node: GraphNode, mods: { shift: boolean; toggle: boolean }) => void;
  onRowContextMenu: (e: React.MouseEvent, node: GraphNode) => void;
  hovered: boolean;
  // Highlight the row as a search match (a warm band behind the cells).
  matched: boolean;
  // Dim the cells when this commit is off the focused branch's line of history
  // (focus mode) or is a non-match during a search. The row stays interactive.
  muted: boolean;
  onRowHover: (oid: string | null) => void;
}) {
  // The checked-out (HEAD) commit's row keeps a permanent muted band so it's
  // obvious which commit is current; hover shows a subtle highlight, and an
  // actual selection takes over with the normal highlight. (The canvas paints
  // the matching band for the graph column.) Priority: selected > hover > HEAD.
  const isHeadRow = node.isHead && !node.isWorkingTree;
  // Priority matches the canvas band (useCommitGraph): selection > search match >
  // hover > HEAD.
  const cellBg = selected
    ? "var(--color-bg-selected)"
    : matched
      ? "var(--color-graph-match)"
      : hovered
        ? "var(--color-bg-hover)"
        : isHeadRow
          ? "var(--color-graph-head-row-bg)"
          : "transparent";

  const renderCell = (col: GraphColumn) => {
    switch (col.kind) {
      case "commit":
        return <MessageCell node={node} bodyPlacement={bodyPlacement} />;
      case "author":
        return <AuthorCell node={node} />;
      case "branch":
        return (
          <BranchCell
            node={node}
            handlers={pillHandlers}
            currentBranch={currentBranch}
            isTagOnRemote={isTagOnRemote}
          />
        );
      case "hash":
        return <HashCell node={node} />;
      case "date":
        return <DateCell node={node} />;
      default:
        return null;
    }
  };

  return (
    <div
      data-oid={node.oid}
      data-head-row={isHeadRow ? "true" : undefined}
      data-muted={muted ? "true" : undefined}
      onClick={(e) => onRowClick(node, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      onContextMenu={(e) => onRowContextMenu(e, node)}
      onMouseEnter={() => onRowHover(node.oid)}
      onMouseLeave={() => onRowHover(null)}
      style={{
        position: "absolute",
        top: rowIndex * rowHeight,
        left: 0,
        right: 0,
        height: rowHeight,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        // Hairline separator between rows (data-column half; the canvas draws the
        // matching line across the graph column). box-sizing: border-box keeps
        // the row height fixed, so this can't drift row geometry off the canvas.
        borderBottom: "1px solid var(--color-graph-row-divider)",
      }}
    >
      {columns.flatMap((col) => {
        // A flexible filler carries the row background across any leftover width
        // so the highlight spans the full row. It sits after the data columns
        // and before the (edge-frozen) graph — i.e. just before the graph cell
        // in Split Rail, or at the very end in Ledger Grid.
        const filler = (
          <div
            key="filler"
            data-cell="filler"
            style={{ flex: "1 1 0", minWidth: 0, height: "100%", background: cellBg }}
          />
        );
        if (col.kind === "graph") {
          // Graph gap — the frozen canvas paints over this (it draws its own
          // bands), so the spacer just reserves the column's width.
          const graphCell = (
            <div key={col.id} data-cell="graph" style={{ ...cellFlex(col, widths), height: "100%" }} />
          );
          return graphOnRight ? [filler, graphCell] : [graphCell];
        }
        return [
          <div
            key={col.id}
            data-cell={col.kind}
            className={muted ? "graph-row-muted" : undefined}
            style={{
              ...cellFlex(col, widths),
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: col.align === "end" ? "flex-end" : "flex-start",
              padding: "0 var(--space-3)",
              background: cellBg,
            }}
          >
            {renderCell(col)}
          </div>,
        ];
      })}
      {!graphOnRight && (
        <div data-cell="filler" style={{ flex: "1 1 0", minWidth: 0, height: "100%", background: cellBg }} />
      )}
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
  const focusCurrentBranch = useGraphStore((s) => s.focusCurrentBranch);
  const searchOpen = useGraphStore((s) => s.searchOpen);
  const searchQuery = useGraphStore((s) => s.searchQuery);
  const searchMatchOids = useGraphStore((s) => s.searchMatchOids);
  const openSearch = useGraphStore((s) => s.openSearch);
  // Dim non-matching commits only once there's a query with results to compare
  // against — an open-but-empty search box shouldn't grey the whole graph.
  const searchActive = searchOpen && searchQuery.trim().length > 0;
  const graphVariant = useGraphStore((s) => s.graphVariant);
  // Row-density preset drives the row height / dot radius (canvas + DOM share
  // these) and where the commit body line goes (below / beside / hidden).
  const graphDensity = useGraphStore((s) => s.graphDensity);
  const { rowHeight, dotRadius, bodyPlacement } = GRAPH_DENSITY[graphDensity];
  const {
    currentRepo,
    createBranch,
    checkoutBranch,
    renameBranch,
    deleteBranch,
    checkoutCommit,
    createTag,
    revertCommit,
    squashCommits,
    fastForwardBranch,
    listFastForwardableBranches,
  } = useRepoStore();
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
  // Local branches that could be fast-forwarded to the right-clicked commit,
  // fetched from the backend when the menu opens so we only offer valid moves.
  const [ffBranches, setFfBranches] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [squash, setSquash] = useState<{ oids: string[]; message: string } | null>(null);
  const [tagDelete, setTagDelete] = useState<{ name: string; onRemote: boolean } | null>(null);
  // The row the pointer is over, for a subtle hover highlight. Stable setter, so
  // memoized rows only re-render when their own hovered flag flips.
  const [hoveredOid, setHoveredOid] = useState<string | null>(null);
  const handleRowHover = useCallback((oid: string | null) => setHoveredOid(oid), []);

  const visibleColumns = useGraphStore((s) => s.visibleColumns);
  const columnOrder = useGraphStore((s) => s.columnOrder);
  // The ordered, visible columns for the active layout variant (Ledger Grid vs
  // Split Rail). Stable per input so memoized rows don't churn on every render.
  const columns = useMemo(
    () => columnsForVariant(graphVariant, visibleColumns, columnOrder[graphVariant]),
    [graphVariant, visibleColumns, columnOrder],
  );
  // Split Rail anchors the graph to the right edge; Ledger Grid to the left.
  const graphOnRight = graphVariant === "split";

  // Resizable, persisted per-column widths — every column is resizable. Hooks
  // are called in a fixed order (one per kind) so they stay stable across
  // renders. The commit column simply starts wider.
  const [graphWidth, setGraphWidth] = usePersistedWidth("graphCol:graph", COLUMN_META.graph.defaultWidth, COLUMN_META.graph.minWidth, 600);
  const [commitWidth, setCommitWidth] = usePersistedWidth("graphCol:commit", COLUMN_META.commit.defaultWidth, COLUMN_META.commit.minWidth, 900);
  const [authorWidth, setAuthorWidth] = usePersistedWidth("graphCol:author", COLUMN_META.author.defaultWidth, COLUMN_META.author.minWidth, 600);
  const [branchWidth, setBranchWidth] = usePersistedWidth("graphCol:branch", COLUMN_META.branch.defaultWidth, COLUMN_META.branch.minWidth, 600);
  const [hashWidth, setHashWidth] = usePersistedWidth("graphCol:hash", COLUMN_META.hash.defaultWidth, COLUMN_META.hash.minWidth, 600);
  const [dateWidth, setDateWidth] = usePersistedWidth("graphCol:date", COLUMN_META.date.defaultWidth, COLUMN_META.date.minWidth, 600);

  // Memoized so the object identity only changes when a width actually changes —
  // a hover/selection change must not force every row to re-render.
  const widths: ColWidths = useMemo(
    () => ({ graph: graphWidth, commit: commitWidth, author: authorWidth, branch: branchWidth, hash: hashWidth, date: dateWidth }),
    [graphWidth, commitWidth, authorWidth, branchWidth, hashWidth, dateWidth],
  );
  const widthSetters: Record<string, (fn: (w: number) => number) => void> = {
    graph: setGraphWidth,
    commit: setCommitWidth,
    author: setAuthorWidth,
    branch: setBranchWidth,
    hash: setHashWidth,
    date: setDateWidth,
  };
  const widthOf = (kind: ColumnKind): number => widths[kind] ?? COLUMN_META[kind].defaultWidth;

  // The graph column stays frozen (canvas-painted, always visible); the data
  // columns scroll horizontally "after" it. `dataMinWidth` is the floor of all
  // data columns combined — when the pane is narrower than graph + this, a
  // horizontal scrollbar appears rather than the commit column collapsing.
  const dataMinWidth = columns
    .filter((c) => c.kind !== "graph")
    .reduce((sum, c) => sum + widthOf(c.kind), 0);
  const contentMinWidth = graphWidth + dataMinWidth;

  // The frozen graph (canvas + HEAD pulse) is pinned by CSS `position: sticky`,
  // so the compositor keeps it glued to its edge without a per-frame JS write
  // (which used to lag the scroll and made the graph appear to vibrate). Only
  // the header's data area still needs a scroll-position mirror.
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const syncHeaderScroll = useCallback(() => {
    const sc = containerRef.current;
    if (sc && headerScrollRef.current) headerScrollRef.current.scrollLeft = sc.scrollLeft;
  }, []);

  // Initial load.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const limit = Math.ceil(container.clientHeight / rowHeight) + BUFFER_ROWS * 2;
    fetchViewport(0, limit);
  }, [fetchViewport, rowHeight]);

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
      // Mirror the horizontal scroll onto the header's data area (the graph is
      // pinned by CSS sticky, so it needs no JS).
      syncHeaderScroll();
      pendingScroll.current = {
        scrollTop: e.currentTarget.scrollTop,
        clientHeight: e.currentTarget.clientHeight,
      };
      if (scrollRaf.current !== null) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        const m = pendingScroll.current;
        if (!m) return;
        const offset = Math.max(0, Math.floor(m.scrollTop / rowHeight) - BUFFER_ROWS);
        const limit = Math.ceil(m.clientHeight / rowHeight) + BUFFER_ROWS * 2;

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
    [fetchViewport, syncHeaderScroll, rowHeight],
  );

  useEffect(() => {
    return () => {
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  // Keep the header's data scroll aligned with the body after any layout change
  // (variant, widths, visibility, a new slice) — the graph itself is CSS-sticky.
  useLayoutEffect(() => {
    syncHeaderScroll();
  }, [syncHeaderScroll, columns, widths, viewport]);

  // Scroll a revealed commit (a branch head clicked in the sidebar) into view,
  // centring it, then load the slice around it. Consumes the pending row.
  useEffect(() => {
    if (scrollToRow === null) return;
    const container = containerRef.current;
    if (!container) return;
    const target = Math.max(0, scrollToRow * rowHeight - container.clientHeight / 2);
    container.scrollTop = target;
    const offset = Math.max(0, Math.floor(target / rowHeight) - BUFFER_ROWS);
    const limit = Math.ceil(container.clientHeight / rowHeight) + BUFFER_ROWS * 2;
    fetchViewport(offset, limit);
    useGraphStore.setState({ scrollToRow: null });
  }, [scrollToRow, fetchViewport, rowHeight]);

  // ⌘/Ctrl+F opens the graph search. Only mounted with the graph view, so it
  // won't fire while a diff editor has the panel.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

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
    (node: GraphNode, mods: { shift: boolean; toggle: boolean }) => {
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
      // the pop/rename/delete actions). Range/toggle-select don't apply to a stash.
      const mode: SelectMode = node.isStash
        ? "replace"
        : mods.toggle
          ? "toggle"
          : mods.shift
            ? "range"
            : "replace";
      selectCommit(node.oid, mode);
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
        // Right-clicking a commit that's already part of a multi-commit
        // selection keeps that selection (so "Squash N commits" stays offered);
        // otherwise it collapses to just this commit.
        const inMultiSelection = selection.range.size > 1 && selection.range.has(node.oid);
        if (!inMultiSelection) {
          selectCommit(node.oid, "replace");
        }
        // Resolve which branches can fast-forward to this commit; the menu items
        // appear once it lands (clears first so a stale list can't linger).
        setFfBranches([]);
        listFastForwardableBranches(node.oid).then(setFfBranches).catch(() => setFfBranches([]));
      } else {
        setFfBranches([]);
      }
      setMenu({ x: e.clientX, y: e.clientY, node });
    },
    [selectCommit, listFastForwardableBranches, selection.range],
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

  const runSquash = async (message: string) => {
    if (!squash) return;
    const count = squash.oids.length;
    await squashCommits(squash.oids, message);
    setSquash(null);
    setMenu(null);
    toastSuccess(`Squashed ${count} commits into one`);
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
      ];

      // When this commit is part of a multi-commit selection, offer to squash the
      // run into one. The backend enforces the real constraints (contiguous,
      // unpushed, includes the branch tip) and reports a clear error otherwise.
      if (viewport && selection.range.size > 1 && selection.range.has(node.oid)) {
        const plan = buildSquashPlan(viewport.nodes, selection.range);
        if (plan) {
          items.push({
            label: `Squash ${plan.oids.length} commits…`,
            onSelect: () => setSquash(plan),
          });
        }
      }

      items.push(
        { separator: true },
        { label: "Copy commit hash", onSelect: () => copy(node.oid) },
        { label: "Copy short hash", onSelect: () => copy(node.shortOid) },
        { label: "Copy message", onSelect: () => copy(commitFullMessage(node)) },
      );
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

      // Fast-forward any local branch that this commit descends from — the way to
      // advance e.g. `main` onto a commit (including a detached-HEAD commit)
      // without checking that branch out first.
      if (ffBranches.length > 0) {
        items.push({ separator: true });
        for (const branch of ffBranches) {
          items.push({
            label: `Fast-forward ${branch} to here`,
            onSelect: () => runBranchOp(() => fastForwardBranch(branch, node.oid)),
          });
        }
      }

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
    [checkoutBranch, deleteBranch, checkoutCommit, remoteInfo, currentRepo, operationStatus.kind, startMerge, isTagOnRemote, ffBranches, fastForwardBranch, viewport, selection.range],
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

  useCommitGraph(canvasRef, viewport, selection, graphWidth, hoveredOid, focusCurrentBranch, rowHeight, dotRadius, searchActive, searchMatchOids);

  const offset = viewport?.offset ?? 0;
  const totalHeight = (viewport?.totalCount ?? 0) * rowHeight;
  const canvasTop = offset * rowHeight;
  const sliceHeight = (viewport?.nodes.length ?? 0) * rowHeight;

  // Position of the HEAD commit dot (when it's in the loaded slice), so a CSS
  // pulse overlay can draw expanding rings on it — a clear "you are here" cue.
  // The pulse lives inside the CSS-sticky graph wrapper, so its coordinates are
  // local to the graph column (x from the column's own left edge).
  const headPulse = useMemo(() => {
    const nodes = viewport?.nodes ?? [];
    const idx = nodes.findIndex((n) => n.isHead && !n.isWorkingTree);
    if (idx < 0) return null;
    const laneWidth =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--graph-lane-width")) ||
      24;
    const x = GRAPH_PAD_LEFT + nodes[idx].lane * laneWidth + laneWidth / 2;
    const y = (offset + idx) * rowHeight + rowHeight / 2;
    return { x, y };
  }, [viewport, offset, rowHeight]);

  const dataColumns = columns.filter((c) => c.kind !== "graph");

  // Drag-to-reorder the data columns from their headers. Pointer-based (like the
  // branch-pill drag) rather than the HTML5 drag API, which Tauri's webview
  // intercepts for OS file drops. `dragCol` is the column being dragged;
  // `dropCol` is the header it's hovering (a "drop before" target).
  const [dragCol, setDragCol] = useState<ColumnKind | null>(null);
  const [dropCol, setDropCol] = useState<ColumnKind | null>(null);
  const dragCandidate = useRef<{ kind: ColumnKind; startX: number; startY: number } | null>(null);
  const draggingRef = useRef(false);
  const dropRef = useRef<ColumnKind | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent, kind: ColumnKind) => {
    dragCandidate.current = { kind, startX: e.clientX, startY: e.clientY };
  };
  const onHeaderPointerEnter = (kind: ColumnKind) => {
    if (!draggingRef.current || dragCandidate.current?.kind === kind) return;
    dropRef.current = kind;
    setDropCol(kind);
  };
  const onHeaderPointerLeave = (kind: ColumnKind) => {
    if (draggingRef.current && dropRef.current === kind) {
      dropRef.current = null;
      setDropCol(null);
    }
  };

  // Window-level pointer move/up drive the drag once the press passes a small
  // threshold. Stable listeners (empty deps) reading refs + the store, so an
  // in-flight drag survives re-renders (mirrors useGraphDragDrop).
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const c = dragCandidate.current;
      if (!c || draggingRef.current) return;
      if (Math.hypot(e.clientX - c.startX, e.clientY - c.startY) <= 4) return;
      draggingRef.current = true;
      setDragCol(c.kind);
      document.body.classList.add("dragging-column");
      window.getSelection?.()?.removeAllRanges();
    };
    const up = () => {
      const c = dragCandidate.current;
      if (c && draggingRef.current && dropRef.current && dropRef.current !== c.kind) {
        const st = useGraphStore.getState();
        const variant = st.graphVariant;
        const arr = [...st.columnOrder[variant]];
        const fromIdx = arr.indexOf(c.kind as DataColumn);
        const toIdx = arr.indexOf(dropRef.current as DataColumn);
        if (fromIdx >= 0 && toIdx >= 0) {
          arr.splice(fromIdx, 1);
          arr.splice(arr.indexOf(dropRef.current as DataColumn), 0, c.kind as DataColumn);
          st.setColumnOrder(variant, arr);
        }
      }
      dragCandidate.current = null;
      draggingRef.current = false;
      dropRef.current = null;
      document.body.classList.remove("dragging-column");
      setDragCol(null);
      setDropCol(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging-column");
    };
  }, []);

  // A frozen graph-column header cell (empty label) carrying the graph resize
  // grip on its inner edge (right in Ledger Grid, left in Split Rail).
  const graphHeaderCell = (
    <div style={{ position: "relative", flex: `0 0 ${graphWidth}px`, height: "100%" }}>
      <ResizeHandle
        ariaLabel="Resize graph column"
        onResize={(dx) => setGraphWidth((w) => (graphOnRight ? w - dx : w + dx))}
        style={{ position: "absolute", top: 0, bottom: 0, [graphOnRight ? "left" : "right"]: -2 }}
      />
    </div>
  );

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--color-graph-bg, var(--color-bg-app))", userSelect: "none", WebkitUserSelect: "none" }}>
      {searchOpen && <GraphSearch />}
      {/* Column header. The graph header cell is frozen; the data header cells
          live in a clip that mirrors the body's horizontal scroll. */}
      <div
        role="row"
        style={{
          display: "flex",
          alignItems: "stretch",
          height: 28,
          flexShrink: 0,
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-panel)",
        }}
      >
        {!graphOnRight && graphHeaderCell}
        <div ref={headerScrollRef} style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden" }}>
          <div style={{ display: "flex", height: "100%", width: "100%", minWidth: dataMinWidth }}>
            {dataColumns.map((col) => {
              const isDropTarget = dropCol === col.kind && dragCol !== null && dragCol !== col.kind;
              return (
                <div
                  key={col.id}
                  data-header={col.kind}
                  onPointerEnter={() => onHeaderPointerEnter(col.kind)}
                  onPointerLeave={() => onHeaderPointerLeave(col.kind)}
                  style={{
                    ...cellFlex(col, widths),
                    position: "relative",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: col.align === "end" ? "flex-end" : "flex-start",
                    opacity: dragCol === col.kind ? 0.4 : 1,
                    boxShadow: isDropTarget ? "inset 2px 0 0 var(--color-accent-primary)" : undefined,
                  }}
                >
                  {/* Only the label is the drag handle, so dragging the right-edge
                      grip resizes instead of starting a reorder. */}
                  <span
                    onPointerDown={(e) => onHeaderPointerDown(e, col.kind)}
                    style={{ ...headerCellStyle, cursor: "grab" }}
                  >
                    {col.header}
                  </span>
                  {COLUMN_META[col.kind].resizable && (
                    <ResizeHandle
                      ariaLabel={`Resize ${col.kind} column`}
                      onResize={(dx) => widthSetters[col.kind]?.((w) => w + dx)}
                      style={{ position: "absolute", top: 0, bottom: 0, right: -2 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {graphOnRight && graphHeaderCell}
      </div>

      {/* Scrollable rows — vertical (virtualised) and horizontal (data columns,
          with the graph column frozen). */}
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        onScroll={handleScroll}
      >
        {viewport === null ? (
          <GraphSkeleton
            graphWidth={graphWidth}
            graphOnRight={graphOnRight}
            rowCount={Math.ceil(window.innerHeight / rowHeight)}
            rowHeight={rowHeight}
          />
        ) : (
        <div style={{ height: totalHeight, minWidth: contentMinWidth, position: "relative" }}>
          {viewport?.nodes.map((node, i) => (
            <GraphRow
              key={node.oid}
              node={node}
              rowIndex={offset + i}
              selected={selection.range.has(node.oid)}
              hovered={hoveredOid === node.oid}
              matched={searchActive && searchMatchOids.has(node.oid)}
              muted={(focusCurrentBranch && !node.onHeadLine) || (searchActive && !searchMatchOids.has(node.oid))}
              onRowHover={handleRowHover}
              columns={columns}
              widths={widths}
              graphOnRight={graphOnRight}
              currentBranch={currentRepo?.headBranch ?? null}
              isTagOnRemote={isTagOnRemote}
              pillHandlers={pillHandlers}
              onRowClick={handleRowClick}
              onRowContextMenu={handleRowContextMenu}
              rowHeight={rowHeight}
              bodyPlacement={bodyPlacement}
            />
          ))}

          {/* Frozen graph column. `position: sticky` (horizontal only — no top
              inset, so it still scrolls vertically) lets the compositor keep it
              glued to its edge as the data columns scroll, with no per-frame JS —
              which is what removes the visible "vibration" on horizontal scroll.
              It's opaque and above the rows, so data scrolls underneath it, and
              pointer-events:none lets row clicks/hover pass through. */}
          <div
            style={{
              position: "sticky",
              [graphOnRight ? "right" : "left"]: 0,
              // `sticky` only pulls the box back when it would scroll out of view;
              // it does not right-align a box whose in-flow position is the left
              // edge. The rows are absolutely positioned, so this overlay is the
              // only in-flow child — `marginLeft: auto` right-aligns its natural
              // position in Split Rail so `right: 0` keeps it pinned to the right.
              marginLeft: graphOnRight ? "auto" : undefined,
              width: graphWidth,
              height: totalHeight,
              zIndex: 3,
              pointerEvents: "none",
              background: "var(--color-graph-bg, var(--color-bg-app))",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                left: 0,
                top: canvasTop,
                width: graphWidth,
                height: sliceHeight,
              }}
            />
            {headPulse && (
              <span
                // Keyed on density: the ring is CSS-animated (`transform:
                // translate(-50%,-50%)`, expanding via keyframes), and a density
                // switch changes its box size (dotRadius) mid-animation. Restyling
                // the same node leaves the running animation centred against its
                // previous size; a fresh element re-centres cleanly.
                key={graphDensity}
                data-testid="head-pulse"
                className="graph-head-pulse"
                aria-hidden
                style={{ left: headPulse.x, top: headPulse.y, width: dotRadius * 2, height: dotRadius * 2 }}
              />
            )}
          </div>
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
            color: "var(--color-text-on-accent)",
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

      {squash && (
        <SquashDialog
          count={squash.oids.length}
          initialMessage={squash.message}
          onConfirm={runSquash}
          onCancel={() => setSquash(null)}
        />
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
