# AGENTS.md — Git Wasp Git Client

Project context for Codex. Read this file at the start of every session before making any suggestions or writing any code.

---

## Project Overview

A personal Git desktop client built with Tauri v2, functionally comparable to GitKraken *but not a knock off or "clone" of GitKraken". Primarily a macOS application, with cross-platform builds for Linux and Windows via GitHub Actions. Initially distributed privately to a team; potentially open-sourced in future.

**Repository:** Private GitHub repository (to be made public at a later date)
**Licence:** MIT

---

## Technology Stack

### Frontend

| Concern                  | Choice                                                     |
| ------------------------ | ---------------------------------------------------------- |
| Framework                | React 19 + TypeScript                                      |
| Build tooling            | Vite (Tauri v2 default)                                    |
| State management         | Zustand                                                    |
| Styling                  | Tailwind CSS, built on a CSS custom properties token layer |
| Commit graph rendering   | Canvas API via custom hook; DAG layout computed in Rust    |
| Diff rendering           | CodeMirror 6 (syntax highlighting, reuse in merge editor)  |
| Three-panel merge editor | Three CodeMirror 6 instances sharing resolution state      |

### Rust / Backend

| Concern                        | Choice                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| Git operations                 | `git2` crate (libgit2 bindings)                            |
| CLI passthrough (gaps in git2) | `std::process::Command` wrapping `git` binary              |
| GitHub / GHE API               | `octocrab` crate                                           |
| Async runtime                  | `tokio`                                                    |
| Credential storage             | Tauri `stronghold` plugin or `keyring` crate (OS keychain) |
| App state                      | Tauri managed state + `Arc<Mutex<>>` for repo handles      |
| File watching                  | `notify` crate; emits Tauri events on working tree changes |

---

## Architecture — Frontend / Rust Boundary

The Rust backend owns all Git state. The frontend never reads `.git` directly; all interaction is via Tauri `invoke()` commands or `listen()` events.

```
Frontend (React)
    │
    │  invoke() — request/response
    │  listen() — push events (file watcher, PR notifications)
    ▼
Tauri Command Layer (Rust)
    │
    ├── RepoManager       — open/close repos, workspace persistence
    ├── GitOperations     — commits, branches, merge, cherry-pick, stash
    ├── DiffEngine        — file diffs, hunk computation, three-way merge
    ├── OperationRunner   — async, pauseable state machine (see note below)
    ├── GitHubClient      — OAuth, PR queries, push/pull authentication
    └── FileWatcher       — notify crate; emits events on working tree changes
```

### OperationRunner — critical architectural note

`OperationRunner` is a pauseable async state machine that all multi-step Git operations route through (merge with conflicts, and in future interactive rebase). It holds operation state server-side and exposes `resume`, `abort`, and `status` commands to the frontend.

