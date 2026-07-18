# Repository Git Hooks Design

## Goal

Add tracked Git hooks for this repository that:

- format staged frontend and Rust files before a commit;
- lint staged frontend source files before a commit; and
- require the complete frontend and Rust test suites to pass before a push.

The hooks must preserve unstaged portions of partially staged files and must be installed automatically as part of the repository's existing frontend dependency setup.

## Tooling and Installation

Use Husky to install and manage tracked hooks, lint-staged to operate safely on the staged snapshot, and Prettier as the frontend formatter.

Add Husky, lint-staged, and Prettier as development dependencies. Add a `prepare` package script that installs the tracked hooks when a developer runs `npm install`. Store the hook entry points in:

- `.husky/pre-commit`
- `.husky/pre-push`

The repository will not write developer-specific hook files directly into `.git/hooks` and will not require global Git configuration.

## Pre-commit Hook

The pre-commit hook invokes lint-staged.

lint-staged will:

1. protect unstaged portions of partially staged files;
2. run Prettier on staged frontend and repository text files with supported extensions;
3. run Rustfmt with Rust 2021 semantics on staged Rust files beneath `src-tauri/`;
4. run ESLint only on staged TypeScript and TSX files beneath `src/`; and
5. re-stage successful formatting changes.

Frontend formatting covers staged TypeScript, TSX, JavaScript, JSX, JSON, CSS, and Markdown files. Frontend linting covers staged `src/**/*.ts` and `src/**/*.tsx` files. Backend formatting covers staged `src-tauri/**/*.rs` files.

Direct argument passing through lint-staged will be used so filenames are not interpolated into ad-hoc shell command strings.

If formatting or linting fails, lint-staged restores the protected working and index state, prints the underlying command output, returns a non-zero status, and blocks the commit.

## Pre-push Hook

The pre-push hook runs these commands sequentially and fails fast:

1. `npm run test:unit -- --dir src --testTimeout=15000`
2. `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features`

The explicit frontend test directory prevents nested local worktrees from being discovered as duplicate suites. A frontend failure prevents the Rust suite from starting. Any non-zero status blocks the push and preserves the original test output.

The hooks do not add a custom bypass. Git's standard deliberate `--no-verify` escape hatch remains available.

## Package Scripts and Configuration

Hook commands and lint-staged configuration will live in `package.json` so developers can inspect and invoke the behavior without reading hook internals. The Husky hook files remain thin entry points into those package scripts.

The implementation will avoid unrelated formatter-driven repository rewrites: formatting runs only against staged matching files during commits.

## Verification

Verification will exercise both the commands and the actual hooks:

- stage a disposable frontend file and confirm Prettier and ESLint run;
- confirm formatter changes are re-staged;
- confirm an unstaged portion of a partially staged file remains unstaged;
- stage a disposable Rust file and confirm Rustfmt runs and re-stages its change;
- stage deliberately invalid frontend input and confirm pre-commit blocks while leaving the index and working tree recoverable;
- invoke the pre-push hook and confirm both complete test suites pass;
- run the repository's existing lint and web-build checks; and
- confirm the final working tree contains no unintended changes.

Disposable verification fixtures will not be committed.

## Contributor Documentation

Add a short contributor-facing section to the root `README.md` covering:

- hooks are installed by `npm install`;
- pre-commit formats and lints staged files;
- pre-push runs both complete test suites; and
- `--no-verify` is available only as Git's standard deliberate emergency bypass.
