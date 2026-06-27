mod layout;

pub(crate) use layout::diag_log;
pub use layout::{compute_layout_cached, find_commit_row, refresh_working_tree_status, GraphCache};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    /// The commit message body (everything after the summary line).
    #[serde(default)]
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub author_timestamp: i64,
    pub lane: usize,
    pub row: usize,
    pub color_index: usize,
    pub parents: Vec<String>,
    pub children: Vec<String>,
    pub edges: Vec<GraphEdge>,
    pub branch_labels: Vec<BranchLabel>,
    pub is_head: bool,
    /// True for the synthetic "uncommitted changes" node drawn above the
    /// current branch tip. Such a node has a sentinel oid and no real commit.
    #[serde(default)]
    pub is_working_tree: bool,
    /// Number of changed files, set only on the working-tree node.
    #[serde(default)]
    pub change_count: Option<u32>,
    /// True for a stash node, drawn hanging off the commit it was created on
    /// with dotted edges/marker. Its `oid` is the real stash commit oid.
    #[serde(default)]
    pub is_stash: bool,
    /// The stash's index (`stash@{N}`), set only on stash nodes — used by the
    /// pop/drop/rename actions.
    #[serde(default)]
    pub stash_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub src_lane: usize,
    pub dst_lane: usize,
    pub color_index: usize,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EdgeKind {
    Straight,
    Merge,
    Branch,
    /// A dotted edge connecting a stash node to the commit it hangs off (or to
    /// the next stash in a stack). Rendered dashed, not solid.
    Stash,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchLabel {
    pub name: String,
    pub is_remote: bool,
    pub is_tag: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphViewport {
    pub nodes: Vec<GraphNode>,
    pub total_count: usize,
    pub offset: usize,
}
