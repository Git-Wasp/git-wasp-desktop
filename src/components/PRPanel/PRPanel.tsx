import { useEffect, useState } from "react";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import { PRRow } from "./PRRow";
import { NewPRForm } from "./NewPRForm";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

export function PRPanel() {
  const { remoteInfo, pullRequests, loadPullRequests, prDraft, setPrDraft } =
    useGithubStore();
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (remoteInfo) {
      loadPullRequests(remoteInfo.host).catch((e) => setError(String(e)));
    }
    // Re-keyed on activeRepoPath too, not just remoteInfo.host — two open
    // repos can share the same GitHub host (e.g. both on github.com), so
    // host alone wouldn't re-fire this effect on a switch between them and
    // the previous repo's PR list would linger until something else
    // triggered a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteInfo?.host, activeRepoPath]);

  // A pr draft (e.g. dropped from the commit graph) opens the form pre-seeded.
  useEffect(() => {
    if (prDraft) setShowNewForm(true);
  }, [prDraft]);

  const closeNewForm = () => {
    setShowNewForm(false);
    setPrDraft(null);
  };

  if (!remoteInfo) {
    return <EmptyState message="No GitHub remote detected for this repository." />;
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
        <Button variant="primary" size="sm" onClick={() => setShowNewForm((v) => !v)}>
          New Pull Request
        </Button>
      </div>

      {showNewForm && (
        <NewPRForm
          initialHead={prDraft?.head}
          initialBase={prDraft?.base}
          onCreated={closeNewForm}
          onCancel={closeNewForm}
        />
      )}

      {error && (
        <div style={{ padding: "var(--space-3)", color: "var(--color-danger)", fontSize: "var(--font-size-sm)" }}>
          {error}
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {pullRequests.length === 0 ? (
          <EmptyState message="No open pull requests." />
        ) : (
          pullRequests.map((pr) => <PRRow key={pr.number} pr={pr} />)
        )}
      </div>
    </div>
  );
}
