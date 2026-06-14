import { useEffect, useRef, useState } from "react";
import type { GraphViewport } from "../types/graph";
import { THEME_CHANGE_EVENT } from "../lib/applyTheme";

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
): void {
  const configRef = useRef<GraphConfig | null>(null);
  const laneColorsRef = useRef<string[]>([]);
  const [themeTick, setThemeTick] = useState(0);

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
    const dpr = window.devicePixelRatio || 1;

    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // row 0 here corresponds to viewport.offset in the full graph.
    viewport.nodes.forEach((node, localRow) => {
      const y = localRow * rowHeight + rowHeight / 2;
      const x = node.lane * laneWidth + laneWidth / 2;
      const color = laneColors[node.colorIndex % 8] || "#4d9de0";
      const rowTop = localRow * rowHeight;

      // Per-commit highlight band behind the row.
      if (!node.isWorkingTree) {
        ctx.fillStyle = nodeBg;
        ctx.fillRect(0, rowTop + 1, cssW, rowHeight - 2);
      }

      // Selection band (graph-column portion; the DOM cells match it).
      if (selection.range.has(node.oid)) {
        ctx.fillStyle = selectedBg;
        ctx.fillRect(0, rowTop, cssW, rowHeight);
      }

      // Strong right-aligned accent line in the commit's lane colour, drawn on
      // top of the bands so it reads clearly even when the row is selected.
      if (!node.isWorkingTree) {
        ctx.fillStyle = color;
        ctx.fillRect(cssW - 3, rowTop + 5, 3, rowHeight - 10);
      }

      // Edges connect this row's dot centre to the next row's centre, so the
      // lines join dot-to-dot (an edge spans the lower half of this row and the
      // upper half of the next).
      const yMid = localRow * rowHeight + rowHeight / 2;
      const yNext = yMid + rowHeight;
      node.edges.forEach((edge) => {
        ctx.strokeStyle = laneColors[edge.colorIndex % 8] || "#4d9de0";
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        const srcX = edge.srcLane * laneWidth + laneWidth / 2;
        const dstX = edge.dstLane * laneWidth + laneWidth / 2;
        if (srcX === dstX) {
          ctx.moveTo(srcX, yMid);
          ctx.lineTo(srcX, yNext);
        } else {
          ctx.moveTo(srcX, yMid);
          ctx.bezierCurveTo(srcX, yMid + rowHeight * 0.5, dstX, yNext - rowHeight * 0.5, dstX, yNext);
        }
        ctx.stroke();
      });

      // Working-tree node: a hollow dashed marker (label lives in the DOM cell).
      if (node.isWorkingTree) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = resolveCssVar("--color-warning") || "#ff9f0a";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      // Commit dot.
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (node.isHead) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }, [viewport, selection, canvasRef, themeTick, width]);
}
