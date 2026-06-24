import { useState } from "react";
import {
  GRAPH_PALETTES,
  LANE_COUNT,
  applyGraphPalette,
  getPalette,
  loadGraphPaletteId,
  saveGraphPaletteId,
} from "../../lib/graphPalettes";

const selectStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 280,
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-input)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
};

// For the preview of "Theme default" (no colours of its own), read the active
// theme's lane tokens straight off the document.
function themeLaneColors(): string[] {
  const styles = getComputedStyle(document.documentElement);
  return Array.from({ length: LANE_COUNT }, (_, i) =>
    styles.getPropertyValue(`--color-lane-${i}`).trim(),
  );
}

function Swatches({ colors }: { colors: string[] }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-1)" }} aria-hidden>
      {colors.map((c, i) => (
        <span
          key={i}
          style={{
            width: 16,
            height: 16,
            borderRadius: "var(--radius-sm)",
            background: c || "transparent",
            border: "1px solid var(--color-border-subtle)",
          }}
        />
      ))}
    </div>
  );
}

/**
 * Settings → Graph colours: pick a lane-colour palette for the commit graph.
 * Applies immediately (overriding the lane tokens, independent of the theme) and
 * persists.
 */
export function GraphColorSettings() {
  const [paletteId, setPaletteId] = useState<string>(loadGraphPaletteId);

  const change = (id: string) => {
    setPaletteId(id);
    saveGraphPaletteId(id);
    applyGraphPalette(id);
  };

  const palette = getPalette(paletteId);
  const previewColors = palette.colors ?? themeLaneColors();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <label
          htmlFor="graph-palette"
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-secondary)",
            width: 120,
            flexShrink: 0,
          }}
        >
          Graph palette
        </label>
        <select
          id="graph-palette"
          style={selectStyle}
          value={paletteId}
          onChange={(e) => change(e.target.value)}
        >
          {GRAPH_PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <Swatches colors={previewColors} />
    </div>
  );
}
