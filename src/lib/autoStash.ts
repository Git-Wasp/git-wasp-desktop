import { useAutoStashStore, type AutoStashPrompt } from "../stores/autoStashStore";

// Mirrors `working_tree::AUTO_STASH_SENTINEL` in the Rust backend. The checkout
// and pull commands return this exact error string when the only thing blocking
// them is stashable, uncommitted local changes — the cue to offer an auto-stash.
export const AUTO_STASH_SENTINEL = "AUTO_STASH_REQUIRED";

/** Whether a rejected `invoke` is the backend's "would lose changes" sentinel. */
export function isAutoStashError(e: unknown): boolean {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  return msg === AUTO_STASH_SENTINEL;
}

/**
 * Run a checkout/pull-style operation that may be blocked by uncommitted
 * changes. The first attempt runs without stashing; if the backend reports the
 * auto-stash sentinel, the user is prompted and, on confirmation, the operation
 * is retried with `autoStash = true`. Returns `undefined` when the user cancels
 * (so callers can quietly abort without surfacing an error).
 */
export async function withAutoStash<T>(
  op: (autoStash: boolean) => Promise<T>,
  prompt: AutoStashPrompt,
  onStashed?: () => void,
): Promise<T | undefined> {
  try {
    return await op(false);
  } catch (e) {
    if (!isAutoStashError(e)) throw e;
    const confirmed = await useAutoStashStore.getState().requestConfirm(prompt);
    if (!confirmed) return undefined;
    onStashed?.();
    return await op(true);
  }
}
