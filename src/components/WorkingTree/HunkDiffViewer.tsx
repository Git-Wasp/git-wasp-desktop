import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import type { FileDiffHunks } from "../../types/workingTree";

export function HunkDiffViewer({
  diffHunks,
  kind,
  onDiscardFile,
  onClose,
}: {
  diffHunks: FileDiffHunks;
  kind: "staged" | "unstaged";
  onDiscardFile?: () => void;
  onClose?: () => void;
}) {
  const { stageHunk, unstageHunk, discardHunk } = useWorkingTreeStore();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--color-border-subtle)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-family-mono)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-secondary)",
          }}
        >
          {diffHunks.path}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {kind === "unstaged" && onDiscardFile && (
            <button
              onClick={onDiscardFile}
              style={{
                fontSize: "var(--font-size-xs)",
                padding: "2px var(--space-2)",
                background: "transparent",
                border: "1px solid var(--color-danger)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-danger)",
                cursor: "pointer",
              }}
            >
              Discard file
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close diff"
              title="Close diff"
              style={{
                fontSize: "var(--font-size-sm)",
                lineHeight: 1,
                padding: "2px var(--space-2)",
                background: "transparent",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Hunks */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {diffHunks.hunks.length === 0 ? (
          <div
            style={{
              padding: "var(--space-4)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
              textAlign: "center",
            }}
          >
            No changes
          </div>
        ) : (
          diffHunks.hunks.map((hunk) => (
            <div key={hunk.index} style={{ marginBottom: "var(--space-1)" }}>
              {/* Hunk header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--color-bg-hunk-header)",
                  padding: "var(--space-1) var(--space-3)",
                  borderTop: "1px solid var(--color-border-subtle)",
                  borderBottom: "1px solid var(--color-border-subtle)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-family-mono)",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {hunk.header}
                </span>
                <div style={{ display: "flex", gap: "var(--space-1)" }}>
                  {kind === "unstaged" && (
                    <>
                      <button
                        onClick={() =>
                          stageHunk(diffHunks.path, hunk.index)
                        }
                        style={hunkButtonStyle("accent")}
                      >
                        Stage hunk
                      </button>
                      <button
                        onClick={() =>
                          discardHunk(diffHunks.path, hunk.index)
                        }
                        style={hunkButtonStyle("danger")}
                      >
                        Discard
                      </button>
                    </>
                  )}
                  {kind === "staged" && (
                    <button
                      onClick={() =>
                        unstageHunk(diffHunks.path, hunk.index)
                      }
                      style={hunkButtonStyle("muted")}
                    >
                      Unstage hunk
                    </button>
                  )}
                </div>
              </div>

              {/* Hunk content */}
              <pre
                style={{
                  margin: 0,
                  padding: "var(--space-1) var(--space-3)",
                  fontFamily: "var(--font-family-mono)",
                  fontSize: "var(--font-size-xs)",
                  lineHeight: 1.6,
                  overflowX: "auto",
                  background: "var(--color-bg-surface)",
                }}
              >
                {hunk.content.split("\n").map((line, i) => (
                  <div
                    key={i}
                    style={{
                      background: line.startsWith("+")
                        ? "var(--color-diff-add-bg)"
                        : line.startsWith("-")
                          ? "var(--color-diff-del-bg)"
                          : "transparent",
                      color: line.startsWith("+")
                        ? "var(--color-diff-add)"
                        : line.startsWith("-")
                          ? "var(--color-diff-del)"
                          : "var(--color-text-primary)",
                    }}
                  >
                    {line || " "}
                  </div>
                ))}
              </pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function hunkButtonStyle(variant: "accent" | "danger" | "muted") {
  const colors = {
    accent: {
      border: "var(--color-accent-primary)",
      color: "var(--color-accent-primary)",
    },
    danger: {
      border: "var(--color-danger)",
      color: "var(--color-danger)",
    },
    muted: {
      border: "var(--color-border-subtle)",
      color: "var(--color-text-muted)",
    },
  };
  const c = colors[variant];
  return {
    fontSize: "var(--font-size-xs)" as const,
    padding: "2px var(--space-2)",
    background: "transparent",
    border: `1px solid ${c.border}`,
    borderRadius: "var(--radius-sm)",
    color: c.color,
    cursor: "pointer" as const,
  };
}
