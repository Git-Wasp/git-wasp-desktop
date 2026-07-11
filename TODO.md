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

- [x] Right-click actions on commits
      - checkout this commit
      - create branch here
      - copy commit hash
      - copy link to this commit on remote
      - create tag here
      — the commit context menu now offers: Checkout this commit (backend
      `checkout_commit` — detached HEAD, checkout-before-detach order), Copy commit
      hash / short hash, Copy link to commit (built from `remoteInfo` as
      `https://<host>/<owner>/<repo>/commit/<oid>`, shown only when a remote is
      detected), New branch here…, Create tag here… (backend `create_tag` —
      lightweight, or annotated when a message is given), plus the existing
      per-branch checkout/rename/delete. New repoStore actions `checkoutCommit` /
      `createTag`; backend unit tests for detached checkout and tag creation.
- [x] Right-click actions on branches (delete local, push, etc.)
      — branch actions are now consistent across the graph context menu and the
      sidebar branch row menu. Graph per-branch menu: Checkout / Push / Merge into
      current / Rename… / Delete, with the invalid actions (checkout, delete,
      merge-into-self) hidden for the currently checked-out branch. Sidebar row
      menu gained Push alongside its Checkout / Merge / Delete. Push targets the
      specific branch via the existing `push_branch` command (`remoteStore.push`),
      with success/error toasts; checkout/rename/delete/merge failures also surface
      as toasts now (no more silent failures). No backend change needed.
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
- [x] Collapse multiple tags on one commit — several tags on a commit overlapped
      and cluttered the branch cell. Now a single tag on a commit renders as
      before; multiple render as one collapsed `MultiTagChip` showing the tag
      icon, the first tag's name, and a bracketed total count (e.g. `v2.0.0 (3)`).
      Hovering shows every tag in a vertical `TagList` — rendered through the
      existing `Tooltip` (portals to `document.body`, `position: fixed`,
      `z-index: 250`) so it floats *over* the graph rather than expanding inline.
      `Tooltip`'s `label` was widened from `string` to `ReactNode` to carry the
      list. Tests: collapsed chip shows first name + count and hides the rest
      inline; hover reveals all names; a single tag stays a plain chip.
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
- [x] Open PR as a result of dropping one branch onto another. Include ability to enter title, description, "assign to (default to @me)", tags and then "Open PR" and "Continue on GitHub" options.
- [x] When clicking on the details of a commit (i.e. already committed) clicking on a file shows the changes in a side by side diff view that opens in the main panel of the app. It is possible to change the view from side by side to "inline"
      — clicking a file in the commit detail panel opens its diff in the main panel
      (replacing the graph, like staging does), reusing `StageFileEditor` in a new
      read-only mode: split/inline toggle, red/green decoration and syntax
      highlighting, but no stage gutters/buttons. Implemented together with the
      right-panel General-UX item below.
- [x] Add a "revert commit" option in right click menu for a commit.
      — commit context menu now has "Revert commit" (creates the revert commit) and
      "Revert without committing" (applies the inverse as ordinary *unstaged*
      working-tree changes to stage/commit as you choose). Backend
      `revert_commit(oid, auto_commit)`: git2 revert → either commit it or
      mixed-reset the index back to HEAD (keeping the reverted working tree) and
      clear the in-progress revert state. Refuses merge commits and a dirty tree
      (so the conflict abort can hard-reset safely); aborts cleanly on conflict.
      `repoStore.revertCommit` refreshes the graph + working-tree status; success/
      error toasts. Backend tests (commit / no-commit / dirty / merge) + menu tests.
- [x] Add a "stash changes" option for uncommitted changes to create a new named stash. The stash can be viewed
      in the commit graph (and clearly shown as a "stash"). Right click on the stash allows me to pop the stash.
      — right-clicking the "uncommitted changes" row in the graph offers "Stash
      changes…" (prompts for a name → `stash_save_cmd`). Stashes now render **inline
      in the graph**, hanging off the commit they were created on: the backend graph
      layout injects a stash node one row below its base commit (the stash commit's
      first parent) on a side lane, with **dotted** edges (new `EdgeKind::Stash`) and
      a dashed diamond marker + "STASH" badge; multiple stashes on one commit stack
      as a dotted chain. Real commits' lanes are untouched (the base just gains one
      dotted edge); rows renumber and `find_commit_row` / the cache key account for
      the injected stash rows (new `stash_fingerprint`). Right-clicking a stash node
      gives **Pop / Rename… / Delete** (`stash_pop_cmd` / new `stash_rename_cmd` /
      `stash_drop_cmd`). Rename has no native git equivalent, so it re-stores the
      same stash commit with the new message via the `git` CLI (drop-then-store;
      moves the stash to the top — noted). `StashEntry` gained `baseOid`; new
      `stashStore` (create/pop/drop/rename) refreshes the graph + working tree after
      each action. Tests: backend (base_oid, rename keeps the commit, stash injected
      below base, find_commit_row shifted by a stash) + frontend (stash badge/menus,
      pop, stash-via-prompt, rename prefilled, stashStore commands+refresh).
      Follow-up: the sidebar StashPanel keeps its own list and won't live-update from
      graph stash actions yet.
- [x] Dragging a branch pill no longer selects text on the commits underneath —
      `useGraphDragDrop` adds a `dragging-branch-pill` class to `<body>` for the
      duration of a drag (CSS `user-select: none` + grabbing cursor) and clears any
      selection the initial press started; removed on release/unmount. Test asserts
      the class toggles on drag/release.
