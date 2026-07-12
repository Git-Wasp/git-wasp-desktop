# Ladle Component Workshop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **First action:** copy this plan into the repo so it is committed alongside the work:
> `mkdir -p docs/superpowers/plans && cp "$0_this_file" docs/superpowers/plans/2026-07-12-ladle-component-workshop.md`
> (Source lives at `/Users/michael/.claude/plans/let-s-plan-out-the-shimmying-avalanche.md`.)

**Goal:** Add [Ladle](https://ladle.dev) as a Vite-native component workshop for viewing and refining the app's presentational UI primitives in isolation, with a working light/dark theme toggle wired to the app's real token system.

**Architecture:** Ladle runs its own Vite dev server (separate from the Tauri/Vite app build) and auto-discovers `*.stories.tsx` files co-located next to components. A single global provider (`.ladle/components.tsx`) imports the app's real CSS token layer (`src/styles/globals.css`) and reuses the app's canonical `applyTheme()` to switch `[data-theme]` on `<html>` when Ladle's built-in light/dark toggle changes. Stories are pure, prop-driven renderings — no Tauri backend, no Zustand stores (store-coupled components are explicitly deferred).

**Tech Stack:** `@ladle/react` (dev-only), Vite 7, React 19, TypeScript 5.8 (strict), Tailwind 4 via `@tailwindcss/vite`, npm.

## Global Constraints

- **Package manager: npm** (`package-lock.json`). Use `npm i -D`, never yarn/pnpm/bun.
- **All styling via CSS tokens** — never hardcode colours/spacing. Stories and the provider reference `var(--color-*)`, `var(--space-*)`, etc. (Hard architectural commitment in `CLAUDE.md`.)
- **TypeScript strict**: `noUnusedLocals` + `noUnusedParameters` are on. No unused imports/vars in any file, including stories.
- **Lint gate**: `npm run lint` is `eslint src --ext .ts,.tsx --max-warnings 0`. Story files live under `src/`, so they ARE linted — zero warnings allowed.
- **Conventional Commits**, and commits must **not** attribute the agent (per `CLAUDE.md`). Feature branch: `feat/ladle-component-workshop`.
- **Reuse existing utilities** — do not re-implement theme logic. The canonical entry point is `applyTheme()` in `src/lib/applyTheme.ts`.
- **Ladle is dev-only** — it must not be imported by the app (`src/main.tsx` chain) and must not appear in `dependencies` (only `devDependencies`).

---

## Context

The backlog item (TODO.md line 53) is: *"Add Storybook (or similar, if there's something better) for viewing and refining UI components."*

The app has a mature set of pure, token-styled UI primitives in `src/components/ui/` and `src/components/common/` (Button, Input, Dropdown, SegmentedControl, MultiSelect, Tooltip, Spinner, EmptyState, FileStatusIcon, IconButton, ConfirmDialog, PromptDialog, ContextMenu, …). They are currently only viewable by running the whole Tauri app and navigating to the right screen, which makes iterating on visual states (variants, disabled/loading, light vs dark theme) slow.

**Why Ladle over Storybook** (decided with the user): the stack is bleeding-edge (Vite 7 / React 19 / Tailwind 4) and the project favours lean, swappable tooling. Ladle is Vite-native, a single dev dependency, and near-zero config, while still offering controls (args), viewport width, and an a11y addon — enough for "viewing and refining". Storybook's heavier manager/builder and large dependency surface aren't warranted here.

**Scope (decided with the user): primitives first.** Only pure, prop-driven components get stories in this plan. Store-coupled components (`ToastContainer` → `useToastStore`, `AutoStashDialog` → `useAutoStashStore`) are **deferred** — they need mock-store decorators, which is a follow-up.

### Key facts the implementer needs

- **Theme mechanism** (`src/lib/applyTheme.ts`): `applyTheme({ id, appearance, builtin })`. For built-ins it sets `document.documentElement`'s `data-theme` attribute; `id: "dark"` is the `:root` default so it **removes** the attribute. `"light"` sets `data-theme="light"`. The chain imports only CodeMirror (no Tauri) — safe to call in Ladle.
- **CSS entry**: `src/styles/globals.css` does `@import "./tokens.css";` then `@import "tailwindcss";` then an `@theme inline { … }` block. Importing this one file pulls in the whole token layer, but it means **Ladle's Vite must have the `@tailwindcss/vite` plugin** or the `@import "tailwindcss"` line fails to compile.
- **Default fonts/scale** are defined in `tokens.css` (`--font-family-sans`, `--font-scale: 1.0`), so stories render correctly without invoking `src/lib/fonts.ts`.
- **No path aliases** — imports are relative.
- **Tauri mock** (`src/test/setup.ts`) is a *vitest* setup file; it does NOT apply to Ladle. The primitives in scope don't call `invoke`, so no Tauri mock is needed for Ladle. (Deferred store-coupled work will need one.)
- **CI** (`.github/workflows/ci.yml`) runs `npm run test:unit` and `npm run build:web` (`tsc && vite build`). Because `tsconfig.json` has `include: ["src"]`, **story files are type-checked by `tsc` in CI** automatically. CI does not currently run `npm run lint`.

### File Structure

New files (all repo-root `.ladle/` config + co-located stories):

- `.ladle/config.mjs` — Ladle config (stories glob, addons, default theme). Not type-checked/linted (outside `src`).
- `.ladle/vite.config.ts` — extends Ladle's internal Vite with the Tailwind 4 plugin. Not type-checked/linted.
- `.ladle/components.tsx` — global `Provider`: imports `globals.css`, applies theme, wraps stories in an app-background container. Not type-checked/linted (outside `src`).
- `src/components/ui/*.stories.tsx` and `src/components/common/*.stories.tsx` — co-located stories (linted + type-checked because they're under `src`).

Modified files:

- `package.json` — add `ladle` + `ladle:build` scripts; add `@ladle/react` to `devDependencies`.
- `.gitignore` — ignore Ladle's `build/` output dir.
- `eslint.config.js` — add an override so `*.stories.tsx` don't trip `react-refresh/only-export-components` or the no-drift rules.
- `.github/workflows/ci.yml` — (optional, final task) add a `ladle build` guard.
- `README.md` — (optional, final task) document `npm run ladle`.

---

## Task 1: Walking skeleton — Ladle installed, serving one themed Button story

**Files:**
- Modify: `package.json` (scripts + devDependency)
- Modify: `.gitignore`
- Create: `.ladle/config.mjs`
- Create: `.ladle/vite.config.ts`
- Create: `.ladle/components.tsx`
- Create: `src/components/ui/Button.stories.tsx`

**Interfaces:**
- Consumes: `applyTheme` and `AppliedTheme` from `src/lib/applyTheme.ts`; `Button` from `src/components/ui/Button.tsx` (`variant?: "primary" | "secondary" | "tertiary" | "danger"`, `size?: "sm" | "md"`, `fullWidth?: boolean`, `loading?: boolean`, `children`, plus native button attrs).
- Produces: `npm run ladle` (serve) and `npm run ladle:build` (static build) scripts; the `.ladle/components.tsx` `Provider` pattern that every later story relies on for theming + background.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/ladle-component-workshop
```

- [ ] **Step 2: Install Ladle (dev-only)**

```bash
npm i -D @ladle/react
```

Expected: `@ladle/react` added under `devDependencies` in `package.json`, `package-lock.json` updated. If npm reports a peer-dependency conflict with Vite 7 / React 19, re-run once with `npm i -D @ladle/react --legacy-peer-deps` and note it in the commit body. (Verification in Step 8 is the real gate — a successful build proves compatibility.)

- [ ] **Step 3: Add scripts to `package.json`**

Add these two entries to the `"scripts"` block (leave existing scripts untouched):

```json
    "ladle": "ladle serve",
    "ladle:build": "ladle build"
```

- [ ] **Step 4: Ignore Ladle's build output**

Add to `.gitignore` (Ladle's default build output dir is `build/`):

```gitignore

# Ladle component-workshop build output
/build
```

- [ ] **Step 5: Create `.ladle/config.mjs`**

```js
/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "src/**/*.stories.{ts,tsx}",
  addons: {
    // Dark is the app's default theme (:root); Ladle's toggle flips to light.
    theme: { enabled: true, defaultState: "dark" },
    // Live prop editing for "refining" component states.
    control: { enabled: true },
    // Responsive width presets.
    width: { enabled: true },
    // Accessibility checks while refining.
    a11y: { enabled: true },
    // "Show code" for each story.
    source: { enabled: true },
  },
};
```

- [ ] **Step 6: Create `.ladle/vite.config.ts`**

Ladle applies its own React plugin internally — do NOT add `@vitejs/plugin-react` here. Only add Tailwind so `globals.css`'s `@import "tailwindcss"` compiles.

```ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Ladle merges this with its internal Vite config. We only need the Tailwind 4
// plugin so the app's globals.css (@import "tailwindcss") compiles; Ladle
// supplies the React plugin itself.
export default defineConfig({
  plugins: [tailwindcss()],
});
```

- [ ] **Step 7: Create the global provider `.ladle/components.tsx`**

```tsx
import { useLayoutEffect } from "react";
import type { GlobalProvider } from "@ladle/react";
// The real app token layer: tokens.css + tailwind + @theme mappings. Importing
// this one file styles every story exactly like the app.
import "../src/styles/globals.css";
import { applyTheme } from "../src/lib/applyTheme";

/**
 * Wraps every story. Maps Ladle's built-in light/dark toggle onto the app's real
 * theme system (applyTheme sets/removes [data-theme] on <html>), and paints an
 * app-like background so components are legible in both themes.
 */
export const Provider: GlobalProvider = ({ children, globalState }) => {
  const light = globalState.theme === "light";
  useLayoutEffect(() => {
    // Reuse the canonical mechanism — "dark" clears the attribute (:root default),
    // "light" sets [data-theme="light"]. "auto" maps to dark for predictability.
    applyTheme(
      light
        ? { id: "light", appearance: "light", builtin: true }
        : { id: "dark", appearance: "dark", builtin: true },
    );
  }, [light]);

  return (
    <div
      style={{
        background: "var(--color-bg-app)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-sans)",
        minHeight: "100vh",
        padding: "var(--space-6)",
      }}
    >
      {children}
    </div>
  );
};
```

- [ ] **Step 8: Create the first story `src/components/ui/Button.stories.tsx`**

```tsx
import type { Story } from "@ladle/react";
import { Button } from "./Button";

export const Variants: Story = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="tertiary">Tertiary</Button>
    <Button variant="danger">Danger</Button>
  </div>
);

