import { selectHookRun, useHookStore } from "../../stores/hookStore";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";

export function HookStatusBar({ repoPath }: { repoPath: string }) {
  const run = useHookStore(selectHookRun(repoPath));
  const setPaneVisible = useHookStore((state) => state.setPaneVisible);

  let message = "Git hooks ready";
  let color = "var(--color-text-secondary)";
  if (run?.status === "running" && run.hook) {
    message = `Running ${run.hook}…`;
    color = "var(--color-text-primary)";
  } else if (run?.status === "succeeded" && run.hook) {
    message = `${run.hook} succeeded`;
    color = "var(--color-success)";
  } else if (run?.status === "failed" && run.hook) {
    message = `${run.hook} failed; review hook output`;
    color = "var(--color-danger)";
  }

  const hasRetainedOutput = (run?.chunks.length ?? 0) > 0;

  return (
    <footer
      aria-label="Git hook status"
      style={{
        minHeight: "var(--control-height-sm)",
        padding: "var(--space-1) var(--space-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-2)",
        borderTop: "1px solid var(--color-border-default)",
        background: "var(--color-bg-secondary)",
        color,
        fontSize: "var(--font-size-xs)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
        {run?.status === "running" && <Spinner size="var(--space-3)" />}
        {message}
      </span>
      {run && hasRetainedOutput && (
        <Button
          size="sm"
          variant="tertiary"
          onClick={() => setPaneVisible(repoPath, !run.paneVisible)}
        >
          {run.paneVisible ? "Hide hook output" : "Show hook output"}
        </Button>
      )}
    </footer>
  );
}