- [x] Show "tag" pills that are visually distinct to branch pills. Add right-click options
      like "delete tag", "push tag". Make clear if tags are local/remote/both. Don't provide "push" option
      if tag is local only. When deleting a tag, confirm whether to also delete from remote. If so, also delete from remote.
      — tag pills now carry a **tag glyph** (`TagIcon`) and, when the tag is also on
      the remote, a small GitHub mark; the tooltip reads "<name> (tag, on remote /
      local only)". Right-clicking a commit's tag offers **Copy tag name**, **Push
      tag** and **Delete tag**. Local/remote/"both" is derived from a new
      `list_remote_tags` (git2 `ls-remote` for HTTPS-with-token, `git ls-remote
      --tags` for SSH) loaded into a new `tagStore` (`remoteTags`, best-effort on
      repo activation); a visible tag is local-only or both (the graph only knows
      local refs, so remote-only tags don't appear). Delete opens a small
      `TagDeleteDialog` with an "Also delete from the remote" checkbox (shown +
      default-checked only when the tag is on the remote) → `delete_tag` (git2
      `tag_delete`) and, if chosen, `delete_remote_tag` (push `:refs/tags/<t>`).
      Push uses `push_tag` (`refs/tags/<t>:refs/tags/<t>`). Backend mirrors the
      existing push SSH/HTTPS split via a shared `push_refspec`. Tests: backend
      (delete_tag removes ref, ls-remote tag parsing) + frontend (tagStore
      load/push/delete, pill menu push-shown-only-when-local-only, delete dialog
      local vs also-remote). **NOTE on the spec:** I read "don't provide push if
      tag is local only" as the inverse of the useful behaviour, so I show **Push**
      for *local-only* tags (nothing to push once it's already on the remote) — flag
      if you actually wanted it the other way and it's a one-line flip.
- [x] "Add tag" option in the right-click menus for commits and branches. — the
      graph commit menu already had "Create tag here…" (it's the row menu, so it
      also appears when right-clicking a branch pill in the graph). Added "Create
      tag…" to the **sidebar local-branch row menu** (the gap): it prompts for a name
      and tags the branch tip via the existing `createTag`, then refreshes the graph
      so the new tag pill appears. Sidebar test added.

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
- [ ] Execute git hooks (pre-commit, pre-push) and show output in a built-in pane that can be hidden and reshown. The contents of the pane should be a "terminal view" with automatic scrolling to keep up with the progress of git hooks. When a repository has git hooks, they should be executed automatically. Add a new option to settings to allow users to choose _per-repository_ which git hooks should run/not run - all should be enabled by default for all respositories making hooks opt-out rather than opt-in. When hooks are running, make it very clear in the git graph view that hooks are running and disable buttons such as commit buttons for the current branch.
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
- [x] Bug: When a branch is checked out, there are other branches "ahead" of that branch, our
      "uncomitted changes" are shown as if they relate to the very latest commit (when considering all branches) rather than shown linked to the immediate ancestor (i.e. the tip of the branch we have checked out).
      — the synthetic working-tree node was hanging off the topmost commit across
      *all* branches instead of HEAD's tip. It now stays pinned at the top of the
      graph (row 0) but belongs to HEAD: it sits on HEAD's lane, names HEAD as its
      parent, and its connector is drawn as a **dotted** line straight down HEAD's
      lane to the HEAD dot — which can be several rows below when other branches
      are ahead. Backend: `working_tree_node` now anchors to the HEAD node (not the
      first row) and carries **no edges** (the connector is a render concern);
      `slice_viewport` exposes HEAD's absolute row on the new `GraphViewport.head_row`
      field (cached alongside the layout) so the connector can reach HEAD even when
      it isn't in the loaded slice. Frontend: the canvas renderer draws the dotted
      warning-coloured connector from the WIP dot down to HEAD's dot (found via
      `isHead`, or `headRow - offset` clamped to the slice as a fallback);
      `graphStore.sliceFromCache` preserves `headRow` so cached scroll slices keep
      it. `find_commit_row` is unchanged (WIP at row 0 still shifts every commit
      down by one). Regression test `working_tree_node_sits_at_top_but_anchors_to_head`
      (commits ahead of a checked-out older branch; WIP is row 0 on HEAD's lane,
      parent = HEAD, `head_row` points at HEAD).
- [ ] Support "fast forwarding" e.g. fast forward main to current checked out commit. Experienced an issue when main was pulled from the remote, local main was not updated, and I committed a change. The current "branch" was just "HEAD" so I was not on a branch and could not push changes. Don't let this happen.

## PR refinements

- [x] Improve UX for opening PRs
  - [x] Select source branch automatically as current branch
  - [x] Select destination branch automatically as main
  - [x] Change branch inputs to select from local branches
  - [x] Allow adding title and description with formatting
  - [x] Add a "continue editing on GitHub" button to pass over to GitHub to open the PR
  - [x] Allow choosing an assignee (defaulting to @me)
  - [x] Allow adding one or more labels
      — `NewPRForm` reworked: head/base are now `<select>`s of *local* branches
      (remote-only refs excluded; the current value is always kept as an option so
      an initialBase like "develop" still shows), defaulting to the current branch →
      main/master. The description gained a Write/Preview markdown toggle (reusing
      `lib/markdown`'s `renderMarkdown`, same pattern as the commit form). New
      Assignees and Labels are now **multi-select pickers populated from GitHub**
      (not free text): a new `ui/MultiSelect` (built on `Dropdown`, which gained a
      `fullWidth` prop) lists the repo's assignable users and labels (label rows
      show a colour swatch), with a filter once the list is long. Backed by new
      Rust commands `list_assignable_users` (`GET /repos/{o}/{r}/assignees`) and
      `list_repo_labels` (`GET …/labels`, returns name+colour), loaded into
      `githubStore` (`assignableUsers`/`repoLabels`) when the form mounts *if the
      GitHub connection is validated as `connected`*. When not connected both
      pickers are **disabled** with a "Connect your GitHub account…" hint, to avoid
      confusion. Assignees still default to the connected login (@me). "Continue on
      GitHub" opens GitHub's compare page with everything pre-filled via
      `lib/githubPr.compareUrl` (`expand=1` + title/body/assignees/labels query
      params; works for GHE hosts) using `plugin-opener`. Backend
      `create_pull_request` takes `assignees` + `labels`: after creating the PR it
      PATCHes `/repos/{owner}/{repo}/issues/{n}` to set them (skipped when both
      empty, since the create-PR endpoint ignores those fields). Tests: backend
      httpmock for create (sets/skips the PATCH) and the two list commands;
      `lib/githubPr` (compareUrl), `ui/MultiSelect`, and `NewPRForm` (local-only
      branch options, disabled-when-disconnected, loads on connect, @me default,
      sends chosen assignees/labels, Continue-on-GitHub URL).
  - [x] Push the head branch first when it isn't on the remote yet — GitHub 422s
        a PR whose head it hasn't seen. New `lib/githubPr.headBranchIsOnRemote`
        (head has a configured upstream, or a remote-tracking branch of the same
        short name exists) decides between the two: when the head is unpushed the
        form shows a "<head> hasn't been pushed yet…" notice and the primary button
        becomes **Push & create PR** ("Pushing…"/"Creating…" while in flight),
        pushing via `remoteStore.push` (existing `push_branch`) before creating; a
        push failure surfaces and stops (no create attempt). Since `push` doesn't
        set `-u` (no local tracking ref appears), in-session pushed heads are
        tracked so the button flips back to "Create". Tests cover the helper, the
        notice/label, push-before-create ordering, and the abort-on-push-failure
        path. Follow-up: `remote_ops::push` could set the upstream so a freshly
        pushed branch reads as tracking without a fetch.
  - [x] Clearer errors when a GitHub App lacks PR permissions — a 403 "Resource
        not accessible by integration" on create (App has Contents:write so the
        push succeeds, but not Pull requests:write) is now rewritten by
        `explain_pr_permission_error` into an actionable message naming the missing
        "Pull requests: Read and write" (and "Issues: Read and write") permission
        and how to re-authorize. Also made the assignees/labels PATCH best-effort:
        the PR is already created, so a failure there (e.g. no Issues:write) now
        logs a warning and still returns the PR instead of discarding it. Backend
        tests for both. (Root resolution is on the GitHub App's permissions, not in
        code.)

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
- [x] Consider whether we need the complexity of the token flow we have for GitHub,
      or whether the user's existing credentials (e.g. ssh key) are enough
- [x] If we do keep the GitHub integration, make sure we're using refresh tokens.
      Tokens are only valid for 8 hours, so we need to use the refresh for a persistent
      connection.
- [ ] **Refresh-token support isn't actually implemented** — despite the item above,
      the device-flow code only captures the `access_token` (`AccessTokenResponse`
      has `access_token` + `error`; the `expires_in` fields are the *device-code*
      lifetime, not token expiry) and stores that single string in the keychain. This
      is fine *only* while the OAuth App has "Expire user authorization tokens" turned
      **OFF** (non-expiring token). If token expiry is ever enabled (8h access token +
      refresh token) the app would break at 8h and force re-auth. To support it:
      capture `refresh_token` + `expires_in`/`refresh_token_expires_in` from the
      access-token response, persist both (keychain), and refresh via
      `grant_type=refresh_token` on 401 / before expiry. Decide first whether to stay
      an OAuth App (coarse `repo` scope, current) or move to a **GitHub App**
      (fine-grained per-repo permissions, always rotating tokens — also the proper fix
      for the earlier "GitHub App lacks PR permissions" item). Registration/ownership
      is now tracked in the CLAUDE.md pre-public checklist (re-register as "Git Wasp"
      under the `gitwasp` org, Homepage gitwasp.com).

## Config & settings

- [x] Git identity config (per-repo / global name + email) (v1 scope)
      — new Settings → Git identity section (`GitIdentitySettings`): shows the
      effective identity used for commits here, a scope toggle (This repository /
      Global), and name/email inputs prefilled from the chosen scope (falling back
      to the effective identity). Backend `get_identity_config` (effective + local +
      global, read per config level) and `set_identity(name, email, global)` —
      local writes `.git/config`, global writes `~/.gitconfig` (created if missing).
      `lib/identity.ts` wrappers; backend tests for read + local write + the
      write mechanism (global file untouched in tests); frontend tests for prefill,
      scope switch, save, and validation.
