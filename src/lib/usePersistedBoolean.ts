import { useCallback, useState } from "react";

/** A boolean persisted to localStorage (e.g. a section's collapsed state). */
export function usePersistedBoolean(key: string, initial: boolean) {
  const [value, setValueState] = useState<boolean>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return stored === null ? initial : stored === "true";
  });

  const setValue = useCallback(
    (updater: boolean | ((v: boolean) => boolean)) => {
      setValueState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        try {
          localStorage.setItem(key, String(next));
        } catch {
          /* ignore storage failures */
        }
        return next;
      });
    },
    [key],
  );

  return [value, setValue] as const;
}
