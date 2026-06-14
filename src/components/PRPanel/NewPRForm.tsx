import { useState } from "react";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import type { PullRequest } from "../../types/github";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

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
  initialHead,
  initialBase,
}: {
  onCreated: (pr: PullRequest) => void;
  onCancel: () => void;
  initialHead?: string;
  initialBase?: string;
}) {
  const { remoteInfo, createPullRequest } = useGithubStore();
  const { currentRepo, branches } = useRepoStore();

  const defaultBase = branches.find((b) => b.name === "main" || b.name === "master")?.name ?? "main";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [head, setHead] = useState(initialHead ?? currentRepo?.headBranch ?? "");
  const [base, setBase] = useState(initialBase ?? defaultBase);
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
      <Input
        fullWidth
        placeholder="Pull request title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ marginBottom: "var(--space-2)" }}
      />
      <textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <Input
          placeholder="head branch"
          value={head}
          onChange={(e) => setHead(e.target.value)}
          style={{ flex: 1, fontFamily: "var(--font-family-mono)" }}
        />
        <span style={{ color: "var(--color-text-muted)" }}>→</span>
        <Input
          placeholder="base branch"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          style={{ flex: 1, fontFamily: "var(--font-family-mono)" }}
        />
      </div>

      {error && (
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-danger)", marginBottom: "var(--space-2)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
        <Button variant="secondary" fullWidth onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          fullWidth
          onClick={handleSubmit}
          disabled={isSubmitting || !title.trim() || !head.trim() || !base.trim()}
        >
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </div>
    </div>
  );
}
