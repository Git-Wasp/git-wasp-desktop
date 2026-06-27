import { useEffect, useState } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useToastStore } from "../../stores/toastStore";
import type { PrunableBranch } from "../../types/repo";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";

/**
 * Auto-prune: lists local branches whose upstream remote branch is gone and lets
 * the user delete a chosen subset (all selected by default). Fetches with prune
 * first so the remote-tracking refs are current, then asks the backend for the
 * gone branches. Deletion reuses `repoStore.deleteBranch` per branch.
 */
export function PruneBranchesDialog({ onClose }: { onClose: () => void }) {
  const listPrunableBranches = useRepoStore((s) => s.listPrunableBranches);
  const deleteBranch = useRepoStore((s) => s.deleteBranch);
  const fetch = useRemoteStore((s) => s.fetch);
  const toastSuccess = useToastStore((s) => s.success);
  const toastError = useToastStore((s) => s.error);

  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<PrunableBranch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Best-effort prune fetch: if it fails (offline, no remote) we still list
      // from the current refs rather than blocking the whole dialog.
      try {
        await fetch(undefined, true);
      } catch {
        /* ignored — detection below still runs against current refs */
      }
      try {
        const list = await listPrunableBranches();
        if (cancelled) return;
        setBranches(list);
        setSelected(new Set(list.map((b) => b.name)));
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetch, listPrunableBranches]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDelete = async () => {
    const toDelete = branches.filter((b) => selected.has(b.name));
    if (toDelete.length === 0) return;
    setDeleting(true);
    const failures: string[] = [];
    for (const b of toDelete) {
      try {
        await deleteBranch(b.name);
      } catch (e) {
        failures.push(`${b.name} (${String(e)})`);
      }
    }
    setDeleting(false);
    const deleted = toDelete.length - failures.length;
    if (deleted > 0) toastSuccess(`Pruned ${deleted} branch${deleted === 1 ? "" : "es"}`);
    if (failures.length > 0) toastError(`Couldn't delete: ${failures.join(", ")}`);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Prune branches"
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
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 440,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
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
            marginBottom: "var(--space-2)",
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Prune branches
        </h2>
        <p
          style={{
            margin: 0,
            marginBottom: "var(--space-3)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            lineHeight: "var(--line-height-normal)",
          }}
        >
          Local branches whose upstream branch no longer exists on the remote. Choose which to
          delete.
        </p>

        {loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "var(--space-4) 0",
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <Spinner /> Checking the remote…
          </div>
        ) : error ? (
          <div style={{ color: "var(--color-danger)", fontSize: "var(--font-size-sm)" }}>{error}</div>
        ) : branches.length === 0 ? (
          <div
            style={{
              padding: "var(--space-4) 0",
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            No branches to prune — everything is in sync with the remote.
          </div>
        ) : (
          <div style={{ overflowY: "auto", marginBottom: "var(--space-3)" }}>
            {branches.map((b) => (
              <label
                key={b.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-1) var(--space-2)",
                  cursor: "pointer",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(b.name)}
                  onChange={() => toggle(b.name)}
                  aria-label={b.name}
                />
                <span
                  style={{
                    fontFamily: "var(--font-family-mono)",
                    fontSize: "var(--font-size-sm)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {b.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  was {b.upstream}
                </span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            {branches.length === 0 ? "Close" : "Cancel"}
          </Button>
          {branches.length > 0 && (
            <Button
              variant="danger"
              onClick={handleDelete}
              loading={deleting}
              disabled={deleting || selected.size === 0}
            >
              Delete {selected.size} branch{selected.size === 1 ? "" : "es"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
