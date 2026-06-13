import { useCallback, useState } from "react";

/**
 * A pixel width persisted to localStorage and clamped to [min, max]. Used for
 * the resizable sidebar / detail panels so widths survive reloads.
 */
export function usePersistedWidth(key: string, initial: number, min: number, max: number) {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);

  const [width, setWidthState] = useState<number>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? clamp(parsed) : initial;
  });

  const setWidth = useCallback(
    (updater: number | ((w: number) => number)) => {
      setWidthState((prev) => {
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

  return [width, setWidth] as const;
}
