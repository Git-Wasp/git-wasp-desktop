import { useEffect, useMemo, useState } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useGraphStore, GRAPH_INITIAL_LIMIT } from "../../stores/graphStore";
import { renderMarkdown, type MarkdownTab } from "../../lib/markdown";

/** Split a commit message into its subject line and (blank-line-separated) body. */
function splitMessage(message: string): { subject: string; body: string } {
  const nl = message.indexOf("\n");
  if (nl === -1) return { subject: message, body: "" };
  return {
    subject: message.slice(0, nl),
    body: message.slice(nl + 1).replace(/^\n+/, "").replace(/\s+$/, ""),
  };
}

export function CommitForm({
  stagedCount,
  onCommitted,
}: {
  stagedCount: number;
  /** Called after a commit succeeds (e.g. to close the panel in the history view). */
  onCommitted?: () => void;
}) {
  const { identity, headCommit, loadIdentity, loadHeadCommit, createCommit, amendCommitMessage, discardAll } =
    useWorkingTreeStore();
  const { fetchViewport } = useGraphStore();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<MarkdownTab>("write");
  const [amending, setAmending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIdentity();
    loadHeadCommit();
  }, [loadIdentity, loadHeadCommit]);

  // Amend is only offered for a local (not-yet-pushed) tip commit.
  const canAmend = !!headCommit && !headCommit.pushed;

  const toggleAmend = () => {
    setError(null);
    if (!amending) {
      // Entering amend mode: prefill from the current tip message.
      const { subject: s, body: b } = splitMessage(headCommit?.message ?? "");
      setSubject(s);
      setBody(b);
      setTab("write");
      setAmending(true);
    } else {
      setSubject("");
      setBody("");
      setTab("write");
      setAmending(false);
    }
  };

  const previewHtml = useMemo(() => renderMarkdown(body), [body]);
  const hasSubject = subject.trim().length > 0;
  // Amending the message needs no staged changes; a normal commit does.
  const canCommit =
    hasSubject && !committing && (amending || stagedCount > 0);

  const handleCommit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    setError(null);
    const message = body.trim()
      ? `${subject.trim()}\n\n${body.trim()}`
      : subject.trim();
    try {
      if (amending) {
        await amendCommitMessage(message);
      } else {
        await createCommit(message);
      }
      setSubject("");
      setBody("");
      setTab("write");
      setAmending(false);
      await fetchViewport(0, GRAPH_INITIAL_LIMIT);
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

      {canAmend && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={amending} onChange={toggleAmend} />
          Amend last commit
        </label>
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
          {amending
            ? committing
              ? "Amending…"
              : "Amend"
            : committing
              ? "Committing…"
              : `Commit${stagedCount > 0 ? ` (${stagedCount})` : ""}`}
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
