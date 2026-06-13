use crate::graph::{BranchLabel, EdgeKind, GraphEdge, GraphNode, GraphViewport};
use anyhow::Context;
use git2::{ObjectType, Repository, Sort};
use std::collections::HashMap;

const LOOKAHEAD: usize = 200;

pub fn compute_layout(
    repo: &Repository,
    offset: usize,
    limit: usize,
) -> anyhow::Result<GraphViewport> {
    let head_id = repo.head().ok().and_then(|h| h.target());

    // Build branch/tag label map keyed by OID.
    let label_map = build_label_map(repo);

    // A dirty working tree adds a synthetic node at row 0 (above HEAD). It is
    // always counted in total_count so the scroll height is offset-independent,
    // but only emitted when row 0 is in view (offset == 0).
    let change_count = if head_id.is_some() { changed_file_count(repo) } else { 0 };
    let wip_offset = if change_count > 0 { 1 } else { 0 };

    // Walk the full graph to count total commits (needed for scroll height).
    let total_count = count_commits(repo)? + wip_offset;

    // Walk offset + limit + LOOKAHEAD commits for lane computation accuracy.
    let walk_limit = offset + limit + LOOKAHEAD;
    let commits = walk_commits(repo, walk_limit)?;

    // Compute lane layout over the full walked slice.
    let laid_out = assign_lanes(&commits, &label_map, head_id);

    // Commit rows are shifted down by the working-tree node when present.
    let commit_start = offset.saturating_sub(wip_offset);
    let commit_end = (offset + limit).saturating_sub(wip_offset);
    let mut commit_nodes: Vec<GraphNode> = laid_out
        .into_iter()
        .skip(commit_start)
        .take(commit_end - commit_start)
        .collect();
    for node in &mut commit_nodes {
        node.row += wip_offset;
    }

    let mut nodes: Vec<GraphNode> = Vec::new();
    if wip_offset == 1 && offset == 0 {
        if let Some(head_node) = commit_nodes.first() {
            nodes.push(working_tree_node(head_node, change_count));
        }
    }
    nodes.append(&mut commit_nodes);

    Ok(GraphViewport { nodes, total_count, offset })
}

fn count_commits(repo: &Repository) -> anyhow::Result<usize> {
    let mut walk = repo.revwalk().context("failed to create revwalk")?;
    walk.push_head().context("no HEAD — empty repository?")?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .context("failed to set sort")?;
    Ok(walk.count())
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

fn walk_commits(repo: &Repository, limit: usize) -> anyhow::Result<Vec<CommitRaw>> {
    let mut walk = repo.revwalk().context("failed to create revwalk")?;
    walk.push_head().context("no HEAD — empty repository?")?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .context("failed to set sort")?;

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
        result.push(CommitRaw { oid, parents, summary, body, author_name, author_email, author_timestamp });
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

        // Collect edges visible in this row (lanes passing through).
        let mut edges: Vec<GraphEdge> = Vec::new();

        // For each active lane, emit a "straight" edge if it passes through.
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
                // Primary parent inherits this commit's lane (straight continuation).
                active_lanes[lane] = Some(*parent);
                lane_colors[lane] = color_index;
                reserved.insert(*parent, (lane, color_index));
                primary_lane_given = true;
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
        });
    }

    nodes
}

/// Counts changed files in the working tree (modified/staged/untracked,
/// excluding ignored) — the badge count for the working-tree graph node.
fn changed_file_count(repo: &Repository) -> u32 {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).include_ignored(false);
    repo.statuses(Some(&mut opts))
        .map(|s| s.len() as u32)
        .unwrap_or(0)
}

/// The synthetic node representing uncommitted changes, sitting one row above
/// HEAD on HEAD's lane with a straight edge down to it.
fn working_tree_node(head: &GraphNode, change_count: u32) -> GraphNode {
    GraphNode {
        oid: "WORKING_TREE".to_string(),
        short_oid: "WORKING_TREE".to_string(),
        summary: format!("{change_count} uncommitted changes"),
        body: String::new(),
        author_name: String::new(),
        author_email: String::new(),
        author_timestamp: 0,
        lane: head.lane,
        row: 0,
        color_index: head.color_index,
        parents: vec![head.oid.clone()],
        children: Vec::new(),
        edges: vec![GraphEdge {
            src_lane: head.lane,
            dst_lane: head.lane,
            color_index: head.color_index,
            kind: EdgeKind::Straight,
        }],
        branch_labels: Vec::new(),
        is_head: false,
        is_working_tree: true,
        change_count: Some(change_count),
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
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, parents).unwrap()
    }

    fn init_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        (dir, repo)
    }

    #[test]
    fn linear_history_all_in_lane_zero() {
        let (_dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "first", &[])).unwrap();
        let c2 = repo.find_commit(make_commit(&repo, "second", &[&c1])).unwrap();
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
            parent = repo.find_commit(make_commit(&repo, &format!("c{i}"), &[&parent])).unwrap();
        }
        std::fs::write(dir.path().join("x.txt"), "y").unwrap(); // uncommitted

        let viewport = compute_layout(&repo, 2, 3).unwrap();

        assert_eq!(viewport.total_count, 7); // 6 commits + working-tree node
        assert!(viewport.nodes.iter().all(|n| !n.is_working_tree));
        assert_eq!(viewport.nodes[0].row, 2); // rows stay shifted by the WIP node
    }

    #[test]
    fn merge_commit_uses_two_lanes() {
        let (_dir, repo) = init_repo();
        let root = repo.find_commit(make_commit(&repo, "root", &[])).unwrap();
        let b1 = repo.find_commit(make_commit(&repo, "branch-1", &[&root])).unwrap();
        // b2 is a second branch off root — create without touching HEAD
        let b2 = {
            let sig = sig();
            let tree_id = empty_tree(&repo);
            let tree = repo.find_tree(tree_id).unwrap();
            let oid = repo.commit(None, &sig, &sig, "branch-2", &tree, &[&root]).unwrap();
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
