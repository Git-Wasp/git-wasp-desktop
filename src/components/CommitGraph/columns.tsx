import type { BranchLabel, GraphNode } from "../../types/graph";
import { MAX_BODY_CHARS, type PillHandlers } from "./columnModel";
import { CheckIcon, GitHubIcon, LaptopIcon, TagIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";

// --- Branch / Tag cell -------------------------------------------------------

function pillColor(label: BranchLabel): string {
  if (label.isTag) return "#f59e0b";
  if (label.isRemote) return "#a855f7";
  return "#4d9de0";
}

function BranchPill({
  label,
  handlers,
  isCurrent,
  tagOnRemote,
}: {
  label: BranchLabel;
  handlers?: PillHandlers;
  isCurrent?: boolean;
  /** For tag pills: whether the tag also exists on the remote ("both"). */
  tagOnRemote?: boolean;
}) {
  const local = !label.isRemote && !label.isTag;
  const isTarget = handlers?.isDropTarget(label.name) ?? false;
  const tooltip = isCurrent
    ? `${label.name} (checked out)`
    : label.isTag
      ? `${label.name} (tag, ${tagOnRemote ? "on remote" : "local only"})`
      : label.name;
  return (
    <Tooltip label={tooltip}>
    <span
      data-branch={label.name}
      data-local={local ? "true" : "false"}
      data-current={isCurrent ? "true" : undefined}
      onPointerDown={local && handlers ? (e) => handlers.onPointerDown(e, label) : undefined}
      onPointerEnter={handlers ? () => handlers.onPointerEnter(label) : undefined}
      onPointerLeave={handlers ? () => handlers.onPointerLeave() : undefined}
      style={{
        maxWidth: "100%",
        padding: "1px var(--space-2)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--font-size-xs)",
        fontFamily: "var(--font-family-mono)",
        fontWeight: isCurrent ? "var(--font-weight-bold)" : "var(--font-weight-normal)",
        background: pillColor(label),
        color: "#fff",
        cursor: local ? "grab" : "default",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        outline: isTarget ? "2px solid var(--color-accent-primary)" : "none",
        outlineOffset: 1,
        // The checked-out branch gets a crisp light ring so it stands out from
        // the other (same-coloured) local pills.
        boxShadow: isCurrent ? "inset 0 0 0 1.5px #fff, 0 0 0 1px rgba(0,0,0,0.25)" : "none",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
      }}
    >
      {/* The checked-out branch shows a check; tags show a tag glyph (plus a
          GitHub mark when the tag is also on the remote); branches show their
          provenance — laptop for local, GitHub for remote. */}
      {isCurrent ? (
        <CheckIcon />
      ) : label.isTag ? (
        <>
          <TagIcon />
          {tagOnRemote && <GitHubIcon />}
        </>
      ) : label.isRemote ? (
        <GitHubIcon />
      ) : (
        <LaptopIcon />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label.name}
      </span>
    </span>
    </Tooltip>
  );
}

export function BranchCell({
  node,
  handlers,
  currentBranch,
  isTagOnRemote,
}: {
  node: GraphNode;
  handlers?: PillHandlers;
  /** The checked-out local branch, so its pill can be marked. */
  currentBranch?: string | null;
  /** Whether a tag name is also on the remote, for the local/both indicator. */
  isTagOnRemote?: (name: string) => boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", overflow: "hidden" }}>
      {node.branchLabels.map((label) => (
        <BranchPill
          key={label.name}
          label={label}
          handlers={handlers}
          isCurrent={!label.isRemote && !label.isTag && label.name === currentBranch}
          tagOnRemote={label.isTag && (isTagOnRemote?.(label.name) ?? false)}
        />
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
      {node.isStash && (
        <span
          style={{
            marginRight: "var(--space-2)",
            padding: "0 var(--space-1)",
            borderRadius: "var(--radius-sm)",
            border: "1px dashed var(--color-text-muted)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-xs)",
            fontWeight: "var(--font-weight-semibold)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          stash
        </span>
      )}
      <span
        style={{
          fontWeight: "var(--font-weight-semibold)",
          color: wip
            ? "var(--color-warning)"
            : node.isStash
              ? "var(--color-text-secondary)"
              : "var(--color-text-primary)",
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
