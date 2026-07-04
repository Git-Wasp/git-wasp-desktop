import { useId } from "react";

/**
 * The Git Wasp brand mark, as a theme-adaptive inline SVG. Geometry is the
 * design handoff's `wasp.svg` (340×240 viewBox); the signature detail — the three
 * abdomen stripes cut with Git moves (stage `+`, discard `−`, sync `⟳`) — is
 * preserved.
 *
 * Colour: the abdomen is always brand gold (`--wasp-body`, #F5A623). The
 * structural parts (head, thorax, legs, antennae, stripes) use `currentColor`,
 * so the mark renders the "reversed" recipe (light parts) on dark surfaces and
 * the "standard" recipe (dark parts) on light surfaces automatically — set the
 * surrounding `color` (callers use `--color-text-primary`). The eye reads as a
 * cutout via the app background token.
 */
export function WaspLogo({
  size = 96,
  title = "Git Wasp",
  style,
}: {
  /** Width in px; height scales to the 340×240 aspect ratio. */
  size?: number;
  title?: string;
  style?: React.CSSProperties;
}) {
  // Unique clip-path id per instance so multiple logos on a page don't collide.
  const clipId = useId().replace(/:/g, "");
  const gold = "var(--wasp-body, #F5A623)";
  const eye = "var(--color-bg-app, #0F1825)";
  const wingFill = "rgba(122,165,237,0.22)";
  const wingStroke = "rgba(122,165,237,0.45)";

  return (
    <svg
      viewBox="0 0 340 240"
      width={size}
      height={size * (240 / 340)}
      role="img"
      aria-label={title}
      style={style}
    >
      <defs>
        <clipPath id={clipId}>
          <path d="M150,122 C150,74 180,50 214,50 C262,50 302,84 312,122 C302,160 262,194 214,194 C180,194 150,170 150,122 Z" />
        </clipPath>
      </defs>
      {/* Wings (behind the body) */}
      <path d="M126,96 Q205,2 308,30 Q232,72 150,110 Z" fill={wingFill} stroke={wingStroke} strokeWidth="2" />
      <path d="M130,104 Q196,44 276,74 Q212,96 148,116 Z" fill={wingFill} stroke={wingStroke} strokeWidth="2" />
      {/* Legs */}
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M96,150 L86,180 L100,190" />
        <path d="M116,154 L114,186 L130,194" />
        <path d="M134,152 L146,182 L162,190" />
      </g>
      {/* Antennae */}
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
        <path d="M50,100 Q36,66 24,56" />
        <path d="M60,96 Q56,62 52,46" />
      </g>
      <circle cx="24" cy="56" r="4.5" fill="currentColor" />
      <circle cx="52" cy="46" r="4.5" fill="currentColor" />
      {/* Abdomen (gold), stinger, stripes */}
      <path d="M150,122 C150,74 180,50 214,50 C262,50 302,84 312,122 C302,160 262,194 214,194 C180,194 150,170 150,122 Z" fill={gold} />
      <path d="M305,109 L305,135 L337,122 Z" fill="currentColor" />
      <g clipPath={`url(#${clipId})`}>
        <rect x="171" y="48" width="30" height="148" rx="8" fill="currentColor" />
        <rect x="215" y="48" width="30" height="148" rx="8" fill="currentColor" />
        <rect x="259" y="48" width="30" height="148" rx="8" fill="currentColor" />
      </g>
      {/* Git moves cut into the stripes, in the body colour */}
      <g fill="none" stroke={gold} strokeLinecap="round" strokeLinejoin="round">
        <g transform="translate(186,100) scale(1.95) translate(-12,-12)" strokeWidth="2.3">
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </g>
        <g transform="translate(230,122) scale(1.95) translate(-12,-12)" strokeWidth="2.3">
          <path d="M5 12h14" />
        </g>
        <g transform="translate(274,144) scale(1.5) translate(-12,-12)" strokeWidth="3.0">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </g>
      </g>
      {/* Petiole (waist), thorax, head, eye */}
      <path d="M126,122 C140,114 150,114 156,122 C150,130 140,130 126,122 Z" fill="currentColor" />
      <ellipse cx="100" cy="122" rx="36" ry="31" fill="currentColor" />
      <circle cx="56" cy="120" r="27" fill="currentColor" />
      <circle cx="48" cy="113" r="4.5" fill={eye} />
    </svg>
  );
}
