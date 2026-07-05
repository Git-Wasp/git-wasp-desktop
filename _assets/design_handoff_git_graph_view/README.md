# Handoff: Git Wasp — Commit Graph View

## Overview

A conceptual redesign of the commit-graph pane for **Git Wasp**, a desktop Git client. The
previous design was visually too close to GitKraken's dense, free-form bezier graph. This
package documents a replacement visual language — **fixed parallel swim-lanes per branch**
with **smooth orthogonal-then-curved connectors**, **avatar-marker commit dots**, inline
**branch/tag chips**, and **hover/click-to-select** row interaction — built on the
michaelrose.dev design system's tokens (colors, type, spacing, radii).

Two layout variants are documented, both showing the same sample history:

- **Ledger Grid** — true spreadsheet columns (graph → commit → author → branch → hash → date),
  dark theme. Optimized for scanning a lot of history fast.
- **Split Rail** — graph flipped to the right edge, hash/date read like a log file on the left,
  light theme (proves the palette re-themes cleanly, not just a dark-mode trick).

Both are the **same density** (compact, 56px rows) — an earlier, more spacious "card" density
was explored and dropped in favor of a single compact view.

## About the Design Files

The bundled file, `reference-prototype.dc.html`, is a **design reference built with an internal
HTML prototyping tool** — it renders live and is genuinely interactive (hover/click work), but
it is **not production code to copy directly**. It depends on a small runtime (`support.js`,
included alongside it purely so you can open the file locally and see it work) that has no
equivalent in a real application.

**The task is to recreate this design in Git Wasp's actual codebase** — presumably a native
desktop UI framework (Electron/web-based, Tauri, Qt, native macOS/Windows, etc., whichever Git
Wasp is actually built on) — using that codebase's existing component patterns, real Git data
(via `git log --graph`-equivalent parsing, e.g. `nodegit`, `isomorphic-git`, or shelling out to
`git`), and real author avatars where available. Do not embed or iframe this HTML file in the
product.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, and the connector-curve math below are final —
implement pixel-for-pixel where the target framework allows. The 13-commit sample dataset is
illustrative only; replace it with real repository data.

## Screens / Views

Only one view: the **commit graph pane**, in two layout variants.

### Variant A — Ledger Grid

**Purpose:** Primary history view for scanning many commits with clear per-field scanning
(useful when comparing authors/dates/branches across rows).

**Layout:**
- Outer container: rounded card, `border-radius: 16px`, `border: 1px solid #243047` (dark) /
  `#D3D8E0` (light), background `#0D1320` (dark) / `#FAFBFC` (light).
- Header toolbar: flex row, `justify-content: space-between`, `padding: 16px 20px`,
  `border-bottom: 1px solid` (border color above). Left side: title in display font
  (`Stack Sans Headline`, 15px/700) + one-line subtitle (12px, muted). Right side: an
  interaction hint ("Click a commit to select · hover to preview", 11px muted) plus two small
  static state chips (e.g. "Dark"/"Compact") — `font: 600 11px`, `padding: 4px 10px`,
  `border-radius: 9999px`, tinted background + 1px border.
- Column header row: CSS grid, `padding: 9px 20px`, background `#111827` (dark) / `#F3F5F7`
  (light), labels are `10.5px/600`, `uppercase`, `letter-spacing: .06em`, muted color.
- Column template (six columns):
  `156px (graph) | 1fr (commit) | 168px (author) | 236px (branch) | 92px (hash) | 108px (date)`
- Row: `height: 56px`, `padding: 0 20px`, `align-items: center`, same grid template as header,
  `border-bottom: 1px solid #1A2840` (dark) / `#E9ECF0` (light).
- Card total width in the interactive build: 1060px (960px in the static reference version) —
  not load-bearing, just what fit the sample columns; the layout should flex to the available
  pane width in the real app (graph column and author/branch/hash/date columns should stay
  fixed-width; the commit column is the one that flexes, `1fr`).

### Variant B — Split Rail

Same row height, same colors-by-theme, mirrored structure:

**Column template:**
`100px (hash) | 1fr (commit) | 160px (author) | 236px (branch) | 92px (date) | 156px (graph)`

The graph SVG is anchored to the **right** edge of the pane (`right: 20px` instead of
`left: 20px`), and the hash column moves to the far left, monospaced, log-file style. Light
theme. Column header row background `#F3F5F7`, border `#D3D8E0`.

## Components

### Commit row cell contents (both variants)

- **Commit cell:** message — 13.5px/600, primary text color, single line, `text-overflow: ellipsis`.
  Secondary/description message directly below — 11.5px, muted color, 1px top margin, also
  truncated to one line.
