use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use anyhow::Context;
use redb::{Database, ReadableTable, TableDefinition};
use serde::{de::DeserializeOwned, Serialize};

use crate::domain::{
    GraphEdge, GraphNode, ModulePermissions, NoteCrdtUpdate, NoteDocState, NoteMeta, TaskComment,
    TaskItem, TaskProject, TaskWorkflowState, TasksBundle, WorkspaceInvite, WorkspaceMember,
    WorkspaceNotification, WorkspaceSummary,
};

pub const NOTES_META: TableDefinition<&str, &str> = TableDefinition::new("notes_meta");
pub const NOTES_NODES: TableDefinition<&str, &str> = TableDefinition::new("notes_nodes");
pub const NOTES_DOC_STATE: TableDefinition<&str, &str> = TableDefinition::new("notes_doc_state");
pub const NOTES_OUTBOX: TableDefinition<&str, &str> = TableDefinition::new("notes_outbox");
pub const NOTES_OPLOG: TableDefinition<&str, &str> = TableDefinition::new("notes_oplog");

pub const TASKS_PROJECTS: TableDefinition<&str, &str> = TableDefinition::new("tasks_projects");
pub const TASKS_STATES: TableDefinition<&str, &str> = TableDefinition::new("tasks_states");
pub const TASKS_ITEMS: TableDefinition<&str, &str> = TableDefinition::new("tasks_items");
pub const TASKS_COMMENTS: TableDefinition<&str, &str> = TableDefinition::new("tasks_comments");
pub const TASKS_OUTBOX: TableDefinition<&str, &str> = TableDefinition::new("tasks_outbox");
pub const TASKS_OPLOG: TableDefinition<&str, &str> = TableDefinition::new("tasks_oplog");

pub const WORKSPACE_MEMBERSHIP: TableDefinition<&str, &str> =
    TableDefinition::new("workspace_membership");
pub const WORKSPACE_ACL: TableDefinition<&str, &str> = TableDefinition::new("workspace_acl");
pub const WORKSPACES: TableDefinition<&str, &str> = TableDefinition::new("workspaces");
pub const WORKSPACE_INVITES: TableDefinition<&str, &str> = TableDefinition::new("workspace_invites");
pub const WORKSPACE_NOTIFICATIONS: TableDefinition<&str, &str> =
    TableDefinition::new("workspace_notifications");

pub const DEVICE_IDENTITY: TableDefinition<&str, &str> = TableDefinition::new("device_identity");
pub const MIGRATION_MARKERS: TableDefinition<&str, &str> = TableDefinition::new("migration_markers");

pub const GRAPH_NODES: TableDefinition<&str, &str> = TableDefinition::new("graph_nodes");
pub const GRAPH_EDGES: TableDefinition<&str, &str> = TableDefinition::new("graph_edges");
pub const GRAPH_VECTORS: TableDefinition<&str, &str> = TableDefinition::new("graph_vectors");

pub const OP_IDEMPOTENCY: TableDefinition<&str, &str> = TableDefinition::new("op_idempotency");
pub const DEVICE_SEQ: TableDefinition<&str, &str> = TableDefinition::new("device_seq");
pub const AUDIT_LOG: TableDefinition<&str, &str> = TableDefinition::new("audit_log");

pub struct RedbStore {
    db: Database,
    write_guard: Mutex<()>,
}

