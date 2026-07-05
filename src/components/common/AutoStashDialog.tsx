import { ConfirmDialog } from "./ConfirmDialog";
import { useAutoStashStore } from "../../stores/autoStashStore";

/**
 * Renders the auto-stash confirmation whenever a checkout or pull is blocked by
 * uncommitted changes. Store-driven, so every call site (sidebar, branch picker,
 * graph, toolbar) shares one dialog rather than wiring its own.
 */
export function AutoStashDialog() {
  const pending = useAutoStashStore((s) => s.pending);
  const respond = useAutoStashStore((s) => s.respond);
  if (!pending) return null;
  return (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel="Cancel"
      danger={false}
      onConfirm={() => respond(true)}
      onCancel={() => respond(false)}
    />
  );
}
