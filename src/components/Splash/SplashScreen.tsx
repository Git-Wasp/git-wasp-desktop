import { Spinner } from "../ui/Spinner";
import { WaspLogo } from "../ui/WaspLogo";

/**
 * Full-window boot screen shown while the app restores state (open repos, the
 * active repo's history, theme, etc.). Replaces the previous blank/stalled
 * window on launch, especially for large repositories whose first history load
 * takes a moment. Shows the Git Wasp brand mark, a spinner, and the task
 * currently in progress.
 */
export function SplashScreen({ task }: { task: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        background: "var(--color-bg-app)",
        color: "var(--color-text-primary)",
        zIndex: 1000,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
        <WaspLogo size={132} />
        <div
          style={{
            fontSize: "var(--font-size-2xl)",
            fontWeight: "var(--font-weight-bold)",
            letterSpacing: "-0.02em",
          }}
        >
          Git Wasp
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          color: "var(--color-text-secondary)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        <Spinner size={16} />
        <span data-testid="splash-task">{task}</span>
      </div>
    </div>
  );
}