export const States: Story = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
    <Button variant="primary">Default</Button>
    <Button variant="primary" disabled>
      Disabled
    </Button>
    <Button variant="primary" loading>
      Loading
    </Button>
    <Button variant="primary" size="md">
      Medium
    </Button>
  </div>
);
```

- [ ] **Step 9: Verify the static build succeeds (compat + config gate)**

Run: `npm run ladle:build`
Expected: exits 0, prints a build summary, writes a `build/` directory. This proves Ladle is compatible with the installed Vite 7 / React 19 and that Tailwind + the token CSS compile. If it fails on `@import "tailwindcss"`, the Tailwind plugin in `.ladle/vite.config.ts` (Step 6) is missing/misnamed — fix and re-run.

- [ ] **Step 10: Verify it serves and themes correctly (visual)**

Run: `npm run ladle`
Expected: dev server boots (default `http://localhost:61000`). In the browser: the left tree shows **Button → Variants / States**; buttons render with correct token colours on a dark app background. Toggling the theme button in Ladle's toolbar switches the background and button colours to the light theme. Stop the server (Ctrl-C) when confirmed.

- [ ] **Step 11: Verify lint + typecheck of the new story**

Run: `npm run lint`
Expected: exits 0 (the Button story is a pure component export; no warnings).
Run: `npm run build:web`
Expected: `tsc` passes (story is type-checked); vite app build succeeds. (If `tsc` flags the story, fix types before committing.)

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json .gitignore .ladle src/components/ui/Button.stories.tsx docs/superpowers/plans
git commit -m "chore: add Ladle component workshop with themed Button story"
```

---

## Task 2: Live controls (args) on the Button story

**Files:**
- Modify: `src/components/ui/Button.stories.tsx`

**Interfaces:**
- Consumes: Ladle's `Story<T>` generic + `.args` / `.argTypes` API for live controls.
- Produces: the args/argTypes pattern reused by any later story that wants live prop editing.

- [ ] **Step 1: Add a Playground story with live controls**

Append to `src/components/ui/Button.stories.tsx`:

```tsx
interface PlaygroundArgs {
  variant: "primary" | "secondary" | "tertiary" | "danger";
  label: string;
  disabled: boolean;
  loading: boolean;
  fullWidth: boolean;
}

