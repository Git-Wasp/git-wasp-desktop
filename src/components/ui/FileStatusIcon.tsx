import type { ComponentType } from "react";
import { ArrowRightIcon, MinusIcon, PencilIcon, PlusIcon } from "./icons";

interface StatusMeta {
  color: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

// Standard red/amber/green semantics: green = added/new, amber = modified,
// red = removed; renames/copies use the accent arrow. Shared by the commit
// detail file list and the staging panel so the language is consistent.
const META: Record<string, StatusMeta> = {
  Added: { color: "var(--color-success)", label: "Added", Icon: PlusIcon },
  Untracked: { color: "var(--color-success)", label: "Untracked (new)", Icon: PlusIcon },
  Modified: { color: "var(--color-warning)", label: "Modified", Icon: PencilIcon },
  Deleted: { color: "var(--color-danger)", label: "Deleted", Icon: MinusIcon },
  Renamed: { color: "var(--color-accent-primary)", label: "Renamed", Icon: ArrowRightIcon },
  Copied: { color: "var(--color-accent-primary)", label: "Copied", Icon: ArrowRightIcon },
};

/** A coloured status icon for a changed file (added/modified/removed/…). */
export function FileStatusIcon({ status, size = 13 }: { status: string; size?: number }) {
  // META.Modified is a literal key defined above, always present.
  const meta = META[status] ?? META.Modified!;
  const Icon = meta.Icon;
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      data-status={status}
      style={{ color: meta.color, display: "inline-flex", flexShrink: 0 }}
    >
      <Icon size={size} />
    </span>
  );
}
