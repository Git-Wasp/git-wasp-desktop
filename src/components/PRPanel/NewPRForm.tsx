import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import type { PullRequest } from "../../types/github";
import { compareUrl, parseList } from "../../lib/githubPr";
import { renderMarkdown } from "../../lib/markdown";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

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
  const { remoteInfo, connections, createPullRequest } = useGithubStore();
  const { currentRepo, branches } = useRepoStore();

  const defaultBase = branches.find((b) => b.name === "main" || b.name === "master")?.name ?? "main";
  const me = (remoteInfo && connections[remoteInfo.host]?.login) || "";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [bodyTab, setBodyTab] = useState<BodyTab>("write");
  const [head, setHead] = useState(initialHead ?? currentRepo?.headBranch ?? "");
  const [base, setBase] = useState(initialBase ?? defaultBase);
  const [assigneesText, setAssigneesText] = useState(me);
  const [labelsText, setLabelsText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local branches drive the head/base pickers. Keep whatever's currently
  // selected in the list even if it isn't a known local branch (e.g. an
  // initialBase like "develop"), so the <select> can still show it.
  const branchOptions = (selected: string) => {
    const locals = branches.filter((b) => !b.isRemote).map((b) => b.name);
    return Array.from(new Set([selected, ...locals].filter(Boolean)));
  };

  const previewHtml = useMemo(() => renderMarkdown(body), [body]);
  const assignees = useMemo(() => parseList(assigneesText), [assigneesText]);
  const labels = useMemo(() => parseList(labelsText), [labelsText]);

  const canSubmit = !!remoteInfo && !!title.trim() && !!head.trim() && !!base.trim();

  const handleSubmit = async () => {
    if (!canSubmit || !remoteInfo) return;
    setIsSubmitting(true);
    setError(null);
    try {
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
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>Assignees</span>
          <Input
            fullWidth
            placeholder="comma-separated logins"
            value={assigneesText}
            onChange={(e) => setAssigneesText(e.target.value)}
          />
        </label>
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>Labels</span>
          <Input
            fullWidth
            placeholder="comma-separated labels"
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
          />
        </label>
      </div>

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
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </div>
    </div>
  );
}
