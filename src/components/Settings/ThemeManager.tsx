import { useEffect } from "react";
import { useThemeStore, type ThemeInfo } from "../../stores/themeStore";

const importButtonStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  background: "var(--color-accent-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const smallButtonStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-xs)",
  background: "transparent",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

function ThemeRow({ theme, active }: { theme: ThemeInfo; active: boolean }) {
  const { setActiveTheme, deleteTheme, previewTheme, clearPreview } = useThemeStore();

  const meta = [theme.author, theme.version].filter(Boolean).join(" · ");

  return (
    <div
      data-theme-row
      onMouseEnter={() => previewTheme(theme.id)}
      onMouseLeave={() => clearPreview()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        borderBottom: "1px solid var(--color-border-subtle)",
        background: active ? "var(--color-bg-elevated)" : "transparent",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-primary)" }}>
          {theme.name}
          {theme.builtin && (
            <span style={{ marginLeft: "var(--space-2)", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              built-in
            </span>
          )}
        </div>
        {meta && (
          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>{meta}</div>
        )}
      </div>

      {active ? (
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-accent-primary)" }}>Active</span>
      ) : (
        <button
          type="button"
          aria-label={`Activate ${theme.name}`}
          onClick={() => setActiveTheme(theme.id)}
          style={smallButtonStyle}
        >
          Activate
        </button>
      )}

      {!theme.builtin && (
        <button
          type="button"
          aria-label={`Delete ${theme.name}`}
          onClick={() => {
            if (window.confirm(`Delete theme "${theme.name}"?`)) deleteTheme(theme.id);
          }}
          style={{ ...smallButtonStyle, color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
        >
          Delete
        </button>
      )}
    </div>
  );
}

export function ThemeManager() {
  const { themes, activeThemeId, loadThemes, importTheme } = useThemeStore();

  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-3)",
        }}
      >
        <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
          Hover a theme to preview it; click Activate to keep it.
        </span>
        <button type="button" onClick={() => importTheme()} style={importButtonStyle}>
          Import theme…
        </button>
      </div>

      <div
        style={{
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        {themes.map((theme) => (
          <ThemeRow key={theme.id} theme={theme} active={theme.id === activeThemeId} />
        ))}
      </div>
    </div>
  );
}
