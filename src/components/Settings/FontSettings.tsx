import { useState } from "react";
import {
  MONO_FONTS,
  UI_FONTS,
  UI_SIZES,
  applyFontPrefs,
  loadFontPrefs,
  monoFont,
  saveFontPrefs,
  type FontPrefs,
} from "../../lib/fonts";

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
  width: 120,
  flexShrink: 0,
};

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

/**
 * Settings → Fonts: choose the UI font, the code-editor (monospace) font, and a
 * global UI size. Changes apply immediately (via the token layer) and persist.
 */
export function FontSettings() {
  const [prefs, setPrefs] = useState<FontPrefs>(loadFontPrefs);

  const update = (patch: Partial<FontPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveFontPrefs(next);
    applyFontPrefs(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={rowStyle}>
        <label htmlFor="ui-font" style={labelStyle}>
          UI font
        </label>
        <select
          id="ui-font"
          style={selectStyle}
          value={prefs.uiFontId}
          onChange={(e) => update({ uiFontId: e.target.value })}
        >
          {UI_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <label htmlFor="code-font" style={labelStyle}>
          Code font
        </label>
        <select
          id="code-font"
          style={selectStyle}
          value={prefs.monoFontId}
          onChange={(e) => update({ monoFontId: e.target.value })}
        >
          {MONO_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <label htmlFor="ui-size" style={labelStyle}>
          UI size
        </label>
        <select
          id="ui-size"
          style={selectStyle}
          value={prefs.sizeId}
          onChange={(e) => update({ sizeId: e.target.value })}
        >
          {UI_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          marginTop: "var(--space-1)",
          padding: "var(--space-3)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-surface)",
        }}
      >
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
          The quick brown fox jumps over the lazy dog.
        </div>
        <div
          style={{
            marginTop: "var(--space-2)",
            fontFamily: monoFont(prefs).stack,
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-primary)",
          }}
        >
          const sum = (a, b) =&gt; a + b; // 0123456789
        </div>
      </div>
    </div>
  );
}
