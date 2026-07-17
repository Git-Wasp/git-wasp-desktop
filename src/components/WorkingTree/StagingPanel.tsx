import { useEffect, useState } from "react";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useStashStore } from "../../stores/stashStore";
import { useToastStore } from "../../stores/toastStore";
import { CommitForm } from "./CommitForm";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { FileStatusIcon } from "../ui/FileStatusIcon";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { VirtualList } from "../ui/VirtualList";
import type { StatusEntry } from "../../types/workingTree";

const FILE_ROW_HEIGHT = 30;

/** An open right-click menu on a file row: its position, the file, and which
 *  panel it came from (the staged panel offers "Unstage" instead of "Stage"). */
interface RowMenuState {
  x: number;
  y: number;
  entry: StatusEntry;
  staged: boolean;
}

function FileRow({
  entry,
  action,
  actionLabel,
  onSelect,
  onContextMenu,
  isSelected,
}: {
  entry: StatusEntry;
  action: () => void;
  actionLabel: string;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isSelected: boolean;
}) {
  return (
    <div
      data-file-row
      data-testid="file-row"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = "var(--color-bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
      title={entry.path}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: FILE_ROW_HEIGHT,
        padding: "0 var(--space-3)",
        cursor: "pointer",
        background: isSelected ? "var(--color-bg-selected)" : "transparent",
        borderRadius: "var(--radius-sm)",
        transition: "background var(--duration-fast) var(--ease-default)",
      }}
    >
      <span style={{ width: 14, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>
        <FileStatusIcon status={entry.status} />
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "var(--font-size-sm)",
        }}
      >
        {entry.path}
      </span>
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          action();
        }}
        style={{ flexShrink: 0 }}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function PanelHeader({
  title,
  count,
  action,
}: {
  title: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "var(--space-2) var(--space-3)",
        fontSize: "var(--font-size-xs)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-2)",
        flexShrink: 0,
      }}
    >
      <span>
        {title} <span style={{ color: "var(--color-text-secondary)" }}>{count}</span>
      </span>
      {action}
    </div>
  );
}

/**
 * The staging + commit column: a "Changes" panel (unstaged + untracked) over a
 * "Staged" panel, with the commit form beneath. Selecting a file loads its diff
 * into the working-tree store; the host decides where that diff renders (the
 * history view shows it in the centre graph pane, the standalone Changes view in
 * its own pane). Designed to fill a narrow sidebar column.
 */
