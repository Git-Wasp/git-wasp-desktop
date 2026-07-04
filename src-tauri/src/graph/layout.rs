use crate::graph::{BranchLabel, EdgeKind, GraphEdge, GraphNode, GraphViewport};
use anyhow::Context;
use git2::{ObjectType, Oid, Repository, Sort};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::time::Instant;

/// Emit a graph-walk diagnostic (e.g. histories that look truncated). Routed
/// through the standard logger at debug level, so it lands in the unified log
/// file only when diagnostic logging is on — keeping everyday logs quiet.
pub(crate) fn diag_log(line: &str) {
    log::debug!(target: "graph", "{line}");
}

/// Slice-independent layout for the active repo, cached across viewport fetches.
/// The whole HEAD-reachable history is laid out once (lanes, colours, edges,
/// branch labels); only the final slicing happens per request. Invalidated
/// whenever HEAD or any ref changes — see [`cache_key`].
///
/// This is what makes scrolling cheap: without it, every scroll tick re-walked
/// the entire history (twice) and re-scanned the working tree.
///
/// `change_count` (the working-tree dirty-file count) is cached here too,
/// rather than rescanned on every slice — `repo.statuses()` walks the whole
/// working directory and can cost well over a second on a large tree, which
/// made every scroll tick pay for a full status scan. It's refreshed
/// explicitly via [`refresh_working_tree_status`], which the frontend calls
/// off the `notify`-driven file-watcher event rather than on every fetch.
pub struct GraphCache {
    key: CacheKey,
    /// All commits, newest-first; `row` equals the index. No working-tree node.
    nodes: Vec<GraphNode>,
    change_count: u32,
    /// Absolute graph row of the HEAD commit (tip of the checked-out branch),
    /// including the working-tree node's offset when the tree is dirty. Sent to
    /// the frontend so it can draw the dotted working-tree→HEAD connector down to
    /// HEAD's dot wherever it sits (other branches may be ahead of HEAD, so HEAD
    /// is often not the topmost row).
    head_row: Option<usize>,
}

#[derive(PartialEq)]
struct CacheKey {
    head: Option<Oid>,
    refs_fingerprint: u64,
    stash_fingerprint: u64,
}

fn cache_key(repo: &Repository) -> CacheKey {
    CacheKey {
        head: repo.head().ok().and_then(|h| h.target()),
        refs_fingerprint: refs_fingerprint(repo),
        stash_fingerprint: stash_fingerprint(repo),
    }
}

/// Order-sensitive fingerprint of the stash list — each entry's commit, message
/// and position. Flips when a stash is created, dropped, popped or renamed, so
/// the cached layout (which embeds stash nodes) is rebuilt.
fn stash_fingerprint(repo: &Repository) -> u64 {
    let mut acc: u64 = 0;
    if let Ok(reflog) = repo.reflog("refs/stash") {
        for i in 0..reflog.len() {
            let Some(entry) = reflog.get(i) else { continue };
            let mut h = std::collections::hash_map::DefaultHasher::new();
            i.hash(&mut h);
            entry.id_new().as_bytes().hash(&mut h);
            if let Some(m) = entry.message() {
                m.hash(&mut h);
            }
            acc ^= h.finish();
        }
    }
    acc
}

/// Order-independent fingerprint of all refs (name + direct target). Flips when a
/// branch/tag is created, deleted, renamed or moved — including remote-tracking
/// refs updated by fetch. Cheap: O(refs), no tag peeling.
fn refs_fingerprint(repo: &Repository) -> u64 {
    let mut acc: u64 = 0;
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            let mut h = std::collections::hash_map::DefaultHasher::new();
            if let Some(name) = r.name() {
                name.hash(&mut h);
            }
            if let Some(target) = r.target() {
                target.as_bytes().hash(&mut h);
            }
            acc ^= h.finish();
        }
    }
    acc
}

/// Lay out the entire HEAD-reachable history. Expensive (one full revwalk + lane
/// assignment); only called on a cache miss.
fn build_full_layout(repo: &Repository) -> anyhow::Result<Vec<GraphNode>> {
    let started = Instant::now();
    let head_id = repo.head().ok().and_then(|h| h.target());
    let label_map = build_label_map(repo);

    let walk_started = Instant::now();
    let commits = walk_commits(repo, usize::MAX)?;
    let walk_ms = walk_started.elapsed().as_millis();

    let nodes = assign_lanes(&commits, &label_map, head_id);
    let nodes = inject_stashes(repo, nodes);
    log_full_build(
        repo,
        &commits,
        &nodes,
        walk_ms,
        started.elapsed().as_millis(),
    );
    Ok(nodes)
}

/// Emit a one-line structural snapshot of the repo whenever the full layout is
/// (re)built. The flags here distinguish the likely causes of a "history looks
/// truncated" report: a shallow clone, or a history stitched via replace refs /
/// grafts (which libgit2 ignores by default). `commits` is the number our walk
/// actually reached — compare it to `git rev-list --count HEAD`.
fn log_full_build(
    repo: &Repository,
    commits: &[CommitRaw],
    nodes: &[GraphNode],
    walk_ms: u128,
    total_ms: u128,
) {
    let git_dir = repo.path();
    let is_shallow = git_dir.join("shallow").exists();
    let has_grafts = git_dir.join("info").join("grafts").exists();
    let replace_refs = repo
        .references_glob("refs/replace/*")
        .map(|r| r.count())
        .unwrap_or(0);
    let roots = commits.iter().filter(|c| c.parents.is_empty()).count();
    let max_lane = nodes.iter().map(|n| n.lane).max().unwrap_or(0);
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|o| o.to_string())
        .unwrap_or_else(|| "none".into());

    diag_log(&format!(
        "FULL BUILD commits={} roots={roots} max_lane={max_lane} shallow={is_shallow} \
         grafts={has_grafts} replace_refs={replace_refs} head={head} walk_ms={walk_ms} total_ms={total_ms}",
        commits.len(),
    ));
}

