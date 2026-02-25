use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModulePermissions {
    pub notes: String,
    pub tasks: String,
}

impl Default for ModulePermissions {
    fn default() -> Self {
        Self {
            notes: "admin".to_string(),
            tasks: "admin".to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub role: String,
    pub permissions: ModulePermissions,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMember {
    pub id: String,
    pub workspace_id: String,
    pub user_id: String,
    pub role: String,
    pub is_active: bool,
    pub removed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInvite {
    pub id: String,
    pub workspace_id: String,
    pub email: String,
    pub role: String,
    pub status: String,
    pub token: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceNotification {
    pub id: String,
    pub workspace_id: Option<String>,
    pub event_type: String,
    pub actor_user_id: Option<String>,
    pub source_module: Option<String>,
    pub source_resource_type: Option<String>,
    pub source_resource_id: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: String,
    pub read_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub icon: Option<String>,
    pub kind: String,
    pub tags: Vec<String>,
    pub is_pinned: bool,
    pub position: String,
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCrdtUpdate {
    pub idempotency_key: String,
    pub workspace_id: String,
    pub note_id: String,
    pub client_id: String,
    pub client_seq: i64,
    pub update_b64: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocState {
    pub snapshot_b64: String,
    pub last_compacted_update_id: i64,
    pub updates: Vec<NoteCrdtUpdate>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProject {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub name: String,
    pub description: String,
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorkflowState {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub project_id: String,
    pub name: String,
    pub kind: String,
    pub color: Option<String>,
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub project_id: String,
    pub parent_task_id: Option<String>,
    pub state_id: String,
    pub assignee_id: Option<String>,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub priority: i16,
    pub due_date: Option<String>,
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskComment {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub task_id: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TasksBundle {
    pub projects: Vec<TaskProject>,
    pub states: Vec<TaskWorkflowState>,
    pub tasks: Vec<TaskItem>,
    pub comments: Vec<TaskComment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub node_type: String,
    pub workspace_id: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub edge_type: String,
    pub workspace_id: String,
    pub from_id: String,
    pub to_id: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphHybridQuery {
    pub workspace_id: String,
    pub query: String,
    pub node_types: Vec<String>,
    pub limit: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphHybridResult {
    pub node_id: String,
    pub score: f32,
    pub payload: serde_json::Value,
}
