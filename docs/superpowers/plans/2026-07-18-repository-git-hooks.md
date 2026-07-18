# Repository Git Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatically installed repository hooks that format and lint staged files before commits and require both complete test suites to pass before pushes.

**Architecture:** Husky owns the tracked hook entry points and installs them through npm's `prepare` lifecycle. lint-staged protects partially staged files, passes staged filenames directly to Prettier, ESLint, and Rustfmt, and runs those tasks serially so formatting finishes before linting. The pre-push hook invokes explicit package scripts for the frontend and Rust suites.

**Tech Stack:** Husky, lint-staged, Prettier, ESLint, Rustfmt, Vitest, Cargo

## Global Constraints

- Preserve unstaged portions of partially staged files.
- Format only staged matching files; do not perform a repository-wide formatting rewrite.
- Frontend formatting covers staged `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.json`, `*.css`, and `*.md` files.
- Frontend linting covers only staged `src/**/*.ts` and `src/**/*.tsx` files.
- Backend formatting covers only staged `src-tauri/**/*.rs` files and uses Rust 2021 semantics.
- Pre-push runs `npm run test:unit -- --dir src --testTimeout=15000` before `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` and fails fast.
- Hook failures preserve the underlying tool output and non-zero exit status.
- Git's standard `--no-verify` behavior remains unchanged.

---

