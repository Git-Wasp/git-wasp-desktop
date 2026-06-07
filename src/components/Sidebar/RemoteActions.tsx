import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";

const buttonStyle = (disabled: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-xs)",
  background: "transparent",
  color: disabled ? "var(--color-text-muted)" : "var(--color-text-secondary)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.6 : 1,
});

export function RemoteActions({ onOpenClone }: { onOpenClone: () => void }) {
  const { remoteInfo } = useGithubStore();
  const { isFetching, isPulling, isPushing, lastError, fetch, pull, push } = useRemoteStore();

  return (
    <div
      style={{
        padding: "var(--space-3)",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      {remoteInfo && (
        <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-2)" }}>
          <button onClick={() => fetch()} disabled={isFetching} style={buttonStyle(isFetching)}>
            {isFetching ? "Fetching…" : "Fetch"}
          </button>
          <button onClick={() => pull()} disabled={isPulling} style={buttonStyle(isPulling)}>
            {isPulling ? "Pulling…" : "Pull"}
          </button>
          <button onClick={() => push()} disabled={isPushing} style={buttonStyle(isPushing)}>
            {isPushing ? "Pushing…" : "Push"}
          </button>
        </div>
      )}

      {lastError && (
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-danger)",
            marginBottom: "var(--space-2)",
          }}
        >
          {lastError}
        </div>
      )}

      <button
        onClick={onOpenClone}
        style={{
          width: "100%",
          padding: "var(--space-1) var(--space-2)",
          fontSize: "var(--font-size-xs)",
          background: "transparent",
          color: "var(--color-text-secondary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
        }}
      >
        Clone from GitHub…
      </button>
    </div>
  );
}