- [ ] Commit signing config (GPG / SSH) (v1 scope)
- [ ] SSH key management UI (add, view, associate with GitHub accounts) (v1 scope)
- [ ] `.gitconfig` viewer/editor (v1 scope)
- [ ] Keyboard shortcut configuration (v1 scope)
- [ ] Embedded terminal pane scoped to the repo working dir, toggleable (Phase 6)
- [x] Remove unnecessary "changes" view. That is replaced by the "uncommitted changes" part of the graph view
      — dropped the "Changes" NavBar tab, the `working-tree` view, and the
      standalone `WorkingTreePanel` (+ its test). The shared `StagingPanel` /
      `HunkDiffViewer` stay, reused by the history view's uncommitted-changes flow.
- [ ] Auto-detect new releases and notifiy user on boot with a toast containing a link to download

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

- [x] Rename to "git wasp"
      — full rebrand to **Git Wasp**. User-facing: `productName` + window `title` →
      "Git Wasp" (`tauri.conf.json`), page `<title>` → "Git Wasp" (`index.html`),
      splash + welcome now show the wordmark. Internal rename (per decision): Cargo
      package `gitclient` → `git-wasp`, lib `gitclient_lib` → `git_wasp_lib`
      (`main.rs` updated, Cargo.lock regenerated, binary is now `git_wasp`), npm
      package `gitclient` → `git-wasp`. Bundle identifier `com.gitclient.dev` →
      `com.gitwasp.desktop` (reverse-DNS of the product's own domain, gitwasp.com;
      avoids the `.app` suffix that clashes with the macOS bundle extension).
      Keychain service string, GitHub user-agent, the `.git/` operation-recovery
      sidecar filename, and the app's on-disk dirs (config `~/.config/git-wasp`,
      themes `~/.config/git-wasp/themes`, avatar cache `<cache>/git-wasp`) all moved
      to `git-wasp` too. **Migration note:** because both the identifier and these
      dirs/service changed, the app starts from a clean slate — saved theme/font
      prefs, recent-repos config, and stored GitHub tokens need re-entering once
      (acceptable pre-release; flagged). Test fixtures that reference a repo *named*
      "gitclient" were left untouched.