/// Carve a viewport out of already-laid-out nodes, layering in the synthetic
/// working-tree node at row 0 (the top of the graph) when the tree is dirty.
/// Pure indexing — no git work — since `change_count` and `head_pos` are
/// supplied by the caller from the cache rather than rescanned here.
///
/// The working-tree node always sits at the top, but its *connector* is drawn
/// (dotted) down to HEAD's dot — the tip of the checked-out branch — which may
/// be several rows below, since other branches can be ahead of HEAD. The
/// connector is a frontend concern; here we only expose HEAD's absolute row
/// (`head_row`) so the renderer can reach it even when HEAD isn't in the slice.
fn slice_viewport(
    full: &[GraphNode],
    change_count: u32,
    head_pos: Option<usize>,
    offset: usize,
    limit: usize,
) -> GraphViewport {
    // A dirty working tree adds a synthetic node at row 0 (above everything). It
    // is always counted in total_count so the scroll height is offset-independent,
    // but only emitted when row 0 is in view (offset == 0). It needs a commit to
    // anchor to, hence the non-empty check.
    let change_count = if full.is_empty() { 0 } else { change_count };
    let wip_offset = if change_count > 0 { 1 } else { 0 };
    let total_count = full.len() + wip_offset;
    // HEAD's absolute graph row, shifted down by the working-tree node when present.
    let head_row = head_pos.map(|p| p + wip_offset);

    // Commit rows are shifted down by the working-tree node when present.
    let commit_start = offset.saturating_sub(wip_offset);
    let commit_end = (offset + limit).saturating_sub(wip_offset).min(full.len());
    let mut commit_nodes: Vec<GraphNode> =
        full.get(commit_start..commit_end).unwrap_or(&[]).to_vec();
    for (i, node) in commit_nodes.iter_mut().enumerate() {
        node.row = commit_start + i + wip_offset;
    }

    let mut nodes: Vec<GraphNode> = Vec::new();
    if wip_offset == 1 && offset == 0 {
        if let Some(head_node) = full.get(head_pos.unwrap_or(0)) {
            nodes.push(working_tree_node(head_node, change_count));
        }
    }
    nodes.append(&mut commit_nodes);

    GraphViewport {
        nodes,
        total_count,
        offset,
        head_row,
    }
}

/// Cache-free layout. Lays out the whole history every call — the cache-free
/// reference the cached path is checked against; production goes through
/// [`compute_layout_cached`].
#[cfg(test)]
pub fn compute_layout(
    repo: &Repository,
    offset: usize,
    limit: usize,
) -> anyhow::Result<GraphViewport> {
    let full = build_full_layout(repo)?;
    let change_count = changed_file_count(repo);
    let head_pos = full.iter().position(|n| n.is_head);
    Ok(slice_viewport(&full, change_count, head_pos, offset, limit))
}

/// Layout that reuses a cached full-history layout while HEAD and refs are
/// unchanged, rebuilding only when they move. This is the path the viewport
/// command uses, so repeated scroll fetches are cheap.
///
/// The working-tree dirty-file count is cached alongside the layout rather
/// than rescanned here — see [`refresh_working_tree_status`].
pub fn compute_layout_cached(
    repo: &Repository,
    cache: &mut Option<GraphCache>,
    offset: usize,
    limit: usize,
) -> anyhow::Result<GraphViewport> {
    let key = cache_key(repo);
    let stale = cache.as_ref().map(|c| c.key != key).unwrap_or(true);
    if stale {
        let nodes = build_full_layout(repo)?;
        let change_count = changed_file_count(repo);
        let head_row = nodes.iter().position(|n| n.is_head);
        *cache = Some(GraphCache {
            key,
            nodes,
            change_count,
            head_row,
        });
    }
    // `stale` guarantees the cache is populated here.
    let cached = cache.as_ref().expect("cache populated above");
    Ok(slice_viewport(
        &cached.nodes,
        cached.change_count,
        cached.head_row,
        offset,
        limit,
    ))
}

/// Re-scans the working tree and updates the cached dirty-file count, without
/// rebuilding the (expensive) full history layout. A no-op when there's no
/// cache yet — the next [`compute_layout_cached`] call will populate one with
/// a fresh scan anyway. Call this when the file watcher reports a working-tree
/// change, before re-fetching the viewport, so the scan happens once per
/// change rather than once per scroll tick.
pub fn refresh_working_tree_status(repo: &Repository, cache: &mut Option<GraphCache>) {
    if let Some(c) = cache {
        c.change_count = changed_file_count(repo);
    }
}

struct CommitRaw {
    oid: git2::Oid,
    parents: Vec<git2::Oid>,
    summary: String,
    body: String,
    author_name: String,
    author_email: String,
    author_timestamp: i64,
}

/// Seed `walk` from every branch/tag tip and HEAD — not just HEAD. This is what
/// makes commits on branches that are ahead of (or unrelated to) the checked-out
/// branch visible and selectable in the graph; pushing only HEAD would hide
/// everything that isn't an ancestor of HEAD (e.g. a remote branch ahead of the
/// local one you have checked out). Returns false when nothing could be pushed
/// (an empty/unborn repository). Shared by the layout walk and `find_commit_row`
/// so their row orderings agree.
fn seed_revwalk(repo: &Repository, walk: &mut git2::Revwalk) -> bool {
    let mut pushed_any = false;
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            if !(r.is_branch() || r.is_remote() || r.is_tag()) {
                continue; // skip symbolic refs (HEAD, origin/HEAD), notes, stash, etc.
            }
            // Tags may be annotated (peel to the commit); branches point at one.
            let target = if r.is_tag() {
                r.peel(ObjectType::Commit).ok().map(|o| o.id())
            } else {
                r.target()
            };
            if let Some(oid) = target {
                if walk.push(oid).is_ok() {
                    pushed_any = true;
                }
            }
        }
    }
    // Include HEAD explicitly so a detached HEAD (not pointed at by any branch
    // ref) is still part of the walk.
    if walk.push_head().is_ok() {
        pushed_any = true;
    }
    pushed_any
}

