# Things still to do

Living backlog. Keep this current as work progresses: tick items off, move them
between sections, and add new ideas under the right heading. Items marked
**(v1 scope)** were in the original CLAUDE.md feature set but aren't built yet;
**(Phase 6)** are from the polish/hardening phase.

## Repository management

- [x] Multi-tab view for opening multiple repositories at once — backend tracks
      a set of open repos + an active tab (file watcher + status follow the
      active one); top TabBar to switch/close/open; tabs persist across restarts.
      Switching reloads fresh (no per-tab UI-state memory yet).
- [ ] Add support for worktrees
- [x] Remove the "workspace" feature — removed entirely, incl. the cross-repo
      features that hung off it (search, bulk fetch/pull, overview). Cross-repo
      notifications were never built. Multi-repo to return via the multi-tab view.

## Commit graph & branches

- [ ] Right-click actions on commits
      - checkout this commit
      - create branch here
      - copy commit hash
      - copy link to this commit on remote
      - create tag here
- [ ] Right-click actions on branches (delete local, push, etc.)
- [x] Integrate user icons via gravatar (in the commit dots) — author gravatars
      render clipped into the commit dots (lane-coloured dot is the fallback).
      Rust `get_avatar` command fetches once per email (d=404 to detect "no
      avatar") and caches to the OS cache dir — hits (`<hash>.png`) and misses
      (`<hash>.none`) both cached with a 14-day TTL, so it survives restarts and
      never re-fetches while fresh. Frontend `avatarStore` dedupes per email,
      requests only authors in view, and bumps a version on resolve so the canvas
      redraws the dot from colour to image asynchronously.
- [ ] **Cherry-pick (single or range)** (v1 scope)
- [ ] Rebase as a merge strategy with conflict-resolution UI — confirm whether
      it's wired up as a first-class action (v1 scope)
- [x] Tooltip for branch name/tag when hovering on branch name/tag pill — new
      reusable token-styled `Tooltip` (hover delay, fixed-positioned above the
      element like ContextMenu, hides on pointer-down so it doesn't linger during
      a drag). Applied to the branch/tag pills showing the full ref name (handy
      since pills truncate), replacing the plain native `title`.
- [x] Indicator/icon show currently checked out branch clearly — two cues:
      (1) the checked-out branch's pill in the graph is marked distinctly — a
      check icon (replacing the laptop marker), bold text, and a crisp white
      inset ring so it stands out from the other same-coloured local pills; its
      tooltip reads "<name> (checked out)". `BranchCell`/`BranchPill` take a
      `currentBranch` (= `currentRepo.headBranch`, threaded through `GraphRow`);
      only a local pill whose name matches is flagged (`data-current`).
      (2) a subtle pulsing ring on the HEAD commit dot — a CSS overlay
      (`.graph-head-pulse`) positioned over the canvas at the HEAD dot (cheap; no
      canvas redraw loop), a ring that starts at the dot's edge (base size = dot
      diameter) and expands outward/fades every 1.5s, with a static-halo fallback
      under `prefers-reduced-motion`. Only rendered when HEAD is in the loaded
      slice. (3) the HEAD commit's right-edge accent line (canvas) becomes a
      left-pointing triangle, so the current commit reads at a glance even when
      other branches are several commits ahead.
- [x] Improve colour scheme. Colours too bright and "basic"? Allow default branch colours to be specified in colour schemes?
- [ ] Open PR as a result of dropping one branch onto another. Include ability to enter title, description, "assign to (default to @me)", tags and then "Open PR" and "Continue on GitHub" options.
- [x] When clicking on the details of a commit (i.e. already committed) clicking on a file shows the changes in a side by side diff view that opens in the main panel of the app. It is possible to change the view from side by side to "inline"
      — clicking a file in the commit detail panel opens its diff in the main panel
      (replacing the graph, like staging does), reusing `StageFileEditor` in a new
      read-only mode: split/inline toggle, red/green decoration and syntax
      highlighting, but no stage gutters/buttons. Implemented together with the
      right-panel General-UX item below.

## Working tree & committing

- [x] "Staging" area for files during commit: stage an entire file or a hunk and
      move it to the panel below; support staging deleted and added files; allow
      "unstage"
- [x] Ability to amend a commit message before it's been pushed to the remote —
      "Amend last commit" toggle in the commit form prefills the tip commit's
      message; reword + Amend rewrites HEAD (message only, tree/parents/author
      kept). Backend refuses, and the toggle is hidden, once the commit is
      contained in a remote-tracking branch (already pushed).
