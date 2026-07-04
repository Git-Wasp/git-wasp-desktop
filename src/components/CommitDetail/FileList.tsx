import type { ChangedFile } from "../../types/repo";
import { FileStatusIcon } from "../ui/FileStatusIcon";

interface FileListProps {
  files: ChangedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileList({ files, selectedPath, onSelect }: FileListProps) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto" }}>
      {files.map((f) => {
        const isSelected = f.path === selectedPath;
        return (
          <li
            key={f.path}
            onClick={() => onSelect(f.path)}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.background = "var(--color-bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.background = "transparent";
            }}
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
              transition: "background var(--duration-fast) var(--ease-default)",
            }}
          >
            <FileStatusIcon status={f.status} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.path}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