fn walk_commits(repo: &Repository, limit: usize) -> anyhow::Result<Vec<CommitRaw>> {
    let mut walk = repo.revwalk().context("failed to create revwalk")?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .context("failed to set sort")?;
    if !seed_revwalk(repo, &mut walk) {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    for oid in walk.take(limit) {
        let oid = oid.context("revwalk error")?;
        let commit = repo.find_commit(oid).context("commit not found")?;
        let parents = commit.parent_ids().collect();
        let summary = commit.summary().unwrap_or("").to_string();
        let body = commit.body().unwrap_or("").trim().to_string();
        let author_name = commit.author().name().unwrap_or("").to_string();
        let author_email = commit.author().email().unwrap_or("").to_string();
        let author_timestamp = commit.author().when().seconds();
        result.push(CommitRaw {
            oid,
            parents,
            summary,
            body,
            author_name,
            author_email,
            author_timestamp,
        });
    }
    Ok(result)
}

fn build_label_map(repo: &Repository) -> HashMap<git2::Oid, Vec<BranchLabel>> {
    let mut map: HashMap<git2::Oid, Vec<BranchLabel>> = HashMap::new();

    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            let Some(name) = r.shorthand() else { continue };
            let is_tag = r.is_tag();
            let is_remote = r.is_remote();
            let target = if is_tag {
                r.peel(ObjectType::Commit).ok().map(|o| o.id())
            } else {
                r.target()
            };
            let Some(oid) = target else { continue };
            map.entry(oid).or_default().push(BranchLabel {
                name: name.to_string(),
                is_remote,
                is_tag,
            });
        }
    }
    map
}

fn assign_lanes(
    commits: &[CommitRaw],
    label_map: &HashMap<git2::Oid, Vec<BranchLabel>>,
    head_id: Option<git2::Oid>,
) -> Vec<GraphNode> {
    // active_lanes[i] = Some(oid) means lane i is occupied by a commit that
    // has not yet appeared in the walk (i.e., we are waiting for its parent).
    let mut active_lanes: Vec<Option<git2::Oid>> = Vec::new();

    // lane_colors[i] = color_index for lane i; stable for the lane lifetime.
    let mut lane_colors: Vec<usize> = Vec::new();
    let mut color_counter: usize = 0;

    // Maps each oid to its reserved (lane, color_index).
    let mut reserved: HashMap<git2::Oid, (usize, usize)> = HashMap::new();

    // children map: for each oid, which oids are its children (for GraphNode.children).
    let mut children_map: HashMap<git2::Oid, Vec<git2::Oid>> = HashMap::new();
    for c in commits {
        for parent in &c.parents {
            children_map.entry(*parent).or_default().push(c.oid);
        }
    }

    let mut nodes: Vec<GraphNode> = Vec::new();

    for (row, c) in commits.iter().enumerate() {
        let oid = &c.oid;
        let parents = &c.parents;
        // Determine this commit's lane.
        let (lane, color_index) = if let Some(&reserved) = reserved.get(oid) {
            reserved
        } else {
            // No lane reserved — grab the leftmost free slot.
            let free = active_lanes.iter().position(|s| s.is_none());
            if let Some(i) = free {
                let c = color_counter % 8;
                color_counter += 1;
                active_lanes[i] = Some(*oid);
                lane_colors[i] = c;
                (i, c)
            } else {
                let i = active_lanes.len();
                let c = color_counter % 8;
                color_counter += 1;
                active_lanes.push(Some(*oid));
                lane_colors.push(c);
                (i, c)
            }
        };

        // Each edge describes how a lane at this row connects to the next row.
        // The renderer draws it from this row's dot centre down to the next
        // row's centre, so lines join dot-to-dot.
        let mut edges: Vec<GraphEdge> = Vec::new();

        // Other occupied lanes pass straight through to the next row.
        for (i, slot) in active_lanes.iter().enumerate() {
            if slot.is_some() && i != lane {
                edges.push(GraphEdge {
                    src_lane: i,
                    dst_lane: i,
                    color_index: lane_colors[i],
                    kind: EdgeKind::Straight,
                });
            }
        }

        // Free this commit's lane — the commit is now "processed".
        active_lanes[lane] = None;

        // Assign lanes to parents.
        let mut primary_lane_given = false;
        for parent in parents {
            if let Some(&(plane, _)) = reserved.get(parent) {
                // Parent already has a lane (from another child) → merge edge.
                edges.push(GraphEdge {
                    src_lane: lane,
                    dst_lane: plane,
                    color_index,
                    kind: EdgeKind::Merge,
                });
            } else if !primary_lane_given {
                // Primary parent inherits this commit's lane: draw the straight
                // continuation down to it (the line through the dots).
                active_lanes[lane] = Some(*parent);
                lane_colors[lane] = color_index;
                reserved.insert(*parent, (lane, color_index));
                primary_lane_given = true;
                edges.push(GraphEdge {
                    src_lane: lane,
                    dst_lane: lane,
                    color_index,
                    kind: EdgeKind::Straight,
                });
            } else {
                // Secondary parent → new lane (branch opening).
                let free = active_lanes.iter().position(|s| s.is_none());
                let new_lane = if let Some(i) = free {
                    let c = color_counter % 8;
                    color_counter += 1;
                    active_lanes[i] = Some(*parent);
                    lane_colors[i] = c;
                    reserved.insert(*parent, (i, c));
                    i
                } else {
                    let i = active_lanes.len();
                    let c = color_counter % 8;
                    color_counter += 1;
                    active_lanes.push(Some(*parent));
                    lane_colors.push(c);
                    reserved.insert(*parent, (i, c));
                    i
                };
                edges.push(GraphEdge {
                    src_lane: lane,
                    dst_lane: new_lane,
                    color_index,
                    kind: EdgeKind::Branch,
                });
            }
        }

        let branch_labels = label_map.get(oid).cloned().unwrap_or_default();
        let oid_str = oid.to_string();

        nodes.push(GraphNode {
            short_oid: oid_str[..8].to_string(),
            oid: oid_str,
            summary: c.summary.clone(),
            body: c.body.clone(),
            author_name: c.author_name.clone(),
            author_email: c.author_email.clone(),
            author_timestamp: c.author_timestamp,
            lane,
            row,
            color_index,
            parents: parents.iter().map(|p| p.to_string()).collect(),
            children: children_map
                .get(oid)
                .map(|v| v.iter().map(|child| child.to_string()).collect())
                .unwrap_or_default(),
            edges,
            branch_labels,
            is_head: head_id == Some(*oid),
            is_working_tree: false,
            change_count: None,
            is_stash: false,
            stash_index: None,
        });
    }

    nodes
}

