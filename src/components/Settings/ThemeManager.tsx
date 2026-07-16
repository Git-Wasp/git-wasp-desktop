import { useEffect } from "react";
import { useThemeStore, type ThemeInfo } from "../../stores/themeStore";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/Button";

function ThemeRow({ theme, active }: { theme: ThemeInfo; active: boolean }) {
  const { setActiveTheme, deleteTheme, previewTheme, clearPreview } = useThemeStore();

  const handleActivate = () => {
    setActiveTheme(theme.id).catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Couldn't activate theme" }),
    );
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete theme "${theme.name}"?`)) return;
    deleteTheme(theme.id).catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Couldn't delete theme" }),
    );
  };

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
        <Button
          type="button"
          size="sm"
          aria-label={`Activate ${theme.name}`}
          onClick={handleActivate}
        >
          Activate
        </Button>
      )}

      {!theme.builtin && (
        <Button
          type="button"
          size="sm"
          variant="danger"
          aria-label={`Delete ${theme.name}`}
          onClick={handleDelete}
        >
          Delete
        </Button>
      )}
    </div>
  );
}

export function ThemeManager() {
  const { themes, activeThemeId, loadThemes, importTheme } = useThemeStore();

  useEffect(() => {
    loadThemes().catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Couldn't load themes" }),
    );
  }, [loadThemes]);

  const handleImport = () => {
    importTheme().catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Couldn't import theme" }),
    );
  };

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
        <Button variant="primary" type="button" onClick={handleImport}>
          Import theme…
        </Button>
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
