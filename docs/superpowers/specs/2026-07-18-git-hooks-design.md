# Git Hooks Design

**Date:** 2026-07-18

**Status:** Approved

## Goal

Git Wasp will automatically execute a repository's `pre-commit` hook for an
ordinary commit and its `pre-push` hook for a branch push. Hook output will
stream into a hideable, persistent-for-the-run terminal pane, and users may
opt out of either hook independently for each repository.

This feature covers only commits equivalent to:

```bash
git commit -m "<message>"
```

Amend, revert, squash, merge, and any other app-created commits remain on their
existing code paths and do not run `pre-commit` as part of this work.

## Requirements

- `pre-commit` and `pre-push` are enabled by default for every repository.
- Users can disable either hook independently for one repository without
  affecting any other repository.
- Git Wasp respects Git's effective hook location, including `core.hooksPath`.
- A missing or non-executable hook is treated the same way Git treats it: the
  operation proceeds.
- Hook output streams while the hook runs and remains available after the pane
  is hidden and reshown.
- The active hook state is clearly visible at the base of the graph.
- Conflicting commit and push controls are disabled only for the repository
  running the operation. Other repositories remain usable.
- A failed hook prevents its commit or push.

## Architecture

### Hybrid Git execution

The ordinary commit command will use the installed `git` executable rather
than `git2`:

```text
git -C <worktree> commit -m <message>
```

`std::process::Command` passes each argument directly without a shell. This
provides native `pre-commit` discovery, environment, exit-code, and index
mutation behavior while avoiding command injection. After success, the backend
reads and returns the new `HEAD` OID. The existing frontend graph and
working-tree refreshes continue to run.

Push transport stays in `git2` to preserve current GitHub/GHE credentials and
error behavior. Before `remote_ops::push` begins, the backend runs the effective
`pre-push` hook with Git-compatible inputs:

```text
<hook-path> <remote-name> <remote-url>
```

Its standard input contains the update for the branch being pushed:

```text
<local-ref> <local-oid> <remote-ref> <remote-oid>\n
```

For a first push, `<remote-oid>` is Git's all-zero object ID. The existing push
command pushes one branch, so exactly one update line is required. A zero exit
continues to `remote_ops::push`; any other exit cancels the push.

### Hook runner

A new Rust `hook_runner` module owns:

- per-repository hook preference lookup;
- effective `pre-push` hook discovery using repository configuration;
- child-process launch with the worktree as the current directory;
- `pre-push` arguments and standard-input construction;
- concurrent stdout/stderr reading and Tauri event emission;
- run IDs, lifecycle events, exit status, and actionable failure summaries.

The module does not edit, install, or relocate hook files. Git configuration is
authoritative; Git Wasp adds only a per-repository opt-out.

`pre-commit` is launched by `git commit`, not directly by the hook runner. The
runner wraps that Git child process so commit output uses the same lifecycle
and streaming event protocol as `pre-push`.

Commit and push commands become asynchronous Tauri commands. Each request
captures the repository path before launching work and associates a new run ID
with it. Hook-aware operations are serialized per repository but do not hold
the global repository collection lock, so work in other open repositories can
continue.

### Event protocol

The backend emits events with a stable repository path and run ID:

- `git-hook://started`: repository, run ID, hook name, operation name.
- `git-hook://output`: repository, run ID, stream (`stdout` or `stderr`), and
  one raw output chunk decoded with UTF-8 replacement for invalid bytes.
- `git-hook://finished`: repository, run ID, hook name, outcome, exit code when
  available, and a concise summary.

The frontend accepts output and completion only when both repository path and
run ID match its current run. Late events from an earlier retry cannot
overwrite newer state.

## Configuration

`AppConfig` gains a backward-compatible map keyed by the normalized repository
worktree path. Each value contains:

```text
preCommit: boolean
prePush: boolean
```

Absent repository entries and absent fields deserialize to `true`. The
settings UI persists explicit repository values through backend commands; hook
preferences are not stored inside the user's repository or Git configuration.

The Settings view adds a **Git hooks** section for the currently open
repository. It shows separate `pre-commit` and `pre-push` toggles and explains
that disabling a hook applies only to that repository. When no repository is
open, the section explains that a repository must be opened to configure its
hooks.

Disabling a hook means Git Wasp skips it. For ordinary commits, the backend
adds `--no-verify` to the CLI commit only when `pre-commit` is disabled.
External Git commands and other Git clients are unaffected.

## Frontend State and User Interface

### Store

A dedicated Zustand hook-operation store is keyed by normalized repository
path. Each repository retains:

