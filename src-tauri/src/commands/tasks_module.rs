//! Tasks module v1 data-layer commands — buckets / tasks / tags.
//!
//! This is the spec'd ADHD bucket/commit/execute Tasks model (see
//! `docs/moduo-tasks-feature-spec.md` §11 and `docs/moduo-architecture-vocabulary.md`).
//! It is the canonical Tasks model going forward and supersedes the legacy
//! Linear-style `commands/tasks.rs` (TaskProject / TaskWorkflowState / TaskItem),
//! which is slated for removal together with its `features/plan` UI in a later
//! session.
//!
//! Scope of this session is the data layer only (schema + CRUD + Inbox seeding +
//! computed drift). The commit-queue / Execute-mode behavior and cloud-sync
//! wiring are intentionally deferred — the fields exist; the logic lands later.
//!
//! The small permission/identity helpers below are duplicated from
//! `commands/tasks.rs` on purpose, so this module stays self-contained and the
//! legacy file can be deleted wholesale later without breaking this one.

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::{domain::*, AppState};

/// Reserved system bucket name.
const INBOX_NAME: &str = "Inbox";

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn require_user_id(state: &AppState) -> Result<String, String> {
    let session = state
        .session
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Not authenticated".to_string())?;
    Ok(session.user.id)
}

fn deny_with_audit(
    state: &AppState,
    user_id: Option<&str>,
    workspace_id: &str,
    action: &str,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "workspaceId": workspace_id,
        "module": "tasks",
        "action": action,
        "userId": user_id,
    });
    let _ = state.store.append_audit_log("acl_forbidden", &payload);
    Err("Forbidden".to_string())
}

fn require_tasks_permission(
    state: &AppState,
    workspace_id: &str,
    min_level: &str,
    action: &str,
) -> Result<String, String> {
    let user_id = require_user_id(state)?;
    let allowed = state
        .acl
        .workspace_can_module(&state.store, workspace_id, &user_id, "tasks", min_level)
        .map_err(|e| e.to_string())?;
    if !allowed {
        deny_with_audit(state, Some(&user_id), workspace_id, action)?;
    }
    Ok(user_id)
}

/// Ensure the workspace has its reserved, undeletable Inbox bucket. Idempotent —
/// safe to call on every read. Returns the existing or newly-created Inbox.
fn ensure_inbox_bucket(
    state: &AppState,
    workspace_id: &str,
    owner_id: &str,
) -> Result<Bucket, String> {
    let buckets = state
        .store
        .list_buckets(workspace_id)
        .map_err(|e| e.to_string())?;
    if let Some(inbox) = buckets
        .into_iter()
        .find(|b| b.is_system && b.deleted_at.is_none())
    {
        return Ok(inbox);
    }
    let now = now_iso();
    let inbox = Bucket {
        id: Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        owner_id: owner_id.to_string(),
        name: INBOX_NAME.to_string(),
        is_system: true,
        // Sort first; lexorank "a0" is a low anchor.
        position: "a0".to_string(),
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    };
    state.store.put_bucket(&inbox).map_err(|e| e.to_string())?;
    Ok(inbox)
}

