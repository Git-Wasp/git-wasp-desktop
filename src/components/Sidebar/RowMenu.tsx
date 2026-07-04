import { useState } from "react";
import { IconButton } from "../ui/IconButton";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

/**
 * The ⋮ overflow menu on sidebar rows (branches, remotes). It shares the graph's
 * right-click `ContextMenu` so the two menus look and behave identically — same
 * surface, hover, and danger styling — rather than being a second, divergent
 * menu. The trigger toggles a `ContextMenu` anchored under it (right-aligned so
 * it tucks beneath the ⋮ rather than spilling across the sidebar).
 */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  if (items.length === 0) return null;

  const menuItems: MenuItem[] = items.map((item) => ({
    label: item.label,
    onSelect: item.onSelect,
    danger: item.destructive,
  }));

  return (
    <div style={{ flexShrink: 0 }}>
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setPos((p) => (p ? null : { x: rect.right, y: rect.bottom + 2 }));
        }}
        // Keep the trigger's own press from reaching ContextMenu's outside-click
        // (document mousedown) handler, so clicking ⋮ while open is a clean toggle.
        onMouseDown={(e) => e.stopPropagation()}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={pos != null}
      >
        ⋮
      </IconButton>
      {pos && (
        <ContextMenu x={pos.x} y={pos.y} align="right" items={menuItems} onClose={() => setPos(null)} />
      )}
    </div>
  );
}
