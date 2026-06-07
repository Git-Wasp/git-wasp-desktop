import { useState } from "react";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import type { PullRequest } from "../../types/github";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-1) var(--space-2)",
  marginBottom: "var(--space-2)",
  fontSize: "var(--font-size-sm)",
  background: "var(--color-bg-input)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-primary)",
  outline: "none",
};

export function NewPRForm({
  onCreated,
  onCancel,
}: {
  onCreated: (pr: PullRequest) => void;
  onCancel: () => void;
}) {
  const { remoteInfo, createPullRequest } = useGithubStore();
  const { currentRepo, branches } = useRepoStore();

  const defaultBase = branches.find((b) => b.name === "main" || b.name === "master")?.name ?? "main";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [head, setHead] = useState(currentRepo?.headBranch ?? "");
  const [base, setBase] = useState(defaultBase);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!remoteInfo || !title.trim() || !head.trim() || !base.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const pr = await createPullRequest(remoteInfo.host, title.trim(), body, head.trim(), base.trim());
      onCreated(pr);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        padding: "var(--space-3)",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <input
        placeholder="Pull request title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={inputStyle}
      />
      <textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <input
          placeholder="head branch"
          value={head}
          onChange={(e) => setHead(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-family-mono)" }}
        />
        <span style={{ alignSelf: "center", color: "var(--color-text-muted)" }}>→</span>
        <input
          placeholder="base branch"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-family-mono)" }}
        />
      </div>

      {error && (
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-danger)", marginBottom: "var(--space-2)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "var(--space-1) var(--space-2)",
            fontSize: "var(--font-size-sm)",
            background: "transparent",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !title.trim() || !head.trim() || !base.trim()}
          style={{
            flex: 1,
            padding: "var(--space-1) var(--space-2)",
            fontSize: "var(--font-size-sm)",
            background: "var(--color-accent-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: isSubmitting ? "default" : "pointer",
            opacity: isSubmitting ? 0.6 : 1,
          }}
        >
          {isSubmitting ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}