#[tauri::command]
pub async fn tasks_module_list(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<TasksModuleBundle, String> {
    let user_id = require_tasks_permission(&state, &workspace_id, "view", "list")?;
    // Lazily seed the reserved Inbox bucket on first read of a workspace.
    let _ = ensure_inbox_bucket(&state, &workspace_id, &user_id)?;
    state
        .store
        .list_tasks_module_bundle(&workspace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tasks_module_seed_inbox(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Bucket, String> {
    let user_id = require_tasks_permission(&state, &workspace_id, "edit", "seed_inbox")?;
    ensure_inbox_bucket(&state, &workspace_id, &user_id)
}

#[tauri::command]
pub async fn tasks_module_upsert_bucket(
    state: State<'_, AppState>,
    bucket: Bucket,
) -> Result<Bucket, String> {
    let user_id =
        require_tasks_permission(&state, &bucket.workspace_id, "edit", "upsert_bucket")?;
    let mut next = bucket;
    if next.id.trim().is_empty() {
        next.id = Uuid::new_v4().to_string();
    }
    if next.owner_id.trim().is_empty() {
        next.owner_id = user_id;
    }
    // `is_system` is owned by the seeding path only: clients can never promote a
    // bucket to the reserved Inbox, nor demote an existing system bucket.
    let existing = state.store.get_bucket(&next.id).map_err(|e| e.to_string())?;
    let now = now_iso();
    match &existing {
        Some(prev) => {
            next.is_system = prev.is_system;
            next.created_at = prev.created_at.clone();
        }
        None => {
            next.is_system = false;
            if next.created_at.trim().is_empty() {
                next.created_at = now.clone();
            }
        }
    }
    next.updated_at = now;
    state.store.put_bucket(&next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketDeleteInput {
    pub workspace_id: String,
    pub bucket_id: String,
}

#[tauri::command]
pub async fn tasks_module_delete_bucket(
    state: State<'_, AppState>,
    input: BucketDeleteInput,
) -> Result<(), String> {
    let user_id =
        require_tasks_permission(&state, &input.workspace_id, "edit", "delete_bucket")?;
    let mut bucket = state
        .store
        .get_bucket(&input.bucket_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Bucket not found".to_string())?;
    if bucket.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }
    if bucket.is_system {
        return Err("The Inbox bucket cannot be deleted".to_string());
    }

    // Reassign this bucket's live tasks to Inbox so no task is left orphaned.
    let inbox = ensure_inbox_bucket(&state, &input.workspace_id, &user_id)?;
    let now = now_iso();
    let tasks = state
        .store
        .list_tasks(&input.workspace_id)
        .map_err(|e| e.to_string())?;
    for mut task in tasks {
        if task.bucket_id == bucket.id && task.deleted_at.is_none() {
            task.bucket_id = inbox.id.clone();
            task.updated_at = now.clone();
            state.store.put_task(&task).map_err(|e| e.to_string())?;
        }
    }

    bucket.deleted_at = Some(now.clone());
    bucket.updated_at = now;
    state.store.put_bucket(&bucket).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn tasks_module_upsert_task(
    state: State<'_, AppState>,
    task: Task,
) -> Result<Task, String> {
    let user_id = require_tasks_permission(&state, &task.workspace_id, "edit", "upsert_task")?;
    let mut next = task;
    if next.id.trim().is_empty() {
        next.id = Uuid::new_v4().to_string();
    }
    if next.owner_id.trim().is_empty() {
        next.owner_id = user_id.clone();
    }

    // Every task lives in exactly one bucket. An empty, unknown, deleted, or
    // cross-workspace bucket falls back to Inbox (spec §6 / §7 fallback).
    let bucket_ok = if next.bucket_id.trim().is_empty() {
        false
    } else {
        matches!(
            state.store.get_bucket(&next.bucket_id).map_err(|e| e.to_string())?,
            Some(b) if b.workspace_id == next.workspace_id && b.deleted_at.is_none()
        )
    };
    if !bucket_ok {
        next.bucket_id = ensure_inbox_bucket(&state, &next.workspace_id, &user_id)?.id;
    }

    let existing = state.store.get_task(&next.id).map_err(|e| e.to_string())?;
    let now = now_iso();
    match &existing {
        Some(prev) => next.created_at = prev.created_at.clone(),
        None => {
            if next.created_at.trim().is_empty() {
                next.created_at = now.clone();
            }
        }
    }
    next.updated_at = now;
    state.store.put_task(&next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDeleteInput {
    pub workspace_id: String,
    pub task_id: String,
}

#[tauri::command]
pub async fn tasks_module_delete_task(
    state: State<'_, AppState>,
    input: TaskDeleteInput,
) -> Result<Task, String> {
    let _ = require_tasks_permission(&state, &input.workspace_id, "edit", "delete_task")?;
    let mut task = state
        .store
        .get_task(&input.task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found".to_string())?;
    if task.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }
    let now = now_iso();
    task.deleted_at = Some(now.clone());
    task.updated_at = now;
    state.store.put_task(&task).map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub async fn tasks_module_upsert_tag(
    state: State<'_, AppState>,
    tag: Tag,
) -> Result<Tag, String> {
    let user_id = require_tasks_permission(&state, &tag.workspace_id, "edit", "upsert_tag")?;
    let mut next = tag;
    if next.id.trim().is_empty() {
        next.id = Uuid::new_v4().to_string();
    }
    if next.owner_id.trim().is_empty() {
        next.owner_id = user_id;
    }
    let existing = state.store.get_tag(&next.id).map_err(|e| e.to_string())?;
    let now = now_iso();
    match &existing {
        Some(prev) => next.created_at = prev.created_at.clone(),
        None => {
            if next.created_at.trim().is_empty() {
                next.created_at = now.clone();
            }
        }
    }
    next.updated_at = now;
    state.store.put_tag(&next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDeleteInput {
    pub workspace_id: String,
    pub tag_id: String,
}

#[tauri::command]
pub async fn tasks_module_delete_tag(
    state: State<'_, AppState>,
    input: TagDeleteInput,
) -> Result<(), String> {
    let _ = require_tasks_permission(&state, &input.workspace_id, "edit", "delete_tag")?;
    let Some(mut tag) = state.store.get_tag(&input.tag_id).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    if tag.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }

    // Hard-remove all links for this tag (associations carry no own history).
    let links = state
        .store
        .list_tag_links(&input.workspace_id)
        .map_err(|e| e.to_string())?;
    for link in links {
        if link.tag_id == tag.id {
            let _ = state.store.remove_tag_link(&link.id);
        }
    }

    let now = now_iso();
    tag.deleted_at = Some(now.clone());
    tag.updated_at = now;
    state.store.put_tag(&tag).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAttachInput {
    pub workspace_id: String,
    pub tag_id: String,
    pub entity_type: String,
    pub entity_id: String,
}

#[tauri::command]
pub async fn tasks_module_attach_tag(
    state: State<'_, AppState>,
    input: TagAttachInput,
) -> Result<TagLink, String> {
    let _ = require_tasks_permission(&state, &input.workspace_id, "edit", "attach_tag")?;
    // Idempotent: reuse an existing link for the same (tag, entity) tuple.
    let links = state
        .store
        .list_tag_links(&input.workspace_id)
        .map_err(|e| e.to_string())?;
    if let Some(existing) = links.into_iter().find(|l| {
        l.tag_id == input.tag_id
            && l.entity_type == input.entity_type
            && l.entity_id == input.entity_id
    }) {
        return Ok(existing);
    }
    let link = TagLink {
        id: Uuid::new_v4().to_string(),
        workspace_id: input.workspace_id,
        tag_id: input.tag_id,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        created_at: now_iso(),
    };
    state.store.put_tag_link(&link).map_err(|e| e.to_string())?;
    Ok(link)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDetachInput {
    pub workspace_id: String,
    pub tag_id: String,
    pub entity_type: String,
    pub entity_id: String,
}

#[tauri::command]
pub async fn tasks_module_detach_tag(
    state: State<'_, AppState>,
    input: TagDetachInput,
) -> Result<(), String> {
    let _ = require_tasks_permission(&state, &input.workspace_id, "edit", "detach_tag")?;
    let links = state
        .store
        .list_tag_links(&input.workspace_id)
        .map_err(|e| e.to_string())?;
    for link in links {
        if link.tag_id == input.tag_id
            && link.entity_type == input.entity_type
            && link.entity_id == input.entity_id
        {
            let _ = state.store.remove_tag_link(&link.id);
        }
    }
    Ok(())
}
