import { Button } from "../ui/Button";

interface MergeConfirmDialogProps {
  source: string;
  target: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** When provided, offers "Start pull request instead" as an alternative. */
  onStartPullRequest?: () => void;
}

function BranchChip({ name }: { name: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-family-mono)",
        fontSize: "var(--font-size-xs)",
        padding: "1px var(--space-2)",
        background: "var(--color-bg-elevated)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-primary)",
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </span>
  );
}

/**
 * Confirmation modal shown when a branch pill is dropped onto another in the
 * graph. Confirms merging `source` into `target` (checking out `target` first),
 * or offers to open a pull request instead. Replaces the inline drop menu so the
 * action is deliberate rather than a single stray click. Escape cancels.
 */
export function MergeConfirmDialog({
  source,
  target,
  onConfirm,
  onCancel,
  onStartPullRequest,
}: MergeConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-label="Merge branch"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
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
          width: 400,
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
          Merge branch
        </h2>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            marginBottom: "var(--space-3)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span>Merge</span>
          <BranchChip name={source} />
          <span>into</span>
          <BranchChip name={target} />
        </div>

        <p
          style={{
            margin: 0,
            marginBottom: "var(--space-4)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            lineHeight: "var(--line-height-normal)",
          }}
        >
          {target} will be checked out and {source} merged into it. Any conflicts open in the merge
          editor.
        </p>

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {onStartPullRequest && (
            <Button variant="tertiary" onClick={onStartPullRequest}>
              Start pull request instead
            </Button>
          )}
          <Button variant="primary" onClick={onConfirm}>
            Merge
          </Button>
        </div>
      </div>
    </div>
  );
}