Every multi-step operation must go through `OperationRunner` — never implement multi-step flows as a single `invoke()` call. Recovery state is persisted to `.git/` (mirroring Git's own in-progress operation tracking) so the app can recover cleanly after an unexpected shutdown.

---

## Key Architectural Commitments

These decisions must not be reversed without explicit discussion. They exist to keep future features viable.

**CSS custom properties token layer**
All visual styling references CSS tokens — never hardcoded colour or spacing values. Tailwind utilities are composed on top of this token layer. This is the contract that custom themes must satisfy. This must be established in Phase 1 before any component styling is written.

**Canvas-based commit graph**
The commit graph renders to a `<canvas>` element, not the DOM. DAG layout (lane assignment, crossing minimisation) is computed in Rust and returns only the viewport-visible slice. Virtualisation is non-negotiable — do not implement this as a DOM list regardless of initial repo size.

**Commit range selection in graph**
The graph component must support selection of commit ranges (not just single commits) from the outset. This is required for future interactive rebase support.

**CodeMirror 6 as the single diff/edit surface**
All diff viewing and editing uses CodeMirror 6. Do not introduce a second editor library.

---

## Feature Set (v1)

### In Scope

**Repository Management**

- Open local repositories; clone from GitHub/GHE via OAuth-authenticated repo picker
- Workspace concept: named groups of repositories, persisted across sessions
- Sidebar showing all open repos with at-a-glance status (uncommitted changes, ahead/behind, current branch)
- Recent repositories list with pinning

**Commit Graph & History**

- Visual DAG — the primary canvas, canvas-rendered, virtualised
- Branch lanes with colour coding
- Filtering by author, branch, date range, commit message
- Commit detail panel: diff viewer (side-by-side and unified), file tree, stats
- Search across commit history

**Branching & Merging**

- Create, rename, delete branches
- One-click checkout from graph
- Merge (fast-forward, no-ff, squash) and rebase — with conflict resolution UI
- Cherry-pick (single or range)
- Interactive rebase: **deferred to v2** — architecture accommodates it (see below)

**Working Tree & Staging**

- File-level and hunk-level staging
- Inline diff editor for partial staging
- Discard changes (file or hunk level)
- Stash management: create, apply, pop, drop, named stashes

**Three-Panel Merge Editor**

- Two-row layout using three CodeMirror 6 instances: top row split 50/50 between source (theirs) and current (ours), both read-only references; bottom row spans the full width and shows the result — pre-seeded with conflict-marker text, the buffer that becomes the final resolved file (manual editing of the result is supported)
- Base/ancestor shown contextually (e.g. diff gutter/toggle against source/current) rather than as a dedicated panel
- Conflict marker parsing and decoration
- Accept source / accept current / manual edit per conflict block
- Mark file resolved, complete merge commit
- Abort merge and return to pre-merge state cleanly
- Routed through `OperationRunner`

**GitHub / GHE Integration**

- OAuth for GitHub.com and one or more GHE instances (configurable base URL, custom CA bundle support)
- Pull request panel: view open PRs, create PRs, CI check status, approval count, open in browser
- Issue reference linking in commit messages
- Push, pull, fetch with remote tracking branch visibility
- SSH and HTTPS credential management via OS keychain

**Multi-Repo & Workspaces**

- Cross-repo search: branch name or commit message across all open repos
- Bulk fetch/pull across workspace
- Workspace status overview: all repos, current state, at a glance
- Notifications for PRs needing review or CI failures across repos (GitHub API polling)

**Theming**

- Built-in dark and light themes (first-party CSS files satisfying the token contract)
- Custom theme support: import a self-contained CSS file overriding the token set
- Theme manifest: CSS file with metadata header (name, author, version) as comment block
- Theme loader: reads from `~/.config/<app>/themes/`, validates, injects at runtime
- Theme Manager UI: list, preview, activate, import, delete

**Configuration**

- Per-repo or global Git identity (name, email)
- SSH key management (add, view, associate with GitHub accounts)
- GPG/SSH commit signing configuration
- `.gitconfig` viewer/editor
- Keyboard shortcut configuration

**Terminal**

- Embedded terminal pane scoped to current repo working directory
- Toggle open/closed without losing context

### Deliberately Out of Scope (v1)

- Interactive rebase (deferred; architecture accommodates it — see below)
- GitLab, Bitbucket, Azure DevOps integrations
- Team / collaboration features
- Apple notarisation (flagged; required before public distribution)
- Public open source release (private repo initially)

---

## Interactive Rebase — Deferral Notes

Interactive rebase is deferred to v2. The following commitments ensure it can be added without architectural rework:

1. The graph component supports commit range selection
2. `OperationRunner` is a generic pauseable state machine, not a one-shot command runner
3. The three-panel merge editor is a standalone reusable component — interactive rebase will invoke it when conflicts arise mid-sequence
4. The Rust command layer uses a consistent async operation pattern, not ad-hoc fire-and-forget calls

---

## Phased Delivery Plan

### Phase 1 — Foundation (Weeks 1–4)

**Goal:** Working app that opens a repository and displays its history.

- Tauri v2 scaffolding (React + TypeScript + Vite)
- CSS custom properties token system established — must be done before any component styling
- MIT `LICENSE` committed
- GitHub Actions CI workflow configured (build + test, all four targets)
- `RepoManager`: open local repo, persist to config, reopen on launch
- Commit graph: DAG layout in Rust, canvas renderer, basic branch lane colouring, virtualised
- Commit detail panel: changed files list, unified diff (read-only, CodeMirror 6)
- Basic branch checkout (no conflict handling yet)

**Exit criterion:** Can open a real repository, navigate its history, and read diffs.

---

### Phase 2 — Working Tree & Staging (Weeks 5–8)

**Goal:** Complete local workflow, no remotes required.

- Working tree status panel (staged / unstaged / untracked)
- File-level and hunk-level staging via `git2`
- Commit creation (message, author, signing config)
- Stash: create, apply, pop, drop, list with names
- Discard changes (file and hunk level)
- Branch create, rename, delete

**Exit criterion:** Can complete an entire local feature branch workflow end-to-end.

---

### Phase 3 — GitHub Integration & Remotes (Weeks 9–13)

**Goal:** Full remote workflow with GitHub and GHE.

- OAuth for GitHub.com and configurable GHE instances
- Clone from GitHub repo picker
- Fetch, pull, push with remote tracking branch display
- Credential management (SSH key association, HTTPS token fallback)
- PR panel: open PRs, CI status, approval count, open in browser
- PR creation from current branch

**Exit criterion:** Can manage a full PR lifecycle without leaving the app.

---

### Phase 4 — Three-Panel Merge Editor (Weeks 14–17)

**Goal:** Conflict resolution entirely within the app.

- `OperationRunner` state machine implemented and wired to merge
- Three-panel CodeMirror 6 merge editor: source/current (50/50 top split, read-only) over result (full-width, editable)
- Conflict marker parsing and decoration
- Per-conflict accept / manual edit
- Mark resolved, complete merge commit
- Abort merge cleanly

**Exit criterion:** Can resolve a genuine multi-file merge conflict entirely within the app.

---

### Phase 5 — Multi-Repo & Workspaces (Weeks 18–21)

**Goal:** Efficient cross-repo workflows.

- Workspace definition: named repo groups, persisted
- Workspace sidebar: all repos, at-a-glance status
- Workspace overview screen: branch, ahead/behind, uncommitted changes across all repos
- Bulk fetch/pull
- Cross-repo branch/commit search

**Exit criterion:** Can manage a full working day across multiple repos without switching windows.

---

### Phase 6 — Polish & Remaining Features (Weeks 22–26)

**Goal:** Complete feature set, hardened and distributable.

- Embedded terminal pane
- **Merge editor UX refinements (per-conflict-block "accept whole side" was the v1 mechanism — these are the v2 follow-ups identified during Phase 4 dogfooding):**
  - Per-line (sub-block) selection of "source" vs "current" within a conflict block — gutter checkboxes for choosing individual lines rather than only whole-block accept
  - Current-line highlighting in the source/current/result panes
  - Red/green highlighting on changed lines, and intra-line (character-level) highlighting of the changed characters within those lines — i.e. word/char-level diff decoration, not just line-level
- Commit graph UX improvement and right-click action menu (rename branch, checkout new branch, copy commit hash etc.)
- Drag and drop from commit on graph to another commit in another branch to show option e.g. merge, start pull request, etc.
- Theme Manager UI, theme loader, theme manifest format
- Dark and light built-in themes finalised
- Custom theme import
- SSH key management UI
- `.gitconfig` viewer/editor
- Keyboard shortcut configuration
- PR notifications (polling)
- GitHub Actions release workflow: tag-triggered, parallel matrix, artifacts uploaded to GitHub Release
- `cargo-deny` and `license-checker` dependency audit added to CI
- Graph performance profiling against large repos (10k+ commits)
- Error handling audit — every Git failure must surface a clear, actionable message

---

## CI / CD & Release Targets

### CI (all branches, all PRs)

- Build + test on all four targets in parallel
- `cargo-deny` licence and dependency audit
- Conventional commits enforced

### Release (tag-triggered)

| Runner                 | Artefacts             |
| ---------------------- | --------------------- |
| `macos-latest` (arm64) | `.dmg`, `.app`        |
| `macos-13` (x64)       | `.dmg`, `.app`        |
| `ubuntu-latest`        | `.deb`, `.AppImage`   |
| `windows-latest`       | `.msi`, `.exe` (NSIS) |

### Pre-public checklist (before repo goes public)

- [ ] Apple code signing and notarisation pipeline (certificates as Actions secrets)
- [ ] GitHub OAuth App re-registered as **"Git Wasp"** under the `gitwasp` GitHub
      org (Homepage `https://gitwasp.com`, Device Flow enabled), replacing the
      personal-account app; old app deleted. Client ID is a **public client** (device
      flow, no secret) — compiled in via `GITHUB_OAUTH_CLIENT_ID` (local:
      `src-tauri/.cargo/config.toml`; CI: `GITHUB_OAUTH_CLIENT_ID` Actions secret,
      wired into the release build). Contributor docs point devs at registering their
      own dev OAuth App.
- [ ] Dependency licence audit clean
- [ ] `CONTRIBUTING.md`, issue templates, PR templates in place
- [ ] `git-cliff` or equivalent changelog generation configured

---

## Key Technical Risks

**Commit graph performance**

Layout computation must run in Rust; only viewport-visible nodes returned to the frontend. Virtualisation must be in place from the start — not retrofitted.

**libgit2 credential handling**

`git2` can have friction with SSH agent forwarding and complex credential chains. The CLI passthrough path (`git` binary via `std::process::Command`) is the designated fallback for push/pull if `git2` proves unreliable in a given environment.

**GitHub Enterprise OAuth**

GHE instances vary in configuration (SAML SSO, custom CA certificates). The auth flow must accept a configurable base URL and optional CA bundle from the outset.

**Three-panel merge editor state**

Keeping three CodeMirror 6 instances synchronised with a shared resolution state is the most complex frontend engineering task in v1. Allocate accordingly.

**OperationRunner correctness**

Must handle process interruption (crash, OS sleep) gracefully. Persist state to `.git/` for recovery on relaunch.

---

## Conventions

- **TDD:** All features must be build using TDD. Tests first, then implementation with a "red", "green", "refactor" approach.
- **Commits:** Conventional Commits format enforced (`feat:`, `fix:`, `chore:`, etc.) Commits must _not_ attribute the agent - only the human author
- **Branching:** `main` is always releasable; feature work on `feat/<name>`, fixes on `fix/<name>`
- **Versioning:** Semantic Versioning from v0.1.0
- **Code style:** `rustfmt` for Rust; ESLint + Prettier for TypeScript/React
- **No hardcoded secrets:** OAuth client IDs, tokens, and certificates via environment variables or OS keychain only
