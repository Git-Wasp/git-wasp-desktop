/**
 * Small inline SVG glyphs used to mark branch provenance. Both inherit
 * `currentColor`, so the parent's text colour drives them. `data-icon` is for
 * tests; the SVGs are decorative (`aria-hidden`).
 */

interface IconProps {
  size?: number;
  title?: string;
}

export function GitHubIcon({ size = 12, title }: IconProps) {
  return (
    <svg
      data-icon="github"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** Two side-by-side panes — the split / side-by-side diff view. */
export function SplitViewIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="split-view"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16" />
    </svg>
  );
}

/** Up arrow to a bar — push (send commits up to the remote). */
export function PushIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="push"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M5 4h14" />
      <path d="M12 20V8" />
      <path d="M6 14l6-6 6 6" />
    </svg>
  );
}

/** Down arrow from a bar — pull (bring remote commits down). */
export function PullIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="pull"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M5 20h14" />
      <path d="M12 4v12" />
      <path d="M6 10l6 6 6-6" />
    </svg>
  );
}

/** Git-branch glyph — create / new branch. */
export function BranchIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="branch"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** A luggage-style tag — marks tag pills. */
export function TagIcon({ size = 12, title }: IconProps) {
  return (
    <svg
      data-icon="tag"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

/** A plus — an added/new file. */
export function PlusIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="plus"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** A minus — a removed/deleted file. */
export function MinusIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="minus"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M5 12h14" />
    </svg>
  );
}

/** A pencil — a modified/changed file. */
export function PencilIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="pencil"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

/** A right arrow — a renamed/copied file. */
export function ArrowRightIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="arrow-right"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** A checkmark — marks the currently checked-out branch. */
export function CheckIcon({ size = 12, title }: IconProps) {
  return (
    <svg
      data-icon="check"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** A panel with a left column — the collapsible left sidebar. */
export function SidebarIcon({ size = 16, title }: IconProps) {
  return (
    <svg
      data-icon="sidebar"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M9 4v16" />
    </svg>
  );
}

/** Stacked rows — the inline / unified diff view. */
export function InlineViewIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="inline-view"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** A crosshair / target — jump to and select the checked-out (HEAD) commit. */
export function TargetIcon({ size = 14, title }: IconProps) {
  return (
    <svg
      data-icon="target"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

export function LaptopIcon({ size = 12, title }: IconProps) {
  return (
    <svg
      data-icon="laptop"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <rect x="4" y="4" width="16" height="12" rx="1.5" />
      <path d="M2 20h20" />
    </svg>
  );
}
