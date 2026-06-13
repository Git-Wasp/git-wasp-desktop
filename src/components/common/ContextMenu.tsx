import { useEffect, useRef } from "react";

export type MenuItem =
  | { label: string; onSelect: () => void; danger?: boolean }
  | { separator: true };

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: x,
        top: y,
        minWidth: 180,
        padding: "var(--space-1)",
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        color: "var(--color-text-primary)",
        zIndex: 200,
      }}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <div
            key={`sep-${i}`}
            style={{
              height: 1,
              margin: "var(--space-1) 0",
              background: "var(--color-border-subtle)",
            }}
          />
        ) : (
          <div
            key={item.label}
            role="menuitem"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            style={{
              padding: "var(--space-1) var(--space-2)",
              fontSize: "var(--font-size-sm)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              color: item.danger
                ? "var(--color-danger)"
                : "var(--color-text-primary)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-bg-elevated)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {item.label}
          </div>
        ),
      )}
    </div>
  );
}
