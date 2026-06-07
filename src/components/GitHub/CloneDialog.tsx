import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import type { GithubRepo } from "../../types/github";
import type { RepoInfo } from "../../types/repo";

export function CloneDialog({ host, onClose }: { host: string; onClose: () => void }) {
  const { githubRepos, loadGithubRepos } = useGithubStore();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GithubRepo | null>(null);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGithubRepos(host).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  const filtered = githubRepos.filter((r) =>
    r.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const destPath = selected && destDir ? `${destDir}/${selected.name}` : null;

  const handleChooseFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setDestDir(dir);
  };

  const handleClone = async () => {
    if (!selected || !destPath) return;
    setIsCloning(true);
    setError(null);
    try {
      const repo = await invoke<RepoInfo>("clone_repo", { url: selected.cloneUrl, destPath });
      useRepoStore.setState({ currentRepo: repo });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Clone from GitHub"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 420,
          padding: "var(--space-5)",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          color: "var(--color-text-primary)",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "var(--space-3)",
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Clone from GitHub
        </h2>

        <input
          placeholder="Search repositories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
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
          }}
        />

        <div style={{ overflowY: "auto", maxHeight: 240, marginBottom: "var(--space-3)" }}>
          {filtered.length === 0 && (
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", padding: "var(--space-2)" }}>
              No repositories found.
            </div>
          )}
          {filtered.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelected(r)}
              style={{
                padding: "var(--space-1) var(--space-2)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-sm)",
                fontFamily: "var(--font-family-mono)",
                cursor: "pointer",
                background: selected?.id === r.id ? "var(--color-bg-elevated)" : "transparent",
                color: selected?.id === r.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              }}
            >
              {r.fullName}
              {r.private && (
                <span style={{ marginLeft: "var(--space-2)", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                  (private)
                </span>
              )}
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <button
              onClick={handleChooseFolder}
              style={{
                padding: "var(--space-1) var(--space-2)",
                fontSize: "var(--font-size-xs)",
                background: "transparent",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              Choose folder…
            </button>
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                fontFamily: "var(--font-family-mono)",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {destPath ?? "No destination chosen"}
            </span>
          </div>
        )}

        {error && (
          <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-danger)", marginBottom: "var(--space-3)" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "var(--space-2)",
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
            onClick={handleClone}
            disabled={!destPath || isCloning}
            style={{
              flex: 1,
              padding: "var(--space-2)",
              fontSize: "var(--font-size-sm)",
              background: "var(--color-accent-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: !destPath || isCloning ? "default" : "pointer",
              opacity: !destPath || isCloning ? 0.6 : 1,
            }}
          >
            {isCloning ? "Cloning…" : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
}
