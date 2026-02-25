use serde::{Deserialize, Serialize};

use crate::domain::{NoteMeta, TaskComment, TaskItem, TaskProject, TaskWorkflowState};
use crate::store_redb::RedbStore;

const MIGRATION_KEY: &str = "legacy_v1";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPayload {
    pub notes: Vec<NoteMeta>,
    pub task_projects: Vec<TaskProject>,
    pub task_states: Vec<TaskWorkflowState>,
    pub task_items: Vec<TaskItem>,
    pub task_comments: Vec<TaskComment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub already_migrated: bool,
    pub imported: bool,
    pub notes_count: usize,
    pub task_projects_count: usize,
    pub task_states_count: usize,
    pub task_items_count: usize,
    pub task_comments_count: usize,
    pub checksums: std::collections::HashMap<String, String>,
}

pub fn import_legacy_payload(store: &RedbStore, payload: LegacyPayload) -> anyhow::Result<MigrationReport> {
    if store.get_migration_marker(MIGRATION_KEY)?.is_some() {
        return Ok(MigrationReport {
            already_migrated: true,
            imported: false,
            notes_count: 0,
            task_projects_count: 0,
            task_states_count: 0,
            task_items_count: 0,
            task_comments_count: 0,
            checksums: std::collections::HashMap::new(),
        });
    }

    for note in &payload.notes {
        store.put_note(note)?;
    }

    for project in &payload.task_projects {
        store.put_task_project(project)?;
    }

    for state in &payload.task_states {
        store.put_task_state(state)?;
    }

    for item in &payload.task_items {
        store.put_task_item(item)?;
    }

    for comment in &payload.task_comments {
        store.put_task_comment(comment)?;
    }

    store.set_migration_marker(MIGRATION_KEY, &chrono::Utc::now().to_rfc3339())?;

    let workspace_id = payload
        .notes
        .first()
        .map(|n| n.workspace_id.clone())
        .or_else(|| payload.task_projects.first().map(|p| p.workspace_id.clone()))
        .unwrap_or_else(|| "default-workspace".to_string());

    let checksums = store.dump_workspace_hashes(&workspace_id)?;

    Ok(MigrationReport {
        already_migrated: false,
        imported: true,
        notes_count: payload.notes.len(),
        task_projects_count: payload.task_projects.len(),
        task_states_count: payload.task_states.len(),
        task_items_count: payload.task_items.len(),
        task_comments_count: payload.task_comments.len(),
        checksums,
    })
}
