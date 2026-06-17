import { useEffect, useMemo, useState } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useGraphStore } from "../../stores/graphStore";
import { renderMarkdown } from "../../lib/markdown";

const INITIAL_LIMIT = 100;

type BodyTab = "write" | "preview";

export function CommitForm({
  stagedCount,
  onCommitted,
}: {
  stagedCount: number;
  /** Called after a commit succeeds (e.g. to close the panel in the history view). */
  onCommitted?: () => void;
}) {
  const { identity, loadIdentity, createCommit, discardAll } = useWorkingTreeStore();
  const { fetchViewport } = useGraphStore();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<BodyTab>("write");
  const [committing, setCommitting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  const previewHtml = useMemo(() => renderMarkdown(body), [body]);
  const canCommit = stagedCount > 0 && subject.trim().length > 0 && !committing;

  const handleCommit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    setError(null);
    const message = body.trim()
      ? `${subject.trim()}\n\n${body.trim()}`
      : subject.trim();
    try {
      await createCommit(message);
      setSubject("");
      setBody("");
      setTab("write");
      await fetchViewport(0, INITIAL_LIMIT);
      onCommitted?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handleReset = async () => {
    setConfirmReset(false);
    setError(null);
    try {
      await discardAll();
      setSubject("");
      setBody("");
      setTab("write");
    } catch (e) {
      setError(String(e));
    }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "var(--space-1) var(--space-2)",
    fontSize: "var(--font-size-xs)",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    borderBottom: active
      ? "2px solid var(--color-accent-primary)"
      : "2px solid transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
  });

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

      <Input
        fullWidth
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Summary (required)"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleCommit();
        }}
      />

      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <button type="button" style={tabStyle(tab === "write")} onClick={() => setTab("write")}>
          Write
        </button>
        <button
          type="button"
          style={tabStyle(tab === "preview")}
          onClick={() => setTab("preview")}
        >
          Preview
        </button>
      </div>

      {tab === "write" ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Description (optional, supports markdown)"
          rows={4}
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
      ) : (
        <div
          className="markdown-preview"
          style={{
            minHeight: 88,
            background: "var(--color-bg-input)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-text-primary)",
            fontSize: "var(--font-size-sm)",
            padding: "var(--space-2)",
            overflowY: "auto",
          }}
          // Safe: renderMarkdown HTML-escapes input before adding its own tags.
          dangerouslySetInnerHTML={{
            __html: previewHtml || '<span style="color:var(--color-text-muted)">Nothing to preview</span>',
          }}
        />
      )}

      {error && (
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-danger)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button
          variant="danger"
          onClick={() => setConfirmReset(true)}
          title="Discard all working-tree changes"
        >
          Reset
        </Button>
        <Button variant="primary" fullWidth onClick={handleCommit} disabled={!canCommit}>
          {committing ? "Committing…" : `Commit${stagedCount > 0 ? ` (${stagedCount})` : ""}`}
        </Button>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Discard all changes?"
          message="This will unstage everything and permanently discard all uncommitted changes in the working tree. This cannot be undone."
          confirmLabel="Discard everything"
          onConfirm={handleReset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
