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

    // Walk the full graph to count total commits (needed for scroll height).
    let total_count = count_commits(repo)?;

    // Walk offset + limit + LOOKAHEAD commits for lane computation accuracy.
    let walk_limit = offset + limit + LOOKAHEAD;
    let raw = walk_commits(repo, walk_limit)?;

    // Compute lane layout over the full walked slice.
    let laid_out = assign_lanes(&raw, &label_map, head_id);

    // Slice to the requested viewport.
    let nodes = laid_out
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();

    Ok(GraphViewport { nodes, total_count, offset })
}

fn count_commits(repo: &Repository) -> anyhow::Result<usize> {
    let mut walk = repo.revwalk().context("failed to create revwalk")?;
    walk.push_head().context("no HEAD — empty repository?")?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .context("failed to set sort")?;
    Ok(walk.count())
}

fn walk_commits(
    repo: &Repository,
    limit: usize,
) -> anyhow::Result<Vec<(git2::Oid, Vec<git2::Oid>)>> {
    let mut walk = repo.revwalk().context("failed to create revwalk")?;
    walk.push_head().context("no HEAD — empty repository?")?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .context("failed to set sort")?;

    let mut result = Vec::new();
    for oid in walk.take(limit) {
        let oid = oid.context("revwalk error")?;
        let commit = repo.find_commit(oid).context("commit not found")?;
        let parents = commit.parent_ids().collect();
        result.push((oid, parents));
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
    commits: &[(git2::Oid, Vec<git2::Oid>)],
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
    for (oid, parents) in commits {
        for parent in parents {
            children_map.entry(*parent).or_default().push(*oid);
        }
    }

    let mut nodes: Vec<GraphNode> = Vec::new();

    for (row, (oid, parents)) in commits.iter().enumerate() {
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
        let commit_str = oid.to_string();

        nodes.push(GraphNode {
            oid: commit_str.clone(),
            short_oid: commit_str[..8].to_string(),
            summary: String::new(), // filled below
            author_name: String::new(),
            author_email: String::new(),
            author_timestamp: 0,
            lane,
            row,
            color_index,
            parents: parents.iter().map(|p| p.to_string()).collect(),
            children: children_map
                .get(oid)
                .map(|v| v.iter().map(|c| c.to_string()).collect())
                .unwrap_or_default(),
            edges,
            branch_labels,
            is_head: head_id == Some(*oid),
        });
    }

    nodes
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
        let (dir, repo) = init_repo();
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
        let (dir, repo) = init_repo();
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
        let (dir, repo) = init_repo();
        let c1 = repo.find_commit(make_commit(&repo, "c1", &[])).unwrap();
        let c2 = repo.find_commit(make_commit(&repo, "c2", &[&c1])).unwrap();
        make_commit(&repo, "c3", &[&c2]);

        let viewport = compute_layout(&repo, 0, 1).unwrap();
        assert_eq!(viewport.total_count, 3);
        assert_eq!(viewport.nodes.len(), 1);
    }
}