- **Author cell:** 26px circular avatar (background = the commit's branch/lane color; see
  Design Tokens), centered initials text 10.5px/700 white, **computed from the author's name**
  when no photo is available (first letter of first + last word, uppercase) — real avatar photo
  should be preferred when the VCS host provides one, falling back to this initials treatment.
  Name (12px) + email (10.5px, muted) stacked to the right. On the "uncommitted changes" row
  there is no author — render a 26px circle with a 1.5px dashed border instead, and an em dash
  where the name would go.
- **Branch cell:** a pill — `font: 600 11px`, `padding: 3px 10px`, `border-radius: 9999px`,
  background = the branch's *subtle* tint, text color = the branch's *solid* color (see Design
  Tokens). If this row is the current `HEAD`, append a small "HEAD" badge — `font: 700 9.5px`,
  `letter-spacing: .04em`, `padding: 2.5px 7px`, `border-radius: 9999px`, background = accent
  orange, dark near-black text. If this commit has a **tag**, append a tag chip (see below).
- **Hash cell:** monospace (`JetBrains Mono`), 12px, muted color.
- **Date cell:** 12px, muted color (right-aligned in Ledger Grid).

### Tag chip — where tags fit

Tags render as a small **notched, neutral chip** next to the branch pill (not colored by
branch — tags are a point-in-time label, not a lane, so they're deliberately kept out of the
branch color coding to avoid visual confusion). Shape: a rounded rectangle with the left edge
notched to a point, built with `clip-path: polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%)`.
Typography is monospace, matching the hash cell.

```
font: 600 10px 'JetBrains Mono', monospace;
padding: 2.5px 8px 2.5px 11px;
border-radius: 4px;
clip-path: polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%);
/* dark theme */
background: #1B2333;  color: #C9D2E0;  border: 1px solid #334157;
/* light theme */
background: #F3F5F7;  color: #363B46;  border: 1px solid #D3D8E0;
```

A commit can have a branch pill, a HEAD badge, and a tag chip simultaneously (in that order,
left to right) — in the sample data this is exercised on the `main` row where `release/2.4`
was merged and tagged `v2.4.0`. Reserve ~230px in the branch column to comfortably fit the
longest branch name in this dataset (`feature/checkout-redesign`, ~163px) plus one badge.

### The graph column (SVG)

Fixed width **156px**, height = `rows × 56px`. Contains, in z-order:

1. **Swim-lane verticals** — one straight `<line>` per branch lane, `stroke-width: 2.5`,
   color = that branch's solid color. Lanes sit at fixed x-positions with 24px pitch:
   `x = [16, 40, 64, 88, 112, 136]` for up to 6 simultaneously-visible branches. A lane's line
   spans only the rows during which that branch actually exists (see "Lane algorithm" below) —
   it does **not** span the full graph height unless the branch is still live at both ends of
   the visible window.
2. **Curved connectors** at every merge or branch-point (diverge) — see formula below.
3. **Commit markers** — see below.

**Curved connector formula.** Every merge/diverge connector spans **exactly one row height**
(56px) and is a cubic bezier between the point where one lane's line ends and the point where
the other lane's line resumes, meeting exactly at the commit dot:

```
// A = {x, y} is the row-height-56-adjacent point on one lane (nearer the commit dot)
// B = {x, y: A.y + rowHeight} is the point on the other lane, one full row away
mid = (A.y + B.y) / 2
d = `M ${A.x} ${A.y} C ${A.x} ${mid} ${B.x} ${mid} ${B.x} ${B.y}`
```

Color the connector with the *feature* branch's color (i.e. whichever of the two lanes is not
the trunk/parent — see the "Lane algorithm" section for how to generalize this to real data).

