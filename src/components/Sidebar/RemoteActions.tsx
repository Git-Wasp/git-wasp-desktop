import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { Button } from "../ui/Button";

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
          <Button size="sm" fullWidth onClick={() => fetch()} disabled={isFetching}>
            {isFetching ? "Fetching…" : "Fetch"}
          </Button>
          <Button size="sm" fullWidth onClick={() => pull()} disabled={isPulling}>
            {isPulling ? "Pulling…" : "Pull"}
          </Button>
          <Button size="sm" fullWidth onClick={() => push()} disabled={isPushing}>
            {isPushing ? "Pushing…" : "Push"}
          </Button>
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

      <Button size="sm" fullWidth onClick={onOpenClone}>
        Clone from GitHub…
      </Button>
    </div>
  );
}
