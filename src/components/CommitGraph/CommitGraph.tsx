import { useCallback, useEffect, useRef, useState } from "react";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useCommitGraph } from "../../hooks/useCommitGraph";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";
import { PromptDialog } from "../common/PromptDialog";
import type { GraphNode } from "../../types/graph";

const ROW_HEIGHT = 28;
const BUFFER_ROWS = 20;

interface MenuState {
  x: number;
  y: number;
  node: GraphNode;
}

type PromptState =
  | { kind: "new-branch"; oid: string }
  | { kind: "rename-branch"; branch: string };

export function CommitGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { viewport, selection, fetchViewport, selectCommit, refresh } =
    useGraphStore();
  const { createBranch, checkoutBranch, renameBranch, deleteBranch } =
    useRepoStore();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);

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

  // Map a click/right-click Y to the node under it within the rendered slice.
  const nodeAtClientY = useCallback(
    (canvas: HTMLCanvasElement, clientY: number): GraphNode | undefined => {
      if (!viewport) return undefined;
      const rect = canvas.getBoundingClientRect();
      const localRow = Math.floor((clientY - rect.top) / ROW_HEIGHT);
      return viewport.nodes[localRow];
    },
    [viewport]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const node = nodeAtClientY(e.currentTarget, e.clientY);
      if (node) selectCommit(node.oid, e.shiftKey);
    },
    [nodeAtClientY, selectCommit]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const node = nodeAtClientY(e.currentTarget, e.clientY);
      if (!node) return;
      selectCommit(node.oid, false);
      setMenu({ x: e.clientX, y: e.clientY, node });
    },
    [nodeAtClientY, selectCommit]
  );

  const buildMenuItems = useCallback(
    (node: GraphNode): MenuItem[] => {
      const items: MenuItem[] = [
        { label: "Copy commit hash", onSelect: () => copy(node.oid) },
        { label: "Copy short hash", onSelect: () => copy(node.shortOid) },
        {
          label: "New branch here…",
          onSelect: () => setPrompt({ kind: "new-branch", oid: node.oid }),
        },
      ];

      const localBranches = node.branchLabels.filter(
        (l) => !l.isRemote && !l.isTag
      );
      if (localBranches.length > 0) {
        items.push({ separator: true });
        for (const branch of localBranches) {
          items.push({
            label: `Checkout ${branch.name}`,
            onSelect: () => runBranchOp(() => checkoutBranch(branch.name)),
          });
          items.push({
            label: `Rename ${branch.name}…`,
            onSelect: () =>
              setPrompt({ kind: "rename-branch", branch: branch.name }),
          });
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
      return items;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutBranch, deleteBranch]
  );

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  // Run a branch mutation then refresh the graph so labels update.
  const runBranchOp = async (op: () => Promise<void>) => {
    await op();
    await refresh();
  };

  const handlePromptConfirm = async (value: string) => {
    const current = prompt;
    setPrompt(null);
    if (!current) return;
    if (current.kind === "new-branch") {
      await runBranchOp(async () => {
        await createBranch(value, current.oid);
        await checkoutBranch(value);
      });
    } else {
      await runBranchOp(() => renameBranch(current.branch, value));
    }
  };

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
          onContextMenu={handleContextMenu}
        />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}

      {prompt && (
        <PromptDialog
          title={prompt.kind === "new-branch" ? "New branch" : "Rename branch"}
          label="Branch name"
          initialValue={prompt.kind === "rename-branch" ? prompt.branch : ""}
          confirmLabel={prompt.kind === "rename-branch" ? "Rename" : "Create"}
          onConfirm={handlePromptConfirm}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}
