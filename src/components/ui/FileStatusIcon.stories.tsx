import type { Story } from "@ladle/react";
import { FileStatusIcon } from "./FileStatusIcon";

const STATUSES = ["Added", "Untracked", "Modified", "Deleted", "Renamed", "Copied"];

export const AllStatuses: Story = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
    {STATUSES.map((status) => (
      <div key={status} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <FileStatusIcon status={status} />
        <span style={{ fontSize: "var(--font-size-sm)" }}>{status}</span>
      </div>
    ))}
  </div>
);
