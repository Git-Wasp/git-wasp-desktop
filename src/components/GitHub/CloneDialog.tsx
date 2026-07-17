import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import type { GithubRepo } from "../../types/github";
import type { RepoInfo } from "../../types/repo";

export function CloneDialog({ host, onClose }: { host: string; onClose: () => void }) {
  const { githubRepos, loadGithubRepos } = useGithubStore();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GithubRepo | null>(null);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadGithubRepos(host).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

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
      ref={rootRef}
      role="dialog"
      aria-label="Clone from GitHub"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-overlay)",
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

        <Input
          fullWidth
          placeholder="Search repositories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: "var(--space-2)" }}
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
            <Button variant="secondary" size="sm" onClick={() => void handleChooseFolder()}>
              Choose folder…
            </Button>
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
          <Button variant="secondary" fullWidth onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth disabled={!destPath || isCloning} onClick={() => void handleClone()}>
            {isCloning ? "Cloning…" : "Clone"}
          </Button>
        </div>
      </div>
    </div>
  );
}
