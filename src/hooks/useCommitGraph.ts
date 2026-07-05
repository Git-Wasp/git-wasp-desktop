import { useEffect, useRef, useState } from "react";
import type { GraphViewport } from "../types/graph";
import { THEME_CHANGE_EVENT } from "../lib/applyTheme";
import { useAvatarStore } from "../stores/avatarStore";

// Left padding inside the graph column so dots clear the branch|graph divider.
export const GRAPH_PAD_LEFT = 10;

interface Selection {
  anchor: string | null;
  focus: string | null;
  range: Set<string>;
}

interface GraphConfig {
  rowHeight: number;
  laneWidth: number;
  dotRadius: number;
  lineWidth: number;
}

function resolveCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function resolveLaneColors(): string[] {
  return Array.from({ length: 8 }, (_, i) => resolveCssVar(`--color-lane-${i}`));
}

function resolveConfig(): GraphConfig {
  const px = (v: string) => parseFloat(v) || 0;
  return {
    rowHeight: px(resolveCssVar("--graph-row-height")) || 34,
    laneWidth: px(resolveCssVar("--graph-lane-width")) || 20,
    dotRadius: px(resolveCssVar("--graph-dot-radius")) || 5,
    lineWidth: px(resolveCssVar("--graph-line-width")) || 2,
  };
}

/**
 * Renders the graph column only — lane lines, commit dots, the working-tree
 * marker, and the selection band. Branch labels and commit messages are DOM
 * columns rendered alongside the canvas (see CommitGraph). The canvas element
 * is positioned within the graph column, so x is measured from the column's
 * left edge (lane 0).
 */
