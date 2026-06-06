mod layout;

pub use layout::compute_layout;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
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