export const Playground: Story<PlaygroundArgs> = ({
  variant,
  label,
  disabled,
  loading,
  fullWidth,
}) => (
  <Button variant={variant} disabled={disabled} loading={loading} fullWidth={fullWidth}>
    {label}
  </Button>
);

Playground.args = {
  label: "Save changes",
  disabled: false,
  loading: false,
  fullWidth: false,
};

Playground.argTypes = {
  variant: {
    options: ["primary", "secondary", "tertiary", "danger"],
    control: { type: "select" },
    defaultValue: "primary",
  },
};
```

- [ ] **Step 2: Verify controls work (visual)**

Run: `npm run ladle`
Expected: **Button → Playground** shows an "Controls" panel; changing `variant` (dropdown), toggling `disabled`/`loading`/`fullWidth` (checkboxes), and editing `label` (text) updates the rendered button live. Stop the server when confirmed.

- [ ] **Step 3: Verify lint + build**

Run: `npm run lint` → exits 0.
Run: `npm run ladle:build` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Button.stories.tsx
git commit -m "feat: add live controls to the Button workshop story"
```

---

## Task 3: Keep lint green — ESLint override for story files

**Files:**
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: the existing flat-config structure in `eslint.config.js` (mirrors the existing test-file exemption block).
- Produces: `*.stories.tsx` are exempt from `react-refresh/only-export-components` and the no-drift `no-restricted-syntax` rules, so future stories can't fail `--max-warnings 0`.

