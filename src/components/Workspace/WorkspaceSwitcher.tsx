import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { RowMenu } from "../Sidebar/RowMenu";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export function WorkspaceSwitcher() {
  const {
    workspaces,
    activeWorkspace,
    loadWorkspaces,
    loadActiveWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setActiveWorkspace,
  } = useWorkspaceStore();

  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    loadWorkspaces();
    loadActiveWorkspace();
  }, [loadWorkspaces, loadActiveWorkspace]);

  const handleCreate = async () => {
    const name = newWorkspaceName.trim();
    if (!name) return;
    const workspace = await createWorkspace(name);
    setNewWorkspaceName("");
    setShowNewWorkspace(false);
    await setActiveWorkspace(workspace.id);
  };

  const handleRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    await renameWorkspace(id, name);
    setRenamingId(null);
  };

  const handleSelect = (id: string) => {
    if (id !== activeWorkspace?.id) {
      void setActiveWorkspace(id);
    }
  };

  return (
    <div
      style={{
        padding: "var(--space-2) 0",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-3)",
          marginBottom: "var(--space-1)",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Workspace
        </span>
        <Button size="sm" onClick={() => setShowNewWorkspace((v) => !v)}>
          + New Workspace
        </Button>
      </div>

      {showNewWorkspace && (
        <div style={{ padding: "0 var(--space-3)", marginBottom: "var(--space-1)", display: "flex", gap: "var(--space-1)" }}>
          <Input
            autoFocus
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setShowNewWorkspace(false);
                setNewWorkspaceName("");
              }
            }}
            placeholder="Workspace name"
            style={{ flex: 1, fontFamily: "var(--font-family-mono)" }}
          />
          <Button variant="primary" size="sm" onClick={handleCreate}>
            Create
          </Button>
        </div>
      )}

      {workspaces.length === 0 ? (
        <div
          style={{
            padding: "var(--space-1) var(--space-3)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          No workspaces yet
        </div>
      ) : (
        workspaces.map((w) => {
          const isActive = w.id === activeWorkspace?.id;
          return (
            <div
              key={w.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "var(--space-1) var(--space-3)",
                gap: "var(--space-1)",
              }}
            >
              {renamingId === w.id ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(w.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  style={{ flex: 1, fontFamily: "var(--font-family-mono)" }}
                />
              ) : (
                <button
                  onClick={() => handleSelect(w.id)}
                  aria-current={isActive ? "true" : undefined}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    fontSize: "var(--font-size-sm)",
                    fontFamily: "var(--font-family-mono)",
                    color: isActive ? "var(--color-accent-primary)" : "var(--color-text-secondary)",
                    background: isActive ? "var(--color-bg-elevated)" : "transparent",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    padding: "1px var(--space-2)",
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isActive ? "▸ " : ""}{w.name}
                </button>
              )}
              {isActive && renamingId !== w.id && (
                <RowMenu
                  label={`${w.name} actions`}
                  items={[
                    {
                      label: "Rename workspace",
                      onSelect: () => { setRenamingId(w.id); setRenameValue(w.name); },
                    },
                    {
                      label: "Delete workspace",
                      destructive: true,
                      onSelect: () => deleteWorkspace(w.id),
                    },
                  ]}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