### Task 1: Install and configure the staged-file pre-commit hook

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.husky/pre-commit`

**Interfaces:**
- Consumes: npm's `prepare` lifecycle and the existing root ESLint configuration.
- Produces: `npm run hooks:pre-commit`, which runs lint-staged serially; an installed `pre-commit` Git hook that invokes that script.

- [ ] **Step 1: Capture the failing installation check**

Run:

```bash
test "$(git config --get core.hooksPath)" = ".husky/_"
test -x .husky/pre-commit
npm run hooks:pre-commit
```

Expected: at least one command fails because Husky and the pre-commit script are not configured yet.

- [ ] **Step 2: Install the exact development tools**

Run:

```bash
npm install --save-dev husky lint-staged prettier
```

Expected: `package.json` and `package-lock.json` contain Husky, lint-staged, and Prettier under development dependencies.

- [ ] **Step 3: Add package scripts and staged-file configuration**

Add the following entries to `package.json`'s `scripts` object:

```json
"prepare": "husky",
"hooks:pre-commit": "lint-staged --concurrent false",
"hooks:pre-push": "npm run test:unit -- --dir src --testTimeout=15000 && cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features"
```

Add this top-level lint-staged configuration. Object insertion order is intentional because `--concurrent false` makes Prettier complete before ESLint sees matching TypeScript files:

```json
"lint-staged": {
  "*.{ts,tsx,js,jsx,json,css,md}": "prettier --write",
  "src/**/*.{ts,tsx}": "eslint --max-warnings 0",
  "src-tauri/**/*.rs": "rustfmt --edition 2021"
}
```

- [ ] **Step 4: Create and install the tracked pre-commit hook**

Create `.husky/pre-commit` with exactly:

```sh
npm run hooks:pre-commit
```

Then run:

```bash
npm run prepare
chmod +x .husky/pre-commit
```

Expected: `git config --get core.hooksPath` prints `.husky/_`.

- [ ] **Step 5: Verify frontend formatting, linting, and partial-stage protection**

Create a temporary tracked fixture:

```bash
mkdir -p src/hook-fixtures
printf 'export const stagedValue={answer:42}\\n' > src/hook-fixtures/preCommitFixture.ts
git add src/hook-fixtures/preCommitFixture.ts
printf 'export const unstagedValue={answer:43}\\n' >> src/hook-fixtures/preCommitFixture.ts
.husky/pre-commit
```

Expected:

- the hook exits zero;
- `git show :src/hook-fixtures/preCommitFixture.ts` contains formatted `stagedValue` only;
- the working file still contains `unstagedValue`; and
- `git diff -- src/hook-fixtures/preCommitFixture.ts` shows the unstaged addition.

Clean up without disturbing other repository changes:

```bash
git reset -- src/hook-fixtures/preCommitFixture.ts
rm src/hook-fixtures/preCommitFixture.ts
rmdir src/hook-fixtures
```

- [ ] **Step 6: Verify Rust formatting**

Create a temporary staged Rust fixture:

```bash
mkdir -p src-tauri/src/hook_fixtures
printf 'pub fn staged_value()->i32{42}\\n' > src-tauri/src/hook_fixtures/pre_commit_fixture.rs
git add src-tauri/src/hook_fixtures/pre_commit_fixture.rs
.husky/pre-commit
```

Expected: `git show :src-tauri/src/hook_fixtures/pre_commit_fixture.rs` contains Rustfmt-formatted output.

Clean up:

```bash
git reset -- src-tauri/src/hook_fixtures/pre_commit_fixture.rs
rm src-tauri/src/hook_fixtures/pre_commit_fixture.rs
rmdir src-tauri/src/hook_fixtures
```

- [ ] **Step 7: Verify failure recovery**

Create and stage invalid frontend input:

```bash
mkdir -p src/hook-fixtures
printf 'export const broken: = 1\\n' > src/hook-fixtures/invalidFixture.ts
git add src/hook-fixtures/invalidFixture.ts
.husky/pre-commit
```

Expected: the hook exits non-zero with Prettier or ESLint output, the fixture remains present in both the index and working tree, and unrelated files are unchanged.

Clean up:

```bash
git reset -- src/hook-fixtures/invalidFixture.ts
rm src/hook-fixtures/invalidFixture.ts
rmdir src/hook-fixtures
```

- [ ] **Step 8: Re-run the installation check and commit**

Run:

```bash
test "$(git config --get core.hooksPath)" = ".husky/_"
test -x .husky/pre-commit
npm run hooks:pre-commit
git diff --check
```

Expected: all commands exit zero when no matching files are staged.

Commit:

```bash
git add package.json package-lock.json .husky/pre-commit
git commit -m "chore: add staged pre-commit checks"
```

### Task 2: Add the pre-push test gate and contributor documentation

**Files:**
- Create: `.husky/pre-push`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `hooks:pre-push` package script created in Task 1.
- Produces: an installed `pre-push` Git hook that runs both complete suites; contributor documentation for installation and bypass behavior.

- [ ] **Step 1: Capture the failing pre-push hook check**

Run:

```bash
test -x .husky/pre-push
```

Expected: FAIL because the tracked pre-push hook does not exist yet.

- [ ] **Step 2: Create the tracked pre-push hook**

Create `.husky/pre-push` with exactly:

```sh
npm run hooks:pre-push
```

Then run:

```bash
chmod +x .husky/pre-push
```

- [ ] **Step 3: Document repository hooks**

Append this section to the root `README.md`:

```markdown
## Git hooks

Running `npm install` installs the repository's tracked Git hooks through Husky.

- **Pre-commit:** formats staged frontend and Rust files, then lints staged frontend source files. Partially staged files keep their unstaged edits out of the commit.
- **Pre-push:** runs the complete frontend and Rust test suites and blocks the push if either suite fails.

Git's standard `--no-verify` option bypasses these checks when an operator deliberately needs the emergency escape hatch.
```

- [ ] **Step 4: Run the pre-push hook**

Run:

```bash
.husky/pre-push
```

Expected:

- 104 frontend test files pass with 920 tests;
- 339 Rust tests pass and 5 performance tests are ignored; and
- the hook exits zero.

- [ ] **Step 5: Run repository verification**

Run:

```bash
npm run lint
npm run build:web
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
git diff --check
git status --short
```

Expected: lint, build, formatting check, Clippy, and diff check exit zero. Status lists only the intended hook and README changes plus any pre-existing unrelated untracked files.

- [ ] **Step 6: Commit**

```bash
git add .husky/pre-push README.md
git commit -m "chore: test before pushing"
```