- [ ] **Step 1: Add a stories override block**

In `eslint.config.js`, add this object to the exported `tseslint.config(...)` array, immediately after the existing test-files override block (the one that sets `"no-restricted-syntax": "off"`):

```js
  {
    // Story files may export non-component values (args/argTypes objects) and
    // legitimately use sentinel strings in fixtures; keep them off the
    // component-only and no-drift rules so `--max-warnings 0` stays green.
    files: ["**/*.stories.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
      "no-restricted-syntax": "off",
    },
  },
```

- [ ] **Step 2: Verify lint still passes**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Prove the override works — temporary sanity check**

Temporarily add a non-component export to `src/components/ui/Button.stories.tsx`:

```tsx
export const meta = { title: "UI/Button" };
```

Run: `npm run lint`
Expected: still exits 0 (without the override, `react-refresh/only-export-components` would warn and fail). Then **remove** the temporary `meta` export and re-run `npm run lint` → still 0.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "chore: exempt Ladle story files from component-only lint rules"
```

---

## Task 4: Stories for input & control primitives

**Files:**
- Create: `src/components/ui/Input.stories.tsx`
- Create: `src/components/ui/IconButton.stories.tsx`
- Create: `src/components/ui/SegmentedControl.stories.tsx`
- Create: `src/components/ui/Dropdown.stories.tsx`
- Create: `src/components/ui/MultiSelect.stories.tsx`

**Interfaces (verified prop shapes — match these exactly):**
- `Input` (`src/components/ui/Input.tsx`): `InputHTMLAttributes<HTMLInputElement>` + `fullWidth?: boolean`.
- `IconButton` (`src/components/ui/IconButton.tsx`): `ButtonHTMLAttributes` + `size?`; takes an icon element as `children`. Icon glyphs live in `src/components/ui/icons.tsx`.
- `SegmentedControl<T extends string>` (`src/components/ui/SegmentedControl.tsx`): `options: readonly SegmentOption<T>[]`, `value: T`, `onChange: (value: T) => void`, `ariaLabel: string`, `size?`, `iconOnly?`. Open the file to confirm the exact `SegmentOption` field names before writing (it has `value` plus a label/icon field).
- `Dropdown` / `MultiSelect` (`src/components/ui/Dropdown.tsx`, `MultiSelect.tsx`): open/close + selection state — render them inside a small stateful wrapper (see recipe).

**Story-writing recipe (applies to every component below and in Tasks 5–6):**
1. Read the component's props interface at the top of its `.tsx` file.
2. Write one or more named `Story` exports that render the component covering its meaningful visual states (each variant, disabled, empty, etc.).
3. For any component that needs interaction/selection state (Dropdown, MultiSelect, SegmentedControl), wrap it in a tiny local component using `useState` so it's interactive in the workshop.
4. Use only token styles (`var(--…)`) for any layout wrappers.
5. Keep it purely presentational — no store, no `invoke`.

- [ ] **Step 1: `Input.stories.tsx`**

```tsx
import type { Story } from "@ladle/react";
import { Input } from "./Input";

