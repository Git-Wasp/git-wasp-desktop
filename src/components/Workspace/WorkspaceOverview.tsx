import { useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import type { CrossRepoSearchResult } from "../../types/workspace";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

const INITIAL_LIMIT = 150;

const cellStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  textAlign: "left",
  borderBottom: "1px solid var(--color-border-subtle)",
};

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export function WorkspaceOverview() {
  const {
    activeWorkspace,
    repoStatuses,
    operationResults,
    searchResults,
    isFetchingAll,
    isPullingAll,
    fetchAll,
    pullAll,
    search,
  } = useWorkspaceStore();
  const { openRepo, loadBranches } = useRepoStore();
  const { fetchViewport, selectCommit } = useGraphStore();
  const [query, setQuery] = useState("");

  if (!activeWorkspace) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--color-text-muted)" }}>
        No workspace selected.
      </div>
    );
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      search(activeWorkspace.id, query);
    }
  };

  const handleResultClick = async (result: CrossRepoSearchResult) => {
    await openRepo(result.repoPath);
    await fetchViewport(0, INITIAL_LIMIT);
    loadBranches();
    if (result.kind === "Commit" && result.oid) {
      selectCommit(result.oid, false);
    }
  };

  return (
    <div style={{ padding: "var(--space-4)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-3)",
        }}
      >
        <h2 style={{ fontSize: "var(--font-size-base)", color: "var(--color-text-primary)" }}>
          {activeWorkspace.name}
        </h2>
        <div style={{ display: "flex", gap: "var(--space-1)" }}>
          <Button onClick={() => fetchAll(activeWorkspace.id)} disabled={isFetchingAll}>
            {isFetchingAll ? "Fetching…" : "Fetch all"}
          </Button>
          <Button onClick={() => pullAll(activeWorkspace.id)} disabled={isPullingAll}>
            {isPullingAll ? "Pulling…" : "Pull all"}
          </Button>
        </div>
      </div>

      {operationResults.length > 0 && (
        <div style={{ marginBottom: "var(--space-3)" }}>
          {operationResults.map((r) => (
            <div
              key={r.path}
              style={{
                fontSize: "var(--font-size-xs)",
                color: r.success ? "var(--color-success)" : "var(--color-danger)",
              }}
            >
              {r.name}: {r.message}
            </div>
          ))}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "var(--space-4)" }}>
        <thead>
          <tr>
            <th style={headerCellStyle}>Repository</th>
            <th style={headerCellStyle}>Branch</th>
            <th style={headerCellStyle}>Ahead/Behind</th>
            <th style={headerCellStyle}>Changes</th>
            <th style={headerCellStyle}>Error</th>
          </tr>
        </thead>
        <tbody>
          {repoStatuses.map((status) => (
            <tr key={status.path}>
              <td style={cellStyle}>{status.name}</td>
              <td style={{ ...cellStyle, fontFamily: "var(--font-family-mono)" }}>
                {status.headBranch ?? "detached"}
              </td>
              <td style={{ ...cellStyle, fontFamily: "var(--font-family-mono)" }}>
                {status.ahead > 0 && <span>↑{status.ahead}</span>}
                {status.ahead > 0 && status.behind > 0 && " "}
                {status.behind > 0 && <span>↓{status.behind}</span>}
              </td>
              <td style={cellStyle}>
                {status.uncommittedCount > 0 && <span>{status.uncommittedCount}</span>}
              </td>
              <td style={{ ...cellStyle, color: "var(--color-danger)" }}>{status.error}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Input
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        placeholder="Search branches and commits…"
        style={{ fontFamily: "var(--font-family-mono)", marginBottom: "var(--space-2)" }}
      />

      {searchResults.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {searchResults.map((r, i) => (
            <button
              key={`${r.repoPath}-${r.kind}-${r.label}-${i}`}
              onClick={() => handleResultClick(r)}
              style={{
                textAlign: "left",
                fontSize: "var(--font-size-sm)",
                fontFamily: "var(--font-family-mono)",
                background: "transparent",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-secondary)",
                padding: "var(--space-1) var(--space-2)",
                cursor: "pointer",
              }}
            >
              {r.repoName} · {r.kind}: {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
