// Row-density presets for the commit graph. The redesign's default is the
// spacious 56px two-line "Comfortable" row; some users want more commits on
// screen, so the density is user-selectable (persisted in graphStore) and cycles
// Comfortable → Cozy → Compact.
//
// Each preset drives the row height (DOM virtualisation + canvas geometry stay
// in lockstep because both read from here), the commit-dot radius, and where the
// muted secondary body line goes: "below" the summary on a second line
// (Comfortable, the only two-line row), "beside" it inline on the same row
// (Cozy — keeps the detail without a second line), or "none" (Compact).

export type GraphDensity = "comfortable" | "cozy" | "compact";

/** Where the commit cell renders its secondary (body) text. */
export type BodyPlacement = "below" | "beside" | "none";

export interface DensitySpec {
  /** Row height in px — the single source of truth for graph geometry. */
  rowHeight: number;
  /** Commit-dot radius in px, scaled down with the row so dots stay in proportion. */
  dotRadius: number;
  /** Where the commit body line goes relative to the summary. */
  bodyPlacement: BodyPlacement;
  /** Human label for the toolbar tooltip. */
  label: string;
}

export const GRAPH_DENSITY: Record<GraphDensity, DensitySpec> = {
  comfortable: { rowHeight: 56, dotRadius: 10, bodyPlacement: "below", label: "Comfortable" },
  cozy: { rowHeight: 44, dotRadius: 8, bodyPlacement: "beside", label: "Cozy" },
  compact: { rowHeight: 34, dotRadius: 6, bodyPlacement: "none", label: "Compact" },
};

/** Cycle order for the toolbar toggle. */
export const DENSITY_ORDER: GraphDensity[] = ["comfortable", "cozy", "compact"];

export const DEFAULT_DENSITY: GraphDensity = "comfortable";

export function isGraphDensity(value: unknown): value is GraphDensity {
  return value === "comfortable" || value === "cozy" || value === "compact";
}

/** The next density in the cycle, wrapping back to Comfortable after Compact. */
export function nextDensity(current: GraphDensity): GraphDensity {
  const i = DENSITY_ORDER.indexOf(current);
  return DENSITY_ORDER[(i + 1) % DENSITY_ORDER.length];
}