export const Default: Story = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 320 }}>
    <Input placeholder="Placeholder text" />
    <Input defaultValue="With a value" />
    <Input placeholder="Disabled" disabled />
    <Input placeholder="Full width" fullWidth />
  </div>
);
```

- [ ] **Step 2: `SegmentedControl.stories.tsx`** (interactive via `useState`)

```tsx
import { useState } from "react";
import type { Story } from "@ladle/react";
import { SegmentedControl } from "./SegmentedControl";

export const TwoOptions: Story = () => {
  const [value, setValue] = useState<"write" | "preview">("write");
  return (
    <SegmentedControl
      ariaLabel="Editor mode"
      value={value}
      onChange={setValue}
      options={[
        { value: "write", label: "Write" },
        { value: "preview", label: "Preview" },
      ]}
    />
  );
};
```

Note: if the file's `SegmentOption` uses a field other than `label` (e.g. `icon`), adjust the `options` entries accordingly after reading `SegmentedControl.tsx`.

- [ ] **Step 3: `IconButton.stories.tsx`, `Dropdown.stories.tsx`, `MultiSelect.stories.tsx`**

Follow the recipe. Specifics:
- **IconButton**: render 2–3 `IconButton`s wrapping glyphs imported from `./icons` (e.g. an ellipsis/close icon), one `disabled`. Read `icons.tsx` for the exact exported glyph names.
- **Dropdown**: render a `Dropdown` with a trigger button and a few `DropdownItem`/`DropdownLabel`/`DropdownDivider` children (all exported from `Dropdown.tsx`). It manages its own open state via the trigger, so no wrapper state is required unless the file's API needs a controlled `open` prop — check the `Dropdown(` signature at line ~73.
- **MultiSelect**: read the `MultiSelect(` props (line ~19); render it inside a `useState`-backed wrapper holding the selected values array so toggling options is interactive.

- [ ] **Step 4: Verify build, lint, and visuals**

Run: `npm run ladle:build` → exits 0.
Run: `npm run lint` → exits 0.
Run: `npm run ladle` → each new component appears in the tree and renders/interacts correctly in both themes. Stop the server when confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Input.stories.tsx src/components/ui/IconButton.stories.tsx src/components/ui/SegmentedControl.stories.tsx src/components/ui/Dropdown.stories.tsx src/components/ui/MultiSelect.stories.tsx
git commit -m "feat: add workshop stories for input and control primitives"
```

---

## Task 5: Stories for feedback & display primitives

**Files:**
- Create: `src/components/ui/Spinner.stories.tsx`
- Create: `src/components/ui/EmptyState.stories.tsx`
- Create: `src/components/ui/FileStatusIcon.stories.tsx`
- Create: `src/components/ui/Tooltip.stories.tsx`
- Create: `src/components/ui/WaspLogo.stories.tsx`

**Interfaces (verified):**
- `Spinner`: `{ size?: number | string; style?: CSSProperties }`.
- `EmptyState`: `{ message: string; icon?: ReactNode; action?: ReactNode }`.
- `FileStatusIcon`: `{ status: string; size?: number }` — valid statuses: `Added`, `Untracked`, `Modified`, `Deleted`, `Renamed`, `Copied` (see the `META` map in `FileStatusIcon.tsx`).
- `Tooltip`: open `Tooltip.tsx` (function at line ~20) to read its props (children + label/content + placement).
- `WaspLogo`: read `WaspLogo.tsx` for size/props.

- [ ] **Step 1: `FileStatusIcon.stories.tsx` (status matrix)**

```tsx
import type { Story } from "@ladle/react";
import { FileStatusIcon } from "./FileStatusIcon";

const STATUSES = ["Added", "Untracked", "Modified", "Deleted", "Renamed", "Copied"];

export const AllStatuses: Story = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
    {STATUSES.map((status) => (
      <div key={status} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <FileStatusIcon status={status} />
        <span style={{ fontSize: "var(--font-size-sm)" }}>{status}</span>
      </div>
    ))}
  </div>
);
```

- [ ] **Step 2: `EmptyState.stories.tsx`**

```tsx
import type { Story } from "@ladle/react";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

export const MessageOnly: Story = () => <EmptyState message="No changes" />;

export const WithAction: Story = () => (
  <EmptyState
    message="No repositories open"
    action={<Button variant="primary">Open a repository</Button>}
  />
);
```

- [ ] **Step 3: `Spinner.stories.tsx`, `Tooltip.stories.tsx`, `WaspLogo.stories.tsx`**

Follow the recipe. Specifics:
- **Spinner**: render a few sizes (`<Spinner />`, `<Spinner size={24} />`, `<Spinner size="2em" />`); it inherits `color`, so wrap one in a `<span style={{ color: "var(--color-accent-primary)" }}>` to show colour inheritance.
- **Tooltip**: render an element wrapped in a `Tooltip` with a label; add a note that hovering shows it. Match the exact prop names from `Tooltip.tsx`.
- **WaspLogo**: render at 1–2 sizes per its props.

- [ ] **Step 4: Verify build, lint, visuals**

Run: `npm run ladle:build` → 0. `npm run lint` → 0. `npm run ladle` → all render in both themes; FileStatusIcon colours match semantics (green add, amber modified, red deleted, accent rename/copy). Stop when confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Spinner.stories.tsx src/components/ui/EmptyState.stories.tsx src/components/ui/FileStatusIcon.stories.tsx src/components/ui/Tooltip.stories.tsx src/components/ui/WaspLogo.stories.tsx
git commit -m "feat: add workshop stories for feedback and display primitives"
```

---

## Task 6: Stories for dialog / overlay primitives (common)

**Files:**
- Create: `src/components/common/ConfirmDialog.stories.tsx`
- Create: `src/components/common/PromptDialog.stories.tsx`
- Create: `src/components/common/ContextMenu.stories.tsx`

**Interfaces (verified):**
- `ConfirmDialog` (`src/components/common/ConfirmDialog.tsx`): `{ title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }`. Renders a fixed-position modal.
- `PromptDialog` (`src/components/common/PromptDialog.tsx`): `{ title: string; label?: string; initialValue?: string; confirmLabel?: string; onConfirm: (value: string) => void; onCancel: () => void }`.
- `ContextMenu` (`src/components/common/ContextMenu.tsx`): read its props (position `x`/`y`, `items: MenuItem[]`, `onClose`). Render it at a fixed position with a couple of items and a separator; the `MenuItem` shape (`{ label, onSelect } | { separator: true } | danger`) is defined in `ContextMenu.tsx` — read it.

These render as fixed-position overlays, so they'll appear over the story area. Provide `onConfirm`/`onCancel`/`onClose`/`onSelect` handlers that log to the console (harmless in the workshop).

- [ ] **Step 1: `ConfirmDialog.stories.tsx`**

```tsx
import type { Story } from "@ladle/react";
import { ConfirmDialog } from "./ConfirmDialog";

const noop = () => console.log("action");

export const Destructive: Story = () => (
  <ConfirmDialog
    title="Discard all changes?"
    message="This will permanently discard every uncommitted change in the working tree."
    confirmLabel="Discard"
    danger
    onConfirm={noop}
    onCancel={noop}
  />
);

export const NonDestructive: Story = () => (
  <ConfirmDialog
    title="Apply stash?"
    message="Apply the selected stash onto the current working tree."
    confirmLabel="Apply"
    danger={false}
    onConfirm={noop}
    onCancel={noop}
  />
);
```

- [ ] **Step 2: `PromptDialog.stories.tsx`**

```tsx
import type { Story } from "@ladle/react";
import { PromptDialog } from "./PromptDialog";

const log = (value: string) => console.log("confirm:", value);
const cancel = () => console.log("cancel");

export const NewBranch: Story = () => (
  <PromptDialog
    title="New branch"
    label="Branch name"
    confirmLabel="Create"
    onConfirm={log}
    onCancel={cancel}
  />
);

export const Prefilled: Story = () => (
  <PromptDialog
    title="Rename branch"
    label="Branch name"
    initialValue="feat/old-name"
    confirmLabel="Rename"
    onConfirm={log}
    onCancel={cancel}
  />
);
```

- [ ] **Step 3: `ContextMenu.stories.tsx`**

Follow the recipe using the real `MenuItem` shape from `ContextMenu.tsx`. Render one `ContextMenu` at a fixed `x`/`y` with 2–3 action items, a separator, and one `danger` item; pass `onClose={() => console.log("close")}`.

- [ ] **Step 4: Verify build, lint, visuals**

Run: `npm run ladle:build` → 0. `npm run lint` → 0. `npm run ladle` → each dialog/menu renders (over a dimmed backdrop where applicable) and looks correct in both themes. Buttons inside dialogs use the shared `Button` primitive, so they should match Task 1. Stop when confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/components/common/ConfirmDialog.stories.tsx src/components/common/PromptDialog.stories.tsx src/components/common/ContextMenu.stories.tsx
git commit -m "feat: add workshop stories for dialog and overlay primitives"
```

---

## Task 7 (optional): CI guard + README docs

Only do this if the user wants the workshop protected in CI and documented. It adds a small amount of CI time.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing CI job that already runs `npm ci` and `npm run test:unit`.
- Produces: a CI step that fails if any story stops compiling; a README section for contributors.

- [ ] **Step 1: Add a Ladle build step to CI**

In `.github/workflows/ci.yml`, immediately after the existing `Frontend tests` step (`run: npm run test:unit`), add:

```yaml
      - name: Component workshop build
        run: npm run ladle:build
```

(If the maintainer prefers to keep CI lean, this can run on a single platform only — but the simplest correct change is to add it to the existing step sequence.)

- [ ] **Step 2: Document it in the README**

Add a short "Component workshop" section:

```markdown
## Component workshop (Ladle)

View and refine UI primitives in isolation, with a light/dark theme toggle:

```bash
npm run ladle        # dev server at http://localhost:61000
npm run ladle:build  # static build (build/)
```

Stories live next to their components as `*.stories.tsx`. Only pure,
prop-driven components have stories; store-coupled components are not yet
included.
```

- [ ] **Step 3: Verify**

Run: `npm run ladle:build` → 0 (mirrors what CI will run).
Optionally validate the workflow YAML with `npx --yes action-validator .github/workflows/ci.yml` if available, or just re-read the diff for indentation.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: build the Ladle component workshop; document it in the README"
```

---

## Self-Review

**Spec coverage:**
- "Add Storybook or similar for viewing and refining UI components" → Ladle installed (Task 1), viewing = story tree + themed rendering (Tasks 1, 4–6), refining = live controls/args (Task 2) + a11y/width addons (Task 1 config). ✅
- "or something better" → tool choice justified in Context; decided with user. ✅
- Theme (dark/light) parity with the real app → Provider reuses `applyTheme` (Task 1). ✅
- Keep the repo's gates green → lint override (Task 3), stories type-checked via existing `build:web`, build artifacts git-ignored (Task 1). ✅

**Placeholder scan:** Exemplar stories (Button, Input, SegmentedControl, FileStatusIcon, EmptyState, ConfirmDialog, PromptDialog) use verified prop signatures with complete code. Components rendered via "recipe" (IconButton, Dropdown, MultiSelect, Spinner, Tooltip, WaspLogo, ContextMenu) each include an explicit instruction to read the real props first and a concrete list of states to show — this is the deliberate "repeated pattern, described once" allowance, not a TODO.

**Type consistency:** `applyTheme` / `AppliedTheme` used consistently (`{ id, appearance, builtin }`). `Story` / `Story<T>` and `.args` / `.argTypes` used consistently across Tasks 1–6. Script names `ladle` / `ladle:build` consistent across tasks and CI.

## Verification (end-to-end)

1. `npm run ladle` — dev server boots; the story tree lists every component from Tasks 1, 4, 5, 6; each renders correctly; the theme toggle flips the whole workshop between the app's dark and light token themes; the Button **Playground** controls edit props live.
2. `npm run ladle:build` — exits 0 (proves the whole story set compiles under Vite 7 / React 19 / Tailwind 4).
3. `npm run lint` — exits 0 (`--max-warnings 0`, stories included).
4. `npm run build:web` — `tsc` type-checks all stories (they're under `src`) and the app build still succeeds.
5. `npm run test:unit` — existing suite unchanged and green (no app code was modified; only additive stories + config).
6. Confirm `@ladle/react` is under `devDependencies` (not `dependencies`) and that `git grep -n "@ladle/react" src` returns only `*.stories.tsx` files — Ladle must never be imported by app runtime code.

## Deferred (explicitly out of scope)

- Store-coupled components (`ToastContainer` → `useToastStore`, `AutoStashDialog` → `useAutoStashStore`) — need mock-store decorators in `.ladle/components.tsx`.
- Full 5-theme picker (github-dark, github-light, cobalt2). MVP wires Ladle's built-in light/dark toggle only; a custom global control for all built-ins is a follow-up.
- Stories for larger feature components (CommitGraph, StagingPanel, PR panels) — these are store/Tauri-coupled.
