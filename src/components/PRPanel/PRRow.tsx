import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../ui/Button";
import { useToastStore } from "../../stores/toastStore";
import { isHttpUrl } from "../../lib/safeUrl";
import type { CiStatus, PullRequest } from "../../types/github";

const ciBadge: Record<CiStatus, { label: string; color: string }> = {
  success: { label: "Success", color: "var(--color-success)" },
  failure: { label: "Failure", color: "var(--color-danger)" },
  pending: { label: "Pending", color: "var(--color-warning)" },
  none: { label: "No checks", color: "var(--color-text-muted)" },
};

export function PRRow({ pr }: { pr: PullRequest }) {
  const badge = ciBadge[pr.ciStatus];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        title={badge.label}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: badge.color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: "var(--font-size-xs)", color: badge.color, flexShrink: 0 }}>
        {badge.label}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pr.title}
          <span style={{ color: "var(--color-text-muted)" }}> #{pr.number}</span>
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-family-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pr.author} · {pr.headRef} → {pr.baseRef}
        </div>
      </div>

      <span
        title="Approvals"
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-secondary)",
          flexShrink: 0,
        }}
      >
        ✓ {pr.approvalCount}
      </span>

      <Button
        size="sm"
        onClick={() => {
          if (isHttpUrl(pr.url)) {
            void openUrl(pr.url).catch((e: unknown) =>
              useToastStore.getState().error(String(e), { title: "Couldn't open pull request" }),
            );
          }
        }}
        style={{ flexShrink: 0 }}
      >
        Open
      </Button>
    </div>
  );
}
