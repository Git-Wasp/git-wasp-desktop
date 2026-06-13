import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { hitTestLabel, isLocalBranch, type BranchLabelHit } from "./dragDrop";

const DRAG_THRESHOLD = 4;

interface PointerLike {
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
}

interface UseGraphDragDropArgs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  labelHitsRef: RefObject<BranchLabelHit[]>;
  onMerge: (source: string, target: string) => void;
  onStartPullRequest: (head: string, base: string) => void;
}

interface DropMenu {
  x: number;
  y: number;
  source: string;
  target: string;
}

export function useGraphDragDrop({
  canvasRef,
  labelHitsRef,
  onMerge,
  onStartPullRequest,
}: UseGraphDragDropArgs) {
  const candidateRef = useRef<{
    source: string;
    startX: number;
    startY: number;
  } | null>(null);
  const didDragRef = useRef(false);

  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<BranchLabelHit | null>(null);
  const [menu, setMenu] = useState<DropMenu | null>(null);

  const toLocal = useCallback(
    (e: PointerLike) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    },
    [canvasRef],
  );

  // Local-branch pill under the pointer that differs from the drag source.
  const localTargetAt = useCallback(
    (e: PointerLike, source: string): BranchLabelHit | undefined => {
      const { x, y } = toLocal(e);
      const h = hitTestLabel(labelHitsRef.current ?? [], x, y);
      return h && isLocalBranch(h) && h.name !== source ? h : undefined;
    },
    [toLocal, labelHitsRef],
  );

  const onPointerDown = useCallback(
    (e: PointerLike) => {
      const { x, y } = toLocal(e);
      const h = hitTestLabel(labelHitsRef.current ?? [], x, y);
      candidateRef.current =
        h && isLocalBranch(h)
          ? { source: h.name, startX: e.clientX, startY: e.clientY }
          : null;
      didDragRef.current = false;
    },
    [toLocal, labelHitsRef],
  );

  const onPointerMove = useCallback(
    (e: PointerLike) => {
      // Hover feedback (independent of an active drag): a local pill under the
      // pointer means it can be grabbed.
      const { x, y } = toLocal(e);
      const over = hitTestLabel(labelHitsRef.current ?? [], x, y);
      setHovering(!!(over && isLocalBranch(over)));

      const c = candidateRef.current;
      if (!c) return;
      if (!didDragRef.current) {
        const dist = Math.hypot(e.clientX - c.startX, e.clientY - c.startY);
        if (dist <= DRAG_THRESHOLD) return;
        didDragRef.current = true;
        setDragging(true);
        setDragSource(c.source);
      }
      setGhostPos({ x: e.clientX, y: e.clientY });
      setDropTarget(localTargetAt(e, c.source) ?? null);
      e.preventDefault?.();
    },
    [localTargetAt, toLocal, labelHitsRef],
  );

  const onPointerUp = useCallback(
    (e: PointerLike) => {
      const c = candidateRef.current;
      if (c && didDragRef.current) {
        const target = localTargetAt(e, c.source);
        if (target) {
          setMenu({ x: e.clientX, y: e.clientY, source: c.source, target: target.name });
        }
      }
      candidateRef.current = null;
      setDragging(false);
      setGhostPos(null);
      setDropTarget(null);
      setDragSource(null);
    },
    [localTargetAt],
  );

  const onPointerLeave = useCallback(() => setHovering(false), []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // True (once) if the last press turned into a drag — lets the canvas swallow
  // the trailing click so a drag doesn't also select a commit.
  const consumeClick = useCallback(() => {
    const did = didDragRef.current;
    didDragRef.current = false;
    return did;
  }, []);

  const confirmMerge = useCallback(() => {
    if (menu) onMerge(menu.source, menu.target);
    setMenu(null);
  }, [menu, onMerge]);

  const confirmStartPullRequest = useCallback(() => {
    if (menu) onStartPullRequest(menu.source, menu.target);
    setMenu(null);
  }, [menu, onStartPullRequest]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    dragging,
    hovering,
    ghostPos,
    dragSource,
    dropTarget,
    menu,
    closeMenu,
    consumeClick,
    confirmMerge,
    confirmStartPullRequest,
  };
}
