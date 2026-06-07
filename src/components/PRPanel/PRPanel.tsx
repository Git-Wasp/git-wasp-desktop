import { useEffect, useState } from "react";
import { useGithubStore } from "../../stores/githubStore";
import { PRRow } from "./PRRow";
import { NewPRForm } from "./NewPRForm";

export function PRPanel() {
  const { remoteInfo, pullRequests, loadPullRequests } = useGithubStore();
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (remoteInfo) {
      loadPullRequests(remoteInfo.host).catch((e) => setError(String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteInfo?.host]);

  if (!remoteInfo) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
        No GitHub remote detected for this repository.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-3)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-text-primary)",
          }}
        >
          Pull Requests · {remoteInfo.owner}/{remoteInfo.repo}
        </span>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          style={{
            fontSize: "var(--font-size-xs)",
            padding: "var(--space-1) var(--space-2)",
            background: "var(--color-accent-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          New Pull Request
        </button>
      </div>

      {showNewForm && (
        <NewPRForm
          onCreated={() => setShowNewForm(false)}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {error && (
        <div style={{ padding: "var(--space-3)", color: "var(--color-danger)", fontSize: "var(--font-size-sm)" }}>
          {error}
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {pullRequests.length === 0 ? (
          <div style={{ padding: "var(--space-4)", color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
            No open pull requests.
          </div>
        ) : (
          pullRequests.map((pr) => <PRRow key={pr.number} pr={pr} />)
        )}
      </div>
    </div>
  );
}
