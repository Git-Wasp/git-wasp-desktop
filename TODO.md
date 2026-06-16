# Things still to do

Living backlog. Keep this current as work progresses: tick items off, move them
between sections, and add new ideas under the right heading. Items marked
**(v1 scope)** were in the original CLAUDE.md feature set but aren't built yet;
**(Phase 6)** are from the polish/hardening phase.

## Repository management

- [ ] Multi-tab view for opening multiple repositories at once
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

## Working tree & committing

- [ ] "Staging" area for files during commit: stage an entire file or a hunk and
      move it to the panel below; support staging deleted and added files; allow
      "unstage"
- [ ] Ability to amend a commit message before it's been pushed to the remote
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

## Theming

- [ ] Additional built-in themes (e.g. Cobalt2)

## Engineering & tooling

- [ ] Add Storybook for viewing and refining UI components
- [ ] GitHub Actions release workflow — tag-triggered matrix, artifacts to Release (Phase 6)
- [ ] `cargo-deny` / licence audit in CI (Phase 6)
- [ ] Error-handling audit — every git failure surfaces a clear, actionable message (Phase 6)
- [ ] Graph performance profiling against large repos (10k+ commits) (Phase 6)