- [x] Import branding design assets (logo etc.) Update app to include branding (e.g. app icon)
      — from the design handoff in `_assets/design_handoff_git_wasp_branding/`.
      App icon set regenerated from the recommended 1024 master
      (`git-wasp-desktop-icon-1024.png`) via `tauri icon` (all of `icons/*.png`,
      `icon.icns`, `icon.ico`; the mobile `ios/`/`android/` outputs were dropped as
      this is desktop-only). New reusable `ui/WaspLogo` React component — a faithful
      port of `wasp.svg` (340×240, preserving the three abdomen stripes cut with the
      Git moves +/−/⟳) that's **theme-adaptive**: the abdomen stays brand gold
      (`--wasp-body`, #F5A623) while the structural parts use `currentColor`, so it
      renders the "reversed" (light) recipe on dark themes and the "standard" (dark)
      recipe on light themes automatically, with the eye as a background-coloured
      cutout. Used in the `SplashScreen` (mark + "Git Wasp" wordmark) and
      `WelcomeView` (mark + wordmark + "Branch fast. Merge clean. Don't get stung."
      tagline). Favicon set to a bare-mark `public/wasp.svg`. Tests: splash asserts
      the wordmark + mark render; frontend/backend suites green (507 / 213).

## Engineering & tooling

- [x] Replace repeated "magic string" literals with shared TypeScript consts/unions.
      Audit frontend `if`/`switch` discriminants and sentinels used as bare strings
      across files — e.g. PromptDialog/`PromptState` kinds ("new-branch",
      "rename-branch", "create-tag"), the `View` ids, `historyRightMode`
      ("commit"/"uncommitted"), the `WORKING_TREE` sentinel, diagnostics levels
      ("error"/"warn"/…), and invoke command names. Where a literal is used in one
      place a string-union type is already type-safe; the win is for literals
      repeated across modules or paired with a backend value (define a `const` or
      `as const` map / enum and reference it). Decide a consistent convention and
      apply it.
      — **Convention decided:** one source of truth per shared string-union/sentinel,
      imported where used — placed in `src/types/` when it's a cross-cutting data
      type, or colocated in the domain module that owns it (matching the existing
      `THEME_CHANGE_EVENT` in `applyTheme.ts`, `WORKING_TREE_OID` in `graphStore`).
      Single-file discriminated unions (`PromptState`, `StageFileEditor`'s
      `ViewMode`, `logger`'s `Level`) are **left local on purpose** — TypeScript
      already type-checks their literals at every use site, so extracting them would
      be churn against the convention above. Applied to the genuine duplications the
      audit found: (1) `View` ("history"|"prs"|"settings") was defined **twice**
      (App + NavBar) → new `types/view.ts` (single `View` + named `HistoryRightMode`
      for App's inline `"commit"|"uncommitted"`), both files import it; (2)
      `BodyTab = "write"|"preview"` was defined **twice** (CommitForm + NewPRForm) →
      `MarkdownTab` exported from `lib/markdown` (where `renderMarkdown` already
      lives), both import it; (3) `INITIAL_LIMIT` (the first graph-fetch page size)
      was defined **three times** (repoStore 150, Sidebar 150, CommitForm **100** —
      a drift) → single `GRAPH_INITIAL_LIMIT = 150` exported from `graphStore`
      (CommitForm now warms 150 like the rest). tsc clean; full suite green (509).
      **Drift guard:** added a `no-restricted-syntax` ESLint rule (`eslint.config.js`,
      `noDriftRules`) that errors on re-declaring the write/preview or
      history/prs/settings unions, or using the bare `"WORKING_TREE"` sentinel —
      each message points at the canonical import. The files that *define* these
      (`types/view.ts`, `lib/markdown.ts`, `graphStore.ts`) and test files (fixtures
      use raw sentinels) are exempted via a scoped override. Verified it fires on all
      three patterns; `npm run lint` clean.
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
- [x] "Auto-prune" capability that will remove local branches that are no longer on the remote. Before deleting
      show a list of local branches to be removed (all selected by default) so the user can choose to retain a selection
      — a "Prune" button in the sidebar Branches header opens `PruneBranchesDialog`:
      it first does a **fetch with prune** (so stale remote-tracking refs are
      removed), then lists the "gone" branches with checkboxes (all selected),
      shows each branch's former upstream, and deletes the chosen subset (reusing
      `repoStore.deleteBranch` per branch, success/failure toasts). Backend:
      `find_prunable_branches` (config-based detection — a local branch whose
      `branch.<n>.remote`/`.merge` point at a remote-tracking ref that no longer
      exists; skips the current branch and local-tracking `.` remotes, since git2's
      `Branch::upstream()` can't distinguish "gone" from "never had one"), exposed
      as `list_prunable_branches`. `remote_ops::fetch` gained a `prune` flag
      (git2 `FetchPrune::On` / `--prune` on the CLI path); `fetch_remote` +
      `remoteStore.fetch` take an optional `prune`. Best-effort fetch — offline
      still lists from current refs. Tests: backend detection (gone vs alive vs
      no-upstream, current-branch excluded), and the dialog (lists all-selected
      after a prune fetch, empty state, deletes only the selected, lists even when
      the fetch fails).

## General UX

- [x] Clean merge no longer blanks the whole app — a merge with **no conflicts**
      used to replace the entire UI with the full-screen `MergeEditor`, which then
      showed only an empty file list + a tiny commit-message input. Now a clean
      merge keeps the app visible and floats a `MergeCommitDialog` modal (prefilled
      "Merge branch '<source>' into <current>", Complete merge / Abort, ⌘/Ctrl+Enter
      to complete, Esc to abort) that refreshes the graph on finish. Conflicted
      merges still use the full-screen editor: `App` latches `mergeHadConflicts` at
      merge start so the editor stays put after the last conflict is resolved
      (rather than flipping to the dialog mid-resolution). Tests for the dialog
      (prefill, complete-with-edited-message, abort, empty-message disabled).
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
- [x] When showing uncommitted changes and there is a single change, don't pluralise changes in git graph
      — the working-tree graph row now reads "1 uncommitted change" for a single
      change and "N uncommitted changes" otherwise. Extracted a pure
      `working_tree_summary(count)` helper in `graph/layout.rs` (used by
      `working_tree_node`); the frontend renders `node.summary` verbatim
      (`columns.tsx`), so no frontend change was needed. Backend tests for the
      singular and plural (incl. 0) cases.
- [x] When a "stash" is selected in the git graph, show that it is selected and show the same
      view as if we'd selected a pre-existing commit i.e. show the diff between the stash its direct ancestor
      — left-clicking a stash node now selects it like a commit instead of being a
      no-op. A stash's `oid` is a real commit whose first parent is its base, and
      the commit-detail path (`get_commit_diff` / `get_commit_file_contents`)
      already diffs a commit against `parent(0)` — so selecting a stash shows its
      changes vs its base (matching `git stash show`) through the exact same
      `CommitDetail` panel + main-panel file-diff surface as any commit, with no
      backend change. `handleRowClick` drops the stash early-return and calls
      `selectCommit(node.oid, false)` (single-select; range-select doesn't apply to
      a stash) + `onCommitSelect`; the existing selection highlight (DOM cells +
      canvas band, keyed on `selection.range.has(oid)`) then marks the stash row as
      selected. Right-click still drives Pop / Rename / Delete (context menu doesn't
      select a stash). Tests: backend `stash_commit_diffs_against_its_base_ancestor`
      (a real `stash_save2` commit → detail shows the stashed file as Modified);
      frontend "selects a stash on left-click" (selects by the stash commit oid,
      fires onCommitSelect).
- [x] Sometimes there are changes in the repository that are not reflected in the git graph and
      I have to close and re-open the app to see the changes. Can we have a regular "background poll"
      whilst a repository is open/selected and add a "refresh" button to the top panel to "check for changes"
      — root cause: the file watcher (`working-tree-changed`) is only started by
      `StagingPanel`, which is mounted only in the uncommitted-changes view, so
      changes made elsewhere (or outside the app) went unreflected. Extracted the
      canonical 3-step refresh into `workingTreeStore.refreshAll()` (loadStatus →
      `refresh_graph_working_tree_status` → graph `refresh()`); the watcher now
      routes through it (DRY). Added a **"Check for changes"** refresh `IconButton`
      to the history toolbar (new `RefreshIcon`) and an **8s background poll** at the
      App root (runs while a repo is open; skips when the window is hidden or a tick
      is still in flight; best-effort). Tests: `refreshAll` call-order + the existing
      watcher test re-pointed through it (9/9 store tests, toolbar 8/8, tsc clean).
- [x] Skeleton when loading e.g. in the git graph view for large repos, show a "skeleton" of the graph. It should
      be "animated" to indicate a loading state.
      — new `GraphSkeleton` component: shimmering placeholder rows (branch pill /
      lane line + dot / message bar) that mirror the real graph geometry
      (`ROW_HEIGHT`, the three columns), shown in the graph area whenever
      `viewport === null`. The shimmer is a token-based moving gradient
      (`.graph-skeleton-shimmer`, `@keyframes graph-skeleton-shimmer`) that fits
      every theme and is disabled under `prefers-reduced-motion`; row widths are
      deterministic (seeded per index) so nothing reflows. To make the skeleton
      actually appear on repo switch, added a `graphStore.reset()` (clears
      viewport, `nodesByRow`, selection, offsets, and supersedes any in-flight
      fetch) and called it from `repoStore` on activate/open/close/new-tab —
      previously the graph store was never reset between repos, so the *previous*
      repo's cached rows were served for the new one (a latent bug) and the graph
      never showed a loading state. Tests: `graphStore.reset` (clears state +
      drops a stale in-flight fetch) and `CommitGraph` (skeleton shows when
      viewport is null, hidden once loaded). Note: during boot the SplashScreen
      already warms the first slice, so the skeleton is mainly for repo switches
      and refetches, not first launch.
- [x] Add icons to the "history" and "PRs" tabs to make them more obvious. Add colour higlight underline to tabs when selected, on hover (different colour), and when inactive and not selected (muted colour)
      — NavBar view tabs now carry icons (new `HistoryIcon` / `PullRequestIcon` /
      `SettingsIcon`, `aria-hidden` so accessible names are unchanged) and their
      styling moved from an inline `tabStyle()` to a `.nav-tab` CSS class driven by
      `aria-selected`: muted (`--color-text-muted`) when inactive, a distinct colour
      (`--color-text-secondary`) + faint underline (`--color-border-default`) on
      hover, and primary text + accent underline (`--color-accent-primary`) + bold
      when selected. Test: each tab renders its `data-icon`.
- [x] Add clear highlighting on hover to sidebar items - currently only the mouse changes to a pointer - some background highlighting would make the hover more obvious
      — added a shared `.sidebar-row` class (`:hover` → `--color-bg-hover`,
      `[data-active="true"]` → `--color-bg-elevated`) applied to the local/remote
      branch rows and the recent-repo rows; the recent row's inline
      selected-background moved to `data-active` so hover and selection compose via
      CSS (an inline background would otherwise beat the `:hover` rule).
- [x] Add clear hover states to all buttons. Primary buttons in particular do not seem to have a clear hover state.
      — the primary button's hover swapped its fill to `--color-accent-hover` (a
      *darker* secondary), which read weakly. It now keeps its accent fill and
      **brightens** on hover via `.ui-button[data-variant="primary"]:hover
      { filter: brightness(1.12) }` — a clear, theme-independent lift (filter isn't
      set inline, so it isn't overridden). Secondary/ghost/danger keep their JS
      background swap to `--color-bg-hover` / `--color-diff-del-bg`.
- [x] Add a subtle :hover highlight to commits in the graph as the pointer moves
      over a row — `GraphRow` tracks a `hovered` flag (stable `onRowHover` setter, so
      only the entered/left memoized rows re-render); the DOM branch/message cells
      pick up `--color-bg-hover` with priority selected > hover > HEAD, and
      `useCommitGraph` paints the matching subtle band in the graph column
      (`hoveredOid` param, same priority, under the edges/dots so lines stay on top).
      Rows gained a `data-oid` attr. Test: hovering a commit row sets the cell
      background and mouse-leave clears it.
- [x] Move "stashes" to the line *above* their ancestor rather than the line below as they are now
      — `inject_stashes` now splices each stash chain onto the rows *above* its base
      commit instead of below (most recent stash immediately above the base, older
      ones stacking further up as a dotted chain). The base no longer carries the
      dotted edge; instead the stash row just above it emits the dotted connector
      *down* to the base's dot (`stash_lane → base_lane`), and the chain continues
      upward via `stash_lane → stash_lane` dotted edges. Because the rows are
      inserted above the base, the pass-through lanes are now the *incoming* lanes
      (the newer commit above), tracked as `prev_out` (the previous real commit's
      out-edges) and replicated as straight edges so the real history line isn't
      broken where the stash splices in. Row-shifting is unchanged in effect
      (`find_commit_row` still finds the position in the same `build_full_layout`),
      so no frontend change was needed — the canvas already draws `EdgeKind::Stash`
      dotted regardless of direction. Tests: `stash_node_is_injected_above_its_base_commit`
      (stash one row above its base, on a side lane, dotted connector down to the
      base, straight pass-through of the commit above, base has no stash edge) +
      the existing `find_commit_row_accounts_for_an_injected_stash` still holds.
- [x] Add hover state to *all* buttons that don't currently have one to make it clear when we're hovering over a button. E.g. "Push", "Pull", "New branch" from menu above the git graph, "Stash", "Apply", "Pop", and "Drop" from sidebar. Let's make sure we have a defined custom `<Button>` component (or similar) for consistent buttons everywhere.
      — the named action buttons (Push/Pull/New branch, Stash/Apply/Pop/Drop) were
      already on the shared `ui/Button` (with hover states) from the earlier
      primary/secondary hover work; this item was stale for those. The real
      remaining inconsistency was the hand-rolled **segmented toggle** pattern,
      duplicated with divergent styles (and mostly *no* hover) across 5 places. New
      reusable `ui/SegmentedControl` (bordered "pick one" group, `aria-pressed`
      segments, accent-filled active segment, clear hover on inactive segments,
      `sm`/`md` + `iconOnly`); migrated the Git-identity scope toggle, the
      notification-placement toggles, the Commit-form + New-PR-form Write/Preview
      tabs (shared `MARKDOWN_TAB_OPTIONS` from `lib/markdown`), and the Stage
      editor's split/inline icon toggle (removed the local `ViewModeButton` /
      `Segmented` / `tabStyle` duplicates). Also formalised the Button vocabulary:
      renamed the borderless `ghost` variant to **`tertiary`** (primary / secondary
      / tertiary / danger), updating its one use (MergeConfirmDialog). Added the
      last missing menu-item hover state to the sidebar `RowMenu` items. List rows,
      nav tabs, and the Dropdown/CollapsibleSection primitives were assessed and
      left as-is (they already have hover or are not action buttons). Tests:
      `SegmentedControl` (render/press/onChange, icon-only aria-label, hover) +
      a `tertiary` Button test; full suite green (514).
      **Follow-up (secondary hover was invisible):** the `secondary` variant (Push/
      Pull/New branch, Stash/Apply/Pop, etc.) swapped its background to
      `--color-bg-hover` on hover — but that token *equals* its resting
      `--color-bg-elevated` in almost every theme (Monokai default, GitHub Dark/
      Light, Cobalt2), so hovering changed nothing. Fixed by treating secondary like
      primary: a solid fill that **brightens** on hover via CSS
      (`.ui-button[data-variant="secondary"]:hover`, `filter: brightness(1.12)`),
      plus a subtle `--shadow-sm` lift so the affordance is clear on light themes too
      (where brightening toward white is weak). Dropped the now-dead JS background
      swap for secondary (`hoverBackground` returns null for it, like primary); the
      transparent variants (tertiary/danger) keep their JS swap since a fill
      appearing over transparent *is* visible. Added `filter` to the button
      transition so the brightness animates.
- [x] Add more "depth" to the UI. Everything feels very "flat" and 1-dimensional. This could be achieved with shadows perhaps.
      — root cause: the app's regions (top chrome, sidebar, graph, detail panel)
      were separated *only* by 1px subtle borders, so the whole UI read as a single
      plane cut by hairlines — even though the tonal model was already right
      (`bg-panel` chrome/panels are lighter/raised over the darker `bg-app` content
      well). Added a token-driven **elevation pass** that sells that hierarchy:
      new `--shadow-edge` token (theme-tuned — heavier on dark; GitHub Dark/Cobalt2
      inherit `:root`) drives three one-sided directional-shadow utility classes in
      globals.css (`.elevation-below` / `.elevation-right` / `.elevation-left`,
      each with `position:relative` + a small `z-index` so the shadow paints over
      the adjacent content rather than being covered by a later sibling). Applied:
      the NavBar and the history toolbar cast a soft shadow *down* onto the content;
      the sidebar casts *right*; the detail panel casts *left* and was given the
      raised `bg-panel` (it previously inherited the `bg-app` well), so the layout
      now reads as a recessed graph well between two raised side panels under a
      floating top chrome. The 1px borders stay (crisp edge) with the shadow adding
      the depth. No component structure changed (className added to four region
      roots); full suite green (514). Left inputs flat on purpose — an inline inset
      box-shadow would override the `:focus-visible` focus ring. **Subjective/tunable:**
      the effect intensity lives entirely in `--shadow-edge` + the three classes, so
      it's a one-line dial if it reads too strong/soft after seeing it live.
- [x] Add highlight on hover to the menu that opens for sidebar items. Make it consistent with the menu used in the git graph on right-click - ideally using a single menu component.
      — the sidebar `RowMenu` (⋮ overflow) and the graph's right-click `ContextMenu`
      were two near-duplicate menus with divergent surfaces/hover. `RowMenu` now
      **renders the shared `ContextMenu`** as its popover, so there's a single menu
      component with identical surface, hover, and danger styling. `ContextMenu`
      gained an `align="right"` option (anchors its right edge at x via
      `translateX(-100%)`) so the sidebar menu still tucks under its ⋮ trigger
      instead of spilling across the sidebar; it also now gives danger items a
      red-tinted (`--color-diff-del-bg`) hover, not just red text. `RowMenu` keeps
      its public API (`{label, onSelect, destructive}`), mapping `destructive`→
      `danger`; its trigger stops `mousedown` propagation so clicking ⋮ while open
      is a clean toggle (rather than fighting ContextMenu's outside-click close).
      Removed RowMenu's own dropdown markup + outside-click effect. Tests: RowMenu
      destructive→danger mapping; ContextMenu right-align.
- [x] Review all other components' hover state. E.g. the files listed in the right hand panel when viewing an existing commit - hovering over a file should highlight what's being hovered over.
      — audited the clickable lists that lacked a hover cue and added a consistent
      one (`--color-bg-hover`, guarded so a selected row keeps its stronger fill,
      with a fast background transition): the commit-detail changed-files list
      (`FileList` — the named example), the staging Changes/Staged file rows
      (`StagingPanel` `FileRow`), and the repo `TabBar` tabs (inactive tabs now
      highlight on hover). Left `PRRow` without a row hover on purpose — the row
      itself isn't clickable (its action is the `Open` button, which already has a
      hover), so a row highlight would falsely imply clickability. The sidebar
      branch/recent rows, `Dropdown` items (repo/branch pickers), graph rows, and
      the shared Button/menus already had hover from earlier work.
- [x] Allow sidebar sections to be resized vertically. Dividers should be more clearly visible and I should be able to move dividers up and down to increase height. The selected state of the height of each panel should persist between app reloads on a single machine.
      — the leaf list sections (Local branches, Remote branches, Recent, Stashes)
      are now vertically resizable. `CollapsibleSection` gained a `resizable` prop:
      the expanded body is capped at a drag-resizable **max-height** (not a fixed
      height — a short list stays compact, a long list scrolls within the cap) and
      a draggable divider replaces the bottom border; drag it up/down to size the
      section. The cap persists per section id (`section-height:<id>` in
      localStorage) via a new generic `usePersistedSize` hook (extracted from
      `usePersistedWidth`, which now delegates to it — widths and heights share one
      primitive). `ResizeHandle` was generalised with an `orientation` prop
      ("vertical"|"horizontal"); the horizontal handle reports the pointer's Y
      delta. Dividers are clearer: section borders bumped `subtle`→`default`, and
      every resize handle's line now brightens to the accent on hover/drag (also
      improves the existing sidebar/detail width dividers). Tests: `ResizeHandle`
      horizontal delta; `CollapsibleSection` cap/divider render, drag-resize +
      persist + restore-on-remount. Full suite green (520).
      **Follow-up (doubled divider):** because Local/Remote are nested inside the
      non-resizable "Branches" group section, that wrapper drew its own bottom
      border *after* Remote's resize-handle divider — a doubled line before Recent.
      Added a `containsSections` prop to `CollapsibleSection` (set on the Branches
      wrapper) that suppresses the wrapper's border while expanded (the nested
      subsections already provide the trailing divider) but keeps it while
      collapsed (so the lone header still separates from the next section). Test
      added; suite green (521).
