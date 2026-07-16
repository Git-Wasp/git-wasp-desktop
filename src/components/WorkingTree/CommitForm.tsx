import { useEffect, useMemo, useState } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useRepoStore } from "../../stores/repoStore";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Input } from "../ui/Input";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useGraphStore, GRAPH_INITIAL_LIMIT } from "../../stores/graphStore";
import { renderMarkdown, MARKDOWN_TAB_OPTIONS, type MarkdownTab } from "../../lib/markdown";

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
  const currentRepo = useRepoStore((s) => s.currentRepo);
  const createBranch = useRepoStore((s) => s.createBranch);
  const checkoutBranch = useRepoStore((s) => s.checkoutBranch);
  const fastForwardBranch = useRepoStore((s) => s.fastForwardBranch);
  const listFastForwardableBranches = useRepoStore((s) => s.listFastForwardableBranches);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<MarkdownTab>("write");
  const [amending, setAmending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Detached HEAD: a repo is open but HEAD is on a bare commit, not a branch.
  // Committing here would orphan the commit (unpushable), so we require the user
  // to land it on a branch first. `null` current repo means "no repo" (e.g. in
  // tests), which is not the detached case.
  const detached = !!currentRepo && currentRepo.headBranch === null;
  const [branchName, setBranchName] = useState("");
  // Existing local branches that this detached commit could fast-forward — the
  // recovery for "I committed on a detached HEAD; advance main to it".
  const [ffBranches, setFfBranches] = useState<string[]>([]);

  useEffect(() => {
    loadIdentity();
    loadHeadCommit();
  }, [loadIdentity, loadHeadCommit]);

  useEffect(() => {
    if (detached && headCommit?.oid) {
      listFastForwardableBranches(headCommit.oid).then(setFfBranches).catch(() => setFfBranches([]));
    } else {
      setFfBranches([]);
    }
  }, [detached, headCommit?.oid, listFastForwardableBranches]);

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
    !detached && hasSubject && !committing && (amending || stagedCount > 0);

  const composeMessage = () =>
    body.trim() ? `${subject.trim()}\n\n${body.trim()}` : subject.trim();

  const resetForm = () => {
    setSubject("");
    setBody("");
    setTab("write");
    setAmending(false);
    setBranchName("");
  };

  const handleCommit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    setError(null);
    const message = composeMessage();
    try {
      if (amending) {
        await amendCommitMessage(message);
      } else {
        await createCommit(message);
      }
      resetForm();
      await fetchViewport(0, GRAPH_INITIAL_LIMIT);
      onCommitted?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  // Detached recovery A: create a branch at HEAD, switch to it (the working tree
  // already matches, so no tree change), then land the commit on that branch.
  const handleCreateBranchAndCommit = async () => {
    const name = branchName.trim();
    if (!name || !hasSubject || stagedCount === 0) return;
    setCommitting(true);
    setError(null);
    try {
      await createBranch(name);
      await checkoutBranch(name);
      await createCommit(composeMessage());
      resetForm();
      await fetchViewport(0, GRAPH_INITIAL_LIMIT);
      onCommitted?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setCommitting(false);
    }
  };

  // Detached recovery B: advance an existing branch to this commit and switch to
  // it — the "fast-forward main to my detached commit, then check main out" fix.
  const handleFastForwardAndSwitch = async (branch: string) => {
    if (!headCommit?.oid) return;
    setCommitting(true);
    setError(null);
    try {
      await fastForwardBranch(branch, headCommit.oid);
      await checkoutBranch(branch);
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

      {detached && (
        <div
          role="alert"
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-warning)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-warning)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2)",
            lineHeight: 1.4,
          }}
        >
          You're not on a branch (detached HEAD). Create a branch so this commit
          isn't lost and can be pushed.
        </div>
      )}

      {!detached && canAmend && (
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
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            if (detached) handleCreateBranchAndCommit();
            else handleCommit();
          }
        }}
      />

      <SegmentedControl
        ariaLabel="Description mode"
        options={MARKDOWN_TAB_OPTIONS}
        value={tab}
        onChange={setTab}
      />

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
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              if (detached) handleCreateBranchAndCommit();
              else handleCommit();
            }
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

      {detached && (
        <Input
          fullWidth
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="New branch name"
          aria-label="New branch name"
          style={{ fontFamily: "var(--font-family-mono)" }}
        />
      )}

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button
          variant="danger"
          onClick={() => setConfirmReset(true)}
          title="Discard all working-tree changes"
        >
          Reset
        </Button>
        {detached ? (
          <Button
            variant="primary"
            fullWidth
            onClick={handleCreateBranchAndCommit}
            disabled={!branchName.trim() || !hasSubject || stagedCount === 0 || committing}
          >
            {committing ? "Creating…" : "Create branch & commit"}
          </Button>
        ) : (
          <Button variant="primary" fullWidth onClick={handleCommit} disabled={!canCommit}>
            {amending
              ? committing
                ? "Amending…"
                : "Amend"
              : committing
                ? "Committing…"
                : `Commit${stagedCount > 0 ? ` (${stagedCount})` : ""}`}
          </Button>
        )}
      </div>

      {detached && ffBranches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
            Or advance an existing branch to this commit and switch to it:
          </div>
          {ffBranches.map((b) => (
            <Button
              key={b}
              variant="secondary"
              fullWidth
              disabled={committing}
              onClick={() => handleFastForwardAndSwitch(b)}
              style={{ fontFamily: "var(--font-family-mono)" }}
            >
              Fast-forward {b} &amp; switch
            </Button>
          ))}
        </div>
      )}

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