/// A stash read from the `refs/stash` reflog. Read this way (not via
/// `stash_foreach`, which needs `&mut Repository`) so layout stays `&Repository`.
struct StashRef {
    index: usize,
    message: String,
    oid: Oid,
    base: Oid,
}

fn read_stashes(repo: &Repository) -> Vec<StashRef> {
    let mut out = Vec::new();
    let Ok(reflog) = repo.reflog("refs/stash") else {
        return out; // no stashes (ref doesn't exist)
    };
    for i in 0..reflog.len() {
        let Some(entry) = reflog.get(i) else { continue };
        let oid = entry.id_new();
        // The stash commit's first parent is the commit it was created on.
        let Some(base) = repo.find_commit(oid).ok().and_then(|c| c.parent_id(0).ok()) else {
            continue;
        };
        out.push(StashRef {
            index: i,
            message: entry.message().unwrap_or("").to_string(),
            oid,
            base,
        });
    }
    out
}

/// Splice stash nodes into the laid-out history, each hanging off the commit it
/// was created on (its first parent) via dotted edges, on a side lane. Multiple
/// stashes on the same commit stack downward as a dotted chain. Real commits'
/// lanes are untouched — only their `row`s shift (renumbered here) and the base
/// commit gains one dotted edge down to its first stash. Stashes whose base
/// commit isn't in the layout are skipped.
fn inject_stashes(repo: &Repository, nodes: Vec<GraphNode>) -> Vec<GraphNode> {
    let stashes = read_stashes(repo);
    if stashes.is_empty() {
        return nodes;
    }

    // base oid -> its stashes, most-recent first (ascending stash index).
    let mut by_base: HashMap<String, Vec<&StashRef>> = HashMap::new();
    for s in &stashes {
        by_base.entry(s.base.to_string()).or_default().push(s);
    }
    for v in by_base.values_mut() {
        v.sort_by_key(|s| s.index);
    }

    let mut out: Vec<GraphNode> = Vec::with_capacity(nodes.len() + stashes.len());
    for node in nodes {
        let Some(chain) = by_base.get(&node.oid).cloned() else {
            out.push(node);
            continue;
        };

        // Lanes alive going from this commit into the next row, with their
        // colours — the stash rows must carry these straight through so the real
        // history lines don't break where a stash is spliced in.
        let active: Vec<(usize, usize)> = node
            .edges
            .iter()
            .map(|e| (e.dst_lane, e.color_index))
            .collect();
        let mut stash_lane = 0;
        while active.iter().any(|(l, _)| *l == stash_lane) {
            stash_lane += 1;
        }
        let base_lane = node.lane;
        let base_color = node.color_index;

        // The base commit gains a dotted edge down to the first stash.
        let mut base = node;
        base.edges.push(GraphEdge {
            src_lane: base_lane,
            dst_lane: stash_lane,
            color_index: base_color,
            kind: EdgeKind::Stash,
        });
        out.push(base);

        let n = chain.len();
        for (i, s) in chain.iter().enumerate() {
            let mut edges: Vec<GraphEdge> = active
                .iter()
                .map(|(lane, color)| GraphEdge {
                    src_lane: *lane,
                    dst_lane: *lane,
                    color_index: *color,
                    kind: EdgeKind::Straight,
                })
                .collect();
            // Continue the dotted stash chain down to the next stash, if any.
            if i + 1 < n {
                edges.push(GraphEdge {
                    src_lane: stash_lane,
                    dst_lane: stash_lane,
                    color_index: base_color,
                    kind: EdgeKind::Stash,
                });
            }
            let oid_str = s.oid.to_string();
            out.push(GraphNode {
                short_oid: oid_str[..8].to_string(),
                oid: oid_str,
                summary: s.message.clone(),
                body: String::new(),
                author_name: String::new(),
                author_email: String::new(),
                author_timestamp: 0,
                lane: stash_lane,
                row: 0, // renumbered below
                color_index: base_color,
                parents: vec![s.base.to_string()],
                children: Vec::new(),
                edges,
                branch_labels: Vec::new(),
                is_head: false,
                is_working_tree: false,
                change_count: None,
                is_stash: true,
                stash_index: Some(s.index),
            });
        }
    }

    for (i, node) in out.iter_mut().enumerate() {
        node.row = i;
    }
    out
}