- [x] Extend the "stale branches" feature to also provide the option to prune branches that only exist locally and don't exist on the remote - not just those that did exist on the remote and don't now.
      — the prune feature now detects two kinds (backend `PrunableKind`): **gone**
      (tracked an upstream that's been deleted — existing behaviour) and **localOnly**
      (no configured upstream *and* no remote-tracking branch of the same name — a
      branch that only ever existed locally). `find_prunable_branches` also reports,
      per branch, whether it's **merged** into the base branch (local `main`/`master`,
      else `origin/HEAD`) via an ancestor check; the base branch itself and HEAD are
      never offered. Safety-driven UX in `PruneBranchesDialog`: two groups — **"Safe
      to delete"** (gone + local-only-already-merged), pre-checked, and **"Not merged
      — review first"** (unmerged local-only), left unchecked with a warning that
      deleting them permanently discards their unique commits (git2's `delete()` is a
      forced `-D`). Each row shows why it's listed ("was origin/x" / "local only ·
      merged|not merged"). Types: `PrunableKind` + `merged` on `PrunableBranch`.
      Tests: backend classifies gone / merged-local-only / unmerged-local-only and
      excludes published-no-upstream + the base; frontend pre-selects merged but not
      unmerged local-only. Suites green (frontend 522, backend 213).
