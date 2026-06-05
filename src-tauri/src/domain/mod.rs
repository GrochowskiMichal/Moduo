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
pub struct NoteShareTarget {
    pub user_id: String,
    pub permission: String,
}

fn default_note_share_scope() -> String {
    "private".to_string()
}

fn default_note_share_permission() -> String {
    "view".to_string()
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
    #[serde(default = "default_note_share_scope")]
    pub share_scope: String,
    #[serde(default = "default_note_share_permission")]
    pub share_permission: String,
    #[serde(default)]
    pub shares: Vec<NoteShareTarget>,
    #[serde(default = "default_note_share_permission")]
    pub effective_permission: String,
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
pub struct ProjectLabel {
    pub name: String,
    pub color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProject {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub name: String,
    pub description: String,
    pub logo_url: Option<String>,
    #[serde(default)]
    pub labels: Vec<ProjectLabel>,
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
    pub icon: Option<String>,
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
    pub task_code: Option<String>,
    pub parent_task_id: Option<String>,
    pub child_of_task_id: Option<String>,
    #[serde(default)]
    pub blocked_by_task_ids: Vec<String>,
    pub duplicate_of_task_id: Option<String>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActivity {
    pub id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub actor_user_id: String,
    pub action: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TasksBundle {
    pub projects: Vec<TaskProject>,
    pub states: Vec<TaskWorkflowState>,
    pub tasks: Vec<TaskItem>,
    pub comments: Vec<TaskComment>,
    pub activities: Vec<TaskActivity>,
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

// ─── Timetracking Domain Types ────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_secs: i64,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub url: Option<String>,
    pub category_id: Option<String>,
    pub project_id: Option<String>,
    pub is_manual: bool,
    pub is_meeting: bool,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeCategory {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub productivity_score: f32,
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRule {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub category_id: String,
    pub match_type: String,
    pub match_value: String,
    pub is_ai_generated: bool,
    pub confidence: f32,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeProject {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub name: String,
    pub color: String,
    pub client_name: String,
    pub budget_hours: Option<f64>,
    pub linked_task_project_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub target_minutes: i32,
    pub category_id: Option<String>,
    pub label: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimetrackingBundle {
    pub entries: Vec<TimeEntry>,
    pub categories: Vec<TimeCategory>,
    pub rules: Vec<CategoryRule>,
    pub projects: Vec<TimeProject>,
    pub focus_sessions: Vec<FocusSession>,
}