/// Counts changed files in the working tree (modified/staged/untracked,
/// excluding ignored) — the badge count for the working-tree graph node.
/// Find the graph row of a commit by OID, matching the ordering used by
/// `compute_layout` (HEAD revwalk, topological + time sort, offset by the
/// synthetic working-tree node when the tree is dirty). Returns `None` if the
/// commit isn't reachable from HEAD (so it has no row in the graph).
pub fn find_commit_row(repo: &Repository, oid_str: &str) -> anyhow::Result<Option<usize>> {
    // Build the same full layout the viewport uses (which embeds stash nodes, so
    // a commit's row reflects any stashes spliced in above it), then look up the
    // commit's position. The working-tree node (row 0 when dirty) shifts every
    // commit down by one, mirroring `slice_viewport`.
    let full = build_full_layout(repo)?;
    let head_id = repo.head().ok().and_then(|h| h.target());
    let wip_offset = if head_id.is_some() && changed_file_count(repo) > 0 {
        1
    } else {
        0
    };
    Ok(full
        .iter()
        .position(|n| n.oid == oid_str)
        .map(|i| i + wip_offset))
}

fn changed_file_count(repo: &Repository) -> u32 {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).include_ignored(false);
    repo.statuses(Some(&mut opts))
        .map(|s| s.len() as u32)
        .unwrap_or(0)
}

/// The synthetic node representing uncommitted changes, sitting one row above
/// HEAD on HEAD's lane with a straight edge down to it.
/// The working-tree row's summary, pluralising "change" by count
/// (e.g. "1 uncommitted change" vs "3 uncommitted changes").
fn working_tree_summary(change_count: u32) -> String {
    if change_count == 1 {
        "1 uncommitted change".to_string()
    } else {
        format!("{change_count} uncommitted changes")
    }
}