- [ ] Add "Search" feature to the git graph. A search button should be included which allows the user to search through the commits for commit hashes or text that matches commit messages. Matching results should be highlighted in the graph, and a count of matches should be shown. "Highlighting" can be via "dimming" non-matching commits, or by highlight matching commits, or both. "Up" and "Down" arrows should allow the user to navigate between matching commits in the graph - the "action bar" at the top should always remain visible. A small "hovering" search component would be acceptable, but open to other ideas.
- [x] Add preview for certain binary files when selecting files in staging or viewing previous commits. Primary use case is to view image files so we should support common files including png, gif, jp(e)g
      — image files now render an inline before/after **image preview** in the shared
      `StageFileEditor` (so it works in both the staging diff and the read-only
      commit-file diff) instead of the "Binary file — no preview" message. Backend:
      `StageFileContents` gained `head_image`/`worktree_image` — a base64 `data:`
      URI per side, populated (in both `get_stage_file_contents` and
      `get_commit_file_contents`) when the path's extension is a recognised raster
      type (png/gif/jpg/jpeg/webp/bmp/ico) via new `image_mime_from_path` +
      `image_data_url` helpers (reusing the existing `base64` dep). An absent side
      (add/delete) is `None`. Frontend: `isImage` (either side has a URI) takes
      priority over the text/line editor; a two-column `ImagePane` grid shows each
      version on a transparency checkerboard, with muted "No previous version" /
      "Deleted" placeholders for an absent side, and a "Stage whole file" button in
      the staging flow (none when read-only). CSP is already `null`, so `data:`
      images render without change (flag for the future CSP task: it'll need
      `img-src 'self' data:`). Tests: backend (PNG → data URI, non-image binary →
      none) + editor (previews instead of text diff, whole-file stage, before/after
      pair, no controls when read-only). Suites green (frontend 535, backend 215).
      Possible follow-up: cap preview size for very large images (currently no limit).
- [x] Add a "hunk" view to the diff viewer in addition to the current "side by side" and "inline" views. The "hunk" view should show a "hunk" for each change. Also add tooltips to the three buttons that allow the user to change view. Persist the last selected view as the "default" e.g. when closing and re-opening the app.
      — added a third **Hunk** view to `StageFileEditor` (used by both the staging
      diff and the read-only commit-file diff). New pure, tested `hunkLines(rows,
      context=3)` helper in `lib/lineDiff.ts` collapses distant unchanged lines and
      groups changes into hunks, each prefixed with a real `@@ -old,len +new,len @@`
      header (carrying per-line source-row index + real old/new line numbers). The
      editor renders it like the inline view — single pane, dual old/new number
      gutter, red/green decorations, and a muted `cm-diff-hunk-header` band — with
      per-line stage toggles wired through a hunk-doc-line→source-row map (so a
      header line has no toggle). New `HunkViewIcon`; the `ViewMode` union +
      `loadViewMode` gained "hunk". **Tooltips:** the three `SegmentedControl`
      buttons already carry `title`/`aria-label` from their `ariaLabel`s
      ("Side-by-side view" / "Inline view" / "Hunk view"), so each shows a tooltip.
      **Persist:** the choice already persists to `localStorage` (`VIEW_MODE_KEY`),
      now including hunk. Tests: `hunkLines` (single hunk drops distant context, one
      hunk per distant change, `@@` ranges, old/new numbers) + editor (button
      present, switches to hunk pane with `@@` header + add/del decorations, stages
      line-by-line from hunk, persists across remount). Full suite green (532).
- [x] In the diff view add an option to "wrap" text or "don't wrap text". Currently we wrap text rather than let it overflow horizontally.
      — added a `WrapLinesIcon` toggle to the diff header (`StageFileEditor`, used
      by both the staging diff and the read-only commit diff). Defaults on (the
      historical wrapping behaviour), persisted to `localStorage`
      (`stageFileEditor.wrap`); off lets long lines overflow horizontally with a
      scrollbar (the panes' `.cm-scroller` already scrolls, and split-view
      horizontal scroll stays in sync). Wrapping is held in a CodeMirror
      `Compartment` and reconfigured live on toggle rather than rebuilding the
      editor, so scroll/cursor and the staged-gutter state are preserved. Tests:
      toggle defaults on, flips + persists, and survives remount.
- [x] In the diff view add an option to hide "leading/trailing whitespace only" changes.
      — `diffLines` gained an `ignoreWhitespace` option: lines are compared by
      their trimmed form, so a change that is only leading/trailing whitespace
      collapses to a `context` row (shown with the worktree/new text); internal
      whitespace differences stay a real change. A `WhitespaceIcon` toggle in the
      diff header drives it (defaults off, persisted to
      `stageFileEditor.ignoreWhitespace`). Tests: lineDiff (folds ws-only into
      context, keeps real + internal-ws changes visible) and editor (ws-only
      change loses its stage toggles when hidden; a genuine change stays).
      Suites green (frontend 548).
- [ ] Add a "stash changes" button before "Stage all" when viewing uncommitted files. Remove the "Stash changes" button from the sidebar.
- [ ] Add a "notifications" button (bell) to the top menu bar. When notifications are fired (currently toasts) append a notification to a floating panel that opens from the right when clicking the "notifications" icon. Allow notifications to be dismissed one at a time or all at once. Notifications should have scope - either to a repo or global. If per-repo, the repo name should be shown in the notification details. All notifications should include a timestamp.
- [x] Always show current checked out branch at the *top* of the sidebar panel showing local branches
      — the sidebar's Local list now partitions the checked-out (`isHead`) branch to
      the top, keeping the remaining branches in their existing order (`Sidebar.tsx`).
      Test asserts head-first with the rest order-preserved.
