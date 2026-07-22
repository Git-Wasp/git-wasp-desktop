# Worktree Support Design

## Goal

Add first-class Git worktree support to Git Wasp so a user can create a new worktree, open it in a new tab, manage sibling worktrees for the same repository from a dedicated sidebar panel, lock and unlock worktrees, close worktree tabs without removing them from disk, remove eligible worktrees safely, and hand off worktree branches back into the main repository's existing merge workflow.

The feature must fit the existing architectural rules:

- the Rust backend remains authoritative for Git state;
- the frontend interacts only through Tauri commands and events;
- multi-step Git operations continue to route through `OperationRunner`;
- all new behavior follows TDD; and
- worktrees are treated as separate working directories attached to one shared repository, not as separate repositories that need a custom synchronization layer.

## Product Model

Git Wasp will treat a linked worktree as a first-class repo variant, not as a nested UI object. Each worktree opens as its own top-level tab and uses the same repo-scoped surfaces as any other open repository path.

The app model becomes:

- a main repository tab is the primary working directory for a shared Git repository;
- a linked worktree tab is another working directory attached to that same repository;
- both are keyed by their normalized working-directory paths;
- both can be open simultaneously;
- both can participate in the existing history, working-tree, branch, merge, stash, and PR surfaces; and
- the worktree tab carries explicit metadata that identifies its parent repository and current worktree state.

This preserves the current tab/session architecture instead of introducing a second navigation system or a frontend-owned family registry.

## Recommended Technical Approach

Use native worktree support as a first-class repo variant backed by explicit backend commands.

The backend should add a dedicated `worktree_ops` module that shells out to the Git CLI for worktree lifecycle commands such as list, add, lock, unlock, and remove. This is preferred over relying on libgit2 alone because Git's own CLI is the source of truth for worktree management and already encodes the edge-case behavior Git Wasp needs to surface accurately.

`RepoManager` remains the owner of open tabs and session restoration. No separate app-owned worktree registry is introduced. A worktree is still opened by its working-directory path, and reopening a persisted worktree path reconstructs its metadata by re-reading Git state.

The frontend reuses the current repo/tab/store model. It gains worktree-aware metadata, navigation surfaces, and actions, but history, working tree, diffing, merge, stash, PR, and settings flows continue to work against the active repo path.

## Backend Design

### Repo metadata

Extend `RepoInfo` so the frontend can distinguish a main repository tab from a linked worktree tab without inferring that state locally.

Recommended fields:

- `repoKind: "main" | "worktree"`
- `parentRepoPath: string | null`
- `commonDirPath: string`
- `worktreeBranch: string | null`
- `worktreeLocked: boolean`
- `worktreePrunable: boolean`

The backend derives these values from Git state every time it opens or refreshes a repository tab. `parentRepoPath` is null for the main repository workdir and set for linked worktrees. `commonDirPath` is included so the backend can reliably resolve a worktree family even when the currently active tab is itself a linked worktree.

### Worktree family listing

Add a dedicated `WorktreeEntry` shape for listing all worktrees that belong to one repository family.

Recommended fields:

- `path: string`
- `name: string`
- `repoKind: "main" | "worktree"`
- `branch: string | null`
- `isCurrent: boolean`
- `isOpen: boolean`
- `isLocked: boolean`
- `hasUncommittedChanges: boolean`
- `parentRepoPath: string | null`

The backend should support listing the family from either a main repository path or a linked worktree path. When invoked from a linked worktree, it resolves the family through the repository common dir and returns the main repository plus all sibling worktrees.

### Commands

Add worktree-specific Tauri commands rather than overloading generic repo commands with ad hoc flags.

Required commands for the first slice:

- `list_worktrees({ repoPath }) -> WorktreeEntry[]`
- `create_worktree({ repoPath, targetPath, mode, branchName, startPoint }) -> RepoInfo`
- `lock_worktree({ repoPath, reason }) -> RepoInfo`
- `unlock_worktree({ repoPath }) -> RepoInfo`
- `remove_worktree({ repoPath }) -> RemoveWorktreeResult`
- `open_parent_repo({ repoPath }) -> RepoInfo`

`open_repo(path)` remains valid for opening a worktree directly by path. If the tab is already open, the existing tab is activated instead of duplicated.

`create_worktree` supports two user-facing modes:

1. create a worktree from an existing branch; and
2. create a new branch worktree from a chosen base branch or commit.

The recommended default mode is creating a new branch from a chosen base.

The first slice does not support detached-head worktree creation.

### Git command strategy

Use the Git CLI for lifecycle commands:

- `git worktree list --porcelain`
- `git worktree add ...`
- `git worktree lock ...`
- `git worktree unlock ...`
- `git worktree remove ...`

The parser for `git worktree list --porcelain` should live in a focused backend unit with its own tests so higher-level commands do not duplicate string parsing logic.

The backend should continue to use existing repository-opening logic for tab activation after worktree creation or parent-repo opening.

### Session restore

Persist open worktree tabs exactly as the app persists any other open repo path today. On launch, restoring a linked worktree path should:

- reopen the path if it still exists and is still a valid Git worktree; and
- skip the path if it no longer exists or is no longer valid, while continuing to restore the rest of the session.

Missing restored worktree paths should be logged for diagnostics but must not block app startup.

### Operation coordination

Worktree lifecycle mutations alter repository topology and must not race with multi-step operations.

For the first slice:

- block create, lock, unlock, and remove while the relevant repo tab has an in-progress `OperationRunner` operation; and
- prevent starting a multi-step operation if a conflicting worktree lifecycle action is in flight.

This preserves the architectural rule that multi-step Git state changes remain coordinated server-side rather than pieced together in the frontend.

## Frontend Design

### Tab model

Each linked worktree opens as its own top-level tab in the existing tab bar.

Tab requirements:

- show a distinct tree-style icon for worktrees;
- preserve the current click-to-activate and close-tab behavior;
- expose explicit metadata somewhere in the active repo surfaces so the user can tell a worktree from the main repo;
- avoid nested tab behavior; and
- keep tab identity keyed by normalized repo path.

Closing a worktree tab only closes the tab. It does not remove the worktree from disk or unregister it from Git.

### Worktrees sidebar panel

Add a new repo-scoped `Worktrees` panel to the left sidebar.

This panel is the primary management surface for worktrees in the currently active repository family. It should appear when the active tab is either the main repository or one of its linked worktrees.

The panel lists:

- the main repository workdir at the top as the family anchor; and
- all linked worktrees beneath it.

Each row shows:

- tree icon;
- display name;
- checked-out branch, when available;
- badges for current, locked, and dirty state; and
- row actions or context-menu actions for open/activate, open parent, lock/unlock, and remove when eligible.

Panel header actions:

- `New worktree`
- `Refresh`

Behavior:

- clicking an already open row activates its tab;
- clicking a closed row opens it as a new tab;
- if the active tab is a linked worktree, the current row highlight reflects that linked worktree, not the main repository;
- the panel is a navigator and manager, not a second source of repository truth.

### Worktree creation flow

Entry points for the first slice:

- `New worktree` action in the `Worktrees` sidebar panel; and
- a repo-level action in the navbar or similar primary repo control area.

Flow:

1. choose creation mode: existing branch or new branch from base;
2. default to new branch from base;
3. choose the destination path;
4. if creating a new branch, choose branch name and base branch/commit;
5. submit the request; and
6. on success, open the new worktree as the active tab and refresh the parent family listing.

The first slice excludes:

- detached-head worktree creation; and
- lock-on-create.

### Parent quick actions and merge handoff

Because a worktree shares the same underlying repository, Git Wasp will not invent a separate "merge worktree back" engine.

Instead:

- every linked worktree tab exposes `Open parent repo`;
- the main repo tab can use the existing merge/cherry-pick/rebase flows against the branch developed in the worktree; and
- the first slice stops at the parent-repo handoff rather than adding a merge-prefill shortcut.

This is a workflow handoff, not a new merge primitive.

### Close vs remove

Close and remove are separate operations with different safety rules.

Close:

- closes the tab only;
- leaves the worktree on disk;
- leaves Git worktree registration unchanged.

Remove:

- is an explicit destructive action on a linked worktree;
- is only available in the first slice when the worktree is clean and unlocked; and
- closes the tab after successful removal if it was open.

If the worktree is dirty or locked, the remove action is blocked with a clear explanation instead of offering a force path.

The first slice does not support force remove.

## User Flows

### Create a new worktree

From the active repository family:

1. user opens `New worktree`;
2. user chooses `New branch from base` or `Existing branch`;
3. user provides destination path and branch details;
4. backend validates the request and runs the Git worktree add command;
5. app opens the new worktree as a new active tab; and
6. the `Worktrees` panel refreshes so the family view updates immediately.

### Open or switch to a sibling worktree

1. user clicks a row in the `Worktrees` panel;
2. if the worktree is already open, the app activates its existing tab;
3. otherwise, the app opens the worktree by path and adds a new tab.

### Lock or unlock a worktree

