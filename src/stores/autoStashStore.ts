import { create } from "zustand";

export interface AutoStashPrompt {
  title: string;
  message: string;
  confirmLabel: string;
}

interface PendingConfirm extends AutoStashPrompt {
  resolve: (ok: boolean) => void;
}

interface AutoStashState {
  /** The open auto-stash confirmation, or null when none is pending. */
  pending: PendingConfirm | null;
  /** Open the prompt and resolve once the user confirms (true) or cancels (false). */
  requestConfirm: (prompt: AutoStashPrompt) => Promise<boolean>;
  /** Answer the open prompt. */
  respond: (ok: boolean) => void;
}

/**
 * Backs the single, app-level auto-stash confirmation dialog. A checkout/pull
 * blocked by uncommitted changes calls `requestConfirm` and awaits the user's
 * answer; `AutoStashDialog` renders `pending` and calls `respond`. Store-driven
 * so every call site (sidebar, branch picker, graph, toolbar) shares one dialog.
 */
export const useAutoStashStore = create<AutoStashState>((set, get) => ({
  pending: null,

  requestConfirm: (prompt) =>
    new Promise<boolean>((resolve) => {
      // Only one prompt at a time — cancel any prior one before replacing it.
      const prev = get().pending;
      if (prev) prev.resolve(false);
      set({ pending: { ...prompt, resolve } });
    }),

  respond: (ok) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(ok);
  },
}));
