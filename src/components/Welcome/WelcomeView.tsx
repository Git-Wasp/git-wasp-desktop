import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "../../stores/repoStore";
import { useGithubStore } from "../../stores/githubStore";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/Button";
import { GitHubIcon } from "../ui/icons";
import { WaspLogo } from "../ui/WaspLogo";
import { CloneDialog } from "../GitHub/CloneDialog";

const cardStyle: React.CSSProperties = {
  width: "min(460px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

const recentRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  textAlign: "left",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
  width: "100%",
};

/**
 * The "new tab" / no-repo landing screen: instead of jumping straight to the OS
 * file picker, offer the three ways into a repo — open a local folder, clone from
 * GitHub, or reopen a recent repository.
 */
export function WelcomeView() {
  const { openRepo, recentRepos, loadRecentRepos } = useRepoStore();
  const remoteInfo = useGithubStore((s) => s.remoteInfo);
  const [showCloneDialog, setShowCloneDialog] = useState(false);

  useEffect(() => {
    void loadRecentRepos();
  }, [loadRecentRepos]);

  const host = remoteInfo?.host ?? "github.com";

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    try {
      await openRepo(selected);
    } catch (e) {
      useToastStore.getState().error(String(e), { title: "Couldn't open repository" });
    }
  };

  const handleOpenRecent = async (path: string) => {
    try {
      await openRepo(path);
    } catch (e) {
      useToastStore.getState().error(String(e), { title: "Couldn't open repository" });
    }
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-5)",
      }}
    >
      <div style={{ ...cardStyle, alignItems: "center", marginBottom: "var(--space-5)", gap: "var(--space-2)" }}>
        <WaspLogo size={72} />
        <div
          style={{
            fontSize: "var(--font-size-2xl)",
            fontWeight: "var(--font-weight-bold)",
            letterSpacing: "-0.02em",
            color: "var(--color-text-primary)",
          }}
        >
          Git Wasp
        </div>
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
          Branch fast. Merge clean. Don't get stung.
        </div>
      </div>

      <div style={cardStyle}>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--font-size-xl)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-primary)",
            }}
          >
            Open a repository
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
            Open a local folder, clone one from GitHub, or pick up where you left off.
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="primary" onClick={() => void handleOpenFolder()}>
            Open repository…
          </Button>
          <Button onClick={() => setShowCloneDialog(true)}>
            <GitHubIcon size={14} />
            Clone from GitHub…
          </Button>
        </div>

        {recentRepos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Recent
            </div>
            {recentRepos.map((r) => (
              <button
                key={r.path}
                type="button"
                onClick={() => void handleOpenRecent(r.path)}
                title={r.path}
                style={recentRowStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-elevated)")}
              >
                <span
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontWeight: "var(--font-weight-medium)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {r.name}
                </span>
                <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-muted)",
                    fontFamily: "var(--font-family-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.path}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showCloneDialog && <CloneDialog host={host} onClose={() => setShowCloneDialog(false)} />}
    </div>
  );
}
