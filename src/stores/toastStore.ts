import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";
export type ToastVertical = "top" | "middle" | "bottom";
export type ToastHorizontal = "left" | "right";

export interface ToastPlacement {
  vertical: ToastVertical;
  horizontal: ToastHorizontal;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  title?: string;
  /** ms before auto-dismiss; `null` keeps it up until dismissed by hand. */
  duration: number | null;
}

export interface ToastInput {
  message: string;
  variant?: ToastVariant;
  title?: string;
  duration?: number | null;
}

const PLACEMENT_KEY = "toastPlacement";
const DEFAULT_PLACEMENT: ToastPlacement = { vertical: "bottom", horizontal: "right" };
/** Transient notifications auto-dismiss; errors stay until dismissed (see `error`). */
const DEFAULT_DURATION = 5000;

const isVertical = (v: unknown): v is ToastVertical =>
  v === "top" || v === "middle" || v === "bottom";
const isHorizontal = (v: unknown): v is ToastHorizontal => v === "left" || v === "right";

function loadPlacement(): ToastPlacement {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PLACEMENT_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<ToastPlacement>;
      if (isVertical(p.vertical) && isHorizontal(p.horizontal)) {
        return { vertical: p.vertical, horizontal: p.horizontal };
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return DEFAULT_PLACEMENT;
}

// Auto-dismiss timers live outside the store state (they aren't render data).
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let counter = 0;
const nextId = () => `toast-${Date.now()}-${counter++}`;

interface ToastStore {
  toasts: Toast[];
  placement: ToastPlacement;
  setPlacement: (p: Partial<ToastPlacement>) => void;
  show: (input: ToastInput) => string;
  success: (message: string, opts?: Partial<ToastInput>) => string;
  error: (message: string, opts?: Partial<ToastInput>) => string;
  info: (message: string, opts?: Partial<ToastInput>) => string;
  warning: (message: string, opts?: Partial<ToastInput>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  placement: loadPlacement(),

  setPlacement: (p) => {
    const placement = { ...get().placement, ...p };
    try {
      localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placement));
    } catch {
      /* ignore storage failures */
    }
    set({ placement });
  },

  show: (input) => {
    const id = nextId();
    const toast: Toast = {
      id,
      variant: input.variant ?? "info",
      message: input.message,
      title: input.title,
      duration: input.duration === undefined ? DEFAULT_DURATION : input.duration,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (toast.duration !== null) {
      timers.set(id, setTimeout(() => get().dismiss(id), toast.duration));
    }
    return id;
  },

  success: (message, opts) => get().show({ ...opts, message, variant: "success" }),
  // Errors stay until dismissed by default so they can't be missed.
  error: (message, opts) =>
    get().show({ duration: null, ...opts, message, variant: "error" }),
  info: (message, opts) => get().show({ ...opts, message, variant: "info" }),
  warning: (message, opts) => get().show({ ...opts, message, variant: "warning" }),

  dismiss: (id) => {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },

  clear: () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    set({ toasts: [] });
  },
}));
