import type { ChangedFile } from "../../types/repo";

const STATUS_ICON: Record<ChangedFile["status"], { symbol: string; color: string }> = {
  Added:     { symbol: "+", color: "var(--color-success)" },
  Modified:  { symbol: "~", color: "var(--color-warning)" },
  Deleted:   { symbol: "-", color: "var(--color-danger)" },
  Renamed:   { symbol: "→", color: "var(--color-accent-primary)" },
  Copied:    { symbol: "⇒", color: "var(--color-accent-primary)" },
  Untracked: { symbol: "?", color: "var(--color-text-muted)" },
};

interface FileListProps {
  files: ChangedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileList({ files, selectedPath, onSelect }: FileListProps) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto" }}>
      {files.map((f) => {
        const { symbol, color } = STATUS_ICON[f.status] ?? STATUS_ICON.Modified;
        const isSelected = f.path === selectedPath;
        return (
          <li
            key={f.path}
            onClick={() => onSelect(f.path)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "var(--space-1) var(--space-3)",
              cursor: "pointer",
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-family-mono)",
              background: isSelected
                ? "var(--color-bg-elevated)"
                : "transparent",
              color: isSelected
                ? "var(--color-text-primary)"
                : "var(--color-text-secondary)",
            }}
          >
            <span style={{ color, fontWeight: 700, minWidth: 12 }}>{symbol}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.path}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
