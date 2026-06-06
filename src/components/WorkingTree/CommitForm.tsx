import { useEffect, useState } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useGraphStore } from "../../stores/graphStore";

const INITIAL_LIMIT = 100;

export function CommitForm({ stagedCount }: { stagedCount: number }) {
  const { identity, loadIdentity, createCommit } = useWorkingTreeStore();
  const { fetchViewport } = useGraphStore();
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  const canCommit = stagedCount > 0 && message.trim().length > 0 && !committing;

  const handleCommit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    setError(null);
    try {
      await createCommit(message.trim());
      setMessage("");
      await fetchViewport(0, INITIAL_LIMIT);
    } catch (e) {
      setError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      {identity && (
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {identity.name} &lt;{identity.email}&gt;
        </div>
      )}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message…"
        rows={3}
        style={{
          resize: "none",
          background: "var(--color-bg-input)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-family-sans)",
          fontSize: "var(--font-size-sm)",
          padding: "var(--space-2)",
          outline: "none",
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleCommit();
        }}
      />

      {error && (
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={handleCommit}
        disabled={!canCommit}
        style={{
          padding: "var(--space-2) var(--space-3)",
          background: canCommit
            ? "var(--color-accent-primary)"
            : "var(--color-bg-panel)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          color: canCommit
            ? "var(--color-text-on-accent)"
            : "var(--color-text-muted)",
          fontWeight: "var(--font-weight-medium)",
          fontSize: "var(--font-size-sm)",
          cursor: canCommit ? "pointer" : "not-allowed",
        }}
      >
        {committing ? "Committing…" : `Commit${stagedCount > 0 ? ` (${stagedCount})` : ""}`}
      </button>
    </div>
  );
}
