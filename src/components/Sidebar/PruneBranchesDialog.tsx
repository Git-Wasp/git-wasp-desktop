import { useEffect, useRef, useState } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useRemoteStore } from "../../stores/remoteStore";
import { useToastStore } from "../../stores/toastStore";
import type { PrunableBranch } from "../../types/repo";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";

/** Safe to delete without losing work: its remote copy is gone, or (local-only)
 *  it's already merged into the base branch. Unmerged local-only branches aren't. */
const isSafeToPrune = (b: PrunableBranch) => b.kind === "gone" || b.merged;

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "var(--space-1) var(--space-2)",
  cursor: "pointer",
  borderRadius: "var(--radius-sm)",
};

const groupHeaderStyle: React.CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginTop: "var(--space-2)",
  marginBottom: "var(--space-1)",
};

/**
 * Prune branches: lists local branches worth cleaning up in two groups — those
 * whose upstream remote branch is gone (pre-selected, safe to delete) and those
 * that only exist locally (never pushed; left unchecked, since deleting one can
 * discard unpushed commits). Fetches with prune first so remote-tracking refs
 * are current. Deletion reuses `repoStore.deleteBranch` per branch.
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
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
        // Pre-select the safe ones: gone branches, and local-only branches already
        // merged into the base. An *unmerged* local-only branch is left for the
        // user to opt into, since deleting it can discard its unique commits.
        setSelected(new Set(list.filter(isSafeToPrune).map((b) => b.name)));
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

  const safe = branches.filter(isSafeToPrune);
  const unmerged = branches.filter((b) => !isSafeToPrune(b));

  const detail = (b: PrunableBranch) =>
    b.kind === "gone"
      ? `was ${b.upstream}`
      : b.merged
        ? "local only · merged"
        : "local only · not merged";

  const renderRow = (b: PrunableBranch) => (
    <label key={b.name} style={rowStyle}>
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
        {detail(b)}
      </span>
    </label>
  );

  return (
    <div
      ref={rootRef}
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
          Local branches you may want to clean up. Choose which to delete.
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
            No branches to prune — nothing local-only, and everything is in sync with the remote.
          </div>
        ) : (
          <div style={{ overflowY: "auto", marginBottom: "var(--space-3)" }}>
            {safe.length > 0 && (
              <>
                <div style={groupHeaderStyle}>Safe to delete</div>
                {safe.map(renderRow)}
              </>
            )}
            {unmerged.length > 0 && (
              <>
                <div style={groupHeaderStyle}>Not merged — review first</div>
                <p
                  style={{
                    margin: "0 0 var(--space-1)",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-warning)",
                    lineHeight: "var(--line-height-normal)",
                  }}
                >
                  These local-only branches have no remote copy and aren&apos;t merged into the base
                  branch — deleting one permanently discards the commits it holds.
                </p>
                {unmerged.map(renderRow)}
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            {branches.length === 0 ? "Close" : "Cancel"}
          </Button>
          {branches.length > 0 && (
            <Button
              variant="danger"
              onClick={() => void handleDelete()}
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
