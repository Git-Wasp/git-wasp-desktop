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
