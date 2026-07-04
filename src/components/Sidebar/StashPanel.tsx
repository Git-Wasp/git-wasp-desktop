import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StashEntry, WorkingTreeStatus } from "../../types/workingTree";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { CollapsibleSection } from "./CollapsibleSection";
import { Button } from "../ui/Button";

export function StashPanel() {
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    const entries = await invoke<StashEntry[]>("stash_list_cmd");
    setStashes(entries);
  };

  useEffect(() => { reload(); }, []);

  const handleApply = async (index: number) => {
    setLoading(true);
    try {
      const status = await invoke<WorkingTreeStatus>("stash_apply_cmd", { index });
      useWorkingTreeStore.setState({ status });
      await reload();
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
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async (index: number) => {
    setLoading(true);
    try {
      const entries = await invoke<StashEntry[]>("stash_drop_cmd", { index });
      setStashes(entries);
    } finally {
      setLoading(false);
    }
  };

  const handleStash = async () => {
    setLoading(true);
    try {
      const status = await invoke<WorkingTreeStatus>("stash_save_cmd", { message: null });
      useWorkingTreeStore.setState({ status });
      await reload();
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
      action={
        <Button size="sm" onClick={handleStash} disabled={loading}>
          Stash
        </Button>
      }
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
                  if (action === "Apply") handleApply(s.index);
                  else if (action === "Pop") handlePop(s.index);
                  else handleDrop(s.index);
                }}
              >
                {action}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </CollapsibleSection>
  );
}
