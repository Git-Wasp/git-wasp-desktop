import { useEffect, useRef, useState } from "react";
import type { GraphViewport } from "../types/graph";
import { THEME_CHANGE_EVENT } from "../lib/applyTheme";
import { useAvatarStore } from "../stores/avatarStore";
import { initials } from "../lib/initials";

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
    // Hairline divider between rows (graph-column half; the DOM row draws the
    // matching border across the data columns) — cues individual commits.
    const rowDivider = resolveCssVar("--color-graph-row-divider") || "rgba(255, 255, 255, 0.06)";
    // Page background: painted as a "cutout" ring around each dot so crossing
    // lane lines never visibly pierce the marker. Accent: the dashed selection
    // ring. Sans stack: canvas text for the commit-dot initials fallback.
    const pageBg =
      resolveCssVar("--color-graph-bg") || resolveCssVar("--color-bg-app") || "#141510";
    const selectionAccent = resolveCssVar("--color-accent-primary") || "#4d9de0";
    const sansFont = resolveCssVar("--font-family-sans") || "sans-serif";
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
    // Paint an opaque page-coloured base rather than clearing to transparent:
    // the graph column is frozen while the data columns scroll horizontally
    // beneath it, so the canvas must fully mask whatever slides underneath.
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, cssW, cssH);

    const laneX = (lane: number) => GRAPH_PAD_LEFT + lane * laneWidth + laneWidth / 2;

    // Drawn in ordered passes so layers never paint over each other: the row
    // bands (highlights / selection) form the background, then the connecting
    // edges, then the dots on top. Doing bands and edges in one per-node loop is
    // wrong — an edge descends into the *next* row's upper half, which a later
    // iteration's selection band would then paint over, clipping the top of the
    // line into a selected commit. Separate passes avoid that.

    // Pass 1 — row bands. The "current commit" cue is carried both by the
    // lane-coloured ring around the HEAD dot (pass 3) and by an accent border
    // down the inner (right) edge of the graph background on the checked-out
    // commit's row, added here. row 0 here corresponds to viewport.offset.
    viewport.nodes.forEach((node, localRow) => {
      const rowTop = localRow * rowHeight;

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

      // Accent border down the inner edge of the graph background, only on the
      // currently checked-out (HEAD) commit's row — a clear "you are here" edge.
      if (node.isHead && !node.isWorkingTree) {
        ctx.fillStyle = nodeColor(node);
        ctx.fillRect(cssW - 2, rowTop, 2, rowHeight);
      }

      // Hairline row divider at the bottom edge (a single line between rows, so
      // adjacent rows never double it up). Drawn before edges/dots so the lane
      // lines and markers stay on top.
      ctx.fillStyle = rowDivider;
      ctx.fillRect(0, rowTop + rowHeight - 1, cssW, 1);
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

      // Working-tree node: a hollow dashed marker in the lane colour (its label
      // lives in the DOM cell). Filled with the page colour so lane lines don't
      // show through the hollow centre.
      if (node.isWorkingTree) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = pageBg;
        ctx.fill();
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = color;
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

      // Background "cutout" ring straddling the dot edge, so lane lines crossing
      // the row never visibly pierce the marker.
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.strokeStyle = pageBg;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Marker body — the author's gravatar (clipped to a circle) when resolved,
      // otherwise a lane-coloured dot carrying the author's initials.
      const avatar = useAvatarStore.getState().getImage(node.authorEmail);
      if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, x - dotRadius, y - dotRadius, dotRadius * 2, dotRadius * 2);
        ctx.restore();
        // A thin lane-coloured ring gives the avatar definition.
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        // Author initials, white, centred on the dot.
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 8.5px ${sansFont}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(node.authorName), x, y + 0.5);
      }

      // HEAD marker: an outer ring in the lane colour around the dot — the
      // "current commit" cue, kept especially around the graph marker.
      if (node.isHead) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Selected commit: a dashed accent ring — but only when it isn't also HEAD,
      // so two rings never stack.
      if (selection.range.has(node.oid) && !node.isHead) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = selectionAccent;
        ctx.lineWidth = 1.75;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1;
    });
  }, [viewport, selection, canvasRef, themeTick, width, avatarVersion, hoveredOid, focusCurrentBranch]);
}