export function useCommitGraph(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewport: GraphViewport | null,
  selection: Selection,
  // The canvas CSS width; a change must re-size the pixel buffer and redraw,
  // otherwise the browser stretches the stale bitmap and squashes the dots.
  width?: number,
  // The oid of the row under the pointer, for a subtle hover band in the graph
  // column (DOM cells are handled by GraphRow). Null when nothing is hovered.
  hoveredOid?: string | null,
  // "Focus current branch" mode: when true, commits/edges not on HEAD's line of
  // history are drawn greyed out (still visible) so the current branch stands out.
  focusCurrentBranch?: boolean,
): void {
  const configRef = useRef<GraphConfig | null>(null);
  const laneColorsRef = useRef<string[]>([]);
  const [themeTick, setThemeTick] = useState(0);
  // Redraw when avatars resolve so dots swap from colour to image.
  const avatarVersion = useAvatarStore((s) => s.version);

  // Resolve CSS tokens at mount and on theme change (tokens are read from CSS,
  // so a theme swap must re-resolve colours and redraw).
  useEffect(() => {
    configRef.current = resolveConfig();
    laneColorsRef.current = resolveLaneColors();

    const onThemeChange = () => {
      configRef.current = resolveConfig();
      laneColorsRef.current = resolveLaneColors();
      setThemeTick((t) => t + 1);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !viewport || !configRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { rowHeight, laneWidth, dotRadius, lineWidth } = configRef.current;
    const laneColors = laneColorsRef.current;
    const selectedBg = resolveCssVar("--color-bg-selected") || "rgba(77, 157, 224, 0.15)";
    const nodeBg = resolveCssVar("--color-graph-node-bg") || "rgba(255, 255, 255, 0.035)";
    const headRowBg = resolveCssVar("--color-graph-head-row-bg") || "rgba(77, 157, 224, 0.13)";
    const hoverBg = resolveCssVar("--color-bg-hover") || "rgba(255, 255, 255, 0.06)";
    const mutedColor = resolveCssVar("--color-graph-muted") || "#5b6270";
    const mutedAlpha = parseFloat(resolveCssVar("--graph-muted-opacity")) || 0.4;
    const dpr = window.devicePixelRatio || 1;

    // In focus mode, commits/edges off HEAD's line of history are greyed. These
    // resolve the effective colour (and, for dots, whether to dim) per element.
    const nodeColor = (node: GraphViewport["nodes"][number]): string => {
      const base = laneColors[node.colorIndex % 8] || "#4d9de0";
      return focusCurrentBranch && !node.onHeadLine ? mutedColor : base;
    };
    const nodeMuted = (node: GraphViewport["nodes"][number]): boolean =>
      !!focusCurrentBranch && !node.onHeadLine;

    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const laneX = (lane: number) => GRAPH_PAD_LEFT + lane * laneWidth + laneWidth / 2;

    // Drawn in ordered passes so layers never paint over each other: the row
    // bands (highlights / selection) form the background, then the connecting
    // edges, then the dots on top. Doing bands and edges in one per-node loop is
    // wrong — an edge descends into the *next* row's upper half, which a later
    // iteration's selection band would then paint over, clipping the top of the
    // line into a selected commit. Separate passes avoid that.

    // Pass 1 — row bands and the right-aligned accent line.
    // row 0 here corresponds to viewport.offset in the full graph.
    viewport.nodes.forEach((node, localRow) => {
      const rowTop = localRow * rowHeight;
      const color = nodeColor(node);

      // Per-commit highlight band behind the row.
      if (!node.isWorkingTree) {
        ctx.fillStyle = nodeBg;
        ctx.fillRect(0, rowTop + 1, cssW, rowHeight - 2);
      }

      // Stronger row band by priority — selection > hover > HEAD (matches the
      // DOM cell background in GraphRow). A subtle hover band cues the row the
      // pointer is over; the base nodeBg above stays underneath.
      const isSelected = selection.range.has(node.oid);
      const isHovered = !isSelected && hoveredOid != null && node.oid === hoveredOid;
      if (isHovered && !node.isWorkingTree) {
        ctx.fillStyle = hoverBg;
        ctx.fillRect(0, rowTop, cssW, rowHeight);
      } else if (node.isHead && !node.isWorkingTree && !isSelected) {
        ctx.fillStyle = headRowBg;
        ctx.fillRect(0, rowTop, cssW, rowHeight);
      }

      // Selection band (graph-column portion; the DOM cells match it).
      if (isSelected) {
        ctx.fillStyle = selectedBg;
        ctx.fillRect(0, rowTop, cssW, rowHeight);
      }

      // Right-edge marker in the commit's lane colour, drawn on top of the bands
      // so it reads clearly even when the row is selected. Normally a strong
      // vertical accent line; for the checked-out commit (HEAD) it's a
      // left-pointing triangle, so the current commit stands out even when other
      // branches sit several commits ahead.
      if (!node.isWorkingTree) {
        ctx.fillStyle = color;
        if (node.isHead) {
          const yMid = rowTop + rowHeight / 2;
          const w = 8;
          const h = 7;
          ctx.beginPath();
          ctx.moveTo(cssW, yMid - h);
          ctx.lineTo(cssW, yMid + h);
          ctx.lineTo(cssW - w, yMid);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(cssW - 3, rowTop + 5, 3, rowHeight - 10);
        }
      }
    });

    // Pass 2 — edges, on top of every band so connecting lines stay unbroken
    // across selected rows. Edges connect this row's dot centre to the next
    // row's centre (an edge spans the lower half of this row and the upper half
    // of the next).
    viewport.nodes.forEach((node, localRow) => {
      const yMid = localRow * rowHeight + rowHeight / 2;
      const yNext = yMid + rowHeight;
      node.edges.forEach((edge) => {
        // Stash edges are drawn dotted and muted; real history edges are solid.
        // In focus mode, edges off HEAD's line are greyed to match their commits.
        const isStashEdge = edge.kind === "Stash";
        ctx.strokeStyle = isStashEdge
          ? resolveCssVar("--color-text-muted") || "#8a8a8a"
          : focusCurrentBranch && !edge.onHeadLine
            ? mutedColor
            : laneColors[edge.colorIndex % 8] || "#4d9de0";
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(isStashEdge ? [3, 3] : []);
        ctx.beginPath();
        const srcX = laneX(edge.srcLane);
        const dstX = laneX(edge.dstLane);
        if (srcX === dstX) {
          ctx.moveTo(srcX, yMid);
          ctx.lineTo(srcX, yNext);
        } else {
          ctx.moveTo(srcX, yMid);
          ctx.bezierCurveTo(srcX, yMid + rowHeight * 0.5, dstX, yNext - rowHeight * 0.5, dstX, yNext);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);
    });

    // Working-tree connector — a dotted line from the uncommitted-changes node
    // (always at the top, row 0) straight down its lane to the HEAD dot, which
    // may be several rows below when other branches are ahead of HEAD. Dotted
    // (not solid) since it's provisional, uncommitted work; drawn in the WIP
    // marker's warning colour so the association reads clearly. Falls back to
    // HEAD's absolute row (clamped to the loaded slice) when HEAD isn't in view.
    const wtIdx = viewport.nodes.findIndex((n) => n.isWorkingTree);
    if (wtIdx >= 0) {
      const wt = viewport.nodes[wtIdx];
      const headIdx = viewport.nodes.findIndex((n) => n.isHead && !n.isWorkingTree);
      const localHeadRow =
        headIdx >= 0
          ? headIdx
          : viewport.headRow != null
            ? Math.min(viewport.headRow - viewport.offset, viewport.nodes.length)
            : null;
      if (localHeadRow != null && localHeadRow > wtIdx) {
        const x = laneX(wt.lane);
        const yTop = wtIdx * rowHeight + rowHeight / 2;
        const yBottom = localHeadRow * rowHeight + rowHeight / 2;
        ctx.strokeStyle = resolveCssVar("--color-warning") || "#ff9f0a";
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, yBottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Pass 3 — dots and the working-tree marker, on top of the edges.
    viewport.nodes.forEach((node, localRow) => {
      const y = localRow * rowHeight + rowHeight / 2;
      const x = laneX(node.lane);
      const color = nodeColor(node);
      // Off-line commit dots (and their avatars) are dimmed in focus mode. Set
      // once here and restored at the end of this node's drawing.
      const muted = nodeMuted(node);
      if (muted) ctx.globalAlpha = mutedAlpha;

      // Working-tree node: a hollow dashed marker (label lives in the DOM cell).
      if (node.isWorkingTree) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = resolveCssVar("--color-warning") || "#ff9f0a";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        return;
      }

      // Stash node: a hollow dashed diamond so it reads distinctly from commits.
      if (node.isStash) {
        const r = dotRadius + 1;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = resolveCssVar("--color-text-muted") || "#8a8a8a";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        return;
      }

      // Commit dot — the author's gravatar (clipped to a circle) when resolved,
      // otherwise the lane-coloured dot as a fallback. Either way a ring gives
      // it definition and marks HEAD.
      const avatar = useAvatarStore.getState().getImage(node.authorEmail);
      if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.strokeStyle = node.isHead ? "#ffffff" : color;
        ctx.lineWidth = node.isHead ? 1.5 : 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (node.isHead) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    });
  }, [viewport, selection, canvasRef, themeTick, width, avatarVersion, hoveredOid, focusCurrentBranch]);
}
