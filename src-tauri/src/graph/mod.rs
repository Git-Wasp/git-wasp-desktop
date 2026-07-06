mod layout;

pub(crate) use layout::diag_log;
pub use layout::{compute_layout_cached, find_commit_row, set_change_count, GraphCache};

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
    /// True when this commit is the checked-out tip (HEAD) or one of its
    /// ancestors — i.e. it lies on the current branch's line of history. The
    /// frontend's "focus current branch" view mode keeps these coloured and
    /// mutes everything else (sibling branches, commits ahead of HEAD). The flag
    /// is a structural fact computed once here; whether muting is *applied* is a
    /// frontend concern driven by the (persisted) toggle. The working-tree node
    /// is on the line; stash nodes are not.
    #[serde(default)]
    pub on_head_line: bool,
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
    /// True when this edge belongs to the current branch's line of history (see
    /// [`GraphNode::on_head_line`]). Continuation/merge/branch edges take the
    /// source commit's status; a lane passing straight through takes the status
    /// of the commit that owns the lane. Lets the renderer grey off-line edges
    /// in "focus current branch" mode.
    #[serde(default)]
    pub on_head_line: bool,
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
    /// Absolute graph row of the HEAD commit (working-tree offset included), or
    /// `None` when HEAD is unborn. Lets the frontend draw the dotted working-tree
    /// connector down to HEAD's dot even when HEAD isn't in the loaded slice.
    pub head_row: Option<usize>,
}
