# Task 2 Report: Repository-Scoped Hook Runs and Streaming Events

## Status

Implemented the Task 2 event protocol, per-repository RAII run registry, unique
run IDs, and shell-free streaming command primitive. Commit and push behavior
was intentionally left unchanged.

## RED evidence

Command:

```text
cd src-tauri
cargo test hook_runner::tests -- --nocapture
```

Initial result: exit 101. Compilation failed with the expected missing feature
errors:

```text
cannot find function `decode_output` in this scope
cannot find type `RunRegistry` in this scope
```

After the first minimal green cycle, two further tests were added for unique run
IDs and the exact serialized frontend event contract. Their RED run exited 101
with the expected missing `HookStarted`, `HookOutput`, `HookFinished`,
`HookName`, `HookStream`, `HookOutcome`, and `HookRunGuard::run_id`.

## GREEN evidence

Focused command:

```text
cd src-tauri
cargo test hook_runner::tests -- --nocapture
```

Result: exit 0; 4 passed, 0 failed.

Covered behavior:

- invalid UTF-8 is decoded with replacement characters;
- concurrent hook-aware operations are rejected only for the same repository;
- dropping the guard releases the repository;
- run IDs are unique within the process;
- started/output/finished payloads serialize with the exact camel-case fields
  and kebab-case hook names expected by the frontend.

Full command, run once as requested:

```text
cd src-tauri
cargo test
```

Result: exit 101; 288 passed, 27 failed, 5 ignored. All Task 2 tests passed.
The 27 failures were outside Task 2 and caused by the managed sandbox:
`httpmock` tests could not bind `127.0.0.1:0` (`PermissionDenied`), and one
file-watcher test timed out waiting for watcher readiness. Outside-sandbox
permission is needed for a meaningful full-suite rerun.

`git diff --check` passed.

## Implementation

- Added stable `git-hook://started`, `git-hook://output`, and
  `git-hook://finished` event names and serializable payload contracts.
- Added process-unique run ID prefixes (PID plus process start timestamp) and an
  atomic sequence counter without adding a dependency.
- Added a clone-backed `RunRegistry` using `Arc<Mutex<HashSet<String>>>` and a
  `HookRunGuard` whose `Drop` releases its repository.
- Stored exactly one registry on `AppState` and exposed
  `AppState::begin_hook_run`.
- Added `stream_command` over `std::process::Command` with piped stdout/stderr,
  optional piped stdin, separate 4 KiB reader threads, and no shell.
- Reader threads send tagged byte chunks to one coordinator. Only that
  coordinator calls `AppHandle::emit`, preserving byte/chunk order within each
  stream while serializing cross-stream event arrival.
- Returned `std::process::Output` with the real exit status and empty buffers,
  because bytes have already been emitted.

## Files

- `src-tauri/src/hook_runner/mod.rs` (new)
- `src-tauri/src/repo_manager/mod.rs`
- `src-tauri/src/lib.rs`

## Self-review

- Scope stayed within the event protocol, registry, run IDs, and generic
  streaming primitive; no commit or push paths were modified.
- No `sh -c`, `cmd /C`, command-string interpolation, UUID dependency, or
  concurrent emitter calls were introduced.
- The original repository-scoped guard test matches the brief verbatim.
- Event serialization was checked directly against the Task 5 TypeScript
  contract.
- Existing unrelated worktree changes were not present and no unrelated source
  file was edited.

## Concerns

- Full-suite verification remains incomplete under the managed sandbox due to
  denied localhost socket binding and watcher readiness; an unrestricted rerun
  is required.
- `cargo fmt -- --check` reports pre-existing formatting differences across
  unrelated files. The new hook runner file was formatted directly with
  `rustfmt`, and `git diff --check` is clean.
- The new public primitives are intentionally unused until Tasks 3 and 4 wire
  commit and push behavior, so Rust emits expected dead-code warnings.

## Review fixes

All Important findings and the Minor child-lifecycle finding were addressed.

- `AppState::begin_hook_run` now calls Task 1's `require_open_repo_key` before
  acquiring the registry guard. Only the exact open-tab key enters the
  registry; aliases, trailing-dot paths, symlinks, and unopened paths cannot
  establish a second identity.
- Each reader now carries incomplete UTF-8 bytes between reads. Valid
  multibyte characters survive arbitrary boundaries, invalid sequences emit
  replacement characters, and an incomplete EOF tail is flushed lossily.
- Added an execution-level test using the Rust test executable itself as the
  child (no shell). It verifies caller cwd, stdin delivery, stdout/stderr
  labels and chunks, non-zero exit status, started-event ordering, and
  coordinator emission through a mock Tauri app.
- Reader, stdin, and output-emission errors now kill the child immediately;
  every post-spawn streaming path calls `wait` before returning.

### Review-fix RED evidence

Command:

```text
cd src-tauri
cargo test hook_runner::tests -- --nocapture
```

Initial result: exit 101. The new execution-level test required a runtime-
generic `AppHandle` (`expected &AppHandle, found &AppHandle<MockRuntime>`).
After resolving test scaffolding, the streaming regression failed because the
old reader exposed raw per-read byte chunks, demonstrating that it could not
preserve split UTF-8.

The repository-identity regression was added under
`repo_manager::tests::hook_runs_require_and_share_the_open_normalized_repository_key`;
the pre-fix implementation passed arbitrary caller strings directly to
`RunRegistry::begin`, so it did not enforce Task 1's open normalized key.

### Review-fix GREEN evidence

Focused commands:

```text
cd src-tauri
cargo test hook_runner::tests -- --nocapture
cargo test repo_manager::tests::hook_runs_require_and_share_the_open_normalized_repository_key -- --nocapture
```

Results: exit 0; hook runner 7 passed, 0 failed; normalized repository identity
1 passed, 0 failed.

Full command (rerun outside the managed sandbox so localhost mock servers and
the file watcher could operate):

```text
cd src-tauri
cargo test
```

Result: exit 0; 319 passed, 0 failed, 5 ignored. `git diff --check` also passed.

The earlier sandbox-only full-suite concern is therefore resolved. Existing
dead-code and deprecated-API warnings remain unrelated to this fix.
