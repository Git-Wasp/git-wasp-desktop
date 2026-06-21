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
- [ ] Remove unnecessary "changes" view. That is replaced by the "uncommitted changes" part of the graph view

## Theming

- [ ] Additional built-in themes (e.g. Cobalt2)
- [ ] Allow default branch colour palette to be configurable (see pre-req in [Working Tree & Committing](#working-tree--committing))

## Engineering & tooling

- [ ] Add Storybook for viewing and refining UI components
- [ ] GitHub Actions release workflow — tag-triggered matrix, artifacts to Release (Phase 6)
- [ ] `cargo-deny` / licence audit in CI (Phase 6)
- [ ] Error-handling audit — every git failure surfaces a clear, actionable message (Phase 6)
- [ ] Graph performance profiling against large repos (10k+ commits) (Phase 6)

## General UX

- [ ] Toast notification system including options for placement (top/middle/bottom + left/right)
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
- [ ] Include section in settings to view open source packages used?
- [ ] Main buttons "open repository", "history", "prs" to move to menu/tabs
- [x] Allow removing items from "recent"
- [x] Fetch/pull/push buttons removed from the left sidebar — they were
      duplicated in the history toolbar (which surfaces in-flight state +
      errors); the sidebar RemoteActions now keeps only "Clone from GitHub…".
- [x] Better primary/secondary button design — primary gained a subtle border +
      shadow for depth; secondary now has a faint fill (reads as a real control,
      not plain text); both get a tactile press (nudge-down) on `:active`.
- [ ] For repositories with lots of commits, tags, or branches the performance
      of the git graph is poor. Scrolling causes "flashing" and frequent "re-painting".
- [ ] Add ability to select multiple "unpushed" commits on the same branch and squash them.