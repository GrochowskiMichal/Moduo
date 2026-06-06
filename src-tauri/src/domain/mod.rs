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

// ─────────────────────────────────────────────────────────────────────────────
// Tasks module v1 — ADHD bucket / commit / execute model.
//
// This is the spec'd Tasks module (docs/moduo-tasks-feature-spec.md §11): buckets
// (exclusive categories), tasks with both due_date and scheduled_at, a today's
// commit queue, recurrence, energy, and a computed `drifted` signal. It is the
// canonical (and only) Tasks model; the legacy Linear-style
// TaskProject/TaskWorkflowState/TaskItem model and its `features/plan` UI were
// removed.
//
// Field names serialize as camelCase (TS interop); enum values serialize as
// snake_case to match the spec vocabulary and the Supabase column values.
// ─────────────────────────────────────────────────────────────────────────────

/// Fixed task lifecycle status. Replaces the legacy per-project `state_id`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    InProgress,
    Done,
    Archived,
}

impl Default for TaskStatus {
    fn default() -> Self {
        TaskStatus::Todo
    }
}

/// Optional per-task energy estimate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnergyLevel {
    Low,
    Medium,
    High,
}

/// Recurrence definition (rrule.js-compatible). Produced by the capture parser.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRule {
    /// RFC 5545 RRULE string, e.g. "FREQ=DAILY;INTERVAL=1".
    pub rrule: String,
    /// Optional anchor datetime (DTSTART), ISO 8601.
    pub dtstart: Option<String>,
    /// Precomputed next occurrence datetime, ISO 8601.
    pub next_occurrence: Option<String>,
}

/// A user-defined, exclusive category for tasks. One task lives in exactly one
/// bucket. `is_system` marks the reserved, undeletable Inbox.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub name: String,
    #[serde(default)]
    pub is_system: bool,
    /// Lexorank-style ordering string.
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// A task in the Tasks module. `drifted` is intentionally NOT stored — it is
/// derived at read time via [`Task::is_drifted`].
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    /// Required: the bucket this task belongs to (Inbox as fallback).
    pub bucket_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// When the task is due.
    pub due_date: Option<String>,
    /// When the task is planned to a clock time. Plain field — works with the
    /// Calendar module hidden. Store as RFC3339 UTC for correct drift compares.
    pub scheduled_at: Option<String>,
    /// Estimated/blocked duration in minutes (default-on-drop, resizable).
    pub duration_minutes: Option<i64>,
    pub recurrence: Option<RecurrenceRule>,
    pub energy_level: Option<EnergyLevel>,
    #[serde(default)]
    pub status: TaskStatus,
    /// Today's-commit-queue membership: the date (YYYY-MM-DD) committed for.
    pub committed_for: Option<String>,
    /// Ordering within the commit queue.
    pub commit_order: Option<i64>,
    /// Ambient count of reschedules. Never blocking (design principle 5).
    #[serde(default)]
    pub reschedule_count: i64,
    /// Lexorank-style ordering string for list/board position.
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

impl Task {
    /// Computed `drifted`: a scheduled task whose time has passed without
    /// completion. `drifted = scheduled_at < now AND status NOT IN (done,
    /// archived)`. `now` is an RFC3339 UTC timestamp; comparison is lexical,
    /// which is correct for same-format UTC timestamps.
    pub fn is_drifted(&self, now: &str) -> bool {
        if matches!(self.status, TaskStatus::Done | TaskStatus::Archived) {
            return false;
        }
        match &self.scheduled_at {
            Some(scheduled) => scheduled.as_str() < now,
            None => false,
        }
    }
}

/// A workspace-level, cross-cutting label. Attached to entities via [`TagLink`].
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// Polymorphic association joining a [`Tag`] to any entity (task, note, …).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagLink {
    pub id: String,
    pub workspace_id: String,
    pub tag_id: String,
    /// Target entity type. Known: "task" | "note" | "email".
    pub entity_type: String,
    pub entity_id: String,
    pub created_at: String,
}

/// Read bundle for the Tasks module, scoped to a workspace.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TasksModuleBundle {
    pub buckets: Vec<Bucket>,
    pub tasks: Vec<Task>,
    pub tags: Vec<Tag>,
    pub tag_links: Vec<TagLink>,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn task_with(scheduled_at: Option<&str>, status: TaskStatus) -> Task {
        Task {
            id: "t1".into(),
            workspace_id: "w1".into(),
            owner_id: "u1".into(),
            bucket_id: "b1".into(),
            title: "x".into(),
            description: String::new(),
            due_date: None,
            scheduled_at: scheduled_at.map(|s| s.to_string()),
            duration_minutes: None,
            recurrence: None,
            energy_level: None,
            status,
            committed_for: None,
            commit_order: None,
            reschedule_count: 0,
            position: String::new(),
            created_at: "2026-06-06T00:00:00Z".into(),
            updated_at: "2026-06-06T00:00:00Z".into(),
            deleted_at: None,
        }
    }

    const NOW: &str = "2026-06-06T12:00:00Z";

    #[test]
    fn drifted_when_scheduled_in_past_and_open() {
        let task = task_with(Some("2026-06-06T08:00:00Z"), TaskStatus::Todo);
        assert!(task.is_drifted(NOW));
        let task = task_with(Some("2026-06-06T08:00:00Z"), TaskStatus::InProgress);
        assert!(task.is_drifted(NOW));
    }

    #[test]
    fn not_drifted_when_scheduled_in_future() {
        let task = task_with(Some("2026-06-06T18:00:00Z"), TaskStatus::Todo);
        assert!(!task.is_drifted(NOW));
    }

    #[test]
    fn not_drifted_when_done_or_archived() {
        let task = task_with(Some("2026-06-06T08:00:00Z"), TaskStatus::Done);
        assert!(!task.is_drifted(NOW));
        let task = task_with(Some("2026-06-06T08:00:00Z"), TaskStatus::Archived);
        assert!(!task.is_drifted(NOW));
    }

    #[test]
    fn not_drifted_when_unscheduled() {
        let task = task_with(None, TaskStatus::Todo);
        assert!(!task.is_drifted(NOW));
    }

    #[test]
    fn status_serializes_as_snake_case() {
        assert_eq!(
            serde_json::to_string(&TaskStatus::InProgress).unwrap(),
            "\"in_progress\""
        );
        assert_eq!(TaskStatus::default(), TaskStatus::Todo);
    }
}
