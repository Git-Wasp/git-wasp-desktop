import { useState } from "react";
import type {
  CreateWorktreeMode,
  CreateWorktreeRequest,
} from "../../types/repo";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export function CreateWorktreeDialog({
  defaultStartPoint,
  onCancel,
  onConfirm,
}: {
  defaultStartPoint?: string;
  onCancel: () => void;
  onConfirm: (request: CreateWorktreeRequest) => void;
}) {
  const [mode, setMode] = useState<CreateWorktreeMode>("newBranchFromBase");
  const [branchName, setBranchName] = useState("");
  const [startPoint, setStartPoint] = useState(defaultStartPoint ?? "");
  const [targetPath, setTargetPath] = useState("");
  const [existingBranch, setExistingBranch] = useState("");

  const trimmedBranchName = branchName.trim();
  const trimmedStartPoint = startPoint.trim();
  const trimmedTargetPath = targetPath.trim();
  const trimmedExistingBranch = existingBranch.trim();

  const canConfirm =
    mode === "newBranchFromBase"
      ? trimmedBranchName.length > 0 &&
        trimmedStartPoint.length > 0 &&
        trimmedTargetPath.length > 0
      : trimmedExistingBranch.length > 0 && trimmedTargetPath.length > 0;

  const confirm = () => {
    if (!canConfirm) return;

    if (mode === "newBranchFromBase") {
      onConfirm({
        mode,
        branchName: trimmedBranchName,
        startPoint: trimmedStartPoint,
        targetPath: trimmedTargetPath,
      });
      return;
    }

    onConfirm({
      mode,
      branchName: trimmedExistingBranch,
      targetPath: trimmedTargetPath,
    });
  };

  return (
    <div
      role="dialog"
      aria-label="Create worktree"
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
          Create worktree
        </h2>

        <div
          style={{
            display: "grid",
            gap: "var(--space-2)",
            marginBottom: "var(--space-4)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <input
              type="radio"
              name="create-worktree-mode"
              checked={mode === "newBranchFromBase"}
              onChange={() => setMode("newBranchFromBase")}
            />
            New branch from base
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <input
              type="radio"
              name="create-worktree-mode"
              checked={mode === "existingBranch"}
              onChange={() => setMode("existingBranch")}
            />
            Existing branch
          </label>
        </div>

        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {mode === "newBranchFromBase" ? (
            <>
              <label
                style={{
                  display: "grid",
                  gap: "var(--space-1)",
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Branch name
                <Input
                  autoFocus
                  fullWidth
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                />
              </label>
              <label
                style={{
                  display: "grid",
                  gap: "var(--space-1)",
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Base branch or commit
                <Input
                  fullWidth
                  value={startPoint}
                  onChange={(e) => setStartPoint(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label
              style={{
                display: "grid",
                gap: "var(--space-1)",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-secondary)",
              }}
            >
              Existing branch
              <Input
                autoFocus
                fullWidth
                value={existingBranch}
                onChange={(e) => setExistingBranch(e.target.value)}
              />
            </label>
          )}

          <label
            style={{
              display: "grid",
              gap: "var(--space-1)",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-secondary)",
            }}
          >
            Target path
            <Input
              fullWidth
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
            />
          </label>
        </div>

        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            marginTop: "var(--space-4)",
          }}
        >
          <Button variant="secondary" fullWidth onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            fullWidth
            disabled={!canConfirm}
            onClick={confirm}
          >
            Create worktree
          </Button>
        </div>
      </div>
    </div>
  );
}
