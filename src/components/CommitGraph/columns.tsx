import type { BranchLabel, GraphNode } from "../../types/graph";
import { MAX_BODY_CHARS, type PillHandlers } from "./columnModel";
import { CheckIcon, GitHubIcon, LaptopIcon, TagIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";
import { useAvatarStore } from "../../stores/avatarStore";
import { initials } from "../../lib/initials";
import { formatRelativeDate } from "../../lib/formatDate";
import type { BodyPlacement } from "../../lib/graphDensity";

// The lane colour for a commit/branch, as a CSS token reference so it re-themes
// with the rest of the app. Mirrors the canvas graph's per-commit colouring so a
// branch pill and its lane share a colour.
function laneColor(colorIndex: number): string {
  return `var(--color-lane-${((colorIndex % 8) + 8) % 8})`;
}

// --- Branch / Tag cell -------------------------------------------------------

function BranchPill({
  label,
  color,
  handlers,
  isCurrent,
}: {
  label: BranchLabel;
  /** The commit's lane colour, so the pill matches its graph lane. */
  color: string;
  handlers?: PillHandlers;
  isCurrent?: boolean;
}) {
  const local = !label.isRemote;
  const isTarget = handlers?.isDropTarget(label.name) ?? false;
  const tooltip = isCurrent ? `${label.name} (checked out)` : label.name;
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
          padding: "3px var(--space-2)",
          borderRadius: "var(--radius-full)",
          fontSize: "var(--font-size-xs)",
          fontWeight: "var(--font-weight-semibold)",
          // Subtle tint background + solid-colour text/border, per the redesign.
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color,
          border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
          cursor: local ? "grab" : "default",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          outline: isTarget ? "2px solid var(--color-accent-primary)" : "none",
          outlineOffset: 1,
          // The checked-out branch gets a crisp inset ring in its own colour so
          // it stands out from other (same-lane) local pills.
          boxShadow: isCurrent ? `inset 0 0 0 1.5px ${color}` : "none",
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
        }}
      >
        {/* The checked-out branch shows a check; other branches show their
            provenance — laptop for local, GitHub for remote. */}
        {isCurrent ? <CheckIcon /> : label.isRemote ? <GitHubIcon /> : <LaptopIcon />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label.name}
        </span>
      </span>
    </Tooltip>
  );
}

function HeadBadge() {
  return (
    <span
      data-head-badge
      style={{
        flexShrink: 0,
        fontSize: "9.5px",
        fontWeight: "var(--font-weight-bold)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: "2.5px 7px",
        borderRadius: "var(--radius-full)",
        background: "var(--color-warning)",
        color: "#241a00",
      }}
    >
      HEAD
    </span>
  );
}

// A tag is a point-in-time label, not a lane, so it's kept out of the branch
// colour coding: a neutral, notched monospace chip (matching the hash cell's
// type) sitting next to the branch pill.
const tagChipStyle: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: "var(--font-family-mono)",
  fontSize: "10px",
  fontWeight: "var(--font-weight-semibold)",
  padding: "2.5px 8px 2.5px 11px",
  borderRadius: "4px",
  clipPath: "polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-default)",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function TagChip({ label, onRemote }: { label: BranchLabel; onRemote?: boolean }) {
  return (
    <Tooltip label={`${label.name} (tag, ${onRemote ? "on remote" : "local only"})`}>
      <span data-tag={label.name} style={tagChipStyle}>
        <TagIcon />
        {onRemote && <GitHubIcon />}
        {label.name}
      </span>
    </Tooltip>
  );
}

// A vertical list of every tag on the commit, shown in the multi-tag chip's
// hover tooltip (over the graph — the tooltip portals to document.body). Each
// row keeps the tag icon + name (+ remote marker) so the collapsed group stays
// legible without expanding inline.
function TagList({ tags, isTagOnRemote }: { tags: BranchLabel[]; isTagOnRemote?: (name: string) => boolean }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: "3px", textAlign: "left" }}>
      {tags.map((tag) => (
        <span key={tag.name} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", whiteSpace: "nowrap" }}>
          <TagIcon />
          {(isTagOnRemote?.(tag.name) ?? false) && <GitHubIcon />}
          {tag.name}
        </span>
      ))}
    </span>
  );
}

