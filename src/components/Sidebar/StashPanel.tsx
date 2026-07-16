import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StashEntry, WorkingTreeStatus } from "../../types/workingTree";
import { useRepoStore } from "../../stores/repoStore";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useToastStore } from "../../stores/toastStore";
import { CollapsibleSection } from "./CollapsibleSection";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../common/ConfirmDialog";

export function StashPanel() {
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<StashEntry | null>(null);

  const reload = async () => {
    const entries = await invoke<StashEntry[]>("stash_list_cmd");
    setStashes(entries);
  };

  useEffect(() => {
    setStashes([]);
    setPendingDrop(null);
    void reload();
  }, [activeRepoPath]);

  const handleApply = async (index: number) => {
    setLoading(true);
    try {
      const status = await invoke<WorkingTreeStatus>("stash_apply_cmd", { index });
      useWorkingTreeStore.setState({ status });
      await reload();
    } catch (e) {
      useToastStore.getState().error(String(e), { title: "Stash apply failed" });
    } finally {
      setLoading(false);
    }
  };

  const handlePop = async (index: number) => {
    setLoading(true);
    try {
      const status = await invoke<WorkingTreeStatus>("stash_pop_cmd", { index });
      useWorkingTreeStore.setState({ status });
      await reload();
    } catch (e) {
      useToastStore.getState().error(String(e), { title: "Stash pop failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async (index: number) => {
    setLoading(true);
    try {
      const entries = await invoke<StashEntry[]>("stash_drop_cmd", { index });
      setStashes(entries);
    } catch (e) {
      useToastStore.getState().error(String(e), { title: "Stash drop failed" });
    } finally {
      setLoading(false);
    }
  };

  if (stashes.length === 0) return null;

  return (
    <CollapsibleSection
      id="stashes"
      title="Stashes"
      resizable
      defaultHeight={140}
    >
      {stashes.map((s) => (
        <div
          key={s.index}
          style={{
            padding: "var(--space-1) var(--space-3)",
          }}
        >
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: "var(--space-1)",
            }}
            title={s.message}
          >
            {s.message}
          </div>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            {(["Apply", "Pop", "Drop"] as const).map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "Drop" ? "danger" : "secondary"}
                disabled={loading}
                onClick={() => {
                  if (action === "Apply") void handleApply(s.index);
                  else if (action === "Pop") void handlePop(s.index);
                  else setPendingDrop(s);
                }}
              >
                {action}
              </Button>
            ))}
          </div>
        </div>
      ))}

      {pendingDrop && (
        <ConfirmDialog
          title="Drop stash"
          message={`Drop "${pendingDrop.message}"? This permanently deletes the stashed changes and cannot be undone.`}
          confirmLabel="Drop"
          onConfirm={() => {
            void handleDrop(pendingDrop.index);
            setPendingDrop(null);
          }}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </CollapsibleSection>
  );
}
