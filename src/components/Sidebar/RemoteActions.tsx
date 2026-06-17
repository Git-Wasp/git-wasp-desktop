import { Button } from "../ui/Button";

/**
 * Sidebar remote actions. Fetch/pull/push live in the history toolbar (where
 * the in-flight state and errors are surfaced); the sidebar keeps only the
 * Clone entry point.
 */
export function RemoteActions({ onOpenClone }: { onOpenClone: () => void }) {
  return (
    <div
      style={{
        padding: "var(--space-3)",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <Button size="sm" fullWidth onClick={onOpenClone}>
        Clone from GitHub…
      </Button>
    </div>
  );
}
