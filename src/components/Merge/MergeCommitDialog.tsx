import { useState } from "react";
import { useMergeStore } from "../../stores/mergeStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { Button } from "../ui/Button";

/**
 * Shown when a merge starts cleanly (no conflicts): rather than replacing the
 * whole app with the (empty) full-screen merge editor, this modal floats over
 * the app to collect the merge commit message and finish — or abort — the merge.
 * Conflicted merges still use the full-screen `MergeEditor`.
 */
export function MergeCommitDialog() {
  const status = useMergeStore((s) => s.status);
  const isLoading = useMergeStore((s) => s.isLoading);
  const completeMerge = useMergeStore((s) => s.completeMerge);
  const abortMerge = useMergeStore((s) => s.abortMerge);
  const headBranch = useRepoStore((s) => s.currentRepo?.headBranch ?? null);

  const sourceBranch = status.kind === "merge" ? status.sourceBranch : null;
  const defaultMessage = sourceBranch
    ? `Merge branch '${sourceBranch}'${headBranch ? ` into ${headBranch}` : ""}`
    : "Merge";

  const [message, setMessage] = useState(defaultMessage);
  const [error, setError] = useState<string | null>(null);

  if (status.kind !== "merge") return null;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      // The app stays mounted behind the modal, so refresh the graph to show
      // the new merge commit (or the reverted state after an abort).
      await useGraphStore.getState().refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Complete merge"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          void run(abortMerge);
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 460,
          padding: "var(--space-5)",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          color: "var(--color-text-primary)",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "var(--space-2)",
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Complete merge
        </h2>
        <p
          style={{
            margin: 0,
            marginBottom: "var(--space-3)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            lineHeight: "var(--line-height-normal)",
          }}
        >
          {sourceBranch ? <code>{sourceBranch}</code> : "The branch"} merged cleanly
          {headBranch ? <> into <code>{headBranch}</code></> : null} with no conflicts. Add a
          commit message to finish.
        </p>

        <textarea
          aria-label="Merge commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          autoFocus
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && message.trim() !== "") {
              e.preventDefault();
              void run(() => completeMerge(message.trim()));
            }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            padding: "var(--space-2)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-family-sans)",
            background: "var(--color-bg-input)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-text-primary)",
            outline: "none",
          }}
        />

        {error && (
          <div
            style={{
              marginTop: "var(--space-2)",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            justifyContent: "flex-end",
            marginTop: "var(--space-4)",
          }}
        >
          <Button variant="danger" onClick={() => void run(abortMerge)} disabled={isLoading}>
            Abort merge
          </Button>
          <Button
            variant="primary"
            onClick={() => void run(() => completeMerge(message.trim()))}
            loading={isLoading}
            disabled={isLoading || message.trim() === ""}
          >
            Complete merge
          </Button>
        </div>
      </div>
    </div>
  );
}
