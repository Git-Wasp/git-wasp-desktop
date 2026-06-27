import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import { useRemoteStore } from "../../stores/remoteStore";
import type { PullRequest } from "../../types/github";
import { compareUrl, headBranchIsOnRemote } from "../../lib/githubPr";
import { renderMarkdown } from "../../lib/markdown";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { MultiSelect, type MultiSelectOption } from "../ui/MultiSelect";

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  background: "var(--color-bg-input)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-primary)",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  marginBottom: "var(--space-1)",
};

type BodyTab = "write" | "preview";

/** A small swatch + name row for a GitHub label in the picker. */
function LabelOption({ name, color }: { name: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          flexShrink: 0,
          background: `#${color}`,
          border: "1px solid var(--color-border-subtle)",
        }}
      />
      {name}
    </span>
  );
}

export function NewPRForm({
  onCreated,
  onCancel,
  initialHead,
  initialBase,
}: {
  onCreated: (pr: PullRequest) => void;
  onCancel: () => void;
  initialHead?: string;
  initialBase?: string;
}) {
  const {
    remoteInfo,
    connections,
    assignableUsers,
    repoLabels,
    loadAssignableUsers,
    loadRepoLabels,
    createPullRequest,
  } = useGithubStore();
  const { currentRepo, branches } = useRepoStore();
  const push = useRemoteStore((s) => s.push);

  const defaultBase = branches.find((b) => b.name === "main" || b.name === "master")?.name ?? "main";
  const isConnected = !!remoteInfo && connections[remoteInfo.host]?.state === "connected";
  const me = (remoteInfo && connections[remoteInfo.host]?.login) || "";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [bodyTab, setBodyTab] = useState<BodyTab>("write");
  const [head, setHead] = useState(initialHead ?? currentRepo?.headBranch ?? "");
  const [base, setBase] = useState(initialBase ?? defaultBase);
  const [assignees, setAssignees] = useState<string[]>(me ? [me] : []);
  const [labels, setLabels] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Branches we've pushed in this session. `push` (no `-u`) doesn't create a
  // local tracking ref, so without this the button would still read "Push &
  // create PR" after a successful push.
  const [pushedHeads, setPushedHeads] = useState<string[]>([]);

  // GitHub rejects a PR whose head it hasn't seen, so when the chosen head
  // hasn't been pushed we push it first as part of opening the PR.
  const headPushed = headBranchIsOnRemote(head, branches) || pushedHeads.includes(head);

  // Populate the assignees/labels pickers from GitHub once we have a working
  // connection. Best-effort: a failure just leaves the pickers empty (the user
  // can still open the PR, and "Continue on GitHub" remains available).
  useEffect(() => {
    if (!isConnected || !remoteInfo) return;
    void loadAssignableUsers(remoteInfo.host).catch(() => {});
    void loadRepoLabels(remoteInfo.host).catch(() => {});
  }, [isConnected, remoteInfo, loadAssignableUsers, loadRepoLabels]);

  // Local branches drive the head/base pickers. Keep whatever's currently
  // selected in the list even if it isn't a known local branch (e.g. an
  // initialBase like "develop"), so the <select> can still show it.
  const branchOptions = (selected: string) => {
    const locals = branches.filter((b) => !b.isRemote).map((b) => b.name);
    return Array.from(new Set([selected, ...locals].filter(Boolean)));
  };

  // Union the fetched options with anything already selected, so a selection
  // (e.g. the @me default before the list loads) stays visible and toggleable.
  const assigneeOptions: MultiSelectOption[] = useMemo(() => {
    const values = Array.from(new Set([...assignees, ...assignableUsers]));
    return values.map((value) => ({ value }));
  }, [assignees, assignableUsers]);

  const labelOptions: MultiSelectOption[] = useMemo(() => {
    const known = new Map(repoLabels.map((l) => [l.name, l.color]));
    const values = Array.from(new Set([...labels, ...repoLabels.map((l) => l.name)]));
    return values.map((value) => ({
      value,
      render: <LabelOption name={value} color={known.get(value) ?? "888888"} />,
    }));
  }, [labels, repoLabels]);

  const previewHtml = useMemo(() => renderMarkdown(body), [body]);

  const canSubmit = !!remoteInfo && !!title.trim() && !!head.trim() && !!base.trim();

  const handleSubmit = async () => {
    if (!canSubmit || !remoteInfo) return;
    setIsSubmitting(true);
    setError(null);
    try {
      // Push the head branch first when it isn't on the remote yet, otherwise
      // GitHub 422s the PR. If the push fails we stop and surface the error
      // rather than letting the create fail with a cryptic message.
      if (!headPushed) {
        await push(undefined, head.trim());
        setPushedHeads((prev) => (prev.includes(head) ? prev : [...prev, head]));
      }
      const pr = await createPullRequest(
        remoteInfo.host,
        title.trim(),
        body,
        head.trim(),
        base.trim(),
        assignees,
        labels,
      );
      onCreated(pr);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinueOnGitHub = () => {
    if (!remoteInfo) return;
    void openUrl(
      compareUrl({
        host: remoteInfo.host,
        owner: remoteInfo.owner,
        repo: remoteInfo.repo,
        base,
        head,
        title,
        body,
        assignees,
        labels,
      }),
    );
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "var(--space-1) var(--space-2)",
    fontSize: "var(--font-size-xs)",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
  });

  return (
    <div
      style={{
        padding: "var(--space-3)",
        borderBottom: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <Input
        fullWidth
        placeholder="Pull request title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>From (source)</span>
          <select
            aria-label="head branch"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            style={{ ...fieldStyle, fontFamily: "var(--font-family-mono)" }}
          >
            {branchOptions(head).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: "var(--color-text-muted)", paddingBottom: "var(--space-1)" }}>→</span>
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>Into (base)</span>
          <select
            aria-label="base branch"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            style={{ ...fieldStyle, fontFamily: "var(--font-family-mono)" }}
          >
            {branchOptions(base).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-1)" }}>
          <button type="button" style={tabStyle(bodyTab === "write")} onClick={() => setBodyTab("write")}>
            Write
          </button>
          <button
            type="button"
            style={tabStyle(bodyTab === "preview")}
            onClick={() => setBodyTab("preview")}
          >
            Preview
          </button>
        </div>
        {bodyTab === "write" ? (
          <textarea
            placeholder="Description (optional, supports markdown)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            style={{ ...fieldStyle, resize: "vertical", fontFamily: "var(--font-family-sans)" }}
          />
        ) : (
          <div
            className="markdown-preview"
            style={{ ...fieldStyle, minHeight: 88, overflowY: "auto" }}
            // Safe: renderMarkdown HTML-escapes input before adding its own tags.
            dangerouslySetInnerHTML={{
              __html:
                previewHtml || '<span style="color:var(--color-text-muted)">Nothing to preview</span>',
            }}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={labelStyle}>Assignees</span>
          <MultiSelect
            ariaLabel="assignees"
            disabled={!isConnected}
            options={assigneeOptions}
            selected={assignees}
            onChange={setAssignees}
            placeholder={isConnected ? "None" : "Connect GitHub"}
            emptyLabel="No assignable users"
          />
        </label>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={labelStyle}>Labels</span>
          <MultiSelect
            ariaLabel="labels"
            disabled={!isConnected}
            options={labelOptions}
            selected={labels}
            onChange={setLabels}
            placeholder={isConnected ? "None" : "Connect GitHub"}
            emptyLabel="No labels defined"
          />
        </label>
      </div>
      {!isConnected && (
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
          Connect your GitHub account (Settings → GitHub) to choose assignees and labels.
        </div>
      )}

      {!headPushed && head.trim() && (
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
          <code style={{ color: "var(--color-text-secondary)" }}>{head}</code> hasn&apos;t been pushed
          yet — it&apos;ll be pushed to the remote when you open the PR.
        </div>
      )}

      {error && (
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-danger)" }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          onClick={handleContinueOnGitHub}
          disabled={!remoteInfo || !head.trim() || !base.trim()}
          title="Open GitHub's compare page with these details pre-filled"
        >
          Continue on GitHub
        </Button>
        <Button
          variant="primary"
          fullWidth
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={isSubmitting || !canSubmit}
        >
          {isSubmitting
            ? headPushed
              ? "Creating…"
              : "Pushing…"
            : headPushed
              ? "Create"
              : "Push & create PR"}
        </Button>
      </div>
    </div>
  );
}