- [x] Add option to "recent" repositories menu to "Remove from recent" - this should remove the entry from the recent entries *not* change anything about the repo being removed - just our reference to it.
      — restored a feature that had been implemented (commit `92f2e71`) but never made
      it into `main`'s history. The sidebar recent-repo ⋮ menu now has a destructive
      "Remove from recent" alongside "Open repository". It only forgets our reference:
      backend `AppConfig::remove_recent(path)` drops the entry (and clears
      `last_repo_path` if it matched) and persists; exposed via `RepoManager::
      remove_recent` / `AppState::remove_recent_repo` / the `remove_recent_repo`
      command. Frontend `repoStore.removeRecent(path)` invokes it and stores the
      returned list; the row also clears its own selection highlight. Nothing on disk
      is touched. Tests restored/added: backend config (drops entry, clears/keeps
      last), `repoStore.removeRecent`, and a Sidebar menu-wiring test. Suites green
      (frontend 525, backend 214). Not extended to the NavBar RepoPicker / WelcomeView
      recent lists (they don't have per-row menus yet) — flag if you want it there too.
- [x] When there are uncommitted changes and the user performs an action that would cause those changes to be lost (such as checking out a different branch, pulling the remote again) auto-stash the changes before performing the action.
      — UX decisions: **confirm first** (only prompt when the action would
      actually lose changes) and **reapply on pull, park on switch**. Backend:
      `working_tree::safe_checkout_tree` performs the safe checkout and, when it's
      refused *only* because stashable tracked changes would be lost, returns the
      `AUTO_STASH_SENTINEL` error (gated on `has_stashable_changes`, so untracked-
      only conflicts keep their real message). Shared by `checkout_local_branch`,
      `checkout_commit`, and `pull_ff`. The checkout commands + `pull_branch` gained
      an `auto_stash` flag: checkout stashes and leaves it in the panel; pull
      stashes → pulls → pops (reapply), and on a pop conflict keeps the stash and
      returns the new `PullResult::StashReapplyConflict`. Frontend: `lib/autoStash.ts`
      (`withAutoStash` runs op → on sentinel prompts via `autoStashStore` → retries
      with `autoStash: true`; `undefined` = user cancelled), a single app-level
      `AutoStashDialog`, wired through `repoStore` checkout methods and
      `remoteStore.pull`. Tests: backend (sentinel on blocked checkout, park-on-
      switch stash, clean-tree no-op, `has_stashable_changes` staged/unstaged/
      untracked) and frontend (`withAutoStash` confirm/cancel/rethrow, store
      replace-pending, repoStore retry/cancel). Suites green (frontend 584,
      backend 224). Not covered: interactive-rebase/merge-with-dirty-tree paths
      (out of scope); pull auto-stash command orchestration is exercised via its
      unit-tested pieces rather than a full remote harness.
- [x] Add subtle top/bottom (non-overlapping) borders to "rows" in the graph view for better visibility of individual commits
      — a new themeable `--color-graph-row-divider` token (faint white/black,
      with light-theme overrides). Drawn as a single hairline at each row's
      bottom edge in two halves so it's continuous but never doubles up between
      rows: the canvas renderer (`useCommitGraph` pass 1) paints it across the
      graph column, and `GraphRow` adds a matching `borderBottom` across the data
      columns (box-sizing keeps row height fixed so canvas/DOM stay aligned).
- [ ] Add "pin" functionality to sidebar panels that allow "pinning" a branch to the top, pinning a remote branch to the top, or pinning a recent repo to the top. The pinned items should persist between restarts. Pinning should be via a "pin" icon shown on hover - if not already pinned, the icon only shows on hover. If already pinned a solid pin icon is shown when not hovering, and changes to an "unfilled" pin icon on hover. A pinned item can be unpinned by clicking the pin icon again. Pinned items appear at the top. Give more spacing around the existing buttons at the top of this panel too (prune / new branch)
- [x] Widen scroll gutter in diff view - it's too narrow and should be wider. It should have 2 "lanes" when in side-by-side view - left shows changes from the left panel (red/green/amber) and right shows changes from the right panel (red/green/amber)
      — `ChangeOverview` widened (11px per lane) and split into two lanes in
      side-by-side (split) view: removed rows in the left lane, added rows in the
      right, single combined lane in inline/hunk view. New pure `overviewMarks`
      helper in `lineDiff.ts` classifies changes — a change block with both a
      deletion and an addition is a modification (amber `--color-warning`),
      pure deletions red, pure additions green. Tests: `overviewMarks`
      (del/add/mod/context) and `ChangeOverview` (two-lane routing, single lane,
      seek).
- [x] Add a graph view option to "focus" on the current branch. This should be turned on by default and the state of the option persisted between app reloads. When enabled, the colours in the graph should remain for the current checked out branch and all of its ancestors, but other branches (including those ahead of the HEAD) should be muted / greyed out - but still visible and can still be interacted with.
      — the Rust layout now flags each node/edge with `on_head_line` (HEAD + its
      ancestors, computed once via a forward pass over the topo-sorted walk in
      `head_reachable_set`; the working-tree node is on the line, stashes are
      not; unborn HEAD → everything on-line, nothing muted). The frontend added a
      persisted `focusCurrentBranch` toggle to `graphStore` (localStorage
      `graphFocusCurrentBranch`, defaults on) with a `BranchFocusIcon` toolbar
      button (accent-tinted + `aria-pressed` when active). When on, off-line
      commits/edges render in `--color-graph-muted` (with dimmed dots/avatars via
      `--graph-muted-opacity`) on the canvas, and their branch pills + message
      dim via the `.graph-row-muted` class — all still fully clickable. Tests:
      backend (ancestors-only, both merge sides, unborn all-on-line); frontend
      (store toggle persists, toolbar flips state, rows mute/unmute with the
      flag). Suites green (frontend 539, backend 218).
- [ ] Add an integrated terminal that can be shown by clicking a button above the graph view. Should open automatically in the directory that contains the currently opened git repo.
- [ ] In diff viewer clicking the + or - to add or remove a line should stage _the selected line(s)_ so the file becomes visible in the "staged" area and clicking on the file from the staged area shows the diff between what's staged and what's in the current commit before this commit lands. Unticking a line from this staged file does the opposite - unstages that line. The changes staged vs unstaged should be tracked so that reselecting an affected file from the unstaged panel (if there are more changes) already shows which lines have been staged and allows them to be unstaged from here too.
- [x] When viewing uncommitted changes, files in the top panel have a right-click menu including "discard", "stage", and "delete file". Delete should require a confirmation via modal. The "staged panel" files should also have a right-click menu with options including "unstage" and "delete" with the same caveats.
      — `StagingPanel` file rows now open a right-click `ContextMenu` (reusing the
      shared graph/sidebar menu, right-aligned): Changes rows offer Stage /
      Discard / Delete file; Staged rows offer Unstage / Delete file. "Delete
      file" routes through a `ConfirmDialog`; Stage/Unstage/Discard fire
      immediately (per the spec, only delete needs confirmation). New backend
      `working_tree::delete_file` + `delete_file` command + store `deleteFile`:
      removes the file from disk and, for a not-yet-committed file (untracked /
      staged-new), drops its index entry so it vanishes entirely; a committed
      file becomes a pending unstaged deletion (restorable via Discard). Path
      guard rejects anything escaping the repo. Tests: backend (untracked gone,
      staged-new vanishes, committed→pending deletion, path-escape rejected),
      frontend (menu items per panel, discard no-confirm, delete confirm
      required, cancel is a no-op). Suites green (frontend 597, backend 228).
- [x] Diff view horizontal scroll doesn't work when line wrapping is disabled. Can't scroll horizontally to see full line. May only affected when not full screen - reproducible when app takes up half the horizontal screen
      — the classic `min-width: auto` flex/grid trap: the diff panes had no
      `minWidth: 0`, so wide unwrapped content forced the pane larger than its
      track instead of letting CodeMirror's `.cm-scroller` (overflow:auto) scroll
      — only visible once the window was narrow enough that the track had to
      shrink below content width (hence "half screen"). Added `minWidth: 0` down
      the chain in `StageFileEditor`: the split grid, the inline/hunk wrappers,
      each `ReadOnlyStagePane` container, and its CodeMirror host. Regression test
      asserts the panes carry `minWidth: 0`. (The App main-panel container above
      already had `minWidth: 0` + `overflow: hidden`, so the width was bounded.)
- [ ] Improve toast design. Add icons (e.g. info, warning, error) in the right colour, add a "title" as well as the text
- [ ] Consider a "conventional commits" config option. If enabled, this provides a dropdown for suitable conventional commit prefixes for commit messages (e.g. fix:, ux:, chore:, etc.). Discuss and plan value and implementation before we change any code.
- [ ] Git graph branch ordering - when there are many branches, the current checked out branch should appear first (left-most) so it is clearly visible. We also have some colored lines still appearing when in "focus" mode, even though the lines are for branches or commits that are not ancestors of the current checked out HEAD.
- [x] In themes, ensure that the background of the git graph is much darker than the foreground and highlighting to give it more "depth". Currently the UI still feels to "flat".
      — new `--color-graph-bg` token: the recessed "well" the graph sits in,
      tuned a notch darker than `--color-bg-app` in every built-in theme
      (Monokai `#141510`, GitHub Dark `#010409`, Cobalt2 `#0c1d2a`, and the two
      light themes slightly greyed), so the graph reads as sunken beneath the
      sidebar/nav/toolbar chrome and the existing row highlights/head-band stand
      out more. Wired into the graph view container, the frozen graph-column
      overlay (both via `var(--color-graph-bg, var(--color-bg-app))`), and the
      canvas cutout ring (`useCommitGraph` resolves graph-bg → bg-app fallback)
      so the ring stays seamless. Custom themes that don't set it fall back to
      `--color-bg-app`. Regression test asserts the graph well uses the token.

## Other issues

- [x] Current-branch marker goes stale after an external `git checkout` (in a
      terminal) until a full reload — affects both the graph's checked-out pill
      and the NavBar branch-selector trigger (both read `currentRepo.headBranch`).
      The 8s poll + file watcher only refreshed the working tree/graph, never
      HEAD or the branch list, and there was no focus listener. Added
      `repoStore.syncHead()` — re-reads `get_current_repo`; if the checked-out
      branch changed it updates `currentRepo` and reloads branches (no-op when
      unchanged, so it's cheap and doesn't churn state). Wired to a new
      window-`focus` listener (immediate on refocus) and folded into the 8s poll.
      Tests: syncHead updates on change + is a no-op (no `list_branches`) when
      unchanged.
- [ ] Perf on large monorepos — findings from profiling the render paths:
      • Commit graph **is** already virtualised (windowed slice via
        `get_graph_viewport` offset/limit + buffer; canvas draws only the slice;
        a full-height spacer drives the scrollbar). Backend layout is cached and
        only re-walks the full history when refs/HEAD actually move — scrolling
        just slices cached nodes. So the graph isn't the main cost.
      • [x] **Sidebar Local/Remote branch lists now virtualised.** Pulled in
        `react-window` v2 (React 19-compatible) behind a small `VirtualList`
        wrapper (so the lib stays swappable). `CollapsibleSection` now accepts a
        render-function child that receives its resizable height cap; the branch
        lists render a `react-window` `List` sized to `min(count × 32px, cap)` —
        short lists stay compact, long ones cap and window (only the visible slice
        + overscan mount). Row height fixed at 32px (fits the 24px ⋮ menu button).
        Tests: `VirtualList` (compact vs capped height; renders a slice not all
        1000 rows); existing Sidebar tests still green.
      • [x] **De-duped the double working-tree `status` scan.** Each combined
        refresh (poll / focus / file-watcher / revert) used to run two full
        `repo.statuses()` scans — `get_working_tree_status` (detailed lists) plus
        `changed_file_count` (graph dirty count). New `refresh_working_tree`
        command scans once: it returns the detailed status *and* updates the graph
        cache's dirty count from that same scan, via
        `WorkingTreeStatus::distinct_change_count()` (unions paths, so a file both
        staged and modified counts once — matches the old `statuses().len()`, and
        now the untracked count matches the staging panel too). Frontend
        `refreshAll` and `revertCommit` call the one command; the old
        `refresh_graph_working_tree_status` command + `graph::refresh_working_tree_status`
        were replaced by `graph::set_change_count(cache, count)`. Halves the
        dominant `git status` cost on a large monorepo. Tests: backend
        (`distinct_change_count` dedup + clean tree; `set_change_count` updates
        the cached count with no rebuild); frontend (refreshAll/watcher do one
        `refresh_working_tree` then the viewport, no second scan). Suites green
        (backend 230, frontend 606).
      • [x] **8s poll now skips the `git status` scan when the watcher saw no
        change.** The Rust file watcher already emits `working-tree-changed`
        (git-ignored churn filtered out backend-side) whenever the tree or
        `.git` moves. App now carries an app-level subscription that flags the
        tree dirty on every such event (on *all* views — the StagingPanel keeps
        its own subscription for the live sub-second refresh there). The poll
        consults `shouldScanWorkingTree(dirty, tick)` (`lib/workingTreeSync`):
        a clean tick skips the expensive `refreshAll` scan entirely; a backstop
        forces a scan every 8th tick (~64s) to recover any dropped watcher
        event. `syncHead` still runs every tick (cheap). A freshly opened repo
        starts dirty so the first tick re-affirms the graph's dirty-file
        baseline. On an idle large monorepo this drops the per-tick `git status`
        to roughly one scan per minute. Tests: `shouldScanWorkingTree` (dirty
        scans; clean non-backstop skips; backstop cadence; custom interval).
        Also added a README "Performance on managed / corporate devices"
        section — real-time AV scanning (Defender/Intune) intercepting Git's
        file I/O is the likely reason a managed M4 Pro underperforms; documents
        folder/process exclusions for macOS (`mdatp`) and Windows
        (`Add-MpPreference`).
- [x] Branch-selector dropdown appears *behind* the graph — z-index/stacking bug.
      The NavBar carries `.elevation-below` (`position: relative; z-index: 2`),
      which creates a stacking context; the dropdown panel's `z-index: 200` was
      trapped inside it, while the graph canvas (`position: sticky; z-index: 3`)
      resolves against the *root* context — so `3 > 2` and the canvas painted over
      the whole NavBar subtree, dropdown included. Fixed by portaling the
      `Dropdown` panel to `document.body` with `position: fixed`, measured from the
      trigger's rect (like `Tooltip`/`ContextMenu`), so it escapes the NavBar
      stacking context entirely. Handles left/right align + `fullWidth` (matches
      trigger width), recomputes on scroll/resize, and the outside-click check now
      also consults the portaled panel (via `panelRef`) so item clicks still work.
      Regression test asserts the panel is portaled to body with `position: fixed`.
- [x] "Split rail" view keeps the graph pinned to the left instead of "repinning" it to the right
      — the frozen graph overlay used `position: sticky` with `right: 0`, but sticky
      only pulls a box back when it would scroll *out* of view; it does not
      right-align a box whose in-flow position is the left edge. The rows are
      absolutely positioned, so the overlay is the only in-flow child and defaulted
      to `left: 0`. Added `marginLeft: auto` (Split Rail only) so its natural flow
      position is the right edge; `right: 0` then keeps it pinned there on
      horizontal scroll. The data model / header already anchored the graph right.
      NOTE: the canvas still draws lanes from the *left* edge of the rail
      (`GRAPH_PAD_LEFT`); the loading skeleton mirrors them to the right, so
      mirroring the real lanes for Split Rail is a possible follow-up.
- [x] When reopening app and "state" is restoring (e.g. when a large repo was previously opened and is now being re-opened) then:
  - [x] app remains in the default theme until loading has completed, then switches to previously-selected preferred theme
        main app window is "blank" and appears to have stalled
        — theme flash fixed: the active theme is now cached to localStorage
        (`cacheActiveTheme`) and applied synchronously in `main.tsx` before the
        first paint (`applyCachedTheme`), alongside fonts + graph palette (moved out
        of the post-mount App effect). The backend remains source of truth and
        re-applies on init. The "blank/stalled" window is covered by the splash
        screen below.
  - [x] When checking out a branch and there are other branches ahead of that branch (either in the remote or
        locally), any commits ahead of the current HEAD are not visible in the graph. They should still be shown and be selectable.
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
- [ ] Perhaps we could create a small local test repo for me to manually test the app's functionality.
      Its contents don't really matter as long as it's somewhat realistic code inside it. We can then do whatever we need
      to that local repo in terms of forcing merge conflicts etc. We could even clone some small open source project
      locally to have some realistic existing history.
- [x] Test failure: Error: src/components/Sidebar/PruneBranchesDialog.test.tsx(6,1): error TS6133: 'useRepoStore' is declared but its value is never read.
      — already resolved in earlier work: the dead `useRepoStore` import was
      replaced by `useToastStore` (which is used). `tsc --noEmit` is clean and the
      test passes 4/4.

## Website

- [ ] Domain gitwasp.com now owned. Create a "showcase" website on-brand. Should include details of features, how to download, and usage documentation. Links to the github repo (to be renamed) to allow people to log issues etc. Should be based on a popular static website framework ideally and should be suitable for including "docs" for the tool. Similar sites would include <https://aspire.dev/docs/>, <https://docs.usebruno.com/introduction/getting-started>, <https://docs.stripe.com/stripe-cli>

## Pre-release

- [ ] Fix all rust formatting/clippy
- [ ] Architectural review of entire backend
- [ ] Architectural review of entire frontend
- [ ] Removal of unnecessary implementation detail tests (did we take TDD too far?)
- [ ] Remove comments that litter the codebase. "Public" functions should be documented according to language standards (ts / rust) but inline comments are included too frequently and are a maintenance burden.
- [ ] Internationalisation. Tokenize strings, and allow users to change language. Initial supported languages to include British English, American English, and Dutch.

## Task tracking

- [ ] Either split this file [TODO.md](./TODO.md) into "todo" and "done" as separate files *or* consider using GitHub issues to track items still to do.