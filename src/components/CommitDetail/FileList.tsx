import type { ChangedFile } from "../../types/repo";
import { FileStatusIcon } from "../ui/FileStatusIcon";
import { VirtualList } from "../ui/VirtualList";

interface FileListProps {
  files: ChangedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

const ROW_HEIGHT = 28;

export function FileList({ files, selectedPath, onSelect }: FileListProps) {
  return (
    <VirtualList
      items={files}
      rowHeight={ROW_HEIGHT}
      maxHeight={480}
      ariaLabel="Changed files"
      render={(f) => {
        const isSelected = f.path === selectedPath;
        return (
          <div
            role="listitem"
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
              height: ROW_HEIGHT,
              padding: "0 var(--space-3)",
              cursor: "pointer",
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-family-mono)",
              background: isSelected ? "var(--color-bg-elevated)" : "transparent",
              color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              transition: "background var(--duration-fast) var(--ease-default)",
            }}
          >
            <FileStatusIcon status={f.status} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
          </div>
        );
      }}
    />
  );
}
