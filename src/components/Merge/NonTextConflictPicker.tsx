import type { ConflictedFile, ConflictKind, ConflictSide } from "../../types/merge";
import { Button } from "../ui/Button";

interface NonTextConflictPickerProps {
  file: ConflictedFile;
  onResolveWithSide: (path: string, side: ConflictSide) => void;
  onResolveWithDeletion: (path: string) => void;
}

interface Choice {
  label: string;
  onClick: () => void;
}

const KIND_DESCRIPTION: Record<ConflictKind, string> = {
  normalEdit: "This file was edited on both branches.",
  addAdd: "This file was added on both branches with different contents.",
  deleteModify: "This file was deleted on the current branch and modified on the source branch.",
  modifyDelete: "This file was modified on the current branch and deleted on the source branch.",
  binaryOrUnmergeable: "This is a binary file that can't be merged automatically.",
};

function choicesForFile(
  file: ConflictedFile,
  onResolveWithSide: (path: string, side: ConflictSide) => void,
  onResolveWithDeletion: (path: string) => void,
): Choice[] {
  const { path, kind } = file;
  switch (kind) {
    case "addAdd":
    case "binaryOrUnmergeable":
      return [
        { label: "Keep current version", onClick: () => onResolveWithSide(path, "ours") },
        { label: "Keep source version", onClick: () => onResolveWithSide(path, "theirs") },
      ];
    case "deleteModify":
      return [
        { label: "Keep deletion", onClick: () => onResolveWithDeletion(path) },
        { label: "Keep source's version", onClick: () => onResolveWithSide(path, "theirs") },
      ];
    case "modifyDelete":
      return [
        { label: "Keep current's version", onClick: () => onResolveWithSide(path, "ours") },
        { label: "Keep deletion", onClick: () => onResolveWithDeletion(path) },
      ];
    case "normalEdit":
      return [];
  }
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  background: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
};

const pathStyle: React.CSSProperties = {
  fontFamily: "var(--font-family-mono)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
};

const descriptionStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
};

export function NonTextConflictPicker({ file, onResolveWithSide, onResolveWithDeletion }: NonTextConflictPickerProps) {
  const choices = choicesForFile(file, onResolveWithSide, onResolveWithDeletion);

  return (
    <div style={containerStyle}>
      <div style={pathStyle}>{file.path}</div>
      <p style={descriptionStyle}>{KIND_DESCRIPTION[file.kind]}</p>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        {choices.map((choice) => (
          <Button variant="primary" key={choice.label} type="button" onClick={choice.onClick}>
            {choice.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
