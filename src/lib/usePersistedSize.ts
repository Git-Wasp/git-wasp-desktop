import { useCallback, useState } from "react";

/**
 * A pixel size (width or height) persisted to localStorage and clamped to
 * [min, max]. Backs the resizable panels (widths) and the resizable sidebar
 * sections (heights), so both survive reloads.
 */
export function usePersistedSize(key: string, initial: number, min: number, max: number) {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);

  const [size, setSizeState] = useState<number>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? clamp(parsed) : initial;
  });

  const setSize = useCallback(
    (updater: number | ((s: number) => number)) => {
      setSizeState((prev) => {
        const next = clamp(typeof updater === "function" ? updater(prev) : updater);
        try {
          localStorage.setItem(key, String(next));
        } catch {
          /* ignore storage failures */
        }
        return next;
      });
    },
    [key, clamp],
  );

  return [size, setSize] as const;
}
