import { useEffect, useRef, useState } from "react";
import type { GraphViewport } from "../types/graph";
import type { BranchLabelHit } from "../components/CommitGraph/dragDrop";
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
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function resolveLaneColors(): string[] {
  return Array.from({ length: 8 }, (_, i) =>
    resolveCssVar(`--color-lane-${i}`)
  );
}

function resolveConfig(): GraphConfig {
  const px = (v: string) => parseFloat(v) || 0;
  return {
    rowHeight: px(resolveCssVar("--graph-row-height")) || 28,
    laneWidth: px(resolveCssVar("--graph-lane-width")) || 20,
    dotRadius: px(resolveCssVar("--graph-dot-radius")) || 5,
    lineWidth: px(resolveCssVar("--graph-line-width")) || 2,
  };
}

export function useCommitGraph(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewport: GraphViewport | null,
  selection: Selection,
  labelHitsRef?: React.RefObject<BranchLabelHit[]>
): void {
  const configRef = useRef<GraphConfig | null>(null);
  const laneColorsRef = useRef<string[]>([]);
  const [themeTick, setThemeTick] = useState(0);

  // Resolve CSS tokens at mount and whenever the theme changes (tokens are read
  // from CSS, so a theme swap must re-resolve colours and trigger a redraw).
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

    const { rowHeight, laneWidth, dotRadius, lineWidth } =
      configRef.current;
    const laneColors = laneColorsRef.current;
    const dpr = window.devicePixelRatio || 1;

    // Sync canvas pixel size to CSS size.
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Reset the branch-pill hit-boxes; repopulated as labels are drawn below.
    if (labelHitsRef) labelHitsRef.current = [];

    // The canvas renders only the viewport slice; row 0 here corresponds to
    // viewport.offset in the full graph. We map to y by local row index.
    viewport.nodes.forEach((node, localRow) => {
      const y = localRow * rowHeight + rowHeight / 2;
      const x = node.lane * laneWidth + laneWidth / 2;
      const color = laneColors[node.colorIndex % 8] || "#4d9de0";

      // Selection highlight.
      if (selection.range.has(node.oid)) {
        ctx.fillStyle = "rgba(77, 157, 224, 0.15)";
        ctx.fillRect(0, localRow * rowHeight, cssW, rowHeight);
      }

      // Edges for this row.
      node.edges.forEach((edge) => {
        const edgeColor = laneColors[edge.colorIndex % 8] || "#4d9de0";
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();

        const srcX = edge.srcLane * laneWidth + laneWidth / 2;
        const dstX = edge.dstLane * laneWidth + laneWidth / 2;

        if (edge.kind === "Straight") {
          // Vertical line through this row.
          ctx.moveTo(srcX, localRow * rowHeight);
          ctx.lineTo(srcX, (localRow + 1) * rowHeight);
        } else {
          // Bezier curve from src to dst lane, spanning one row height.
          const topY = localRow * rowHeight;
          const botY = (localRow + 1) * rowHeight;
          ctx.moveTo(srcX, topY);
          ctx.bezierCurveTo(srcX, topY + rowHeight * 0.5, dstX, botY - rowHeight * 0.5, dstX, botY);
        }
        ctx.stroke();
      });

      // Working-tree node: a hollow dashed marker in the warning colour plus a
      // count label, then skip the normal commit rendering.
      if (node.isWorkingTree) {
        const warn = resolveCssVar("--color-warning") || "#ff9f0a";
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = warn;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = `${13}px var(--font-family-sans, system-ui)`;
        ctx.fillStyle = warn;
        ctx.fillText(node.summary, x + dotRadius + 8, y + 4);
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

      // Branch labels (pill badges).
      if (node.branchLabels.length > 0) {
        ctx.font = `${11}px var(--font-family-mono, monospace)`;
        let labelX = x + dotRadius + 6;
        node.branchLabels.forEach((label) => {
          const text = label.name;
          const textW = ctx.measureText(text).width;
          const padX = 6;
          const padY = 3;
          const badgeH = 16;
          const badgeW = textW + padX * 2;
          const badgeY = y - badgeH / 2;

          ctx.fillStyle = label.isTag ? "#f59e0b" : label.isRemote ? "#a855f7" : "#4d9de0";
          ctx.beginPath();
          ctx.roundRect(labelX, badgeY, badgeW, badgeH, 3);
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.fillText(text, labelX + padX, badgeY + badgeH - padY - 2);

          if (labelHitsRef) {
            labelHitsRef.current.push({
              name: label.name,
              isRemote: label.isRemote,
              isTag: label.isTag,
              x: labelX,
              y: badgeY,
              w: badgeW,
              h: badgeH,
            });
          }

          labelX += badgeW + 4;
        });
      }

      // Commit summary text.
      const textX = x + dotRadius + 8 + (node.branchLabels.length > 0
        ? node.branchLabels.reduce((acc, l) => acc + ctx.measureText(l.name).width + 16, 0)
        : 0);
      ctx.font = `${13}px var(--font-family-sans, system-ui)`;
      ctx.fillStyle = node.isHead
        ? resolveCssVar("--color-text-primary") || "#eef1f5"
        : resolveCssVar("--color-text-secondary") || "#a3afc2";
      ctx.fillText(node.summary, textX, y + 4);
    });
  }, [viewport, selection, canvasRef, labelHitsRef, themeTick]);
}