- [x] Improved UX for committing — doesn't need to be a separate "screen"
      (Changes/Staged panels, diff in main view, subject + markdown Write/Preview
      body, Commit / Reset-with-confirm)
- [x] Merge-editor-style staging: selecting a modified file opens a three-pane
      `StageFileEditor` — HEAD (left) / working tree (right) read-only on top, an
      editable "Staged result" buffer on the bottom — with per-line `+`/`−`
      gutter toggles (`−` = staged, click to unstage). Replaced the hunk-based
      `HunkDiffViewer`. Backend `get_stage_file_contents` returns exact
      HEAD/worktree bytes (+ binary/deletion flags); `stage_file_content` writes
      the result buffer straight to the index as a blob (bypasses clean filters —
      noted limitation). Line alignment + result composition live in a tested TS
      util (`lib/lineDiff.ts`); binary/deleted files fall back to whole-file
      staging. Follow-ups: (a) char-level intra-line diff decoration on the
      staging panes (only line-level red/green so far — the merge editor already
      has char-level); (b) remove the now-dead backend hunk commands
      (`stage_hunk`/`unstage_hunk`/`discard_hunk` + `build_hunk_patch`) and the
      `get_staged_diff`/`get_unstaged_diff` diff commands if no future feature
      needs them.
- [x] Add file-type-aware syntax highlighting in diff viewer — shared
      `lib/editorLanguage.ts` maps a file path (extension, plus a few
      extension-less names like `Dockerfile`) to a CodeMirror `StreamLanguage`
      from the already-bundled `@codemirror/legacy-modes` (no new deps; covers
      JS/TS/JSX, Python, Rust, Go, C/C++/Java/C#/Kotlin/Swift, CSS/SCSS/LESS,
      Ruby, shell, SQL, YAML/TOML, XML/HTML, etc.). Applied to the file-content
      panes of `StageFileEditor` (HEAD / Working Tree / Result) and the merge
      `ConflictFileEditor` (Source / Current / Result); unknown types render
      plain. The unified `DiffViewer` (commit detail) keeps diff-mode — per-line
      code tokenisation of a `+`/`-`-prefixed unified diff would be wrong; it'll
      gain highlighting when the side-by-side commit diff lands. Follow-up: the
      highlight palette comes from oneDark (dark) / defaultHighlightStyle (light)
      rather than the active app theme's tokens — a theme-matched highlight style
      would be a nice polish.