impl RedbStore {
    fn ensure_schema(db: &Database) -> anyhow::Result<()> {
        let write_txn = db.begin_write()?;
        let _ = write_txn.open_table(NOTES_META)?;
        let _ = write_txn.open_table(NOTES_NODES)?;
        let _ = write_txn.open_table(NOTES_DOC_STATE)?;
        let _ = write_txn.open_table(NOTES_OUTBOX)?;
        let _ = write_txn.open_table(NOTES_OPLOG)?;

        let _ = write_txn.open_table(TASKS_PROJECTS)?;
        let _ = write_txn.open_table(TASKS_STATES)?;
        let _ = write_txn.open_table(TASKS_ITEMS)?;
        let _ = write_txn.open_table(TASKS_COMMENTS)?;
        let _ = write_txn.open_table(TASKS_OUTBOX)?;
        let _ = write_txn.open_table(TASKS_OPLOG)?;

        let _ = write_txn.open_table(WORKSPACES)?;
        let _ = write_txn.open_table(WORKSPACE_MEMBERSHIP)?;
        let _ = write_txn.open_table(WORKSPACE_ACL)?;
        let _ = write_txn.open_table(WORKSPACE_INVITES)?;
        let _ = write_txn.open_table(WORKSPACE_NOTIFICATIONS)?;

        let _ = write_txn.open_table(DEVICE_IDENTITY)?;
        let _ = write_txn.open_table(MIGRATION_MARKERS)?;

        let _ = write_txn.open_table(GRAPH_NODES)?;
        let _ = write_txn.open_table(GRAPH_EDGES)?;
        let _ = write_txn.open_table(GRAPH_VECTORS)?;

        let _ = write_txn.open_table(OP_IDEMPOTENCY)?;
        let _ = write_txn.open_table(DEVICE_SEQ)?;
        let _ = write_txn.open_table(AUDIT_LOG)?;
        write_txn.commit()?;
        Ok(())
    }

    fn corrupt_backup_path(path: &Path) -> PathBuf {
        let base = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("moduo_desktop.redb");
        let ts = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
        path.with_file_name(format!("{base}.corrupt.{ts}"))
    }

    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let db = if path.exists() {
            let mut opened: Option<Database> = None;
            let mut last_err: Option<anyhow::Error> = None;
            for attempt in 0..6 {
                match Database::open(path) {
                    Ok(db) => {
                        opened = Some(db);
                        last_err = None;
                        break;
                    }
                    Err(err) => {
                        last_err = Some(anyhow::anyhow!(err).context("open redb database"));
                        std::thread::sleep(Duration::from_millis(50 * (attempt + 1) as u64));
                    }
                }
            }
            if let Some(db) = opened {
                db
            } else if let Some(err) = last_err {
                let backup_path = Self::corrupt_backup_path(path);
                eprintln!(
                    "[RedbStore] Failed to open {:?} ({}). Moving to {:?} and recreating a fresh DB.",
                    path, err, backup_path
                );
                let _ = fs::rename(path, &backup_path);
                Database::create(path).context("create redb database after recovery")?
            } else {
                Database::create(path).context("create redb database after recovery")?
            }
        } else {
            Database::create(path).context("create redb database")?
        };

        if let Err(err) = Self::ensure_schema(&db) {
            let backup_path = Self::corrupt_backup_path(path);
            eprintln!(
                "[RedbStore] Schema init failed for {:?} ({}). Moving to {:?} and recreating a fresh DB.",
                path, err, backup_path
            );
            let _ = fs::rename(path, &backup_path);
            let fresh = Database::create(path).context("create redb database after schema recovery")?;
            Self::ensure_schema(&fresh)?;
            return Ok(Self {
                db: fresh,
                write_guard: Mutex::new(()),
            });
        }

