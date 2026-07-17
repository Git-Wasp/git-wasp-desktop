# Performance Baseline

Companion to `.reviews/perf-review.md` (Phase 0, Task 0). Numbers here are
produced by `scripts/make-bench-repo.sh` plus a set of `#[ignore]`d Rust
"bench" tests that open the generated repo directly and time the real backend
functions with `std::time::Instant` — not the criterion-style `benches/`
micro-benchmarking harness, and not manual DevTools Performance-panel capture
(that requires driving the actual GUI app interactively, which isn't
practical in an agent session). The bench tests live next to the code they
measure, are `#[ignore]`d so they never run in normal `cargo test`, and are
re-run the same way after each optimisation lands:

```bash
BENCH_REPO_PATH=/path/to/bench-repo cargo test --release -- --ignored --nocapture bench_
```

## Bench repo

Generated with `scripts/make-bench-repo.sh <dest> <commits> <files>`. The
plan's suggested defaults (50,000 commits / 2,000 files) were reduced for
dev-machine turnaround — the generator shells out to `git commit` once per
commit, so 50k commits would take on the order of 20+ minutes. Actual repo
used for the numbers below:

| Parameter | Value |
|---|---|
| Commits | 10,000 |
| Files | 1,000 |
| Branches | 20 (one every 500 commits) |
| Generation time | ~3.7 min |

Reproduce with:
```bash
scripts/make-bench-repo.sh /tmp/bench-monorepo 10000 1000
```

## Scenario coverage

The plan's five Phase-0 scenarios, and how each is measured here:

| # | Scenario | Covered by |
|---|---|---|
| 1 | First graph paint after open | `graph::layout::tests::bench_graph_layout` (cold call) |
| 2 | "Stage all" on ~1000 files | `working_tree::tests::bench_stage_all_files` |
| 3 | Scroll from top to row ~5000 | `graph::layout::tests::bench_graph_layout` (warm viewport + re-request burst) |
| 4 | `list_branches` refresh (100+ branches) | `repo_manager::tests::bench_list_branches` (20 branches — see note) |
| 5 | Opening commit detail for a 1000-file commit | `diff_engine::tests::bench_commit_detail_large_changeset` (seed commit, 1000 files) |

Note on #4: the bench repo has 20 branches (one per 500 commits at this
reduced scale), not 100+. `list_branches`' cost is dominated by
`compute_ahead_behind` walking each branch against upstream/HEAD, so the
number below should be read as "cost per branch × branch count" rather than
a fixed number — it scales roughly linearly with branch count.

## Results

Measured on the 10,000-commit / 1,000-file / 21-branch bench repo above,
release build (`cargo test --release`).

| Scenario | Before | After-target | Actual-after |
|---|---|---|---|
| First graph paint (cold, rows 0-100 of 10,002) | 183.1ms | sub-scenario of B2; watch this scale on larger repos, not necessarily reduced at this size | |
| Stage all ~1000 files (current per-file loop: `stage_file` × 1000, each a full index write + full status rescan) | **2.444s** (2.466s on re-run) | one index write + one status rescan total (Task A3) | **127.5ms** (~19x) |
| Warm viewport fetch, scroll to row 5000 | 252.6µs | unchanged — already cheap once cached | |
| 10× viewport re-requests, no ref change (per-scroll ref-fingerprint cost) | 1.636ms / 10 calls (~164µs/call) | fingerprint reused, not recomputed, when Task B2 lands | |
| `list_branches`, 21 branches (`compute_ahead_behind` per branch) | 7.863ms (~0.37ms/branch) | near-instant list; ahead/behind fetched lazily per-branch on demand (Task B3) | |
| `get_working_tree_status`, 1000 unstaged files | 3.394ms | n/a — not a target of this plan, recorded as context for the stage-all number | |
| `get_commit_detail`, 1000-file seed commit | 25.566ms | single diff pass, same result (Task B5) | |

**Read for what it says, not more:** at only 10k commits / 21 branches the
graph-layout and list_branches numbers are already small in absolute terms —
the point of Tasks B2/B3 is that they scale with commit/branch count (or, for
B2, with *ref-touching operations* like fetch), so the payoff shows up on the
50k–200k-commit / 100+-branch repos the plan targets, not necessarily as a
dramatic drop at this bench size. The one number that's unambiguously bad
*at this size already* is the stage-all loop — 2.4 seconds for 1000 files is
the P1 target Task A3 fixes directly.

*(`Actual-after` column filled in as each task lands and the same bench
command is re-run.)*