**Commit markers** (all centered on the commit's row/lane intersection):
- **Normal commit:** filled circle, `r: 10`, fill = lane color, `stroke: <page background>`,
  `stroke-width: 3` (the background-colored stroke is a "cutout" so crossing lines never visibly
  pierce the dot). Centered initials text on top: 8.5px/700, white, `dy: 0.32em`,
  `text-anchor: middle`.
- **HEAD commit:** same filled circle, plus an outer ring — `r: 15`, `fill: none`,
  `stroke: <lane color>`, `stroke-width: 1.5`.
- **Uncommitted/working-changes row:** hollow circle only — `r: 10`, `fill: <page background>`,
  `stroke: <lane color>`, `stroke-width: 2`, `stroke-dasharray: 2,2`. No initials (no author yet).
- **Selected commit** (only drawn when the selected row is *not* also HEAD, to avoid stacking
  two rings): a dashed ring, `r: 14`, `stroke: <selection accent color>`, `stroke-width: 1.75`,
  `stroke-dasharray: 3,2`.

### Lane algorithm (generalizing beyond the sample data)

This design uses **persistent parallel swim-lanes** rather than GitKraken's dynamic lane
packing — each branch keeps one fixed column for as long as it's part of the visible window,
which is what makes the fixed 24px-pitch x-positions above possible. To implement against real
repository data:

1. Walk commits newest → oldest (as from `git log --graph --all --date-order` or equivalent).
2. Assign each ref (branch) a lane index the first time it's encountered, left to right in the
   order first seen; recycle a lane index once that branch's lane has no more commits above it
   in the visible window (fully merged and scrolled past) so lanes don't grow unbounded on long
   histories. Cap simultaneous visible lanes at a sane number (6 comfortably fits the 156px
   column at 24px pitch; more needs a wider column or a "+N more branches" affordance).
3. Assign each **branch** (not each commit) a color from the palette below, reused cyclically;
   avoid assigning the same color to two simultaneously-visible adjacent lanes.
4. For a merge commit, draw the connector from the *source* lane (the branch being merged in)
   to the *target* lane (where the merge commit's dot sits) using the curve formula above,
   anchored one row below the merge commit.
5. For a branch-point (a commit that is the first commit unique to a branch), draw the connector
   from the *child* lane (the new branch, where the dot sits) down to the *parent* lane, anchored
   one row below that commit.
6. A lane whose branch is still checked out / not yet merged draws its line all the way to the
   edge of the visible window (implying "continues beyond what's shown").

## Sample Dataset (as built in the reference prototype)

13 rows, newest at top, feeding both layout variants identically:

| Row | Lane (branch) | Hash | Type | Message |
|---|---|---|---|---|
| 0 | feature/checkout-redesign | — | uncommitted | Uncommitted changes |
| 1 | feature/checkout-redesign | a91f3c2 | HEAD | Add Apple Pay to checkout confirmation |
| 2 | feature/checkout-redesign | 7c02e88 | commit | Wire up Apple Pay button to checkout state |
| 3 | develop | 4d19a06 | merge (from feature/oauth-providers) | Merge branch 'feature/oauth-providers' into develop |
| 4 | feature/oauth-providers | e330f14 | commit | Refactor OAuth token refresh into shared hook |
| 5 | hotfix/payment-retry | 9b7a5d0 | commit | Add retry backoff for failed payment webhook |
| 6 | main | f21c8b3 | merge (from release/2.4), **tag: v2.4.0** | Merge branch 'release/2.4' |
| 7 | release/2.4 | 0a68e77 | commit | Bump release/2.4 changelog and version string |
| 8 | develop | c58e112 | commit | Update dependency lockfile |
| 9 | feature/oauth-providers | 15af9c4 | diverge (from develop) | Scaffold OAuth provider abstraction |
| 10 | feature/checkout-redesign | 88de201 | diverge (from develop) | Start checkout redesign spike |
| 11 | release/2.4 | 3f4a9e6 | diverge (from main) | Cut release/2.4 branch |
| 12 | hotfix/payment-retry | 6e0d7a1 | diverge (from main) | Hotfix: payment retries silently failing |

Full author/email/secondary-message copy for every row is in `reference-prototype.dc.html`
(search for `this.commits =`).

## Interactions & Behavior

- **Hover:** background tint appears on the row (`rgba` overlay, see Design Tokens), cursor
  becomes a pointer. Transition: `background 150ms cubic-bezier(0.16, 1, 0.3, 1)`.
- **Click to select:** sets a `selectedIndex`. Selected row gets an inset ring
  (`box-shadow: inset 0 0 0 1.5px <accent>`) instead of a background tint change (so it reads
  as "sticky" vs. hover's transient tint); its graph marker gets the dashed selection ring
  described above. Only one commit selected at a time per pane.
- **Not built in this pack, flagged as the obvious next step:** clicking a commit should open a
  details/diff panel (out of scope — this handoff covers the graph pane only, per the original
  design brief).
- No drag, context menu, or multi-select behavior was specified or designed here.

## State Management

Minimal state needed to reproduce the interaction:
- `selectedIndex: number` — index (or, in a real app, commit SHA) of the currently-selected
  commit. Defaults to the HEAD commit.
- `hoveredIndex: number | null` — updated on row `mouseenter`/`mouseleave`.
- Everything else (lane assignment, colors, curve paths, row backgrounds) is **derived**, not
  stored — recompute from the commit list + `selectedIndex`/`hoveredIndex` on every render, as
  the prototype's `buildGraphCurved()` function does.
- Real app data requirements per commit: SHA (full + short), parent SHA(s), author name/email/
  avatar URL, message (title + body), author or commit date, ref list (branches/tags pointing
  at it), and which lane it was assigned during graph layout.

## Design Tokens

All values below are drawn from the michaelrose.dev design system (`colors_and_type.css`,
included in this pack) or are direct hex equivalents of its tokens.

**Branch/lane palette** (assign one per branch, cycle if more branches than colors):

| Lane role | Dark solid | Dark subtle (bg) | Light solid | Light subtle (bg) |
|---|---|---|---|---|
| main / trunk | `#4880E0` | `rgba(72,128,224,.16)` | `#2162D4` | `rgba(33,98,212,.10)` |
| develop / integration | `#8C96A8` | `rgba(140,150,168,.16)` | `#6E7887` | `rgba(110,120,135,.12)` |
| release | `#F59E0B` | `rgba(245,158,11,.16)` | `#D97706` | `rgba(217,119,6,.12)` |
| feature (current/HEAD in sample) | `#F88E3A` | `rgba(248,142,58,.16)` | `#F5720A` | `rgba(245,114,10,.12)` |
| feature (secondary) | `#22C55E` | `rgba(34,197,94,.16)` | `#16A34A` | `rgba(22,163,74,.12)` |
| hotfix | `#F87171` | `rgba(248,113,113,.16)` | `#DC2626` | `rgba(220,38,38,.12)` |

**Page/surface:**
- Dark background `#0D1320`, dark border `#243047`, dark header strip `#111827`, dark row
  border `#1A2840`, dark primary text `#F0F2F5`, dark muted text `#8C96A8`, dark subtle text `#5A6370`.
- Light background `#FAFBFC`, light border `#D3D8E0`, light header strip `#F3F5F7`, light row
  border `#E9ECF0`, light primary text `#181B20`, light muted text `#6E7887`.

**Interaction accents:**
- HEAD badge background `#F88E3A` (dark) / `#F5720A` (light).
- Hover row tint `rgba(240,242,245,.05)` (dark) / `rgba(24,27,32,.03)` (light).
- Selected row tint `rgba(72,128,224,.16)` (dark) / `rgba(33,98,212,.08)` (light); selection ring
  accent `#4880E0` (dark) / `#2162D4` (light).
- HEAD row background tint (subtler than selection) `rgba(248,142,58,.07)` (dark) /
  `rgba(245,114,10,.06)` (light).

**Typography:**
- Display / titles: `Stack Sans Headline` (variable, weight 700 used here).
- Body / UI text: `Noto Sans` (variable).
- Monospace (hash, tag chip): `JetBrains Mono` (Google Fonts).
- Sizes used: 8.5px (graph marker initials), 9.5px (HEAD badge), 10–10.5px (avatar initials, tag
  chip, column labels), 11–12px (body/meta text), 13.5px (commit message), 15px (panel titles).

**Radii & shadows:** pill/avatar `border-radius: 9999px`; tag chip `4px`; outer card
`16px`; dark card shadow `0 8px 32px rgba(0,0,0,.45), 0 24px 64px rgba(0,0,0,.3)`; light card
shadow `0 4px 16px rgba(15,23,42,.08), 0 12px 40px rgba(15,23,42,.08)`.

**Spacing:** row height `56px`; row horizontal padding `20px`; lane pitch `24px`; header/toolbar
padding `16px 20px`; column-header padding `9px 20px`.

## Assets

- `fonts/StackSansHeadline-VariableFont_wght.ttf` and `fonts/NotoSans-VariableFont_wdth_wght.ttf`
  — brand variable fonts, included in this pack.
- JetBrains Mono is loaded from Google Fonts (`@import` in the prototype's `<style>`) — no local
  file needed, just add the same `@import` or self-host per your build's font strategy.
- No other imagery. Avatars are computed initials-on-color-circle; wire up real avatar photos
  where the VCS host (GitHub/GitLab/etc.) or local Git config provides one, falling back to this
  same initials treatment.

## Screenshots

- `screenshots/01-ledger-grid-2a.png` — Ledger Grid variant (dark), showing the graph column,
  avatar markers, HEAD highlight, and the `v2.4.0` tag chip on the `main` row.
- `screenshots/02-split-rail-2b.png` — Split Rail variant (light), graph mirrored to the right.

## Files

- `reference-prototype.dc.html` — the interactive design reference. Open it directly in a
  browser (double-click, or serve the folder locally) to see the live hover/select behavior
  described above. `support.js` next to it is only the prototype tool's runtime, required for
  this file to render — it has no bearing on your implementation.
- `colors_and_type.css` — the full design system token sheet this design draws its colors,
  type, spacing, and radii from.