// When several tags sit on one commit their chips overlap and clutter the row,
// so collapse them: one chip showing the first tag's name plus a bracketed total
// count, and a hover tooltip listing them all vertically over the graph.
function MultiTagChip({
  tags,
  isTagOnRemote,
}: {
  tags: BranchLabel[];
  isTagOnRemote?: (name: string) => boolean;
}) {
  const first = tags[0];
  return (
    <Tooltip label={<TagList tags={tags} isTagOnRemote={isTagOnRemote} />}>
      <span data-tag={first.name} data-tag-count={tags.length} style={tagChipStyle}>
        <TagIcon />
        {(isTagOnRemote?.(first.name) ?? false) && <GitHubIcon />}
        {first.name}
        <span style={{ opacity: 0.7 }}>({tags.length})</span>
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
  const color = laneColor(node.colorIndex);
  const branches = node.branchLabels.filter((l) => !l.isTag);
  const tags = node.branchLabels.filter((l) => l.isTag);
  const showHead = node.isHead && !node.isWorkingTree && !node.isStash;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", overflow: "hidden" }}>
      {branches.map((label) => (
        <BranchPill
          key={label.name}
          label={label}
          color={color}
          handlers={handlers}
          isCurrent={!label.isRemote && label.name === currentBranch}
        />
      ))}
      {showHead && <HeadBadge />}
      {/* One tag → a plain chip; several → a collapsed chip (first name + count)
          whose hover reveals the full list over the graph, so overlapping tags
          don't clutter the row. */}
      {tags.length === 1 ? (
        <TagChip label={tags[0]} onRemote={isTagOnRemote?.(tags[0].name) ?? false} />
      ) : tags.length > 1 ? (
        <MultiTagChip tags={tags} isTagOnRemote={isTagOnRemote} />
      ) : null}
    </div>
  );
}

// --- Commit message cell -----------------------------------------------------

// The muted secondary line's style, shared so the "below" and "beside"
// placements read identically (only their position differs).
const bodyTextStyle = {
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-normal)",
  color: "var(--color-text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

export function MessageCell({
  node,
  bodyPlacement = "below",
}: {
  node: GraphNode;
  bodyPlacement?: BodyPlacement;
}) {
  const body = (node.body ?? "").replace(/\s+/g, " ").trim();
  const cappedBody = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + "…" : body;
  const wip = node.isWorkingTree;
  const hasBody = !!cappedBody && bodyPlacement !== "none";

  return (
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-2)",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {node.isStash && (
          <span
            style={{
              flexShrink: 0,
              alignSelf: "center",
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
            flexShrink: 1,
            minWidth: 0,
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: wip
              ? "var(--color-warning)"
              : node.isStash
                ? "var(--color-text-secondary)"
                : "var(--color-text-primary)",
          }}
        >
          {node.summary}
        </span>
        {/* Cozy: the body sits inline to the side of the summary, taking the
            remaining width, in the same muted style as the two-line version. */}
        {hasBody && bodyPlacement === "beside" && (
          <span style={{ ...bodyTextStyle, flex: "1 1 0", minWidth: 0 }}>{cappedBody}</span>
        )}
      </div>
      {hasBody && bodyPlacement === "below" && <span style={bodyTextStyle}>{cappedBody}</span>}
    </div>
  );
}

// --- Author cell -------------------------------------------------------------

const AVATAR_SIZE = 26;

export function AuthorCell({ node }: { node: GraphNode }) {
  // Subscribe to the resolved avatar URL directly — the selector re-runs when
  // the store settles a photo, swapping the initials fallback for the image.
  // Photos are preferred; initials-on-lane-colour otherwise.
  const url = useAvatarStore((s) => (node.isWorkingTree ? null : s.getUrl(node.authorEmail)));

  // No author on the uncommitted-changes row — a dashed placeholder + em dash.
  if (node.isWorkingTree) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", overflow: "hidden" }}>
        <span
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: "var(--radius-full)",
            border: "1.5px dashed var(--color-border-strong)",
            flexShrink: 0,
          }}
        />
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>—</span>
      </div>
    );
  }

  const color = laneColor(node.colorIndex);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", overflow: "hidden" }}>
      {url ? (
        <img
          src={url}
          alt=""
          width={AVATAR_SIZE}
          height={AVATAR_SIZE}
          style={{ borderRadius: "var(--radius-full)", flexShrink: 0, objectFit: "cover" }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: "var(--radius-full)",
            background: color,
            color: "#fff",
            fontSize: "10.5px",
            fontWeight: "var(--font-weight-bold)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initials(node.authorName)}
        </span>
      )}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
        <span
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.authorName}
        </span>
        <span
          style={{
            fontSize: "10.5px",
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.authorEmail}
        </span>
      </div>
    </div>
  );
}

// --- Hash & date cells -------------------------------------------------------

export function HashCell({ node }: { node: GraphNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-family-mono)",
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-muted)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {node.isWorkingTree ? "—" : node.shortOid}
    </span>
  );
}

export function DateCell({ node }: { node: GraphNode }) {
  return (
    <span
      style={{
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-muted)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {node.isWorkingTree ? "Now" : formatRelativeDate(node.authorTimestamp)}
    </span>
  );
}
