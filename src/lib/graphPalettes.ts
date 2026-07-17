// Commit-graph lane colour palettes. A palette overrides the eight
// `--color-lane-0..7` tokens on the document root, so it wins over whatever the
// active theme defines and therefore applies independently of the theme. The
// special "theme" palette carries no colours: it removes the overrides so the
// active theme's own lane colours show through. Persisted to localStorage.

import { THEME_CHANGE_EVENT } from "./applyTheme";

export const LANE_COUNT = 8;

export interface GraphPalette {
  id: string;
  label: string;
  /** Eight lane colours, or null to defer to the active theme's lane tokens. */
  colors: string[] | null;
}

export const GRAPH_PALETTES: GraphPalette[] = [
  { id: "theme", label: "Theme default", colors: null },
  {
    id: "bright",
    label: "Bright",
    colors: ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#eab308"],
  },
  {
    id: "pastel",
    label: "Pastel",
    colors: ["#a5b4fc", "#f9a8d4", "#86efac", "#fde68a", "#7dd3fc", "#c4b5fd", "#fdba74", "#67e8f9"],
  },
  {
    id: "blue",
    label: "Shades of blue",
    colors: ["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#38bdf8", "#0ea5e9", "#6366f1"],
  },
  {
    id: "green",
    label: "Shades of green",
    colors: ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#84cc16", "#65a30d", "#10b981"],
  },
  {
    id: "red",
    label: "Shades of red",
    colors: ["#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#fb7185", "#e11d48", "#f43f5e"],
  },
  {
    id: "ocean",
    label: "Ocean",
    colors: ["#22d3ee", "#06b6d4", "#0ea5e9", "#3b82f6", "#2dd4bf", "#14b8a6", "#0891b2", "#6366f1"],
  },
  {
    id: "sunset",
    label: "Sunset",
    colors: ["#f59e0b", "#f97316", "#ef4444", "#ec4899", "#d946ef", "#fb7185", "#fbbf24", "#a855f7"],
  },
];

export const DEFAULT_PALETTE_ID = "theme";
const STORAGE_KEY = "graphPalette";

export function getPalette(id: string): GraphPalette {
  // GRAPH_PALETTES is a non-empty literal array declared above.
  return GRAPH_PALETTES.find((p) => p.id === id) ?? GRAPH_PALETTES[0]!;
}

export function loadGraphPaletteId(): string {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return id && GRAPH_PALETTES.some((p) => p.id === id) ? id : DEFAULT_PALETTE_ID;
  } catch {
    return DEFAULT_PALETTE_ID;
  }
}

export function saveGraphPaletteId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore storage failures */
  }
}

/** Override (or clear, for "theme") the lane tokens and redraw the graph. */
export function applyGraphPalette(id: string): void {
  const palette = getPalette(id);
  const root = document.documentElement.style;
  for (let i = 0; i < LANE_COUNT; i++) {
    const name = `--color-lane-${i}`;
    // Every non-"theme" palette is expected to define exactly LANE_COUNT
    // colours (enforced by a test), but index defensively rather than assert.
    const color = palette.colors?.[i];
    if (color) root.setProperty(name, color);
    else root.removeProperty(name);
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