/// The synthetic node representing uncommitted changes, sitting at row 0 (the
/// top of the graph) on HEAD's lane. It carries **no edges**: its connector to
/// HEAD is drawn by the frontend as a dotted line straight down HEAD's lane to
/// the HEAD dot (which may be several rows below when other branches are ahead),
/// rather than a per-row edge — see the graph renderer's working-tree connector.
fn working_tree_node(head: &GraphNode, change_count: u32) -> GraphNode {
    GraphNode {
        oid: "WORKING_TREE".to_string(),
        short_oid: "WORKING_TREE".to_string(),
        summary: working_tree_summary(change_count),
        body: String::new(),
        author_name: String::new(),
        author_email: String::new(),
        author_timestamp: 0,
        lane: head.lane,
        row: 0,
        color_index: head.color_index,
        parents: vec![head.oid.clone()],
        children: Vec::new(),
        edges: Vec::new(),
        branch_labels: Vec::new(),
        is_head: false,
        is_working_tree: true,
        change_count: Some(change_count),
        is_stash: false,
        stash_index: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use tempfile::TempDir;

    fn sig() -> Signature<'static> {
        Signature::now("Test", "test@test.com").unwrap()
    }

    fn empty_tree(repo: &Repository) -> git2::Oid {
        let mut index = repo.index().unwrap();
        index.write_tree().unwrap()
    }

    fn make_commit(repo: &Repository, msg: &str, parents: &[&git2::Commit]) -> git2::Oid {
        let sig = sig();
        let tree_id = empty_tree(repo);
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, parents)
            .unwrap()
    }

    fn init_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        (dir, repo)
    }

    #[test]
    fn working_tree_summary_is_singular_for_one_change() {
        assert_eq!(working_tree_summary(1), "1 uncommitted change");
    }

    #[test]
    fn working_tree_summary_is_plural_otherwise() {
        assert_eq!(working_tree_summary(0), "0 uncommitted changes");
        assert_eq!(working_tree_summary(2), "2 uncommitted changes");
    }

    #[test]
    fn find_commit_row_matches_layout_order() {
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "first", &[])).unwrap();
        let c2 = repo
            .find_commit(make_commit(&repo, "second", &[&c1]))
            .unwrap();
        let c3 = make_commit(&repo, "third", &[&c2]);

        // Newest first: third is row 0, first is row 2.
        assert_eq!(find_commit_row(&repo, &c3.to_string()).unwrap(), Some(0));
        assert_eq!(
            find_commit_row(&repo, &c1.id().to_string()).unwrap(),
            Some(2)
        );
    }

    /// Repo with two real-file commits (so the working tree can be made dirty
    /// and stashed). Returns (dir, repo, head_oid).
    fn repo_with_two_commits() -> (TempDir, Repository, String) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Test").unwrap();
            cfg.set_str("user.email", "t@t.com").unwrap();
        }
        let commit_file = |name: &str, content: &str, msg: &str| {
            std::fs::write(dir.path().join(name), content).unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new(name)).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let parents: Vec<&git2::Commit> = parent.iter().collect();
            repo.commit(Some("HEAD"), &sig(), &sig(), msg, &tree, &parents)
                .unwrap();
        };
        commit_file("f.txt", "v1\n", "first");
        commit_file("f.txt", "v2\n", "second");
        let head = repo.head().unwrap().target().unwrap().to_string();
        (dir, repo, head)
    }

    #[test]
    fn stash_node_is_injected_below_its_base_commit() {
        let (dir, mut repo, head) = repo_with_two_commits();
        std::fs::write(dir.path().join("f.txt"), "dirty\n").unwrap();
        crate::stash::stash_save(&mut repo, Some("WIP work")).unwrap();

        let nodes = build_full_layout(&repo).unwrap();

        let base_row = nodes.iter().position(|n| n.oid == head).unwrap();
        let stash = nodes.iter().find(|n| n.is_stash).expect("a stash node");

        // The stash sits one row below the commit it was created on.
        assert_eq!(stash.row, base_row + 1);
        assert_eq!(stash.stash_index, Some(0));
        assert!(stash.summary.contains("WIP work"));

        // The base commit gained a dotted edge pointing at the stash's lane.
        let base = &nodes[base_row];
        assert!(base
            .edges
            .iter()
            .any(|e| matches!(e.kind, EdgeKind::Stash) && e.dst_lane == stash.lane));
        // The stash is on a side lane, and carries the real history line straight
        // through (a pass-through edge on the base's lane).
        assert_ne!(stash.lane, base.lane);
        assert!(stash
            .edges
            .iter()
            .any(|e| matches!(e.kind, EdgeKind::Straight) && e.src_lane == base.lane));
    }

    #[test]
    fn find_commit_row_accounts_for_an_injected_stash() {
        let (dir, mut repo, _head) = repo_with_two_commits();
        // Row of the root commit before stashing.
        let root = build_full_layout(&repo)
            .unwrap()
            .iter()
            .find(|n| n.summary == "first")
            .map(|n| n.oid.clone())
            .unwrap();
        let before = find_commit_row(&repo, &root).unwrap();

        std::fs::write(dir.path().join("f.txt"), "dirty\n").unwrap();
        crate::stash::stash_save(&mut repo, Some("WIP")).unwrap();
        // Stash sits above the root (below HEAD), so the root shifts down by one.
        let after = find_commit_row(&repo, &root).unwrap();
        assert_eq!(after, before.map(|r| r + 1));
    }

    #[test]
    fn find_commit_row_returns_none_for_unknown_commit() {
        let (_dir, repo) = init_repo();
        make_commit(&repo, "only", &[]);
        let missing = "0".repeat(40);
        assert_eq!(find_commit_row(&repo, &missing).unwrap(), None);
    }

    #[test]
    fn commits_ahead_of_head_on_other_branches_are_included() {
        // Regression: the walk used to seed only from HEAD, so a branch ahead of
        // the checked-out one was invisible. Build first→second→third on the
        // default branch, then check out a branch sitting back at `first`; the
        // commits ahead must still be laid out and selectable.
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "first", &[])).unwrap();
        let c2 = repo
            .find_commit(make_commit(&repo, "second", &[&c1]))
            .unwrap();
        let c3 = make_commit(&repo, "third", &[&c2]);
        repo.branch("old", &c1, false).unwrap();
        repo.set_head("refs/heads/old").unwrap();

        let viewport = compute_layout(&repo, 0, 10).unwrap();

        assert_eq!(
            viewport.total_count, 3,
            "commits ahead of HEAD should still show"
        );
        let summaries: Vec<&str> = viewport.nodes.iter().map(|n| n.summary.as_str()).collect();
        assert!(summaries.contains(&"first"));
        assert!(summaries.contains(&"second"));
        assert!(summaries.contains(&"third"));
        // The ahead commit is reachable by find_commit_row too (so reveal/scroll
        // works), and the two walks agree on its position.
        let row = find_commit_row(&repo, &c3.to_string()).unwrap();
        assert_eq!(
            row,
            Some(0),
            "newest commit (ahead of HEAD) should be row 0"
        );
    }

    #[test]
    fn working_tree_node_sits_at_top_but_anchors_to_head() {
        // With commits ahead of the checked-out branch, the uncommitted-changes
        // node stays at the top of the graph (row 0), but it belongs to HEAD's
        // tip — so it sits on HEAD's lane, names HEAD as its parent, and the
        // viewport reports HEAD's row so the frontend can draw the dotted
        // connector down to it. (The old bug had it hanging off the topmost
        // commit across all branches.)
        let (dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "first", &[])).unwrap();
        let c2 = repo
            .find_commit(make_commit(&repo, "second", &[&c1]))
            .unwrap();
        make_commit(&repo, "third", &[&c2]);
        // Check out `old` at `first` (two commits behind the tip).
        repo.branch("old", &c1, false).unwrap();
        repo.set_head("refs/heads/old").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        std::fs::write(dir.path().join("new.txt"), "hi").unwrap(); // uncommitted

        let viewport = compute_layout(&repo, 0, 10).unwrap();

        // The working-tree node is the topmost row.
        let wt = &viewport.nodes[0];
        assert!(wt.is_working_tree);
        assert_eq!(wt.row, 0);
        assert_eq!(wt.summary, "1 uncommitted change");
        // It carries no edges — the connector to HEAD is a frontend concern.
        assert!(wt.edges.is_empty());

        // It anchors to HEAD ("first"), not to the topmost commit ("third"):
        // HEAD's lane and oid, and the viewport reports HEAD's absolute row.
        let head = viewport.nodes.iter().find(|n| n.is_head).unwrap();
        assert_eq!(head.summary, "first");
        assert_eq!(wt.lane, head.lane);
        assert_eq!(wt.parents, vec![head.oid.clone()]);
        assert_eq!(viewport.head_row, Some(head.row));
        assert_eq!(
            find_commit_row(&repo, &c1.id().to_string()).unwrap(),
            Some(head.row)
        );
        // Commits ahead of HEAD still sit above it, unchanged.
        assert!(viewport.nodes[1].summary == "third" || viewport.nodes[1].summary == "second");
        let _ = c2;
    }

    #[test]
    fn linear_history_all_in_lane_zero() {
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "first", &[])).unwrap();
        let c2 = repo
            .find_commit(make_commit(&repo, "second", &[&c1]))
            .unwrap();
        make_commit(&repo, "third", &[&c2]);

        let viewport = compute_layout(&repo, 0, 10).unwrap();
        assert_eq!(viewport.total_count, 3);
        for node in &viewport.nodes {
            assert_eq!(node.lane, 0, "node {} not in lane 0", node.short_oid);
        }
    }

    #[test]
    fn working_tree_node_prepended_when_dirty() {
        let (dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "first", &[])).unwrap();
        make_commit(&repo, "second", &[&c1]);
        std::fs::write(dir.path().join("new.txt"), "hi").unwrap(); // uncommitted

        let viewport = compute_layout(&repo, 0, 10).unwrap();

        assert_eq!(viewport.total_count, 3); // 2 commits + working-tree node
        assert!(viewport.nodes[0].is_working_tree);
        assert_eq!(viewport.nodes[0].change_count, Some(1));
        assert_eq!(viewport.nodes[0].row, 0);
        // HEAD is pushed down one row, on the same lane the WIP node sits on.
        assert!(viewport.nodes[1].is_head);
        assert_eq!(viewport.nodes[1].row, 1);
        assert_eq!(viewport.nodes[0].lane, viewport.nodes[1].lane);
    }

    #[test]
    fn linear_history_has_straight_connecting_edges() {
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "first", &[])).unwrap();
        let c2 = repo
            .find_commit(make_commit(&repo, "second", &[&c1]))
            .unwrap();
        make_commit(&repo, "third", &[&c2]);

        let viewport = compute_layout(&repo, 0, 10).unwrap();

        // Every commit except the root has a straight edge to its parent in the
        // same lane (the line through the dots).
        for node in viewport.nodes.iter().filter(|n| !n.parents.is_empty()) {
            assert!(
                node.edges
                    .iter()
                    .any(|e| matches!(e.kind, EdgeKind::Straight)
                        && e.src_lane == 0
                        && e.dst_lane == 0),
                "node {} missing its straight continuation edge",
                node.summary,
            );
        }
        // The root commit (no parent) has no outgoing edge.
        let root = viewport
            .nodes
            .iter()
            .find(|n| n.parents.is_empty())
            .unwrap();
        assert!(root.edges.is_empty());
    }

    #[test]
    fn nodes_carry_the_commit_body() {
        let (_dir, repo) = init_repo();
        make_commit(&repo, "summary line\n\nthe detailed body", &[]);

        let viewport = compute_layout(&repo, 0, 10).unwrap();

        assert_eq!(viewport.nodes[0].summary, "summary line");
        assert_eq!(viewport.nodes[0].body, "the detailed body");
    }

    #[test]
    fn nodes_without_a_body_get_empty_string() {
        let (_dir, repo) = init_repo();
        make_commit(&repo, "just a summary", &[]);

        let viewport = compute_layout(&repo, 0, 10).unwrap();
        assert_eq!(viewport.nodes[0].body, "");
    }

    #[test]
    fn no_working_tree_node_when_clean() {
        let (_dir, repo) = init_repo();
        make_commit(&repo, "first", &[]);

        let viewport = compute_layout(&repo, 0, 10).unwrap();

        assert!(viewport.nodes.iter().all(|n| !n.is_working_tree));
        assert_eq!(viewport.total_count, 1);
    }

    #[test]
    fn working_tree_node_omitted_when_scrolled_but_still_counted() {
        let (dir, repo) = init_repo();
        let mut parent = repo.find_commit(make_commit(&repo, "c0", &[])).unwrap();
        for i in 1..6 {
            parent = repo
                .find_commit(make_commit(&repo, &format!("c{i}"), &[&parent]))
                .unwrap();
        }
        std::fs::write(dir.path().join("x.txt"), "y").unwrap(); // uncommitted

        let viewport = compute_layout(&repo, 2, 3).unwrap();

        assert_eq!(viewport.total_count, 7); // 6 commits + working-tree node
        assert!(viewport.nodes.iter().all(|n| !n.is_working_tree));
        assert_eq!(viewport.nodes[0].row, 2); // rows stay shifted by the WIP node
    }

    #[test]
    fn merge_of_unrelated_histories_includes_all_ancestors() {
        let (_dir, repo) = init_repo();
        // History A — on HEAD.
        let a1 = repo.find_commit(make_commit(&repo, "a1", &[])).unwrap();
        let a2 = repo.find_commit(make_commit(&repo, "a2", &[&a1])).unwrap();
        // History B — an unrelated root (no common ancestor with A), off HEAD.
        let b1 = {
            let sig = sig();
            let tree = repo.find_tree(empty_tree(&repo)).unwrap();
            repo.find_commit(repo.commit(None, &sig, &sig, "b1", &tree, &[]).unwrap())
                .unwrap()
        };
        let b2 = {
            let sig = sig();
            let tree = repo.find_tree(empty_tree(&repo)).unwrap();
            repo.find_commit(repo.commit(None, &sig, &sig, "b2", &tree, &[&b1]).unwrap())
                .unwrap()
        };
        // Merge B into A (HEAD moves to the merge commit).
        make_commit(&repo, "merge", &[&a2, &b2]);

        let viewport = compute_layout(&repo, 0, 100).unwrap();
        let summaries: Vec<String> = viewport.nodes.iter().map(|n| n.summary.clone()).collect();

        assert_eq!(
            viewport.total_count, 5,
            "all five commits should be laid out"
        );
        for expected in ["merge", "a2", "a1", "b2", "b1"] {
            assert!(
                summaries.contains(&expected.to_string()),
                "missing {expected}: {summaries:?}"
            );
        }
    }

    #[test]
    fn merge_of_histories_with_out_of_order_times_keeps_all() {
        // History B is much OLDER than history A, and merged into A. With a
        // TOPOLOGICAL|TIME walk this is the case most likely to misbehave.
        let (_dir, repo) = init_repo();
        fn at(
            repo: &Repository,
            msg: &str,
            secs: i64,
            parents: &[&git2::Commit],
            head: bool,
        ) -> git2::Oid {
            let sig = git2::Signature::new("T", "t@t", &git2::Time::new(secs, 0)).unwrap();
            let tree = repo.find_tree(empty_tree(repo)).unwrap();
            let target = if head { Some("HEAD") } else { None };
            repo.commit(target, &sig, &sig, msg, &tree, parents)
                .unwrap()
        }

        let a1 = repo.find_commit(at(&repo, "a1", 1_000, &[], true)).unwrap();
        let a2 = repo
            .find_commit(at(&repo, "a2", 2_000, &[&a1], true))
            .unwrap();
        // Older, unrelated history.
        let b1 = repo.find_commit(at(&repo, "b1", 10, &[], false)).unwrap();
        let b2 = repo
            .find_commit(at(&repo, "b2", 20, &[&b1], false))
            .unwrap();
        at(&repo, "merge", 3_000, &[&a2, &b2], true);

        let viewport = compute_layout(&repo, 0, 100).unwrap();
        let summaries: Vec<String> = viewport.nodes.iter().map(|n| n.summary.clone()).collect();
        assert_eq!(viewport.total_count, 5, "got: {summaries:?}");
        for expected in ["merge", "a2", "a1", "b2", "b1"] {
            assert!(
                summaries.contains(&expected.to_string()),
                "missing {expected}: {summaries:?}"
            );
        }
    }

    #[test]
    fn merge_commit_uses_two_lanes() {
        let (_dir, repo) = init_repo();
        let root = repo.find_commit(make_commit(&repo, "root", &[])).unwrap();
        let b1 = repo
            .find_commit(make_commit(&repo, "branch-1", &[&root]))
            .unwrap();
        // b2 is a second branch off root — create without touching HEAD
        let b2 = {
            let sig = sig();
            let tree_id = empty_tree(&repo);
            let tree = repo.find_tree(tree_id).unwrap();
            let oid = repo
                .commit(None, &sig, &sig, "branch-2", &tree, &[&root])
                .unwrap();
            drop(tree);
            repo.find_commit(oid).unwrap()
        };
        // Merge b1 and b2 — HEAD now points here.
        make_commit(&repo, "merge", &[&b1, &b2]);

        let viewport = compute_layout(&repo, 0, 10).unwrap();
        let max_lane = viewport.nodes.iter().map(|n| n.lane).max().unwrap_or(0);
        assert!(max_lane >= 1, "expected merge to use more than one lane");
    }

    #[test]
    fn viewport_offset_returns_correct_slice() {
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "c1", &[])).unwrap();
        let c2 = repo.find_commit(make_commit(&repo, "c2", &[&c1])).unwrap();
        let c3 = repo.find_commit(make_commit(&repo, "c3", &[&c2])).unwrap();
        make_commit(&repo, "c4", &[&c3]);

        let full = compute_layout(&repo, 0, 10).unwrap();
        let sliced = compute_layout(&repo, 1, 2).unwrap();

        assert_eq!(full.total_count, 4);
        assert_eq!(sliced.offset, 1);
        assert_eq!(sliced.nodes.len(), 2);
        assert_eq!(sliced.nodes[0].oid, full.nodes[1].oid);
    }

    #[test]
    fn cached_layout_matches_uncached_and_reflects_new_commits() {
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "c1", &[])).unwrap();
        make_commit(&repo, "c2", &[&c1]);

        let mut cache = None;
        let cached = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        let uncached = compute_layout(&repo, 0, 10).unwrap();
        assert_eq!(cached.total_count, uncached.total_count);
        assert_eq!(cached.nodes.len(), uncached.nodes.len());
        assert_eq!(cached.nodes[0].oid, uncached.nodes[0].oid);

        // A second call with no change returns the same slice (cache hit path).
        let again = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        assert_eq!(again.nodes[0].oid, cached.nodes[0].oid);

        // A new commit moves HEAD → the cache key changes → rebuild.
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        make_commit(&repo, "c3", &[&head]);
        let after = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        assert_eq!(after.total_count, 3);
        assert_eq!(after.nodes[0].summary, "c3");
    }

    #[test]
    fn cached_layout_invalidates_on_branch_change() {
        let (_dir, repo) = init_repo();
        make_commit(&repo, "c1", &[]);

        let mut cache = None;
        let before = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        assert!(before.nodes[0]
            .branch_labels
            .iter()
            .all(|l| l.name != "feature"));

        // Create a branch at HEAD without moving HEAD — only refs change.
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head, false).unwrap();

        let after = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        assert!(after.nodes[0]
            .branch_labels
            .iter()
            .any(|l| l.name == "feature"));
    }

    #[test]
    fn cached_layout_does_not_rescan_working_tree_without_explicit_refresh() {
        let (dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "c1", &[])).unwrap();
        make_commit(&repo, "c2", &[&c1]);

        let mut cache = None;
        let clean = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        assert_eq!(clean.total_count, 2);
        assert!(clean.nodes.iter().all(|n| !n.is_working_tree));

        // Dirtying the tree doesn't change HEAD/refs, and — since the dirty
        // count is now cached rather than rescanned per call — a plain
        // re-fetch doesn't notice it either, until something explicitly
        // refreshes the cached count (see the test below).
        std::fs::write(dir.path().join("new.txt"), "hi").unwrap();
        let still_clean = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        assert_eq!(still_clean.total_count, 2);
        assert!(still_clean.nodes.iter().all(|n| !n.is_working_tree));
    }

    #[test]
    fn refresh_working_tree_status_updates_cached_count_without_rebuilding_layout() {
        let (dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "c1", &[])).unwrap();
        make_commit(&repo, "c2", &[&c1]);

        let mut cache = None;
        compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();

        std::fs::write(dir.path().join("new.txt"), "hi").unwrap();
        refresh_working_tree_status(&repo, &mut cache);

        let dirty = compute_layout_cached(&repo, &mut cache, 0, 10).unwrap();
        assert_eq!(dirty.total_count, 3);
        assert!(dirty.nodes[0].is_working_tree);
        assert_eq!(dirty.nodes[0].change_count, Some(1));
    }

    #[test]
    fn refresh_working_tree_status_is_a_no_op_without_a_cache() {
        let (_dir, repo) = init_repo();
        make_commit(&repo, "c1", &[]);

        let mut cache = None;
        refresh_working_tree_status(&repo, &mut cache); // must not panic
        assert!(cache.is_none());
    }

    #[test]
    fn total_count_correct_for_full_walk() {
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "c1", &[])).unwrap();
        let c2 = repo.find_commit(make_commit(&repo, "c2", &[&c1])).unwrap();
        make_commit(&repo, "c3", &[&c2]);

        let viewport = compute_layout(&repo, 0, 1).unwrap();
        assert_eq!(viewport.total_count, 3);
        assert_eq!(viewport.nodes.len(), 1);
    }
}
