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

## Task B1 spike gate — shared `repos` lock blocking unrelated tabs

Reproduced with a deterministic test (`repo_manager::tests::
tab_a_slow_op_does_not_block_tab_b`, part of the normal suite — no bench repo
needed, since the bug is about lock scope, not repo size). Two repos are
opened as separate tabs; tab A runs a simulated slow operation (a 150ms
`sleep` inside `with_repo_mut`'s closure, standing in for a real network op
like fetch) while tab B — a completely unrelated repo — tries to run
`get_working_tree_status`.

| Scenario | Before | After |
|---|---|---|
| Tab B's `get_working_tree_status`, while tab A holds a 150ms slow op | **blocked ~135.5ms** (of the 150ms) | **651.9µs** (~200x — effectively unblocked) |

Confirms the diagnosis: `RepoManager.repos: Mutex<Vec<OpenRepo>>` is one lock
shared by every open tab, so a slow op on any one tab (fetch, push, a large
checkout) stalls every other tab's otherwise-cheap operations (status, graph
viewport, branch list) for its full duration — this only gets worse as fetch
sizes and repo counts grow with the monorepo/multi-tab use case this plan
targets.

**Implemented:** `OpenRepo` now holds `state: Arc<Mutex<RepoState>>` (a new
struct bundling `repo`/`operation`/`graph_cache` — the same trio that used to
share the outer lock, kept together since some operations need two of them
at once). `with_repo`/`with_repo_mut`/`with_repo_graph_cache`/
`with_repo_and_operation_mut` all route through a new `active_state()` helper
that locks the outer `repos` Vec only long enough to find the active entry
and `Arc::clone` its state handle, then release the outer lock before locking
the inner one for the actual git2 work. `open()`/`activate()`/`close()`/
`list_open()`/`get_current()` build `RepoInfo` via a new `open_repo_info()`
that gets `path`/`name` from the tab's stable `key` (no lock needed) and
`head_branch` via `try_lock` — if another operation currently holds that
tab's state (e.g. an in-flight fetch), `head_branch` comes back `None`
instead of blocking, so listing/switching/closing tabs never waits on an
unrelated tab's slow operation either.

## Task B2 spike gate — per-scroll fingerprint cost vs. full-rebuild-on-fetch cost

Reproduced with two ignored bench tests on the same 10,000-commit / 21-branch
bench repo used above (`graph::layout::tests::bench_full_rebuild_after_ref_churn`,
alongside the existing `bench_graph_layout`):

| Scenario | Result |
|---|---|
| `cache_key` (`refs_fingerprint` + `stash_fingerprint` + HEAD), isolated, 100x | **108.8µs/call** (21 branches) |
| Warm-cache viewport re-request, no ref change (from `bench_graph_layout`, for comparison) | 164µs/call |
| Graph viewport immediately after 500 new branch refs (0 new commits) — forced full rebuild | **83.5ms** |

Two distinct costs, not one:

1. **Per-call fingerprint overhead** — `compute_layout_cached` calls `cache_key`
   (which calls `refs_fingerprint`, O(refs)) on *every* viewport request, i.e.
   every scroll tick, even when nothing changed. At 108.8µs/call with 21 refs
   this is a meaningful fraction of the 164µs/call warm-cache cost above —
   and it scales with ref count, so a 100+-branch monorepo pays more per tick.
2. **Full-rebuild cost when refs genuinely change** — any ref movement at all
   (this test creates 500 new branches pointing at existing commits — no new
   commits, no DAG change) invalidates the *entire* cached layout, forcing a
   full `build_full_layout` rewalk: 83.5ms at 10k commits. A fetch typically
   moves many remote-tracking refs at once, so this is the realistic
   per-fetch tax, not a rare edge case. `build_full_layout` walks the whole
   HEAD-reachable history regardless of commit count touched, so this scales
   with total commit count — extrapolating (roughly linear: revwalk + lane
   assignment) to the plan's 50k–200k-commit target range suggests **~400ms
   at 50k, ~1.6s at 200k** for the same "one fetch, zero new commits"
   scenario. That extrapolation, not the 10k-commit number, is the one that
   matters for the windowed-layout decision below.