export function StagingPanel({ onCommitted }: { onCommitted?: () => void } = {}) {
  const {
    status,
    selectedPath,
    stageMode,
    loadStatus,
    startWatching,
    selectFile,
    stageFile,
    unstageFile,
    stageAll: stageAllPaths,
    unstageAll: unstageAllPaths,
    discardFile,
    deleteFile,
  } = useWorkingTreeStore();

  // Right-click menu + the pending delete/discard awaiting confirmation.
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StatusEntry | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<StatusEntry | null>(null);

  const openMenu = (e: React.MouseEvent, entry: StatusEntry, staged: boolean) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry, staged });
  };

  // Single-file mutations all route through these so a rejection (e.g. the file
  // vanished, a permissions error) surfaces as a toast instead of an unhandled
  // rejection — see the sibling `stashChanges` for the same shape.
  const stageOne = (path: string) =>
    stageFile(path).catch((e: unknown) => useToastStore.getState().error(String(e), { title: "Stage failed" }));
  const unstageOne = (path: string) =>
    unstageFile(path).catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Unstage failed" }),
    );
  const discardOne = (path: string) =>
    discardFile(path).catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Discard failed" }),
    );
  const deleteOne = (path: string) =>
    deleteFile(path).catch((e: unknown) => useToastStore.getState().error(String(e), { title: "Delete failed" }));
  const selectOne = (path: string, mode: "staged" | "unstaged") =>
    selectFile(path, mode).catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Couldn't load diff" }),
    );

  const menuItems = (m: RowMenuState): MenuItem[] => {
    const { entry, staged } = m;
    const deleteItem: MenuItem = {
      label: "Delete file",
      danger: true,
      onSelect: () => setPendingDelete(entry),
    };
    return staged
      ? [{ label: "Unstage", onSelect: () => void unstageOne(entry.path) }, { separator: true }, deleteItem]
      : [
          { label: "Stage", onSelect: () => void stageOne(entry.path) },
          { label: "Discard", danger: true, onSelect: () => setPendingDiscard(entry) },
          { separator: true },
          deleteItem,
        ];
  };

  useEffect(() => {
    loadStatus().catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Couldn't load working tree status" }),
    );
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    startWatching().then((fn) => {
      // If the panel already unmounted (or a repo switch tore this effect down)
      // before listen() resolved, tear the listener down immediately instead of
      // stashing it in a variable nothing will ever read again.
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {
      // Best-effort: the panel keeps working off the (still-refreshed-on-demand)
      // status even if the live watch subscription fails to attach.
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadStatus, startWatching]);

  // "Changes" = everything not yet staged (modified/deleted + untracked).
  const changes = [...(status?.unstaged ?? []), ...(status?.untracked ?? [])];
  const staged = status?.staged ?? [];
  const stagedCount = staged.length;

  const stageAll = () =>
    stageAllPaths(changes.map((e) => e.path)).catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Stage failed" }),
    );
  const unstageAll = () =>
    unstageAllPaths(staged.map((e) => e.path)).catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Unstage failed" }),
    );

  // Stash all tracked changes (staged + unstaged). Untracked files aren't
  // stashed, so the button is offered only when there's something git will
  // actually stash — otherwise the backend would report "nothing to stash".
  const stashable = staged.length > 0 || (status?.unstaged?.length ?? 0) > 0;
  const stashChanges = async () => {
    try {
      await useStashStore.getState().create();
      useToastStore.getState().success("Stashed changes");
    } catch (e) {
      useToastStore.getState().error(String(e), { title: "Stash failed" });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Changes panel */}
      <div
        style={{
          flex: 2,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <PanelHeader
          title="Changes"
          count={changes.length}
          action={
            stashable || changes.length > 0 ? (
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                {stashable && (
                  <Button size="sm" variant="secondary" onClick={() => void stashChanges()}>
                    Stash changes
                  </Button>
                )}
                {changes.length > 0 && (
                  <Button size="sm" onClick={() => void stageAll()}>
                    Stage all
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "var(--space-2)" }}>
          {changes.length === 0 ? (
            <EmptyState message="No changes" />
          ) : (
            <VirtualList
              items={changes}
              rowHeight={FILE_ROW_HEIGHT}
              maxHeight={2000}
              ariaLabel="Changed files"
              render={(entry) => (
                <FileRow
                  entry={entry}
                  actionLabel="Stage"
                  action={() => void stageOne(entry.path)}
                  onSelect={() => void selectOne(entry.path, "unstaged")}
                  onContextMenu={(e) => openMenu(e, entry, false)}
                  isSelected={selectedPath === entry.path && stageMode === "unstaged"}
                />
              )}
            />
          )}
        </div>
      </div>

      {/* Staged panel */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderTop: "1px solid var(--color-border-subtle)",
        }}
      >
        <PanelHeader
          title="Staged"
          count={stagedCount}
          action={
            stagedCount > 0 ? (
              <Button size="sm" onClick={() => void unstageAll()}>
                Unstage all
              </Button>
            ) : undefined
          }
        />
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "var(--space-2)" }}>
          {stagedCount === 0 ? (
            <EmptyState message="Stage files to commit them" />
          ) : (
            <VirtualList
              items={staged}
              rowHeight={FILE_ROW_HEIGHT}
              maxHeight={2000}
              ariaLabel="Staged files"
              render={(entry) => (
                <FileRow
                  entry={entry}
                  actionLabel="Unstage"
                  action={() => void unstageOne(entry.path)}
                  onSelect={() => void selectOne(entry.path, "staged")}
                  onContextMenu={(e) => openMenu(e, entry, true)}
                  isSelected={selectedPath === entry.path && stageMode === "staged"}
                />
              )}
            />
          )}
        </div>
      </div>

      <CommitForm stagedCount={stagedCount} onCommitted={onCommitted} />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          align="right"
          items={menuItems(menu)}
          onClose={() => setMenu(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete file"
          message={`Delete "${pendingDelete.path}"? This removes the file from your working tree.`}
          confirmLabel="Delete"
          onConfirm={() => {
            void deleteOne(pendingDelete.path);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingDiscard && (
        <ConfirmDialog
          title="Discard changes"
          message={`Discard changes to "${pendingDiscard.path}"? This permanently discards the uncommitted changes to this file and cannot be undone.`}
          confirmLabel="Discard"
          onConfirm={() => {
            void discardOne(pendingDiscard.path);
            setPendingDiscard(null);
          }}
          onCancel={() => setPendingDiscard(null)}
        />
      )}
    </div>
  );
}
