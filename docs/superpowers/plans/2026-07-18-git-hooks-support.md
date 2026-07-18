# Git Hooks Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run repository `pre-commit` and `pre-push` hooks automatically, stream their output into a repository-scoped terminal pane, and provide default-on per-repository opt-outs.

**Architecture:** Ordinary commits move from `git2` to `git commit -m`, while pushes retain their current authenticated transport and run a Git-compatible `pre-push` first. A focused Rust hook runner emits repository/run-keyed lifecycle events; a Zustand store consumes those events and drives settings, a terminal pane, a graph footer, and repository-scoped action locking.

**Tech Stack:** Rust, Tauri v2 events and async commands, `git2`, React 19, TypeScript, Zustand, Vitest/Testing Library, `@xterm/xterm`.

## Global Constraints

- Only ordinary commits equivalent to `git commit -m "<message>"` run `pre-commit`.
- Amend, revert, squash, merge, and other generated commits keep their existing implementations and do not run `pre-commit`.
- `pre-commit` and `pre-push` are enabled by default for every repository and can be disabled independently per repository.
- Push transport remains on the existing authenticated path after `pre-push` succeeds.
- Hook-aware work is serialized per repository but must not block another open repository.
- Hook processes use the repository worktree as their current directory and are never launched through a shell.
- Hook output is decoded lossily, streamed with stdout/stderr labels, and retained up to 1 MiB per repository.
- A failed hook prevents its commit or push.
- Hiding the output pane does not cancel the operation or erase output.
- Hook cancellation, hook editing/installing, other hook names, and an interactive PTY are out of scope.

---

## File Structure

### Backend

- Create `src-tauri/src/hook_runner/mod.rs`: hook event types, run guard, process streaming, Git hook discovery, commit execution, and pre-push input construction.
- Create `src-tauri/src/commands/hooks.rs`: hook settings commands.
- Modify `src-tauri/src/repo_manager/config.rs`: backward-compatible per-repository hook preferences.
- Modify `src-tauri/src/repo_manager/mod.rs`: path-addressed repository access, per-repository operation guards, and preference persistence.
- Modify `src-tauri/src/commands/mod.rs`: export hook commands.
- Modify `src-tauri/src/commands/commit.rs`: asynchronous CLI-backed ordinary commit.
- Modify `src-tauri/src/commands/remote.rs`: asynchronous pre-push gate around the existing transport.
- Modify `src-tauri/src/remote_ops/mod.rs`: expose push preparation data and accept a testable transport boundary.
- Modify `src-tauri/src/lib.rs`: register the module and commands.

### Frontend

- Create `src/types/hooks.ts`: settings and event payload contracts.
- Create `src/stores/hookStore.ts`: repository/run-keyed operation state and listener setup.
- Create `src/stores/__tests__/hookStore.test.ts`: event isolation, stale-event, visibility, following, and truncation tests.
- Create `src/components/Settings/GitHooksSettings.tsx` and `.test.tsx`: per-repository toggles.
- Create `src/components/GitHooks/HookOutputPane.tsx` and `.test.tsx`: read-only xterm output and follow behavior.
- Create `src/components/GitHooks/HookStatusBar.tsx` and `.test.tsx`: footer lifecycle UI.
- Modify `src/components/Settings/SettingsView.tsx`: render the hooks settings section.
- Modify `src/components/CommitGraph/HistoryToolbar.tsx` and `HistoryToolbar.test.tsx`: disable push for the active repository run.
- Modify `src/components/WorkingTree/CommitForm.tsx` and its test: disable ordinary commit for the active repository run.
- Modify `src/stores/workingTreeStore.ts`: pass the captured repository path to ordinary commit.
- Modify `src/stores/remoteStore.ts`: pass the captured repository path to push.
- Modify `src/stores/repoStore.ts`: clear retained hook state when a repository closes.
- Modify `src/App.tsx` and `src/App.test.tsx`: initialize listeners and mount the pane/footer in the graph column.
- Modify `package.json` and `package-lock.json`: add `@xterm/xterm`.
- Modify `TODO.md` and `DONE.md`: move the completed backlog item after all verification passes.

---

### Task 1: Persist Default-On Per-Repository Hook Preferences

**Files:**
- Modify: `src-tauri/src/repo_manager/config.rs`
- Modify: `src-tauri/src/repo_manager/mod.rs`
- Create: `src-tauri/src/commands/hooks.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `HookPreferences { pre_commit: bool, pre_push: bool }`
- Produces: `AppState::hook_preferences(repo_path: &str) -> anyhow::Result<HookPreferences>`
- Produces: `AppState::set_hook_preferences(repo_path: &str, preferences: HookPreferences) -> anyhow::Result<HookPreferences>`
- Produces Tauri commands: `get_hook_preferences(repo_path: String)` and `set_hook_preferences(repo_path: String, preferences: HookPreferences)`

- [ ] **Step 1: Write failing configuration tests**

Add these tests to `src-tauri/src/repo_manager/config.rs`:

```rust
#[test]
fn hook_preferences_default_to_enabled_for_legacy_config() {
    let json = r#"{"recentRepos":[],"lastRepoPath":null}"#;
    let config: AppConfig = serde_json::from_str(json).unwrap();
    assert_eq!(
        config.hook_preferences_for(Path::new("/tmp/repo")),
        HookPreferences::default()
    );
}