- [x] Add "removed" line to gutter in diff view when staging
- [x] Allow changing view from side-by-side/split view to "inline" view (done for
      the staging diff; merge editor deferred) — `StageFileEditor` header now has a
      GitKraken-style icon toggle (`SplitViewIcon`/`InlineViewIcon` segmented
      control) switching between the two-pane split and a single unified/inline
      editor. Inline = one CodeMirror with every diff row on its own line (new
      `inlineText` helper in `lib/lineDiff.ts`), removed red / added green, a dual
      old+new line-number gutter (`dualNumberGutter`, reusing the aligned
      line-number maps), and the same per-line `+`/`−` stage toggles. Choice
      persists to `localStorage`. `ReadOnlyStagePane` was generalised (optional
      label + optional `oldLineNumberMap`) to serve both modes. NOTE: only the
      staging view for now — the merge editor (`ConflictFileEditor`) should get the
      same toggle when the two diff surfaces are unified into shared components
      (tracked separately; we'll review the merge flow later).
- [x] Remove unnecessary bottom panel in diff view when staging files (but not
      when handling merge conflicts!) — `StageFileEditor` dropped the editable
      "Staged result" pane (it confusingly showed a full result even before you
      staged anything); Stage/Reset moved to the header and the staged content is
      now composed straight from the per-line selection (`composeStagedText`).
      The two panes are now row-for-row aligned (GitKraken style): each diff row
      is one line in both panes. The side that holds the changed text reads solid
      (red removal in HEAD, green addition in Working Tree); the absent side shows
      a neutral diagonal-hatch placeholder gap (`cm-diff-placeholder-line`, built
      from `--color-border-default` over the surface). Real file line numbers are
      kept in the gutter (placeholders blank) via new
      `alignedHead/WorktreeText` + `alignedHead/WorktreeLineNumbers` helpers in
      `lib/lineDiff.ts`. Removed the now-dead `stageResultPane.ts`. The merge
      editor (`ConflictFileEditor`) is untouched — it keeps its Result pane.
- [x] Auto-advance the staging diff to the next unstaged file — when the file
      open in the diff view is staged (via the editor's Stage, whole-file stage,
      or its row's Stage button), the view jumps to the next file that still needs
      staging (the one that took its slot in the Changes list, clamped to the
      last). A partial stage keeps the file selected; when nothing is left to
      stage the last file stays shown. Logic in `lib/stagingSelection.ts`
      (`unstagedPaths` + `nextSelectionAfterStaging`, both tested), wired into the
      store's `applyStagedContent`/`stageFile` (gated on the file being the open
      one, so staging a different file's row doesn't move the selection).
- [ ] Execute git hooks (pre-commit, pre-push) and show output in a built-in pane
- [x] When a branch is checked out and fully committed, checking out another branch
      feels like it's not a "clean" checkout and I end up with multiple changes
      in an unstaged state.
      — Diagnosed via the diagnostic logging: the `checkout: pre/post` counts showed
      `checkout_branch` itself is clean (0/0/0); the spurious "modified" files
      actually appeared after a **pull (fast-forward)**. Root cause was the order in
      `remote_ops::pull_ff`: it moved the branch ref to the upstream commit *before*
      `checkout_tree`. Since HEAD is a symbolic ref to the branch, moving it made the
      checkout baseline (HEAD) equal the target, so the working tree was never
      updated while the index advanced — leaving every changed file reading as
      modified. Fixed by checking out the new tree first (baseline = old HEAD), then
      moving the ref. Regression test
      `pull_ff_materialises_new_files_and_leaves_a_clean_tree` (verified failing
      before the reorder).

## PR refinements

- [ ] Improve UX for opening PRs
  - [ ] Select source branch automatically as current branch
  - [ ] Select destination branch automatically as main
  - [ ] Change branch inputs to select from local branches
  - [ ] Allow adding title and description with formatting
  - [ ] Add a "continue editing on GitHub" button to pass over to GitHub to open the PR
  - [ ] Allow choosing an assignee (defaulting to @me)
  - [ ] Allow adding one or more labels

## Merge editor (v2 refinements)

- [x] Per-line (sub-block) selection of source vs current via gutter checkboxes
      (Phase 6) — `selectionGutter` renders controlled checkboxes on each
      conflict block's lines; toggles compose the result via `lineSelection`
      (`composeBlockText`). Whole-block "Accept source/current" chips remain,
      now implemented as select-all-lines-of-one-side.
- [x] Current-line highlighting across the source/current/result panes (Phase 6)
      — shared `highlightActiveLine`/`highlightActiveLineGutter` on all three
      panes (read-only panes still track a cursor, so clicking highlights).
- [x] Red/green changed-line plus intra-line (character-level) diff decoration
      (Phase 6) — `mergeDecorations` emits line-level (`cm-diff-add/del-line`)
      and char-level (`cm-diff-add/del` marks) decorations from a per-block
      char diff (`diffSides`). Source reads as added (green), current as
      removed (red).

## GitHub integration

- [x] Move GitHub connection into settings — connect/disconnect + status moved
      out of the sidebar into a new Settings → GitHub section (`GithubSettings`).
      Status is now *validated*, not "is there a token": new backend
      `github_connection_status` command calls `check_token` (GET /user) and
      returns `connected` (with the login), `expired` (401 → reconnect),
      `disconnected` (no token), or `error` (transient/network, with message).
      Frontend `githubStore` replaced the boolean `authStatus` map with a
      `connections` map + `checkConnection`; the Settings section re-validates on
      mount, on window focus, and every 60s, so a token revoked elsewhere is
      caught. Shows "Connected as <login>", Reconnect on expiry, Retry on error.
      Removed the now-dead `github_auth_status` command.
- [ ] Issue reference linking in commit messages (v1 scope)
- [x] Attempting to manage PRs shows error "failed to parse PRs" — root cause was
      the GitHub REST helpers calling `.json()` without checking HTTP status, so an
      auth/404/rate-limit error body (a JSON object, not an array) failed to
      deserialize and surfaced as the cryptic "failed to parse PRs". New
      `github_json` helper checks the status and surfaces the status + GitHub's
      `message` (e.g. "GitHub API error fetching pull requests (401 Unauthorized):
      Bad credentials"); applied to `list_pull_requests`, `list_repos`, and
      `create_pull_request`. Also made the PR `user` optional (deleted/ghost
      authors → "ghost") so a null author no longer fails the parse. The PR panel
      already shows the error string, so the actionable message flows through.
- [ ] Cross-repo PR/CI notifications via API polling (Phase 6) — overlaps the
      workspace decision above

## Config & settings

- [ ] Git identity config (per-repo / global name + email) (v1 scope)
- [ ] Commit signing config (GPG / SSH) (v1 scope)
- [ ] SSH key management UI (add, view, associate with GitHub accounts) (v1 scope)
- [ ] `.gitconfig` viewer/editor (v1 scope)
- [ ] Keyboard shortcut configuration (v1 scope)
- [ ] Embedded terminal pane scoped to the repo working dir, toggleable (Phase 6)
- [x] Remove unnecessary "changes" view. That is replaced by the "uncommitted changes" part of the graph view
      — dropped the "Changes" NavBar tab, the `working-tree` view, and the
      standalone `WorkingTreePanel` (+ its test). The shared `StagingPanel` /
      `HunkDiffViewer` stay, reused by the history view's uncommitted-changes flow.

## Theming

- [x] Improve dark theme. Think more "monokai" - more grey than black with clear colours for highlights/actions
      — retuned the `:root` neutral scale to warm Monokai greys (app reads dark
      grey, not near-black; off-white #f8f8f2 text) and the semantic/lane/diff
      colours to vivid Monokai hues (green/pink/orange/purple/cyan/yellow). Blue
      (#4d9de0) stays the primary action/link colour so buttons read as clickable.
      Only the default dark theme changed — other themes set their surfaces
      explicitly, and no component reads the raw neutral scale.
- [x] Additional built-in themes (e.g. Cobalt2) — Cobalt2 added (deep-blue
      surfaces, signature yellow accent with dark text-on-accent). The built-in
      theme machinery now takes any number of `[data-theme=…]` token blocks, so
      further themes are just a token block + a `BUILT_IN_THEMES` entry.
- [x] Add a "GitHub" theme pair - dark and light - matching GitHub colour themes.
      — "GitHub Dark" + "GitHub Light" built-in themes (Primer palette) added as
      `[data-theme=github-dark|github-light]` token blocks. `applyTheme` now maps
      any built-in id to its `data-theme` value (dark stays the `:root` default),
      so further built-ins (e.g. Cobalt2) just need a token block + registry entry.
- [x] Further theming improvements - the current grey colours feel "brown" and need to be more "grey"
      — resolved without a code change: the default "Dark" theme is Monokai, whose
      warm/brown greys are intentional and part of its character. The neutral grey
      look is already provided by the built-in "GitHub Dark" theme, so the fix is
      to use that theme rather than neutralise Monokai's palette.
- [x] Allow choice of fonts, customization of default UI font size, default code editor font (monospace).
      Changes to be configurable from "settings" section and to persist between app reloads.
      — new Settings → Fonts section (`FontSettings`): UI font, code (monospace)
      font, and a UI size (Small/Default/Large/Extra large). Applied live by
      overriding the `--font-family-sans` / `--font-family-mono` / `--font-scale`
      tokens on the document root; the size tokens are now `calc(Npx *
      var(--font-scale))` so the whole UI (incl. the CodeMirror panes that read
      `--font-family-mono`) scales proportionally. Curated font stacks +
      load/save/apply live in tested `lib/fonts.ts`; persisted to localStorage and
      applied on startup in `App`. The graph stays aligned (fixed `ROW_HEIGHT`,
      text just sizes within the row). A small live preview shows the fonts.
- [x] Allow default branch colour palette to be configurable — new Settings →
      Graph colours section (`GraphColorSettings`) with a set of pre-built lane
      palettes: Theme default, Bright, Pastel, Shades of blue/green/red, Ocean,
      Sunset (live swatch preview). A palette overrides the eight
      `--color-lane-0..7` tokens on the document root, so it applies independently
      of the active theme (inline style beats the theme stylesheet) and survives
      theme switches; "Theme default" clears the overrides so the theme's own lane
      colours show. Palettes + load/save/apply live in tested `lib/graphPalettes.ts`;
      persisted to localStorage and applied on startup in `App`. The graph
      re-resolves lane colours on the existing `THEME_CHANGE_EVENT`.

## Branding

- [ ] Rename to "git wasp"
- [ ] Import branding design assets (logo etc.) Update app to include branding (e.g. app icon)

## Engineering & tooling

- [ ] Add Storybook for viewing and refining UI components
- [ ] GitHub Actions release workflow — tag-triggered matrix, artifacts to Release (Phase 6)
- [ ] `cargo-deny` / licence audit in CI (Phase 6)
- [ ] Error-handling audit — every git failure surfaces a clear, actionable message (Phase 6)
- [ ] Graph performance profiling against large repos (10k+ commits) (Phase 6)
- [ ] Implement rustfmt on save + pre-commit hook
- [ ] Consider implementing a CSP for the frontend (bear in mind we need to support data img or find alternative for user icons)
- [x] Proper logging everywhere (esp. rust backend) with an option to enable diagnostic logging
      e.g. to increase log verbosity. Log file location clearly visible from within a "help" section
      (possibly as a child section within settings). App fully instrumented for logging without storing
      PII. Pay particular attention to git operations and potential issues that may occur when in
      diagnostics "mode". The existing logs we have can move to DEBUG level too - they're very noisy
      — replaced `env_logger` with `tauri-plugin-log` (file in the app log dir +
      stdout). New `logging` module: a runtime "diagnostics" toggle that flips the
      effective level between Info (off) and Debug (on) via `log::set_max_level`
      (ceiling Debug; noisy framework crates pinned to Warn/Info). Defaults on for
      dev builds, off for release; the user's choice persists (localStorage) and is
      re-applied on startup. Backend commands `get_diagnostics_info` /
      `set_diagnostics` / `open_log_dir` / `frontend_log` (the last bridges
      frontend logs into the same file). New Settings → Diagnostics section: toggle,
      log file path, "Open log folder". Git ops now log at info (checkout, commit,
      branch create/rename/delete, fetch/pull/push) — checkout additionally logs
      pre/post working-tree dirty counts at debug to diagnose the next item — and
      tokens/file contents/messages/emails are never logged (PII-safe). Demoted the
      noisy graph-walk + credential-store logs to debug.
- [ ] "Auto-prune" capability that will remove local branches that are no longer on the remote. Before deleting
      show a list of local branches to be removed (all selected by default) so the user can choose to retain a selection

## General UX

- [x] Toast notification system including options for placement (top/middle/bottom + left/right)
      — `toastStore` (success/error/info/warning, auto-dismiss with errors sticky)
      drives a `ToastContainer` mounted at the app root; placement (vertical ×
      horizontal) is chosen in Settings → Notifications and persisted. Wired into
      push/pull/fetch in the history toolbar (replacing the inline error text).
- [x] Auto close right panel when commit completed — the history view's
      uncommitted-changes panel returns to the commit-detail view after a
      successful commit (optional `onCommitted` callback; the standalone Changes
      view is unaffected).
- [x] Progress/spinners for buttons (e.g. when pushing, pulling) — the shared
      Button shows an animated spinner alongside its label in the `loading`
      state; wired to push/pull/fetch in the history toolbar.
- [x] Branch selection highlight obscures the graph lines — fixed by drawing the
      graph canvas in ordered passes (row bands → edges → dots) so connecting
      lines are never painted over by a selected row's highlight band.
- [x] Main buttons "open repository", "history", "prs" to move to menu/tabs —
      new top `NavBar` tab strip (under the repo TabBar) holds the History /
      Changes / PRs / Settings view tabs plus an "Open Repository…" action;
      always visible so a repo can be opened (and Settings reached) with nothing
      open yet, with the view tabs appearing only once a repo is open. The
      sidebar is now pure repo content (branches, recent, stash); its view
      toggle, Open Repository button, and bottom Settings button were removed.
- [ ] Include section in settings to view open source packages used?
- [x] Allow removing items from "recent"
- [x] Fetch/pull/push buttons removed from the left sidebar — they were
      duplicated in the history toolbar (which surfaces in-flight state +
      errors); the sidebar RemoteActions now keeps only "Clone from GitHub…".
- [x] Better primary/secondary button design — primary gained a subtle border +
      shadow for depth; secondary now has a faint fill (reads as a real control,
      not plain text); both get a tactile press (nudge-down) on `:active`.
- [x] For repositories with lots of commits, tags, or branches the performance
      of the git graph is poor. Scrolling causes "flashing" and frequent "re-painting".
      — Backend now caches the full laid-out history per tab (keyed by HEAD +
      a refs fingerprint), so scroll fetches no longer re-walk the whole history,
      re-scan the working tree, or rebuild the label map; rebuild happens only
      when HEAD/refs move. Frontend: scroll fetches are rAF-throttled and skipped
      when the loaded slice already covers the viewport, a fetch-id guard drops
      stale out-of-order responses, and rows are keyed by oid + memoized so a
      selection change re-renders only the affected rows. (Canvas keeps the
      selection band so graph lines stay unobscured — see earlier ordered-pass fix.)
- [x] Add icons to key buttons like "push", "pull", and "new branch" — new
      `PushIcon` (up-arrow-to-bar), `PullIcon` (down-arrow-from-bar) and
      `BranchIcon` (git-branch) in `ui/icons.tsx`, added to the history toolbar's
      Push / Pull / New branch buttons and the sidebar's "New" branch button. The
      icon is hidden while the button is loading (the spinner takes its place);
      icons are `aria-hidden` so button accessible names are unchanged.
- [ ] Add ability to select multiple "unpushed" commits on the same branch and squash them.
- [x] Add the top left (under the tab) show a the current repo name and make it a "repo picker" to choose from 
      recent repositories. Next to it show the current checked out branch, and also make that
      a picker to choose from the available branches (local only). Remove the unnecessary "open repository" button
      — new NavBar pickers on the left, under the tab bar: `RepoPicker` (trigger
      shows the current repo name, or "Open a repository" when none; panel lists
      recent repos + an "Open repository…" folder action) and `BranchPicker`
      (trigger shows the checked-out branch; panel lists local branches, filterable
      once there are ≥8, and checking one out refreshes the graph). Both built on a
      new reusable `ui/Dropdown` (anchored popover with `DropdownItem/Label/Divider`,
      close on outside-click/Escape, `onOpenChange`). Removed the standalone
      "Open Repository…" button from the NavBar (its function now lives in the repo
      picker). The sidebar's repo/branch/recent sections are unchanged.
      Refinements: taller NavBar (44px) + taller picker triggers (md control
      height). The branch picker lists the current branch first, then other locals,
      then remote-only branches (remotes whose short name already exists locally are
      hidden to avoid duplicates; symbolic `origin/HEAD` dropped). Rows carry the
      graph's pill icons — laptop (local) / GitHub (remote), check for the current.
      Choosing a remote branch checks it out via a new backend
      `checkout_remote_branch` that creates a local tracking branch of the same
      short name (sets upstream) and switches to it.
- [x] Make the left side bar collapsible — a sidebar toggle (panel icon) at the
      far left of the `NavBar` hides/shows the left `Sidebar` (and its resize
      handle); collapsed state persists via `usePersistedBoolean`
      ("sidebarCollapsed"). When collapsed the main content takes the full width;
      the toggle stays visible to expand again (aria-label/title flip between
      "Hide sidebar" / "Show sidebar"). New `SidebarIcon` in `ui/icons.tsx`.
- [x] Improve "new tab" experience. Don't just open file explorer/finder, instead
      create a "new" view where the user can choose functionality like "open a
      repository", "clone", and a list of "recent" repos to re-open — new
      `WelcomeView` (open folder / clone from GitHub / clickable recent list)
      shown in the main area whenever there's no active repo (`!currentRepo` and
      not on Settings): initial launch, after closing the last repo, or a "new
      tab". The TabBar "+" now calls a frontend-only `repoStore.newTab()` (nulls
      the active repo without closing others) instead of jumping straight to the
      OS picker; clicking an existing tab re-activates it.
- [x] Remember screen size when re-opening app. If it was full screen when closed,
      it should be full screen again when re-opened. — added the
      `tauri-plugin-window-state` plugin (registered in `lib.rs` with default
      `StateFlags`, which cover size/position/maximised/fullscreen) + the
      `window-state:default` capability. The window's geometry and fullscreen
      state now persist and restore automatically across restarts.
- [x] Always show "new tab" button — `TabBar` no longer returns null when no
      repos are open; it always renders so the "New tab" (+) button is reachable
      even with nothing open (the bar then shows just that button, above the
      welcome view).
- [x] When selecting an existing file from an existing commit, show diff in
      the same view we use for staging changes (read only). Don't show at the 
      bottom of the right hand panel. Instead, add the commit title, date,
      commit hash, and author in a read only view at the top of the right hand
      panel (above the list of changed files)
      — `CommitDetail` dropped the bottom `DiffViewer` (file removed): the right
      panel is now commit metadata (message, author, date, short hash) above a
      full-height changed-files list. Selecting a file loads its parent-vs-commit
      content into a new `commitFileStore` (backend `get_commit_file_contents`,
      reusing `StageFileContents` — parent on the HEAD side, this commit on the
      worktree side; handles root commits, deletions, renames via `oldPath`) and
      opens it in the main panel via `StageFileEditor readOnly` (see the commit-
      graph item above). Closing returns to the graph.
- [x] Use icons for "added", "changed", and "removed" files using standard
      red/amber/green colours — new SVG glyphs (`PlusIcon`/`PencilIcon`/`MinusIcon`/
      `ArrowRightIcon`) + a shared `FileStatusIcon` mapping status → coloured icon
      (green plus = added/untracked, amber pencil = modified, red minus = deleted,
      accent arrow = renamed/copied), with an accessible label. Replaces the
      commit-detail file list's text symbols and the staging panel's plain
      A/M/D/R letters, so both lists read consistently.
- [x] When the uncommitted changes are selected at the top of the graph,
      show a clear "currently selected" indicator. Currently the checked out
      head line still shows as "selected" which is confusing
      — clicking the working-tree row now selects it like a commit: new
      `selectWorkingTree` graph-store action puts the sentinel `WORKING_TREE` oid
      in the selection range (so the row's branch/message cells and the canvas
      selection band all highlight) and clears `selectedOid`, so the previously
      selected commit (often HEAD) stops reading as selected. `selectedOid` is
      nulled rather than set to the sentinel so the commit-detail panel never
      tries to resolve it. Selecting any commit afterwards replaces it as before.
- [x] Add a permanent "muted" background colour to the entire row of the currently checked
      out branch in the graph view. When actually selected, show the normal highlight colour,
      but make it even more obvious which commit is currently the checked out HEAD
      — the HEAD commit's row now carries a permanent muted band across the whole
      row: the DOM branch/message cells use a new `--color-graph-head-row-bg` token
      and the canvas paints the matching band over the graph column. A real
      selection overrides it with the usual `--color-bg-selected` highlight. The
      token is defined per built-in theme (a soft accent tint). Adds to the existing
      HEAD cues (pulsing dot ring, check pill, left-pointing accent triangle).

## Other issues

- [x] When reopening app and "state" is restoring (e.g. when a large repo was previously opened and is now being re-opened) then:
  - [x] app remains in the default theme until loading has completed, then switches to previously-selected preferred theme
        main app window is "blank" and appears to have stalled
        — theme flash fixed: the active theme is now cached to localStorage
        (`cacheActiveTheme`) and applied synchronously in `main.tsx` before the
        first paint (`applyCachedTheme`), alongside fonts + graph palette (moved out
        of the post-mount App effect). The backend remains source of truth and
        re-applies on init. The "blank/stalled" window is covered by the splash
        screen below.
  - [x] When checking out a branch and there are other branches ahead of that branch (either in the remote or locally), 
        any commits ahead of the current HEAD are not visible in the graph. They should still be shown and be selectable.
        — the graph revwalk seeded only from HEAD, hiding anything not an ancestor
        of HEAD. New `seed_revwalk` pushes every local/remote branch tip + tag (and
        HEAD), shared by the layout walk and `find_commit_row` so reveal/scroll
        stays consistent. Regression test
        `commits_ahead_of_head_on_other_branches_are_included`.
- [x] It may be better to have a "loading / splash" screen whilst we're opening the app - have the processes required 
      to "boot" the app and restore state run in the background whilst the loading screen is active, then show the main app. Bonus points if the loading screen has either a progress bar or spinner and below it states which "task" is being performed as part of the "boot".
      — new `SplashScreen` (spinner + current-task label) shown until a one-time
      boot sequence in `App` completes: loads theme, restores session (current +
      open repos), resolves merge state, and warms the first graph slice (so the
      graph isn't blank on reveal). Network-bound work (GitHub) is deferred to
      after reveal so it can't stall the splash; boot is best-effort and always
      reveals even if a step fails. The task label steps through "Loading theme…",
      "Restoring session…", "Loading history…".