- current run ID;
- hook and operation names;
- `idle`, `running`, `succeeded`, or `failed` status;
- streamed output chunks;
- failure summary;
- pane visibility;
- whether output following is enabled.

Starting a run replaces the previous run's output and opens the pane. Closing
the repository removes its retained state. Hiding the pane never cancels the
process or clears output.

Retained output is capped at 1 MiB per repository, measured as JavaScript
string length. When the cap is exceeded, the store removes the oldest whole
chunks and prepends a single truncation notice. This prevents an unbounded
frontend memory cost while preserving the most recent diagnostics.

### Terminal pane

A resizable `HookOutputPane` sits above the graph footer. It uses a read-only
terminal renderer rather than starting an interactive shell or PTY. Raw output
chunks are written to the renderer so ordinary ANSI color and cursor sequences
display as terminal output.

The pane follows new output when the viewport is already at the bottom. Manual
scrolling upward pauses following. Returning to the bottom, or choosing
**Follow output**, resumes it. A close control hides the pane, and the graph
footer can show it again with the complete retained output.

### Graph footer and operation controls

A `HookStatusBar` is always available at the base of the graph when a
repository is open. Its content is:

- idle: hooks ready, with a control to show the most recent output when one
  exists;
- running: spinner plus `Running pre-commit…` or `Running pre-push…`;
- succeeded: success indication and output toggle;
- failed: prominent failure indication, concise summary, and output toggle.

While either hook-aware operation is running, the ordinary Commit button and
push controls for that repository are disabled. Labels identify the work in
progress. The lock is repository-scoped, so switching tabs leaves unrelated
repositories interactive.

## Completion and Failure Behavior

For commit:

1. Start a repository-scoped run and open the output pane.
2. Run `git commit -m <message>`, adding `--no-verify` only for an opted-out
   `pre-commit`.
3. Stream all Git and hook output.
4. On success, read `HEAD`, emit success, return its OID, and use existing
   frontend refresh behavior.
5. On failure, emit failure, keep the pane open, and do not report a commit.

For push:

1. Resolve the selected remote, branch, remote URL, and local/remote OIDs.
2. Start a repository-scoped run and open the output pane.
3. If `pre-push` is enabled and executable, invoke it with the defined
   arguments/stdin and stream its output.
4. On hook success or when no hook is effective, continue through the existing
   authenticated `git2` push.
5. On hook failure, emit failure and do not contact the remote for the push.
6. Emit the final push success or failure so controls remain locked for the
   complete hook-aware operation, not merely the hook process.

The initiating control shows only a concise actionable error, such as
`pre-push failed; review hook output`. Full process output remains in the pane
and is not duplicated in a toast. Child launch failures, unavailable Git,
invalid repository state, and transport failures retain distinct summaries.

There is no cancellation control in this scope. Hiding the pane does not
terminate a hook.

## Testing

### Rust unit and integration tests

Temporary repositories and executable fixture hooks verify:

- legacy configuration defaults both hooks to enabled;
- per-repository settings round-trip and do not affect another repository;
- an ordinary commit runs `pre-commit`;
- disabling `pre-commit` uses native `--no-verify` behavior;
- a successful hook allows the commit and returns the new OID;
- a failing hook blocks the commit and preserves staged changes;
- a hook that updates the index affects the committed tree as native Git does;
- a configured `core.hooksPath` is honored;
- missing and non-executable hooks allow the operation;
- invalid UTF-8 output is delivered with replacement characters;
- mixed stdout/stderr is delivered with correct stream labels;
- `pre-push` receives the remote arguments and exact update line;
- a first push supplies an all-zero remote OID;
- a failed `pre-push` prevents the transport call;
- an opted-out `pre-push` skips the hook and allows transport;
- repository-scoped execution does not block an operation on another repo.

### Frontend tests

Store and component tests verify:

- events are isolated by repository path and run ID;
- stale output and completion events are rejected;
- a run clears old output and opens the pane;
- hiding and showing the pane again preserves output;
- output truncation retains the newest chunks and one truncation notice;
- automatic following pauses on manual upward scroll and resumes at bottom;
- footer content covers idle, running, succeeded, and failed states;
- the output pane can be toggled from the footer;
- settings load and save independently for the current repository;
- commit and push controls are disabled only for the running repository.

Existing Rust and frontend commit, remote, repository-store, working-tree, and
graph tests remain regression gates.

## Out of Scope

- Hooks other than `pre-commit` and `pre-push`.
- Running `pre-commit` for amend, revert, squash, merge, or other generated
  commits.
- Installing, editing, debugging, or managing hook files.
- An interactive embedded shell or pseudo-terminal.
- Hook cancellation.
- Changing hooks used by external Git commands.
