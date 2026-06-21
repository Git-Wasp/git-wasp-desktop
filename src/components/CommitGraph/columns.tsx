import type { BranchLabel, GraphNode } from "../../types/graph";
import { MAX_BODY_CHARS, type PillHandlers } from "./columnModel";
import { GitHubIcon, LaptopIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";

// --- Branch / Tag cell -------------------------------------------------------

function pillColor(label: BranchLabel): string {
  if (label.isTag) return "#f59e0b";
  if (label.isRemote) return "#a855f7";
  return "#4d9de0";
}

function BranchPill({ label, handlers }: { label: BranchLabel; handlers?: PillHandlers }) {
  const local = !label.isRemote && !label.isTag;
  const isTarget = handlers?.isDropTarget(label.name) ?? false;
  return (
    <Tooltip label={label.name}>
    <span
      data-branch={label.name}
      data-local={local ? "true" : "false"}
      onPointerDown={local && handlers ? (e) => handlers.onPointerDown(e, label) : undefined}
      onPointerEnter={handlers ? () => handlers.onPointerEnter(label) : undefined}
      onPointerLeave={handlers ? () => handlers.onPointerLeave() : undefined}
      style={{
        maxWidth: "100%",
        padding: "1px var(--space-2)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--font-size-xs)",
        fontFamily: "var(--font-family-mono)",
        background: pillColor(label),
        color: "#fff",
        cursor: local ? "grab" : "default",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        outline: isTarget ? "2px solid var(--color-accent-primary)" : "none",
        outlineOffset: 1,
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
      }}
    >
      {/* Provenance marker: laptop for local branches, GitHub for remotes.
          Tags get neither (they're distinguished by colour). */}
      {!label.isTag && (label.isRemote ? <GitHubIcon /> : <LaptopIcon />)}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label.name}
      </span>
    </span>
    </Tooltip>
  );
}

export function BranchCell({ node, handlers }: { node: GraphNode; handlers?: PillHandlers }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", overflow: "hidden" }}>
      {node.branchLabels.map((label) => (
        <BranchPill key={label.name} label={label} handlers={handlers} />
      ))}
    </div>
  );
}

// --- Commit message cell -----------------------------------------------------

export function MessageCell({ node }: { node: GraphNode }) {
  const body = (node.body ?? "").replace(/\s+/g, " ").trim();
  const cappedBody = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + "…" : body;
  const wip = node.isWorkingTree;

  return (
    <div
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "var(--font-size-sm)",
      }}
    >
      <span
        style={{
          fontWeight: "var(--font-weight-semibold)",
          color: wip ? "var(--color-warning)" : "var(--color-text-primary)",
        }}
      >
        {node.summary}
      </span>
      {cappedBody && (
        <span
          style={{
            marginLeft: "var(--space-2)",
            fontWeight: "var(--font-weight-normal)",
            color: "var(--color-text-muted)",
          }}
        >
          {cappedBody}
        </span>
      )}
    </div>
  );
}
