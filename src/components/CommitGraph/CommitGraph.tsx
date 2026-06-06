import { useCallback, useEffect, useRef } from "react";
import { useGraphStore } from "../../stores/graphStore";
import { useCommitGraph } from "../../hooks/useCommitGraph";

const ROW_HEIGHT = 28;
const BUFFER_ROWS = 20;

export function CommitGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { viewport, selection, fetchViewport, selectCommit } = useGraphStore();

  // Initial load.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const limit = Math.ceil(container.clientHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    fetchViewport(0, limit);
  }, [fetchViewport]);

  // Sync canvas CSS size to container, then redraw.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.style.width = container.clientWidth + "px";
    canvas.style.height = container.clientHeight + "px";
  }, [viewport]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const container = e.currentTarget;
      const scrollTop = container.scrollTop;
      const offset = Math.max(
        0,
        Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS
      );
      const limit =
        Math.ceil(container.clientHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
      fetchViewport(offset, limit);
    },
    [fetchViewport]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!viewport) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      // Map click Y to local row index within the rendered viewport slice.
      const localRow = Math.floor(relY / ROW_HEIGHT);
      const node = viewport.nodes[localRow];
      if (node) selectCommit(node.oid, e.shiftKey);
    },
    [viewport, selectCommit]
  );

  useCommitGraph(canvasRef, viewport, selection);

  const totalHeight = (viewport?.totalCount ?? 0) * ROW_HEIGHT;
  const canvasTop = (viewport?.offset ?? 0) * ROW_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="relative overflow-y-auto h-full"
      style={{ background: "var(--color-bg-app)" }}
      onScroll={handleScroll}
    >
      {/* Spacer div provides the full scroll height */}
      <div style={{ height: totalHeight, position: "relative" }}>
        {/* Canvas is positioned at the current viewport offset */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: canvasTop,
            left: 0,
            cursor: "default",
          }}
          onClick={handleCanvasClick}
        />
      </div>
    </div>
  );
}