#[test]
fn hook_preferences_are_isolated_and_round_trip() {
    let mut config = AppConfig::default();
    config.set_hook_preferences(
        PathBuf::from("/tmp/a"),
        HookPreferences {
            pre_commit: false,
            pre_push: true,
        },
    );
    let json = serde_json::to_string(&config).unwrap();
    let restored: AppConfig = serde_json::from_str(&json).unwrap();
    assert!(!restored.hook_preferences_for(Path::new("/tmp/a")).pre_commit);
    assert!(restored.hook_preferences_for(Path::new("/tmp/a")).pre_push);
    assert_eq!(
        restored.hook_preferences_for(Path::new("/tmp/b")),
        HookPreferences::default()
    );
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd src-tauri
cargo test repo_manager::config::tests::hook_preferences -- --nocapture
```

Expected: compilation fails because `HookPreferences`, `hook_preferences_for`, and `set_hook_preferences` do not exist.

- [ ] **Step 3: Add the serialized preference model and accessors**

Add to `src-tauri/src/repo_manager/config.rs`:

```rust
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HookPreferences {
    pub pre_commit: bool,
    pub pre_push: bool,
}

impl Default for HookPreferences {
    fn default() -> Self {
        Self {
            pre_commit: true,
            pre_push: true,
        }
    }
}
```

Add this field to `AppConfig`:

```rust
#[serde(default)]
pub hook_preferences: HashMap<PathBuf, HookPreferences>,
```

Initialize it in `Default`, then add:

```rust
pub fn hook_preferences_for(&self, path: &Path) -> HookPreferences {
    self.hook_preferences.get(path).copied().unwrap_or_default()
}

pub fn set_hook_preferences(&mut self, path: PathBuf, preferences: HookPreferences) {
    if preferences == HookPreferences::default() {
        self.hook_preferences.remove(&path);
    } else {
        self.hook_preferences.insert(path, preferences);
    }
}
```

Re-export `HookPreferences` from `repo_manager/mod.rs`. Add manager/AppState methods that validate `repo_path` is an open normalized worktree key, read/update the config mutex, and call `config.save()` after updates.

- [ ] **Step 4: Add the Tauri command boundary**

Create `src-tauri/src/commands/hooks.rs`:

```rust
use crate::repo_manager::{AppState, HookPreferences};
use tauri::State;

#[tauri::command]
pub fn get_hook_preferences(
    repo_path: String,
    state: State<'_, AppState>,
) -> Result<HookPreferences, String> {
    state.hook_preferences(&repo_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_hook_preferences(
    repo_path: String,
    preferences: HookPreferences,
    state: State<'_, AppState>,
) -> Result<HookPreferences, String> {
    state
        .set_hook_preferences(&repo_path, preferences)
        .map_err(|e| e.to_string())
}
```

Export `hooks` from `commands/mod.rs` and register both commands in `src-tauri/src/lib.rs`.

- [ ] **Step 5: Run focused and full backend tests**

Run:

```bash
cd src-tauri
cargo test repo_manager::config::tests -- --nocapture
cargo test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/repo_manager/config.rs src-tauri/src/repo_manager/mod.rs src-tauri/src/commands/hooks.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: persist per-repository hook preferences"
```

---

### Task 2: Add Repository-Scoped Hook Runs and Streaming Events

**Files:**
- Create: `src-tauri/src/hook_runner/mod.rs`
- Modify: `src-tauri/src/repo_manager/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `HookPreferences`
- Produces: `HookName`, `HookOutcome`, `HookStarted`, `HookOutput`, `HookFinished`
- Produces: `AppState::begin_hook_run(repo_path: &str) -> anyhow::Result<HookRunGuard>`
- Produces: `stream_command(app: &AppHandle, metadata: &HookRunMetadata, command: Command, stdin: Option<Vec<u8>>) -> anyhow::Result<Output>`

- [ ] **Step 1: Write failing run-isolation and output-decoding tests**

Create `src-tauri/src/hook_runner/mod.rs` with a `tests` module containing:

```rust
#[test]
fn invalid_utf8_is_decoded_lossily() {
    assert_eq!(decode_output(&[b'o', b'k', 0xff]), "ok\u{fffd}");
}

#[test]
fn a_repository_cannot_start_two_hook_runs() {
    let registry = RunRegistry::default();
    let first = registry.begin("/tmp/a").unwrap();
    assert_eq!(
        registry.begin("/tmp/a").unwrap_err().to_string(),
        "a hook-aware operation is already running for this repository"
    );
    assert!(registry.begin("/tmp/b").is_ok());
    drop(first);
    assert!(registry.begin("/tmp/a").is_ok());
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd src-tauri
cargo test hook_runner::tests -- --nocapture
```

Expected: compilation fails because the module and types are not implemented.

- [ ] **Step 3: Implement event contracts and the RAII run registry**

Define:

```rust
pub const STARTED_EVENT: &str = "git-hook://started";
pub const OUTPUT_EVENT: &str = "git-hook://output";
pub const FINISHED_EVENT: &str = "git-hook://finished";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HookName {
    PreCommit,
    PrePush,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HookOutcome {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone)]
pub struct HookRunMetadata {
    pub repo_path: String,
    pub run_id: String,
    pub hook: HookName,
    pub operation: &'static str,
}
```

Serialize event payloads with camel-case fields exactly matching Task 5. Implement `RunRegistry` as `Arc<Mutex<HashSet<String>>>`; `begin` inserts a path and returns a clone-backed `HookRunGuard` whose `Drop` removes it. Store one registry in `AppState`, not in the global repo vector.

Generate run IDs from an `AtomicU64` counter plus process start uniqueness; do not add a UUID dependency.

- [ ] **Step 4: Implement streaming without a shell**

Implement `stream_command` so it:

1. emits `HookStarted`;
2. sets piped stdout/stderr and optional piped stdin;
3. spawns the supplied `std::process::Command`;
4. reads stdout and stderr on separate scoped threads in 4 KiB chunks;
5. emits every chunk with its stream label and lossy UTF-8 decoding;
6. waits for the child and joins both readers;
7. returns `std::process::Output` containing the exit status and empty byte buffers, because content has already streamed.

Use `tauri::Emitter`; never use `sh -c`, `cmd /C`, or string interpolation into a shell command.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd src-tauri
cargo test hook_runner::tests -- --nocapture
```

Expected: all hook runner unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/hook_runner/mod.rs src-tauri/src/repo_manager/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add repository-scoped hook runner"
```

---

### Task 3: Route Ordinary Commits Through Native Git

**Files:**
- Modify: `src-tauri/src/hook_runner/mod.rs`
- Modify: `src-tauri/src/commands/commit.rs`
- Modify: `src-tauri/src/repo_manager/mod.rs`

**Interfaces:**
- Consumes: `AppState::hook_preferences`, `AppState::begin_hook_run`, `stream_command`
- Produces: `run_commit(app, repo_path, run_id, message, pre_commit_enabled) -> anyhow::Result<String>`
- Changes Tauri command: `create_commit(repo_path: String, message: String, app_handle: AppHandle, state: State<'_, AppState>) -> async Result<String, String>`

- [ ] **Step 1: Write failing native-commit integration tests**

Add fixture helpers and tests to `hook_runner::tests`:

```rust
#[test]
fn native_commit_runs_pre_commit_and_returns_head() {
    let fixture = CommitFixture::new();
    fixture.stage("file.txt", "changed\n");
    fixture.install_hook("pre-commit", "#!/bin/sh\nprintf ran > .git/pre-commit-ran\n");
    let oid = run_commit_for_test(
        fixture.path(),
        "run hook",
        true,
        &RecordingEmitter::default(),
    )
    .unwrap();
    assert_eq!(oid, fixture.head_oid());
    assert_eq!(
        std::fs::read_to_string(fixture.git_dir().join("pre-commit-ran")).unwrap(),
        "ran"
    );
}

#[test]
fn failed_pre_commit_blocks_commit_and_keeps_index() {
    let fixture = CommitFixture::new();
    fixture.stage("file.txt", "changed\n");
    let before = fixture.head_oid();
    fixture.install_hook(
        "pre-commit",
        "#!/bin/sh\nprintf 'lint failed\\n' >&2\nexit 7\n",
    );
    assert!(run_commit_for_test(
        fixture.path(),
        "blocked",
        true,
        &RecordingEmitter::default(),
    )
    .is_err());
    assert_eq!(fixture.head_oid(), before);
    assert!(fixture.is_staged("file.txt"));
}

#[test]
fn disabled_pre_commit_uses_no_verify() {
    let fixture = CommitFixture::new();
    fixture.stage("file.txt", "changed\n");
    fixture.install_hook("pre-commit", "#!/bin/sh\nexit 9\n");
    assert!(run_commit_for_test(
        fixture.path(),
        "skip hook",
        false,
        &RecordingEmitter::default(),
    )
    .is_ok());
}

#[test]
fn pre_commit_can_change_the_index_before_commit() {
    let fixture = CommitFixture::new();
    fixture.stage("file.txt", "before hook\n");
    fixture.install_hook(
        "pre-commit",
        "#!/bin/sh\nprintf 'from hook\\n' > file.txt\ngit add file.txt\n",
    );
    run_commit_for_test(
        fixture.path(),
        "index update",
        true,
        &RecordingEmitter::default(),
    )
    .unwrap();
    assert_eq!(fixture.head_file("file.txt"), "from hook\n");
}
```

The fixture must set local `user.name`, `user.email`, `core.autocrlf=false`, and
`core.eol=lf`; on Windows, create an equivalent executable hook supported by
the test environment or guard POSIX-script tests with `#[cfg(unix)]`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd src-tauri
cargo test hook_runner::tests -- --nocapture
```

Expected: compilation fails because commit execution helpers do not exist.

- [ ] **Step 3: Implement the native ordinary commit**

Build the command exactly as arguments:

```rust
let mut command = std::process::Command::new("git");
command
    .arg("-C")
    .arg(worktree)
    .arg("commit");
if !pre_commit_enabled {
    command.arg("--no-verify");
}
command.arg("-m").arg(message);
```

Use the existing normalized worktree path rather than accepting an arbitrary
directory. After `stream_command` succeeds, reopen/read the repository and
resolve `HEAD` to a commit OID. Emit `HookFinished` with `succeeded`; on a
non-zero exit emit `failed` with exit code and summary
`pre-commit failed; review hook output`.

Use `HookName::PreCommit` for the full commit lifecycle even when opted out, so
the same UI locks the commit while Git is running.

- [ ] **Step 4: Replace only `create_commit`**

Make `commands::commit::create_commit` async. Capture preferences and acquire
the run guard before entering `tauri::async_runtime::spawn_blocking`. Move the
guard into the blocking closure so it covers the child lifetime. Pass
`repo_path` from the frontend; use a new path-addressed repo helper to verify
the path is currently open and mark only that repository's graph cache dirty
after completion.

Do not change `amend_commit_message`, `revert_commit`, `squash_commits`, or
merge completion.

- [ ] **Step 5: Run commit and backend regression tests**

Run:

```bash
cd src-tauri
cargo test hook_runner::tests -- --nocapture
cargo test commands::commit working_tree -- --nocapture
cargo test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/hook_runner/mod.rs src-tauri/src/commands/commit.rs src-tauri/src/repo_manager/mod.rs
git commit -m "feat: run pre-commit for ordinary commits"
```

---

### Task 4: Gate Branch Pushes With `pre-push`

**Files:**
- Modify: `src-tauri/src/hook_runner/mod.rs`
- Modify: `src-tauri/src/commands/remote.rs`
- Modify: `src-tauri/src/remote_ops/mod.rs`
- Modify: `src-tauri/src/repo_manager/mod.rs`

**Interfaces:**
- Produces: `PushHookInput { hook_path, remote_name, remote_url, local_ref, local_oid, remote_ref, remote_oid }`
- Produces: `prepare_pre_push(repo, remote_name, branch, advertised_remote_oid) -> anyhow::Result<Option<PushHookInput>>`
- Produces: `run_pre_push(app, metadata, input) -> anyhow::Result<()>`
- Produces: `remote_branch_oid(repo, remote_name, branch, token) -> anyhow::Result<Oid>`
- Changes Tauri command: `push_branch(repo_path: String, remote_name: Option<String>, branch: Option<String>, app_handle: AppHandle, state: State<'_, AppState>) -> async Result<(), String>`

- [ ] **Step 1: Write failing hook discovery and input tests**

Add:

```rust
#[cfg(unix)]
#[test]
fn pre_push_honors_core_hooks_path_and_builds_git_input() {
    let fixture = PushFixture::new();
    fixture.configure_hooks_path(".custom-hooks");
    fixture.install_hook(
        ".custom-hooks/pre-push",
        "#!/bin/sh\ncat > .git/pre-push-stdin\nprintf '%s\\n%s\\n' \"$1\" \"$2\" > .git/pre-push-args\n",
    );
    let input = prepare_pre_push(
        &fixture.repo(),
        "origin",
        "main",
        fixture.remote_oid(),
    )
        .unwrap()
        .unwrap();
    assert_eq!(input.remote_name, "origin");
    assert_eq!(input.remote_url, fixture.remote_url());
    assert_eq!(input.local_ref, "refs/heads/main");
    assert_eq!(input.local_oid, fixture.local_oid());
    assert_eq!(input.remote_ref, "refs/heads/main");
}

#[test]
fn first_push_uses_zero_remote_oid() {
    let fixture = PushFixture::without_remote_branch();
    let input = prepare_pre_push(
        &fixture.repo(),
        "origin",
        "main",
        git2::Oid::zero(),
    )
        .unwrap()
        .unwrap();
    assert_eq!(input.remote_oid, "0000000000000000000000000000000000000000");
}

#[cfg(unix)]
#[test]
fn missing_or_non_executable_pre_push_is_skipped() {
    let fixture = PushFixture::new();
    assert!(prepare_pre_push(
        &fixture.repo(),
        "origin",
        "main",
        fixture.remote_oid(),
    )
    .unwrap()
    .is_none());
    fixture.install_non_executable_hook("pre-push", "#!/bin/sh\nexit 1\n");
    assert!(prepare_pre_push(
        &fixture.repo(),
        "origin",
        "main",
        fixture.remote_oid(),
    )
    .unwrap()
    .is_none());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd src-tauri
cargo test hook_runner::tests -- --nocapture
```

Expected: compilation fails because push preparation is not implemented.

- [ ] **Step 3: Implement Git-compatible discovery and stdin**

Resolve `core.hooksPath` through `repo.config()?.get_path("core.hooksPath")`.
Relative configured paths are relative to the worktree; without the setting,
use `repo.path().join("hooks/pre-push")`. On Unix require an executable regular
file via `PermissionsExt::mode() & 0o111 != 0`; on Windows follow Git for
Windows by treating an existing regular hook file as runnable.

Resolve:

```rust
let local_ref = format!("refs/heads/{branch}");
let remote_ref = format!("refs/heads/{branch}");
let local_oid = repo.refname_to_id(&local_ref)?;
let remote_oid = advertised_remote_oid;
```

Write exactly:

```rust
format!("{local_ref} {local_oid} {remote_ref} {remote_oid}\n")
```

to hook stdin. Invoke the hook directly with remote name and URL as its two
arguments.

For HTTPS, obtain `advertised_remote_oid` from the remote's advertised heads,
using the same token credential callback as the existing push. Match
`refs/heads/<branch>` and use `Oid::zero()` only when the advertised list has
no such ref. Do not substitute the local remote-tracking ref: it may be stale
and is not the value native Git supplies to `pre-push`.

For SSH, retain the existing CLI push path and let `git push` discover and run
`pre-push` natively. Stream that CLI child's output through the common runner;
add `--no-verify` only when the repository's `pre-push` preference is disabled.
Do not manually run the hook before an SSH CLI push, because that would execute
it twice.

- [ ] **Step 4: Add a transport seam and failure-gate test**

Extract the existing branch transport body in `remote_ops` behind:

```rust
pub trait PushTransport {
    fn push(
        &self,
        repo: &Repository,
        remote_name: &str,
        branch: &str,
        token: Option<&str>,
    ) -> anyhow::Result<()>;
}
```

`DefaultPushTransport` contains the current SSH CLI/HTTPS `git2` behavior
unchanged. Add a command-layer helper generic over this trait and test:

```rust
#[test]
fn failed_pre_push_never_calls_transport() {
    let transport = RecordingPushTransport::default();
    let result = push_with_hook_for_test(&fixture, &transport);
    assert!(result.is_err());
    assert_eq!(transport.call_count(), 0);
}
```

Also test success and opt-out each call transport exactly once.

- [ ] **Step 5: Make `push_branch` asynchronous and path-addressed**

Capture host, branch, token, preferences, and remote URL for `repo_path`.
Acquire the repository run guard, then use `spawn_blocking`. For HTTPS, query
the advertised remote branch OID, run the manual hook, and invoke the existing
`git2` transport. For SSH, stream the existing CLI push and rely on its native
hook invocation/`--no-verify`. Emit a single start/finish lifecycle covering
the complete path. On hook failure use summary
`pre-push failed; review hook output`; on transport failure use
`push failed after pre-push completed`.

- [ ] **Step 6: Run push and full backend tests**

Run:

```bash
cd src-tauri
cargo test hook_runner::tests -- --nocapture
cargo test commands::remote remote_ops -- --nocapture
cargo test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/hook_runner/mod.rs src-tauri/src/commands/remote.rs src-tauri/src/remote_ops/mod.rs src-tauri/src/repo_manager/mod.rs
git commit -m "feat: run pre-push before branch pushes"
```

---

### Task 5: Add the Repository-Scoped Frontend Hook Store

**Files:**
- Create: `src/types/hooks.ts`
- Create: `src/stores/hookStore.ts`
- Create: `src/stores/__tests__/hookStore.test.ts`

**Interfaces:**
- Consumes backend events from Tasks 2–4
- Produces: `initHookListeners() -> Promise<() => void>`
- Produces store actions: `started`, `appendOutput`, `finished`, `setPaneVisible`, `setFollowing`, `clearRepo`
- Produces selector: `selectHookRun(repoPath: string | null)`

- [ ] **Step 1: Define payload types and failing store tests**

Create `src/types/hooks.ts`:

```ts
export type HookName = "pre-commit" | "pre-push";
export type HookRunStatus = "idle" | "running" | "succeeded" | "failed";
export type HookStream = "stdout" | "stderr";

export interface HookPreferences {
  preCommit: boolean;
  prePush: boolean;
}

export interface HookStarted {
  repoPath: string;
  runId: string;
  hook: HookName;
  operation: "commit" | "push";
}

export interface HookOutput {
  repoPath: string;
  runId: string;
  stream: HookStream;
  chunk: string;
}

export interface HookFinished {
  repoPath: string;
  runId: string;
  hook: HookName;
  outcome: "succeeded" | "failed";
  exitCode: number | null;
  summary: string;
}
```

In `hookStore.test.ts`, assert:

```ts
it("isolates repositories and rejects stale events", () => {
  const store = useHookStore.getState();
  store.started(started("/a", "run-2"));
  store.appendOutput(output("/a", "run-1", "stale"));
  store.appendOutput(output("/b", "run-2", "other"));
  store.appendOutput(output("/a", "run-2", "current"));
  expect(useHookStore.getState().runs["/a"].chunks.map((c) => c.chunk)).toEqual(["current"]);
  expect(useHookStore.getState().runs["/b"]).toBeUndefined();
});

it("opens on start, preserves output while hidden, and clears one repo", () => {
  const store = useHookStore.getState();
  store.started(started("/a", "run-1"));
  store.setPaneVisible("/a", false);
  store.appendOutput(output("/a", "run-1", "kept"));
  expect(useHookStore.getState().runs["/a"].paneVisible).toBe(false);
  expect(useHookStore.getState().runs["/a"].chunks[0].chunk).toBe("kept");
  store.clearRepo("/a");
  expect(useHookStore.getState().runs["/a"]).toBeUndefined();
});
```

Add a truncation test that appends chunks beyond `MAX_RETAINED_OUTPUT` and
asserts the newest content plus exactly one truncation notice remains.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:unit -- src/stores/__tests__/hookStore.test.ts
```

Expected: fails because `hookStore` does not exist.

- [ ] **Step 3: Implement the store and listeners**

Use:

```ts
export const MAX_RETAINED_OUTPUT = 1024 * 1024;
export const TRUNCATION_NOTICE = "\r\n[Earlier hook output truncated]\r\n";

export interface HookChunk {
  stream: HookStream;
  chunk: string;
}

export interface RepoHookRun {
  runId: string | null;
  hook: HookName | null;
  operation: "commit" | "push" | null;
  status: HookRunStatus;
  chunks: HookChunk[];
  retainedLength: number;
  summary: string | null;
  paneVisible: boolean;
  following: boolean;
}
```

On `started`, replace the repository entry with an open, following, empty
running state. On output/finish, require matching path and run ID. Truncate
oldest whole chunks until the cap fits, then insert the notice once.

`initHookListeners` subscribes to all three event names with Tauri `listen` and
returns one cleanup function that invokes every unlisten function.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run test:unit -- src/stores/__tests__/hookStore.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/hooks.ts src/stores/hookStore.ts src/stores/__tests__/hookStore.test.ts
git commit -m "feat: track hook runs per repository"
```

---

### Task 6: Add Per-Repository Hook Settings

**Files:**
- Create: `src/components/Settings/GitHooksSettings.tsx`
- Create: `src/components/Settings/GitHooksSettings.test.tsx`
- Modify: `src/components/Settings/SettingsView.tsx`

**Interfaces:**
- Consumes: `get_hook_preferences`, `set_hook_preferences`
- Consumes: `useRepoStore.currentRepo`
- Produces: two accessible checkboxes labeled `Run pre-commit` and `Run pre-push`

- [ ] **Step 1: Write failing component tests**

Test:

```tsx
it("explains that a repository is required", () => {
  useRepoStore.setState({ currentRepo: null });
  render(<GitHooksSettings />);
  expect(screen.getByText(/open a repository/i)).toBeInTheDocument();
});

it("loads default-on preferences for the current repository", async () => {
  useRepoStore.setState({
    currentRepo: { name: "repo", path: "/repo", headBranch: "main" },
  });
  vi.mocked(invoke).mockResolvedValueOnce({ preCommit: true, prePush: true });
  render(<GitHooksSettings />);
  expect(await screen.findByLabelText("Run pre-commit")).toBeChecked();
  expect(screen.getByLabelText("Run pre-push")).toBeChecked();
  expect(invoke).toHaveBeenCalledWith("get_hook_preferences", { repoPath: "/repo" });
});

it("persists one toggle without changing the other", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce({ preCommit: true, prePush: true })
    .mockResolvedValueOnce({ preCommit: false, prePush: true });
  render(<GitHooksSettings />);
  await userEvent.click(await screen.findByLabelText("Run pre-commit"));
  expect(invoke).toHaveBeenLastCalledWith("set_hook_preferences", {
    repoPath: "/repo",
    preferences: { preCommit: false, prePush: true },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:unit -- src/components/Settings/GitHooksSettings.test.tsx
```

Expected: fails because the component does not exist.

- [ ] **Step 3: Implement the settings component**

Load on `currentRepo.path` change, discard stale async results with a request
counter, disable toggles while loading/saving, and show a token-styled inline
error. Copy:

```text
Choose which hooks Git Wasp runs for this repository. Hooks are enabled by
default; these settings do not affect Git in a terminal or another client.
```

Do not expose settings for hooks outside scope.

- [ ] **Step 4: Add it to SettingsView**

Import and render:

```tsx
<section style={{ maxWidth: 640, marginBottom: "var(--space-6)" }}>
  <h2 style={sectionTitleStyle}>Git hooks</h2>
  <GitHooksSettings />
</section>
```

Place it immediately after Git identity.

- [ ] **Step 5: Run settings tests**

Run:

```bash
npm run test:unit -- src/components/Settings/GitHooksSettings.test.tsx src/components/Settings
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/GitHooksSettings.tsx src/components/Settings/GitHooksSettings.test.tsx src/components/Settings/SettingsView.tsx
git commit -m "feat: configure hooks per repository"
```

---

### Task 7: Build the Terminal Output Pane and Graph Footer

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/GitHooks/HookOutputPane.tsx`
- Create: `src/components/GitHooks/HookOutputPane.test.tsx`
- Create: `src/components/GitHooks/HookStatusBar.tsx`
- Create: `src/components/GitHooks/HookStatusBar.test.tsx`

**Interfaces:**
- Consumes: `useHookStore`, current repository path
- Produces: `HookOutputPane({ repoPath, height, onResize })`
- Produces: `HookStatusBar({ repoPath })`

- [ ] **Step 1: Install the read-only terminal renderer**

Run:

```bash
npm install @xterm/xterm
```

Expected: `package.json` and `package-lock.json` add `@xterm/xterm`; no shell or
PTY dependency is added.

- [ ] **Step 2: Write failing footer tests**

Cover:

```tsx
it.each([
  ["running", "Running pre-commit…"],
  ["succeeded", "pre-commit succeeded"],
  ["failed", "pre-commit failed; review hook output"],
])("shows %s state", (status, expected) => {
  seedRun("/repo", { status, hook: "pre-commit" });
  render(<HookStatusBar repoPath="/repo" />);
  expect(screen.getByText(expected)).toBeInTheDocument();
});

it("reshows retained output", async () => {
  seedRun("/repo", { status: "succeeded", paneVisible: false, chunks: [chunk("kept")] });
  render(<HookStatusBar repoPath="/repo" />);
  await userEvent.click(screen.getByRole("button", { name: "Show hook output" }));
  expect(useHookStore.getState().runs["/repo"].paneVisible).toBe(true);
});
```

- [ ] **Step 3: Implement `HookStatusBar`**

Use token colors and existing `Button`/`Spinner` primitives. The footer is
always rendered for an open repository. With no run it says `Git hooks ready`.
With retained output its button toggles `Show hook output`/`Hide hook output`.
Failure uses `var(--color-danger)`; success uses `var(--color-success)`.

- [ ] **Step 4: Write failing terminal-pane tests**

Mock `@xterm/xterm` with methods `open`, `write`, `clear`, `scrollToBottom`,
`onScroll`, and `dispose`. Verify:

```tsx
it("replays retained chunks and writes new chunks", () => {
  seedRun("/repo", { paneVisible: true, chunks: [chunk("first\r\n")] });
  const { rerender } = render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);
  expect(terminal.write).toHaveBeenCalledWith("first\r\n");
  append("/repo", "run-1", "second\r\n");
  rerender(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);
  expect(terminal.write).toHaveBeenCalledWith("second\r\n");
});

it("pauses follow when scrolled up and resumes at bottom", () => {
  terminal.buffer.active.baseY = 20;
  terminal.buffer.active.viewportY = 10;
  fireTerminalScroll();
  expect(useHookStore.getState().runs["/repo"].following).toBe(false);
  terminal.buffer.active.viewportY = 20;
  fireTerminalScroll();
  expect(useHookStore.getState().runs["/repo"].following).toBe(true);
});
```

- [ ] **Step 5: Implement `HookOutputPane`**

Import `@xterm/xterm/css/xterm.css`. Create one `Terminal` per mounted pane:

```ts
new Terminal({
  convertEol: false,
  cursorBlink: false,
  disableStdin: true,
  scrollback: 10_000,
  theme: {
    background: resolvedToken("--color-bg-app"),
    foreground: resolvedToken("--color-text-primary"),
  },
});
```

Track how many retained chunks have been written; reset/clear and replay if
truncation or run replacement shortens/changes the prefix. Call
`scrollToBottom()` only while `following` is true. Use a horizontal
`ResizeHandle` above the pane, a close button, and a `Follow output` button
while following is paused. Clamp height to 100–480 px in the App integration.

- [ ] **Step 6: Run component tests**

Run:

```bash
npm run test:unit -- src/components/GitHooks
```

Expected: all tests pass without a canvas/terminal DOM error.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/components/GitHooks
git commit -m "feat: show hook output in terminal pane"
```

---

### Task 8: Wire Events, Layout, and Repository-Scoped Action Locks

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/stores/workingTreeStore.ts`
- Modify: `src/stores/remoteStore.ts`
- Modify: `src/stores/repoStore.ts`
- Modify: `src/components/WorkingTree/CommitForm.tsx`
- Modify: `src/components/WorkingTree/CommitForm.test.tsx`
- Modify: `src/components/CommitGraph/HistoryToolbar.tsx`
- Modify: `src/components/CommitGraph/HistoryToolbar.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–7
- Changes invoke payloads: `create_commit({ repoPath, message })`, `push_branch({ repoPath, remoteName, branch })`
- Produces: hook pane/footer mounted inside the history graph column

- [ ] **Step 1: Write failing store payload tests**

In existing store tests assert:

```ts
useRepoStore.setState({
  currentRepo: { name: "repo", path: "/repo", headBranch: "main" },
});
await useWorkingTreeStore.getState().createCommit("message");
expect(invoke).toHaveBeenCalledWith("create_commit", {
  repoPath: "/repo",
  message: "message",
});

await useRemoteStore.getState().push();
expect(invoke).toHaveBeenCalledWith("push_branch", {
  repoPath: "/repo",
  remoteName: null,
  branch: null,
});
```

Reject with `No repository is open` if there is no current repository.

- [ ] **Step 2: Update the store invoke payloads**

Capture `useRepoStore.getState().currentRepo?.path` synchronously before the
invoke. This prevents a tab switch during the await from retargeting backend
work. Preserve existing post-success refresh behavior.

- [ ] **Step 3: Write failing control-lock tests**

For `CommitForm`, seed a running hook state for `/repo` and assert the ordinary
commit button is disabled and says `Running pre-commit…`. Assert amend remains
disabled during any repository hook-aware operation to avoid concurrent index
mutation, but its label remains `Amend`.

For `HistoryToolbar`, assert push is disabled and says `Running pre-push…` for
`/repo`, then switch `currentRepo` to `/other` and assert it is enabled.

- [ ] **Step 4: Implement repository-scoped control locks**

Select only:

```ts
const repoHookRunning = useHookStore(
  (s) => currentRepo ? s.runs[currentRepo.path]?.status === "running" : false,
);
const runningHook = useHookStore(
  (s) => currentRepo ? s.runs[currentRepo.path]?.hook ?? null : null,
);
```

Fold `repoHookRunning` into CommitForm `canCommit`, detached commit recovery
buttons, amend, reset, and HistoryToolbar push/pull/fetch/new-branch controls
that could conflict with the same repository. Do not inspect another
repository's state.

- [ ] **Step 5: Write failing App lifecycle/layout tests**

Mock `initHookListeners` and assert it is called once after boot and its cleanup
is called on unmount. With an active history repository and a visible run,
assert `HookOutputPane` and `HookStatusBar` render. Assert neither renders on
Welcome, PR, Settings, or full-screen merge views.

- [ ] **Step 6: Mount listeners and hook UI**

Initialize event listeners in an App effect:

```ts
useEffect(() => {
  let cleanup: (() => void) | undefined;
  let cancelled = false;
  void initHookListeners().then((unlisten) => {
    if (cancelled) unlisten();
    else cleanup = unlisten;
  });
  return () => {
    cancelled = true;
    cleanup?.();
  };
}, []);
```

In the history graph column, wrap the current graph/diff body in the existing
flex area, then render visible `HookOutputPane` below it and `HookStatusBar` as
the last child. Persist height with:

```ts
const [hookPaneHeight, setHookPaneHeight] = usePersistedSize(
  "hookOutputPaneHeight",
  180,
  100,
  480,
);
```

Use the repository path as the pane/status key.

- [ ] **Step 7: Clear closed repository state**

After `close_repo` succeeds, call:

```ts
useHookStore.getState().clearRepo(path);
```

Do not clear state on tab activation; switching back must show retained output.

- [ ] **Step 8: Run focused frontend tests**

Run:

```bash
npm run test:unit -- src/stores/__tests__/workingTreeStore.test.ts src/stores/__tests__/remoteStore.test.ts src/components/WorkingTree/CommitForm.test.tsx src/components/CommitGraph/HistoryToolbar.test.tsx src/App.test.tsx
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/stores/workingTreeStore.ts src/stores/remoteStore.ts src/stores/repoStore.ts src/components/WorkingTree/CommitForm.tsx src/components/WorkingTree/CommitForm.test.tsx src/components/CommitGraph/HistoryToolbar.tsx src/components/CommitGraph/HistoryToolbar.test.tsx
git commit -m "feat: integrate hook status with repository workflows"
```

---

### Task 9: Cross-Platform Verification and Backlog Completion

**Files:**
- Modify: `TODO.md`
- Modify: `DONE.md`

**Interfaces:**
- Consumes: all prior tasks
- Produces: verified feature and accurate project backlog

- [ ] **Step 1: Run formatting and static checks**

Run:

```bash
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -D warnings
cd ..
npm run lint
npm run build:web
```

Expected: every command exits 0 with no warnings treated as errors.

- [ ] **Step 2: Run all automated tests**

Run:

```bash
cd src-tauri
cargo test
cd ..
npm run test:unit
```

Expected: all Rust and frontend tests pass.

- [ ] **Step 3: Perform a real-repository smoke test**

Create a disposable repository and verify:

```bash
tmp_repo="$(mktemp -d)"
git -C "$tmp_repo" init
git -C "$tmp_repo" config user.name "Git Wasp Test"
git -C "$tmp_repo" config user.email "git-wasp@example.test"
printf 'base\n' > "$tmp_repo/file.txt"
git -C "$tmp_repo" add file.txt
git -C "$tmp_repo" commit -m base
```

Open it in Git Wasp, install executable `pre-commit` and `pre-push` hooks that
print progress and sleep briefly, then verify:

1. the pane opens and follows output;
2. hiding/showing retains content;
3. the footer and controls reflect running/success/failure;
4. a failing `pre-commit` leaves staged changes and no new commit;
5. disabling `pre-commit` for this repository permits the commit;
6. another open repository remains usable during the sleep;
7. failed `pre-push` prevents remote update;
8. disabling `pre-push` permits the existing push path.

Expected: all eight behaviors match the approved specification.

- [ ] **Step 4: Move the completed backlog item**

Remove the full line-21 item from `TODO.md` and add it under
`## Working tree & committing` in `DONE.md`, changing `[ ]` to `[x]` and
preserving its complete description. Do not move the separate engineering item
at TODO line 61; that item concerns hooks for developing Git Wasp itself.

- [ ] **Step 5: Run the final diff and status review**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only intended feature/backlog files are
modified. Confirm pre-existing unrelated untracked files remain untouched.

- [ ] **Step 6: Commit**

```bash
git add TODO.md DONE.md
git commit -m "docs: mark git hooks support complete"
```
