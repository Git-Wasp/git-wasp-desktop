# Handoff: Git Wasp Branding Pack

## Overview
Complete brand identity for **Git Wasp**, a cross-platform Git desktop client ("Branch fast. Merge clean. Don't get stung."). This pack covers the logo mark, wordmark lockups, color treatments, and app icon tiles needed to brand the desktop app (window icon, dock/taskbar icon, About panel, installer, etc.).

Git Wasp's visual identity is a fork of the **michaelrose.dev Design System** — it reuses that system's color palette, type stack, and card/spacing conventions, with one new brand asset: the wasp mark itself.

## About the Design Files
The files in this bundle (`Wasp.dc.html`, `Git Wasp Logo.dc.html`, `wasp.svg`, and the PNG tiles) are **design references**, not production code to import as-is. `Wasp.dc.html` and `Git Wasp Logo.dc.html` are `.dc.html` prototype files from the design tool used to create this brand — they render in that tool's runtime and are not meant to be dropped into a normal app. Recreate the mark as a plain, framework-native asset (SVG component, `.icns`/`.ico`/`.png` icon sets, etc.) using the exact geometry, colors, and states documented below.

## Fidelity
**High-fidelity.** All colors, proportions, and layout values below are final. `wasp.svg` is a clean, plain SVG export of the mark at 340×240 viewBox — use it directly as the source-of-truth geometry when generating icon sizes or a React/Vue icon component.

## The Mark
A side-facing wasp built entirely from flat geometric shapes on a 340×240 viewBox:
- **Head**: circle, r=27, centered (56,120)
- **Eye**: small dot, r=4.5, at (48,113)
- **Thorax**: ellipse, rx=36 ry=31, centered (100,122)
- **Petiole** (waist): small lens shape connecting thorax to abdomen
- **Abdomen**: rounded-lobe path (the widest shape), rightmost part of the body
- **Stripes**: 3 rounded-rect bands (30w, radius 8) clipped to the abdomen shape
- **Stinger**: small triangle at the rear tip
- **Legs**: 3 angled double-segment lines, stroke width 5, round caps/joins
- **Antennae**: 2 curved lines with a dot at each tip
- **Wings**: 2 overlapping translucent lobes behind the body, stroke + low-opacity fill

**Signature detail**: the three abdomen stripes are cut with **Git iconography** in the body color — a plus (+ / stage), a minus (− / discard), and a sync/refresh loop (⟳ / sync). This is the core concept: *"three stripes, three Git moves."* Always preserve these three icons in the stripes; don't simplify them away — they're what makes the mark specific to a Git client rather than a generic insect logo.

## Color Recipes (by treatment)
The mark is fully re-colorable via 6 slots: body, dark (thorax/head/legs/stripes-base/stinger), stripe (the band color, usually = dark), eye, wing fill, wing stroke.

| Treatment | body | dark | stripe | eye | wing fill | wing stroke |
|---|---|---|---|---|---|---|
| **Standard (light bg)** | `#F5A623` | `#181B20` | `#181B20` | `#FFFFFF` | `rgba(33,98,212,0.15)` | `rgba(33,98,212,0.34)` |
| **Reversed (dark bg / navy tile)** | `#F5A623` | `#F0F2F5` | `#181B20` or tile bg | `#0F1825` | `rgba(122,165,237,0.22)` | `rgba(122,165,237,0.45)` |
| **Gold tile (inverted)** | `#181B20` | `#181B20` | `#FFFFFF` | `#F5A623` | `rgba(255,255,255,0.32)` | `rgba(255,255,255,0.5)` |
| **Monochrome dark-on-light** | `#181B20` | `#181B20` | `#FFFFFF` | `#FFFFFF` | `rgba(24,27,32,0.07)` | `rgba(24,27,32,0.28)` |
| **Monochrome light-on-dark** | `#FFFFFF` | `#FFFFFF` | `#0F1825` | `#0F1825` | `rgba(255,255,255,0.12)` | `rgba(255,255,255,0.32)` |

These map to `michaelrose.dev` design tokens: `#F5A623` ≈ warm gold (custom, brand-specific — not in the base orange scale; if you need a token match, nearest is `--orange-500 (#F5720A)` but the wasp uses this slightly warmer, less-red gold intentionally). `#181B20` = `--grey-900`. `#0F1825` = the design system's dark-mode background. `#2162D4`-family blue is `--blue-500`, used only as the translucent wing tint.