1. user triggers `Lock` or `Unlock` from the worktree row or tab actions;
2. backend executes the Git command;
3. active repo metadata and the family listing refresh;
4. UI badges update to reflect the new state.

The first slice omits lock reasons. `Lock` and `Unlock` are simple state changes.

### Remove an eligible worktree

1. user triggers `Remove worktree`;
2. app verifies the worktree is clean and unlocked;
3. app confirms the destructive action;
4. backend removes the worktree from Git and disk;
5. if the tab was open, the app closes it; and
6. the family listing refreshes.

### Merge a worktree branch back

1. user finishes work in the linked worktree and commits there normally;
2. user chooses `Open parent repo` or the worktree-to-parent merge shortcut;
3. parent repo tab becomes active or opens;
4. user uses the existing merge or cherry-pick flow against the worktree branch.

## Error Handling and Edge Cases

### Branch already checked out elsewhere

Git will reject creating a worktree that checks out a branch already in use elsewhere. The app should surface this clearly and point the user toward the valid path: create a new branch from that base instead of trying to reuse the already-checked-out branch.

### Invalid destination path

Reject destination paths that:

- already exist and are non-empty;
- point into invalid repository internals; or
- cannot be created or normalized safely.

Error copy should be concrete and directly actionable.

### Dirty or locked removal attempts

The first slice blocks removal when a worktree is dirty or locked. The UI should explain the precise blocker so the user knows whether they need to commit, stash, discard, or unlock first.

### Parent repo not already open

A user may open a linked worktree directly by path without first opening the parent repository. In that case the backend still resolves the repository family, the sidebar still shows the family list, and `Open parent repo` opens the parent as a separate tab if needed.

### Missing or stale sibling paths

One invalid sibling path must not prevent the rest of the family from loading. The app should tolerate missing siblings during family listing and session restore rather than treating the entire repository family as broken.

## Rollout Boundaries

Include in the first slice:

- create worktree from existing branch;
- create new-branch worktree from base branch or commit;
- open or activate sibling worktrees from the sidebar panel;
- separate top-level tabs for linked worktrees;
- explicit worktree metadata and parent quick actions;
- lock and unlock;
- close tab versus remove worktree distinction;
- remove only when clean and unlocked; and
- merge handoff into the existing parent-repo merge workflow.

Explicitly exclude from the first slice:

- detached-head worktree creation;
- force remove;
- prune or repair flows for stale worktrees;
- bulk worktree management;
- workspace-wide aggregation of unrelated repository families;
- cross-worktree compare views; and
- a custom merge engine for "merge back"; and
- a separate merge-prefill shortcut beyond the core `Open parent repo` handoff.

## Testing Strategy

This feature must follow the repository's TDD rule: tests first, then minimal implementation, then refactor.

### Backend tests

Add focused unit and integration coverage for:

- parsing `git worktree list --porcelain`;
- deriving `RepoInfo` worktree metadata from both main repo and linked worktree paths;
- listing a full family from either the main repo or a linked worktree;
- create worktree success and expected error paths;
- branch-already-checked-out failures;
- lock and unlock state transitions;
- remove eligibility checks for clean, dirty, and locked worktrees; and
- session restore skipping a missing worktree path without aborting the rest.

### Frontend tests

Add focused component and store coverage for:

- tab rendering with worktree iconography and metadata;
- `Worktrees` sidebar panel rendering the main repo and linked worktrees;
- current-row highlighting when the active tab is a linked worktree;
- clicking a closed sibling row opening a new tab;
- clicking an open sibling row activating the existing tab;
- create-flow defaults using `New branch from base`;
- lock/unlock actions refreshing visible state; and
- remove actions appearing only when the worktree is eligible.

### Verification

Manual verification for the first slice should cover:

- create a new worktree from a new branch and confirm it opens as a new tab;
- create a worktree from an existing branch that is not already checked out;
- attempt to create one from a branch already checked out elsewhere and confirm the error is clear;
- switch between main repo and sibling worktree tabs from the sidebar;
- lock and unlock a worktree and confirm badges update;
- close a worktree tab and confirm the worktree remains available in the sidebar;
- remove a clean, unlocked worktree and confirm the tab closes if open; and
- open the parent repo from a linked worktree and perform a normal merge handoff.

## Delivery Recommendation

Ship worktree support in two internal increments:

1. backend worktree metadata and commands, tab/session awareness, and the `Worktrees` sidebar family view; and
2. create/remove/lock/unlock dialogs plus merge-handoff polish.

This keeps the initial integration slice inspectable before destructive UI actions are layered on top.
