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
- [ ] Right-click actions on branches (delete local, push, etc.)
- [ ] Integrate user icons via gravatar (in the commit dots)
- [ ] **Cherry-pick (single or range)** (v1 scope)
- [ ] Rebase as a merge strategy with conflict-resolution UI — confirm whether
      it's wired up as a first-class action (v1 scope)
- [ ] Tooltip for branch name when hovering on branch name pill
- [ ] Indicator/icon show currently checked out branch clearly (e.g. left arrow by 'circle' icon for commit?)
- [ ] Improve colour scheme. Colours too bright and "basic"? Allow default branch colours to be specified in colour schemes?

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
- [ ] Execute git hooks (pre-commit, pre-push) and show output in a built-in pane

## Merge editor (v2 refinements)

- [ ] Per-line (sub-block) selection of source vs current via gutter checkboxes (Phase 6)
- [ ] Current-line highlighting across the source/current/result panes (Phase 6)
- [ ] Red/green changed-line plus intra-line (character-level) diff decoration (Phase 6)

## GitHub integration

- [ ] Move GitHub connection into settings
- [ ] Issue reference linking in commit messages (v1 scope)
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
- [ ] Allow default branch colour palette to be configurable (see pre-req in [Working Tree & Committing](#working-tree--committing))

## Engineering & tooling

- [ ] Add Storybook for viewing and refining UI components
- [ ] GitHub Actions release workflow — tag-triggered matrix, artifacts to Release (Phase 6)
- [ ] `cargo-deny` / licence audit in CI (Phase 6)
- [ ] Error-handling audit — every git failure surfaces a clear, actionable message (Phase 6)
- [ ] Graph performance profiling against large repos (10k+ commits) (Phase 6)
- [ ] Implement rustfmt on save + pre-commit hook

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
- [ ] Add ability to select multiple "unpushed" commits on the same branch and squash them.