**Decision point** (per the plan): fingerprint caching (stop recomputing
`cache_key` speculatively on every call; only re-check on an explicit
invalidation signal — from Task B4's debounced watcher, or directly after a
fetch/push completes) directly fixes cost #1 and is cheap to implement. It
does **not** fix cost #2 — a genuine ref change still means a genuine
rebuild; correctness requires that. Cost #2 only comes down with the more
invasive fix: bounding the initial walk (lay out only the first N rows,
extend on demand as the viewport scrolls past the built extent), so a fetch
that only moves refs doesn't force a full history rewalk when the visible
window hasn't changed.

**Decision:** user chose to implement both fingerprint caching and windowed
layout together rather than deferring the latter.

**Implemented:**

- *Fingerprint caching.* `GraphCache` gained `needs_recheck: bool`.
  `compute_layout_cached` only calls `cache_key` when `needs_recheck` is set —
  set by a new `mark_dirty()`, called from `with_repo_mut` and
  `with_repo_and_operation_mut` (every mutating repo operation in the app
  routes through one of these two, so this is a conservative, can't-miss-it
  hook: any `&mut Repository` access flags the cache regardless of whether it
  actually moved a ref) and from `refresh_working_tree` (the file-watcher-
  driven refresh path — the one place that also needs to notice a change made
  *outside* the app, e.g. a `git` command in a terminal). Ordinary scrolling —
  the overwhelming majority of calls — now skips the `cache_key` check
  entirely instead of recomputing it every time.
- *Windowed layout.* `build_full_layout` takes an explicit `limit` and reports
  whether the walk was cut off (`truncated`). `compute_layout_cached` builds
  at most `INITIAL_WALK_CAP` (5000) rows initially, and extends (re-walks at a
  larger limit — doubling, or as far as the request needs, whichever is
  larger) only when a viewport request reaches past what's been laid out.
  `GraphViewport.total_count` stays accurate regardless, via a cheap
  count-only revwalk (`count_reachable_commits`) computed once per genuine
  rebuild and carried across extends. `find_commit_row`/`search_graph` (which
  need to find a commit *anywhere*, not just on-screen) call a new
  `ensure_full_layout` that forces a full walk first, so their behaviour is
  byte-for-byte unchanged — only `get_graph_viewport`'s scroll-driven fetches
  get windowed.

**After, measured on the same 10,000-commit / 21-branch bench repo:**

| Scenario | Before | After |
|---|---|---|
| Warm-cache viewport re-request, no intervening `mark_dirty` (ordinary scrolling) | 164µs/call | **~19µs/call** (~8-9x) |
| First graph paint (cold, rows 0-100 of 10,002) | 183.1ms | **160.1ms** (~13%) |
| Graph viewport immediately after 500 new branch refs + `mark_dirty` (forced rebuild) | 83.5ms | **~115-121ms** (see caveat below) |

**Important caveat — the rebuild-after-fetch number got slightly *worse*, not
better, at this bench repo's size, and it's worth understanding why rather
than glossing over it.** The windowed *build* itself is bounded (good — it
stops scaling with total repo size past the cap), but reporting an accurate
`total_count` isn't optional (the frontend's virtualised scroll height
depends on it, and changing that contract risks the canvas
renderer/virtualisation CLAUDE.md says not to touch) — so every genuine
rebuild still pays for a full history walk, just a cheaper count-only one
instead of the expensive full-layout one. At 10,000 commits with a 5,000-row
cap (the cap is *half* the repo), that count-only walk (measured in isolation
across several cap sizes: 40-75ms, dominating the total regardless of cap)
isn't yet small relative to the old full-layout cost it replaced, so the
total comes out slightly higher than before. The structural win — build cost
bounded at `INITIAL_WALK_CAP` regardless of repo size — should still pay off
at the plan's actual 50k–200k-commit target, where the cap is a much smaller
fraction of the total and a count-only walk is consistently cheaper than a
full lane-assignment walk over the same commits; a real bench repo at that
scale (not generated here — see "Bench repo" above on why) would be needed to
confirm the crossover point rather than extrapolate it. Worth flagging to the
user as a follow-up rather than claiming a clean win on this specific number.