## Wordmark
- Typeface: **Stack Sans Headline** (brand display font), weight 800, letter-spacing -0.03 to -0.035em
- Text: "Git Wasp" (sentence case — capital G, capital W only, no other caps)
- Tagline (optional, secondary use only): "Branch fast. Merge clean. Don't get stung." — set in Noto Sans, regular, `--grey-500`-ish tone (`#6E7887`), never bold, never as a primary heading

## App Icon Construction
Two container conventions are documented — pick the one matching the target OS:

**1. Rounded-square "app tile" (macOS-style squircle)**
- Canvas: 1024×1024
- Corner radius: ~22% of edge (≈224px at 1024, or use OS-native squircle mask if the platform provides one — do not use a plain CSS border-radius squircle approximation in production; use the OS icon mask)
- Background: solid `#0F1825` (dark tile, primary) — gold (`#F5A623`) and white/`#FFFFFF` w/ 1px `#D3D8E0` border are approved alternates, shown in `Git Wasp Logo.dc.html`
- Mark: wasp inset with generous padding (mark spans roughly 60–65% of the tile width), rotated **-14° to -16°** (diagonal "in flight" tilt), centered with a slight downward offset (~+8 to +18px) to optically balance the stinger's visual weight
- Use the **reversed** color recipe (gold body, off-white `#F0F2F5` dark parts) on the dark tile
- Optional depth: soft drop shadow under the mark (`rgba(0,0,0,0.35)`, blur ~30px, y-offset ~14px) and a faint 1px inner highlight stroke (`rgba(255,255,255,0.08)`) — subtle, not skeuomorphic/glossy
- Reference exports: `git-wasp-icon-1024.png` (flat tile, no depth) and `git-wasp-desktop-icon-1024.png` (with shadow + highlight, recommended for dock/taskbar use)

**2. Bare mark, no container**
- For favicons, in-app headers, and anywhere a container would be redundant — just the wasp SVG at the "Standard" or a "Monochrome" color recipe, transparent background

### Sizes to generate
Render the finished 1024×1024 master down (never re-draw at small sizes) to produce a full platform set:
- macOS `.icns`: 16, 32, 64, 128, 256, 512, 1024 (@1x and @2x variants per Apple's Icon Composer conventions)
- Windows `.ico`: 16, 24, 32, 48, 64, 128, 256
- Linux: 16, 24, 32, 48, 64, 128, 256, 512 PNGs
- Favicon: 16, 32, 180 (apple-touch-icon)

At 16–32px the three stripe-icons will not read individually — that's fine; at those sizes the silhouette (gold striped abdomen + dark head/thorax) is what needs to stay legible. Do not remove the stripes at small sizes; just let them simplify visually.

## Design Tokens Reference
| Token | Value | Use |
|---|---|---|
| Wasp gold | `#F5A623` | body / primary brand color |
| Ink / dark | `#181B20` | head, thorax, legs, default stripe color (= `--grey-900`) |
| Off-white | `#F0F2F5` | dark-part color when mark sits on a dark tile |
| Dark tile bg | `#0F1825` | primary app-icon tile background |
| Wing blue | `#2162D4` family, low opacity | translucent wing tint only, light bg |
| Wing blue (dark bg) | `rgba(122,165,237, …)` | translucent wing tint, dark bg |
| Border (light cards) | `#D3D8E0` | 1px card/tile borders |
| Corner radius, app tile | 224px @ 1024 canvas (~22%) | icon tile |
| Corner radius, cards | 16px | matches design system `--radius-lg` |
| Icon rotation | -14° to -16° | consistent "in-flight" tilt |

## Assets Included
- `Wasp.dc.html` — the reusable, re-colorable mark component (6 CSS-var color slots: `--wasp-body`, `--wasp-dark`, `--wasp-stripe`, `--wasp-eye`, `--wasp-wing`, `--wasp-wing-stroke`). Reference for exact geometry/paths, not to be shipped as-is.
- `Git Wasp Logo.dc.html` — full brand sheet: primary lockup, 3 lockup variations, 3 app-icon tile treatments, monochrome versions, concept note
- `wasp.svg` — plain, portable SVG export of the mark at its native 340×240 viewBox, standard light-bg color recipe. Best starting point for building a real icon-generation pipeline.
- `git-wasp-icon-1024.png` — flat dark-tile app icon, 1024×1024
- `git-wasp-desktop-icon-1024.png` — dark-tile app icon with depth (shadow + highlight), 1024×1024, recommended master for generating the full OS icon set

## Source Design System
Git Wasp inherits type, spacing, radius, and base color tokens from the **michaelrose.dev Design System**. If your codebase doesn't already have that system's tokens available, pull the ones referenced above (`--grey-900`, `--blue-500`, `--radius-lg`, etc.) from that project rather than re-deriving new values.
