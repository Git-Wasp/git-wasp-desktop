import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommitDetail as CommitDetailData } from "../../types/repo";
import { FileList } from "./FileList";
import { useCommitFileStore } from "../../stores/commitFileStore";

interface CommitDetailProps {
  oid: string | null;
}

export function CommitDetail({ oid }: CommitDetailProps) {
  const [detail, setDetail] = useState<CommitDetailData | null>(null);
  const {
    oid: openOid,
    path: openPath,
    selectFile,
    clear: clearCommitFile,
  } = useCommitFileStore();

  useEffect(() => {
    if (!oid) {
      setDetail(null);
      clearCommitFile();
      return;
    }
    // A different commit: drop any file open in the main-panel diff so it returns
    // to the graph and this commit's file list reads fresh.
    clearCommitFile();
    invoke<CommitDetailData>("get_commit_diff", { oid }).then(setDetail);
  }, [oid, clearCommitFile]);

  if (!oid || !detail) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--color-text-muted)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        Select a commit to view details
      </div>
    );
  }

  const date = new Date(detail.authorTimestamp * 1000).toLocaleString();
  // Only highlight a file when its diff (for this commit) is the one open.
  const selectedPath = openOid === oid ? openPath : null;

  const handleSelect = (path: string) => {
    const file = detail.changedFiles.find((f) => f.path === path);
    selectFile(oid, path, file?.oldPath ?? null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Commit metadata */}
      <div
        style={{
          padding: "var(--space-4)",
          borderBottom: "1px solid var(--color-border-subtle)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-family-sans)",
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--color-text-primary)",
            marginBottom: "var(--space-2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {detail.message}
        </div>
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
          {detail.authorName} &lt;{detail.authorEmail}&gt; · {date}
        </div>
        <div
          style={{
            fontFamily: "var(--font-family-mono)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            marginTop: "var(--space-1)",
          }}
        >
          {detail.oid.slice(0, 12)}
        </div>
      </div>

      {/* File list — selecting a file opens its diff in the main panel */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <FileList
          files={detail.changedFiles}
          selectedPath={selectedPath}
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}