        Ok(Self {
            db,
            write_guard: Mutex::new(()),
        })
    }

    pub fn wipe_all(&self) -> anyhow::Result<()> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        let tables = [
            NOTES_META,
            NOTES_NODES,
            NOTES_DOC_STATE,
            NOTES_OUTBOX,
            NOTES_OPLOG,
            TASKS_PROJECTS,
            TASKS_STATES,
            TASKS_ITEMS,
            TASKS_COMMENTS,
            TASKS_OUTBOX,
            TASKS_OPLOG,
            WORKSPACES,
            WORKSPACE_MEMBERSHIP,
            WORKSPACE_ACL,
            WORKSPACE_INVITES,
            WORKSPACE_NOTIFICATIONS,
            DEVICE_IDENTITY,
            MIGRATION_MARKERS,
            GRAPH_NODES,
            GRAPH_EDGES,
            GRAPH_VECTORS,
            OP_IDEMPOTENCY,
            DEVICE_SEQ,
            AUDIT_LOG,
        ];

        for table_def in tables {
            let mut table = write_txn.open_table(table_def)?;
            let mut keys = Vec::new();
            for row in table.iter()? {
                let (key, _) = row?;
                keys.push(key.value().to_string());
            }
            for key in keys {
                let _ = table.remove(key.as_str())?;
            }
        }

        write_txn.commit()?;
        Ok(())
    }

    fn put_json<T: Serialize>(
        &self,
        table_def: TableDefinition<&str, &str>,
        key: &str,
        value: &T,
    ) -> anyhow::Result<()> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(table_def)?;
            let payload = serde_json::to_string(value)?;
            table.insert(key, payload.as_str())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    fn remove_key(&self, table_def: TableDefinition<&str, &str>, key: &str) -> anyhow::Result<()> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(table_def)?;
            let _ = table.remove(key)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    fn get_json<T: DeserializeOwned>(
        &self,
        table_def: TableDefinition<&str, &str>,
        key: &str,
    ) -> anyhow::Result<Option<T>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(table_def)?;
        let Some(value) = table.get(key)? else {
            return Ok(None);
        };
        let parsed = serde_json::from_str::<T>(value.value())?;
        Ok(Some(parsed))
    }

    fn list_json<T: DeserializeOwned>(&self, table_def: TableDefinition<&str, &str>) -> anyhow::Result<Vec<T>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(table_def)?;
        let mut items = Vec::new();
        for result in table.iter()? {
            let (_, value) = result?;
            let parsed = serde_json::from_str::<T>(value.value())?;
            items.push(parsed);
        }
        Ok(items)
    }

    pub fn next_device_seq(&self, device_id: &str) -> anyhow::Result<i64> {
        let key = format!("device:{}", device_id);
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        let next = {
            let mut table = write_txn.open_table(DEVICE_SEQ)?;
            let current = table
                .get(key.as_str())?
                .map(|v| v.value().parse::<i64>().unwrap_or_default())
                .unwrap_or_default();
            let next = current + 1;
            let next_text = next.to_string();
            table.insert(key.as_str(), next_text.as_str())?;
            next
        };
        write_txn.commit()?;
        Ok(next)
    }

    pub fn try_register_op(&self, idempotency_key: &str) -> anyhow::Result<bool> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        let inserted = {
            let mut table = write_txn.open_table(OP_IDEMPOTENCY)?;
            if table.get(idempotency_key)?.is_some() {
                false
            } else {
                table.insert(idempotency_key, "1")?;
                true
            }
        };
        write_txn.commit()?;
        Ok(inserted)
    }

    pub fn put_workspace(&self, workspace: &WorkspaceSummary) -> anyhow::Result<()> {
        self.put_json(WORKSPACES, &workspace.id, workspace)
    }

    pub fn list_workspaces(&self) -> anyhow::Result<Vec<WorkspaceSummary>> {
        self.list_json(WORKSPACES)
    }

    pub fn put_workspace_member(&self, member: &WorkspaceMember) -> anyhow::Result<()> {
        self.put_json(WORKSPACE_MEMBERSHIP, &member.id, member)
    }

    pub fn list_workspace_members(&self, workspace_id: &str) -> anyhow::Result<Vec<WorkspaceMember>> {
        Ok(self
            .list_json::<WorkspaceMember>(WORKSPACE_MEMBERSHIP)?
            .into_iter()
            .filter(|m| m.workspace_id == workspace_id)
            .collect())
    }

    pub fn list_all_workspace_members(&self) -> anyhow::Result<Vec<WorkspaceMember>> {
        self.list_json(WORKSPACE_MEMBERSHIP)
    }

    pub fn put_workspace_invite(&self, invite: &WorkspaceInvite) -> anyhow::Result<()> {
        self.put_json(WORKSPACE_INVITES, &invite.id, invite)
    }

    pub fn list_workspace_invites(&self, workspace_id: &str) -> anyhow::Result<Vec<WorkspaceInvite>> {
        Ok(self
            .list_json::<WorkspaceInvite>(WORKSPACE_INVITES)?
            .into_iter()
            .filter(|m| m.workspace_id == workspace_id)
            .collect())
    }

    pub fn list_all_workspace_invites(&self) -> anyhow::Result<Vec<WorkspaceInvite>> {
        self.list_json(WORKSPACE_INVITES)
    }

    pub fn put_notification(&self, notification: &WorkspaceNotification) -> anyhow::Result<()> {
        self.put_json(WORKSPACE_NOTIFICATIONS, &notification.id, notification)
    }

    pub fn list_notifications(&self) -> anyhow::Result<Vec<WorkspaceNotification>> {
        self.list_json(WORKSPACE_NOTIFICATIONS)
    }

    pub fn put_note(&self, note: &NoteMeta) -> anyhow::Result<()> {
        self.put_json(NOTES_NODES, &note.id, note)
    }

    pub fn get_note(&self, note_id: &str) -> anyhow::Result<Option<NoteMeta>> {
        self.get_json(NOTES_NODES, note_id)
    }

    pub fn list_notes(&self, workspace_id: &str) -> anyhow::Result<Vec<NoteMeta>> {
        Ok(self
            .list_json::<NoteMeta>(NOTES_NODES)?
            .into_iter()
            .filter(|n| n.workspace_id == workspace_id)
            .collect())
    }

    pub fn put_note_doc_state(&self, note_id: &str, state: &NoteDocState) -> anyhow::Result<()> {
        self.put_json(NOTES_DOC_STATE, note_id, state)
    }

    pub fn get_note_doc_state(&self, note_id: &str) -> anyhow::Result<NoteDocState> {
        Ok(self.get_json(NOTES_DOC_STATE, note_id)?.unwrap_or_default())
    }

    pub fn append_note_update(&self, update: &NoteCrdtUpdate) -> anyhow::Result<()> {
        let key = format!(
            "{}:{}:{}:{}",
            update.workspace_id, update.note_id, update.client_id, update.client_seq
        );
        self.put_json(NOTES_OPLOG, key.as_str(), update)
    }

    pub fn put_task_project(&self, project: &TaskProject) -> anyhow::Result<()> {
        self.put_json(TASKS_PROJECTS, &project.id, project)
    }

    pub fn put_task_state(&self, state: &TaskWorkflowState) -> anyhow::Result<()> {
        self.put_json(TASKS_STATES, &state.id, state)
    }

    pub fn put_task_item(&self, task: &TaskItem) -> anyhow::Result<()> {
        self.put_json(TASKS_ITEMS, &task.id, task)
    }

    pub fn put_task_comment(&self, comment: &TaskComment) -> anyhow::Result<()> {
        self.put_json(TASKS_COMMENTS, &comment.id, comment)
    }

    pub fn get_task_item(&self, task_id: &str) -> anyhow::Result<Option<TaskItem>> {
        self.get_json(TASKS_ITEMS, task_id)
    }

    pub fn get_task_comment(&self, comment_id: &str) -> anyhow::Result<Option<TaskComment>> {
        self.get_json(TASKS_COMMENTS, comment_id)
    }

    pub fn remove_task_comment(&self, comment_id: &str) -> anyhow::Result<()> {
        self.remove_key(TASKS_COMMENTS, comment_id)
    }

    pub fn list_tasks_bundle(&self, workspace_id: &str) -> anyhow::Result<TasksBundle> {
        let projects = self
            .list_json::<TaskProject>(TASKS_PROJECTS)?
            .into_iter()
            .filter(|x| x.workspace_id == workspace_id)
            .collect();
        let states = self
            .list_json::<TaskWorkflowState>(TASKS_STATES)?
            .into_iter()
            .filter(|x| x.workspace_id == workspace_id)
            .collect();
        let tasks = self
            .list_json::<TaskItem>(TASKS_ITEMS)?
            .into_iter()
            .filter(|x| x.workspace_id == workspace_id)
            .collect();
        let comments = self
            .list_json::<TaskComment>(TASKS_COMMENTS)?
            .into_iter()
            .filter(|x| x.workspace_id == workspace_id)
            .collect();

        Ok(TasksBundle {
            projects,
            states,
            tasks,
            comments,
        })
    }

    pub fn put_device_identity(&self, device_id: &str, payload: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(DEVICE_IDENTITY, device_id, payload)
    }

    pub fn get_device_identity(&self, device_id: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(DEVICE_IDENTITY, device_id)
    }

    pub fn set_migration_marker(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(MIGRATION_MARKERS)?;
            table.insert(key, value)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn get_migration_marker(&self, key: &str) -> anyhow::Result<Option<String>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(MIGRATION_MARKERS)?;
        Ok(table.get(key)?.map(|v| v.value().to_string()))
    }

    pub fn put_graph_node(&self, node: &GraphNode) -> anyhow::Result<()> {
        self.put_json(GRAPH_NODES, &node.id, node)
    }

    pub fn put_graph_edge(&self, edge: &GraphEdge) -> anyhow::Result<()> {
        self.put_json(GRAPH_EDGES, &edge.id, edge)
    }

    pub fn list_graph_nodes(&self, workspace_id: &str) -> anyhow::Result<Vec<GraphNode>> {
        Ok(self
            .list_json::<GraphNode>(GRAPH_NODES)?
            .into_iter()
            .filter(|n| n.workspace_id == workspace_id)
            .collect())
    }

    pub fn list_graph_edges(&self, workspace_id: &str) -> anyhow::Result<Vec<GraphEdge>> {
        Ok(self
            .list_json::<GraphEdge>(GRAPH_EDGES)?
            .into_iter()
            .filter(|n| n.workspace_id == workspace_id)
            .collect())
    }

    pub fn upsert_workspace_acl(
        &self,
        workspace_id: &str,
        user_id: &str,
        permissions: &ModulePermissions,
    ) -> anyhow::Result<()> {
        let key = format!("{}:{}", workspace_id, user_id);
        self.put_json(WORKSPACE_ACL, key.as_str(), permissions)
    }

    pub fn get_workspace_acl(
        &self,
        workspace_id: &str,
        user_id: &str,
    ) -> anyhow::Result<Option<ModulePermissions>> {
        let key = format!("{}:{}", workspace_id, user_id);
        self.get_json(WORKSPACE_ACL, key.as_str())
    }

    pub fn kv_set(&self, namespace: &str, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        let namespaced = format!("{}:{}", namespace, key);
        self.put_json(NOTES_META, namespaced.as_str(), value)
    }

    pub fn kv_get(&self, namespace: &str, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        let namespaced = format!("{}:{}", namespace, key);
        self.get_json(NOTES_META, namespaced.as_str())
    }

    pub fn kv_remove(&self, namespace: &str, key: &str) -> anyhow::Result<()> {
        let namespaced = format!("{}:{}", namespace, key);
        self.remove_key(NOTES_META, namespaced.as_str())
    }

    pub fn append_audit_log(&self, event_type: &str, payload: &serde_json::Value) -> anyhow::Result<()> {
        let key = format!(
            "{}:{}:{}",
            chrono::Utc::now().timestamp_millis(),
            fastrand::u32(..),
            event_type
        );
        let entry = serde_json::json!({
            "eventType": event_type,
            "createdAt": chrono::Utc::now().to_rfc3339(),
            "payload": payload,
        });
        self.put_json(AUDIT_LOG, key.as_str(), &entry)
    }

    pub fn apply_note_update_atomic(
        &self,
        note: &NoteMeta,
        update: Option<&NoteCrdtUpdate>,
        idempotency_key: Option<&str>,
        device_id: Option<&str>,
    ) -> anyhow::Result<Option<i64>> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        let mut next_seq = None;

        if let Some(op_key) = idempotency_key {
            let already_exists = {
                let op_table = write_txn.open_table(OP_IDEMPOTENCY)?;
                let present = op_table.get(op_key)?.is_some();
                present
            };
            if already_exists {
                write_txn.commit()?;
                return Ok(None);
            }
            let mut op_table = write_txn.open_table(OP_IDEMPOTENCY)?;
            op_table.insert(op_key, "1")?;
        }

        {
            let mut notes_table = write_txn.open_table(NOTES_NODES)?;
            let mut meta_table = write_txn.open_table(NOTES_META)?;
            let note_payload = serde_json::to_string(note)?;
            notes_table.insert(note.id.as_str(), note_payload.as_str())?;
            meta_table.insert(note.id.as_str(), note_payload.as_str())?;
        }

        if let Some(update) = update {
            let mut oplog_table = write_txn.open_table(NOTES_OPLOG)?;
            let oplog_key = format!(
                "{}:{}:{}:{}",
                update.workspace_id, update.note_id, update.client_id, update.client_seq
            );
            let payload = serde_json::to_string(update)?;
            oplog_table.insert(oplog_key.as_str(), payload.as_str())?;

            let mut doc_table = write_txn.open_table(NOTES_DOC_STATE)?;
            let current = doc_table
                .get(update.note_id.as_str())?
                .map(|v| serde_json::from_str::<NoteDocState>(v.value()).unwrap_or_default())
                .unwrap_or_default();
            let mut merged = current;
            merged.updates.push(update.clone());
            let merged_payload = serde_json::to_string(&merged)?;
            doc_table.insert(update.note_id.as_str(), merged_payload.as_str())?;
        }

        if let Some(device_id) = device_id {
            let seq_key = format!("device:{}", device_id);
            let mut seq_table = write_txn.open_table(DEVICE_SEQ)?;
            let current = seq_table
                .get(seq_key.as_str())?
                .map(|v| v.value().parse::<i64>().unwrap_or_default())
                .unwrap_or_default();
            let next = current + 1;
            let next_text = next.to_string();
            seq_table.insert(seq_key.as_str(), next_text.as_str())?;
            next_seq = Some(next);
        }

        write_txn.commit()?;
        Ok(next_seq)
    }

    pub fn dump_workspace_hashes(&self, workspace_id: &str) -> anyhow::Result<HashMap<String, String>> {
        let notes = self.list_notes(workspace_id)?;
        let tasks = self.list_tasks_bundle(workspace_id)?;
        let notes_hash = format!("{}:{}", notes.len(), stable_hash(&notes)?);
        let task_hash = format!(
            "{}:{}:{}:{}",
            tasks.projects.len() + tasks.states.len() + tasks.tasks.len() + tasks.comments.len(),
            stable_hash(&tasks.projects)?,
            stable_hash(&tasks.tasks)?,
            stable_hash(&tasks.comments)?
        );

        let mut out = HashMap::new();
        out.insert("notes".to_string(), notes_hash);
        out.insert("tasks".to_string(), task_hash);
        Ok(out)
    }
}

fn stable_hash<T: Serialize>(value: &T) -> anyhow::Result<String> {
    use std::hash::{Hash, Hasher};

    let json = serde_json::to_string(value)?;
    let mut state = std::collections::hash_map::DefaultHasher::new();
    json.hash(&mut state);
    Ok(format!("{:x}", state.finish()))
}
