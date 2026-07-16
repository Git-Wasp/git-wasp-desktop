import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BranchLabel } from "../../types/graph";

const DRAG_THRESHOLD = 4;

interface DropMenu {
  x: number;
  y: number;
  source: string;
  target: string;
}

interface UseGraphDragDropArgs {
  onMerge: (source: string, target: string) => void;
  onStartPullRequest: (head: string, base: string) => void;
}

/**
 * Branch-pill drag-and-drop over DOM pills. A pill's `onPointerDown` records the
 * source; while dragging, `onPointerEnter`/`onPointerLeave` on other pills set
 * the drop target; a window `pointerup` over a target opens the merge / start-PR
 * menu. (Uses pointer enter/leave rather than `elementFromPoint`, which jsdom
 * doesn't implement — keeping it testable.)
 */
export function useGraphDragDrop({ onMerge, onStartPullRequest }: UseGraphDragDropArgs) {
  const candidateRef = useRef<{ source: string; startX: number; startY: number } | null>(null);
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dropTargetRef = useRef<string | null>(null);

  const [dragging, setDragging] = useState(false);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<DropMenu | null>(null);

  const onPillPointerDown = useCallback((e: React.PointerEvent, label: BranchLabel) => {
    candidateRef.current = { source: label.name, startX: e.clientX, startY: e.clientY };
    didDragRef.current = false;
  }, []);

  const onPillPointerEnter = useCallback((label: BranchLabel) => {
    if (!draggingRef.current) return;
    const source = candidateRef.current?.source;
    const local = !label.isRemote && !label.isTag;
    if (local && label.name !== source) {
      dropTargetRef.current = label.name;
      setDropTarget(label.name);
    }
  }, []);

  const onPillPointerLeave = useCallback(() => {
    if (!draggingRef.current) return;
    dropTargetRef.current = null;
    setDropTarget(null);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const c = candidateRef.current;
      if (!c) return;
      if (!draggingRef.current) {
        if (Math.hypot(e.clientX - c.startX, e.clientY - c.startY) <= DRAG_THRESHOLD) return;
        draggingRef.current = true;
        didDragRef.current = true;
        setDragging(true);
        setDragSource(c.source);
        // Suppress text selection for the duration of the drag, and clear any
        // selection the initial press already started, so dragging a pill over
        // commit rows doesn't highlight their text.
        document.body.classList.add("dragging-branch-pill");
        window.getSelection?.()?.removeAllRanges();
      }
      setGhostPos({ x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      const c = candidateRef.current;
      if (c && draggingRef.current && dropTargetRef.current) {
        setMenu({ x: e.clientX, y: e.clientY, source: c.source, target: dropTargetRef.current });
      }
      candidateRef.current = null;
      draggingRef.current = false;
      dropTargetRef.current = null;
      document.body.classList.remove("dragging-branch-pill");
      setDragging(false);
      setGhostPos(null);
      setDropTarget(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging-branch-pill");
    };
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // True (once) if the last press became a drag, so the trailing click can be
  // swallowed (a drag shouldn't also select).
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

  return useMemo(
    () => ({
      onPillPointerDown,
      onPillPointerEnter,
      onPillPointerLeave,
      dragging,
      ghostPos,
      dragSource,
      dropTarget,
      menu,
      closeMenu,
      consumeClick,
      confirmMerge,
      confirmStartPullRequest,
    }),
    [
      onPillPointerDown,
      onPillPointerEnter,
      onPillPointerLeave,
      dragging,
      ghostPos,
      dragSource,
      dropTarget,
      menu,
      closeMenu,
      consumeClick,
      confirmMerge,
      confirmStartPullRequest,
    ],
  );
}
