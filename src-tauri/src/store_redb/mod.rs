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
    Bucket, CategoryRule, FocusSession, GraphEdge, GraphNode, ModulePermissions, NoteCrdtUpdate,
    NoteDocState, NoteMeta, Tag, TagLink, Task, TaskActivity, TaskComment, TaskItem, TaskProject,
    TaskWorkflowState, TasksBundle, TasksModuleBundle, TimeCategory, TimeEntry, TimeProject,
    TimetrackingBundle, WorkspaceInvite, WorkspaceMember, WorkspaceNotification, WorkspaceSummary,
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
pub const TASKS_ACTIVITY: TableDefinition<&str, &str> = TableDefinition::new("tasks_activity");

// Tasks module v1 (ADHD bucket / commit / execute model). Canonical going
// forward; supersedes the legacy tasks_* tables above.
pub const BUCKETS: TableDefinition<&str, &str> = TableDefinition::new("buckets");
pub const TASKS: TableDefinition<&str, &str> = TableDefinition::new("tasks");
pub const TAGS: TableDefinition<&str, &str> = TableDefinition::new("tags");
pub const TAG_LINKS: TableDefinition<&str, &str> = TableDefinition::new("tag_links");

pub const WORKSPACE_MEMBERSHIP: TableDefinition<&str, &str> =
    TableDefinition::new("workspace_membership");
pub const WORKSPACE_ACL: TableDefinition<&str, &str> = TableDefinition::new("workspace_acl");
pub const WORKSPACES: TableDefinition<&str, &str> = TableDefinition::new("workspaces");
pub const WORKSPACE_INVITES: TableDefinition<&str, &str> =
    TableDefinition::new("workspace_invites");
pub const WORKSPACE_NOTIFICATIONS: TableDefinition<&str, &str> =
    TableDefinition::new("workspace_notifications");

pub const DEVICE_IDENTITY: TableDefinition<&str, &str> = TableDefinition::new("device_identity");
pub const MIGRATION_MARKERS: TableDefinition<&str, &str> =
    TableDefinition::new("migration_markers");

pub const GRAPH_NODES: TableDefinition<&str, &str> = TableDefinition::new("graph_nodes");
pub const GRAPH_EDGES: TableDefinition<&str, &str> = TableDefinition::new("graph_edges");
pub const GRAPH_VECTORS: TableDefinition<&str, &str> = TableDefinition::new("graph_vectors");

pub const OP_IDEMPOTENCY: TableDefinition<&str, &str> = TableDefinition::new("op_idempotency");
pub const DEVICE_SEQ: TableDefinition<&str, &str> = TableDefinition::new("device_seq");
pub const AUDIT_LOG: TableDefinition<&str, &str> = TableDefinition::new("audit_log");

pub const EMAIL_ACCOUNTS_V2: TableDefinition<&str, &str> =
    TableDefinition::new("email_accounts_v2");
pub const EMAIL_FOLDER_STATE: TableDefinition<&str, &str> =
    TableDefinition::new("email_folder_state");
pub const EMAIL_ENVELOPES: TableDefinition<&str, &str> = TableDefinition::new("email_envelopes");
pub const EMAIL_ENVELOPE_ORDER: TableDefinition<&str, &str> =
    TableDefinition::new("email_envelope_order");
pub const EMAIL_BODIES: TableDefinition<&str, &str> = TableDefinition::new("email_bodies");
pub const EMAIL_BODY_LRU: TableDefinition<&str, &str> = TableDefinition::new("email_body_lru");
pub const EMAIL_FLAG_OUTBOX: TableDefinition<&str, &str> =
    TableDefinition::new("email_flag_outbox");
pub const EMAIL_GRAPH_OUTBOX: TableDefinition<&str, &str> =
    TableDefinition::new("email_graph_outbox");
pub const EMAIL_UI_STATE: TableDefinition<&str, &str> = TableDefinition::new("email_ui_state");

pub const CALENDAR_EVENTS: TableDefinition<&str, &str> = TableDefinition::new("calendar_events");

// Cloud sync tables
pub const SYNC_CLOUD_OUTBOX: TableDefinition<&str, &str> =
    TableDefinition::new("sync_cloud_outbox");
pub const SYNC_PULL_CURSOR: TableDefinition<&str, &str> = TableDefinition::new("sync_pull_cursor");

pub const TT_ENTRIES: TableDefinition<&str, &str> = TableDefinition::new("tt_entries");
pub const TT_CATEGORIES: TableDefinition<&str, &str> = TableDefinition::new("tt_categories");
pub const TT_RULES: TableDefinition<&str, &str> = TableDefinition::new("tt_rules");
pub const TT_PROJECTS: TableDefinition<&str, &str> = TableDefinition::new("tt_projects");
pub const TT_FOCUS: TableDefinition<&str, &str> = TableDefinition::new("tt_focus");

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
        let _ = write_txn.open_table(TASKS_ACTIVITY)?;

        let _ = write_txn.open_table(BUCKETS)?;
        let _ = write_txn.open_table(TASKS)?;
        let _ = write_txn.open_table(TAGS)?;
        let _ = write_txn.open_table(TAG_LINKS)?;

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

        let _ = write_txn.open_table(EMAIL_ACCOUNTS_V2)?;
        let _ = write_txn.open_table(EMAIL_FOLDER_STATE)?;
        let _ = write_txn.open_table(EMAIL_ENVELOPES)?;
        let _ = write_txn.open_table(EMAIL_ENVELOPE_ORDER)?;
        let _ = write_txn.open_table(EMAIL_BODIES)?;
        let _ = write_txn.open_table(EMAIL_BODY_LRU)?;
        let _ = write_txn.open_table(EMAIL_FLAG_OUTBOX)?;
        let _ = write_txn.open_table(EMAIL_GRAPH_OUTBOX)?;
        let _ = write_txn.open_table(EMAIL_UI_STATE)?;

        let _ = write_txn.open_table(CALENDAR_EVENTS)?;

        let _ = write_txn.open_table(SYNC_CLOUD_OUTBOX)?;
        let _ = write_txn.open_table(SYNC_PULL_CURSOR)?;

        let _ = write_txn.open_table(TT_ENTRIES)?;
        let _ = write_txn.open_table(TT_CATEGORIES)?;
        let _ = write_txn.open_table(TT_RULES)?;
        let _ = write_txn.open_table(TT_PROJECTS)?;
        let _ = write_txn.open_table(TT_FOCUS)?;
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
            let fresh =
                Database::create(path).context("create redb database after schema recovery")?;
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
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
            TASKS_ACTIVITY,
            BUCKETS,
            TASKS,
            TAGS,
            TAG_LINKS,
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
            EMAIL_ACCOUNTS_V2,
            EMAIL_FOLDER_STATE,
            EMAIL_ENVELOPES,
            EMAIL_ENVELOPE_ORDER,
            EMAIL_BODIES,
            EMAIL_BODY_LRU,
            EMAIL_FLAG_OUTBOX,
            EMAIL_GRAPH_OUTBOX,
            EMAIL_UI_STATE,
            TT_ENTRIES,
            TT_CATEGORIES,
            TT_RULES,
            TT_PROJECTS,
            TT_FOCUS,
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
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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

    fn list_json<T: DeserializeOwned>(
        &self,
        table_def: TableDefinition<&str, &str>,
    ) -> anyhow::Result<Vec<T>> {
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
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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

    pub fn list_workspace_members(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<WorkspaceMember>> {
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

    pub fn list_workspace_invites(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<WorkspaceInvite>> {
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

    pub fn put_task_activity(&self, activity: &TaskActivity) -> anyhow::Result<()> {
        self.put_json(TASKS_ACTIVITY, &activity.id, activity)
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
        let activities = self
            .list_json::<TaskActivity>(TASKS_ACTIVITY)?
            .into_iter()
            .filter(|x| x.workspace_id == workspace_id)
            .collect();

        Ok(TasksBundle {
            projects,
            states,
            tasks,
            comments,
            activities,
        })
    }

    // ─── Tasks module v1 (buckets / tasks / tags) ──────────────────────────────

    pub fn put_bucket(&self, bucket: &Bucket) -> anyhow::Result<()> {
        self.put_json(BUCKETS, &bucket.id, bucket)
    }

    pub fn get_bucket(&self, id: &str) -> anyhow::Result<Option<Bucket>> {
        self.get_json(BUCKETS, id)
    }

    pub fn list_buckets(&self, workspace_id: &str) -> anyhow::Result<Vec<Bucket>> {
        Ok(self
            .list_json::<Bucket>(BUCKETS)?
            .into_iter()
            .filter(|b| b.workspace_id == workspace_id)
            .collect())
    }

    pub fn put_task(&self, task: &Task) -> anyhow::Result<()> {
        self.put_json(TASKS, &task.id, task)
    }

    pub fn get_task(&self, id: &str) -> anyhow::Result<Option<Task>> {
        self.get_json(TASKS, id)
    }

    pub fn list_tasks(&self, workspace_id: &str) -> anyhow::Result<Vec<Task>> {
        Ok(self
            .list_json::<Task>(TASKS)?
            .into_iter()
            .filter(|t| t.workspace_id == workspace_id)
            .collect())
    }

    pub fn put_tag(&self, tag: &Tag) -> anyhow::Result<()> {
        self.put_json(TAGS, &tag.id, tag)
    }

    pub fn get_tag(&self, id: &str) -> anyhow::Result<Option<Tag>> {
        self.get_json(TAGS, id)
    }

    pub fn list_tags(&self, workspace_id: &str) -> anyhow::Result<Vec<Tag>> {
        Ok(self
            .list_json::<Tag>(TAGS)?
            .into_iter()
            .filter(|t| t.workspace_id == workspace_id)
            .collect())
    }

    pub fn put_tag_link(&self, link: &TagLink) -> anyhow::Result<()> {
        self.put_json(TAG_LINKS, &link.id, link)
    }

    pub fn remove_tag_link(&self, id: &str) -> anyhow::Result<()> {
        self.remove_key(TAG_LINKS, id)
    }

    pub fn list_tag_links(&self, workspace_id: &str) -> anyhow::Result<Vec<TagLink>> {
        Ok(self
            .list_json::<TagLink>(TAG_LINKS)?
            .into_iter()
            .filter(|l| l.workspace_id == workspace_id)
            .collect())
    }

    pub fn list_tasks_module_bundle(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<TasksModuleBundle> {
        Ok(TasksModuleBundle {
            buckets: self.list_buckets(workspace_id)?,
            tasks: self.list_tasks(workspace_id)?,
            tags: self.list_tags(workspace_id)?,
            tag_links: self.list_tag_links(workspace_id)?,
        })
    }

    pub fn put_device_identity(
        &self,
        device_id: &str,
        payload: &serde_json::Value,
    ) -> anyhow::Result<()> {
        self.put_json(DEVICE_IDENTITY, device_id, payload)
    }

    pub fn get_device_identity(
        &self,
        device_id: &str,
    ) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(DEVICE_IDENTITY, device_id)
    }

    pub fn set_migration_marker(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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

    pub fn put_email_account_v2(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_ACCOUNTS_V2, key, value)
    }

    pub fn get_email_account_v2(&self, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(EMAIL_ACCOUNTS_V2, key)
    }

    pub fn list_email_accounts_v2(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_ACCOUNTS_V2)
    }

    pub fn remove_email_account_v2(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_ACCOUNTS_V2, key)
    }

    pub fn put_email_folder_state(
        &self,
        key: &str,
        value: &serde_json::Value,
    ) -> anyhow::Result<()> {
        self.put_json(EMAIL_FOLDER_STATE, key, value)
    }

    pub fn get_email_folder_state(&self, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(EMAIL_FOLDER_STATE, key)
    }

    pub fn list_email_folder_states(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_FOLDER_STATE)
    }

    pub fn remove_email_folder_state(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_FOLDER_STATE, key)
    }

    pub fn put_email_envelope(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_ENVELOPES, key, value)
    }

    pub fn get_email_envelope(&self, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(EMAIL_ENVELOPES, key)
    }

    pub fn list_email_envelopes(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_ENVELOPES)
    }

    pub fn remove_email_envelope(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_ENVELOPES, key)
    }

    pub fn put_email_envelope_order(
        &self,
        key: &str,
        value: &serde_json::Value,
    ) -> anyhow::Result<()> {
        self.put_json(EMAIL_ENVELOPE_ORDER, key, value)
    }

    pub fn list_email_envelope_order(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_ENVELOPE_ORDER)
    }

    pub fn remove_email_envelope_order(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_ENVELOPE_ORDER, key)
    }

    pub fn put_email_body(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_BODIES, key, value)
    }

    pub fn get_email_body(&self, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(EMAIL_BODIES, key)
    }

    pub fn list_email_bodies(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_BODIES)
    }

    pub fn remove_email_body(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_BODIES, key)
    }

    pub fn put_email_body_lru(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_BODY_LRU, key, value)
    }

    pub fn list_email_body_lru(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_BODY_LRU)
    }

    pub fn remove_email_body_lru(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_BODY_LRU, key)
    }

    pub fn put_email_flag_outbox(
        &self,
        key: &str,
        value: &serde_json::Value,
    ) -> anyhow::Result<()> {
        self.put_json(EMAIL_FLAG_OUTBOX, key, value)
    }

    pub fn list_email_flag_outbox(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_FLAG_OUTBOX)
    }

    pub fn remove_email_flag_outbox(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_FLAG_OUTBOX, key)
    }

    pub fn put_email_graph_outbox(
        &self,
        key: &str,
        value: &serde_json::Value,
    ) -> anyhow::Result<()> {
        self.put_json(EMAIL_GRAPH_OUTBOX, key, value)
    }

    pub fn list_email_graph_outbox(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_GRAPH_OUTBOX)
    }

    pub fn remove_email_graph_outbox(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_GRAPH_OUTBOX, key)
    }

    pub fn put_email_ui_state(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_UI_STATE, key, value)
    }

    pub fn get_email_ui_state(&self, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(EMAIL_UI_STATE, key)
    }

    pub fn put_calendar_event(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(CALENDAR_EVENTS, key, value)
    }

    pub fn list_calendar_events(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(CALENDAR_EVENTS)
    }

    pub fn remove_calendar_event(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(CALENDAR_EVENTS, key)
    }

    // ─── Timetracking ─────────────────────────────────────────────────────────

    pub fn put_tt_entry(&self, entry: &TimeEntry) -> anyhow::Result<()> {
        self.put_json(TT_ENTRIES, &entry.id, entry)
    }

    pub fn get_tt_entry(&self, id: &str) -> anyhow::Result<Option<TimeEntry>> {
        self.get_json(TT_ENTRIES, id)
    }

    pub fn list_tt_entries(&self, workspace_id: &str) -> anyhow::Result<Vec<TimeEntry>> {
        Ok(self
            .list_json::<TimeEntry>(TT_ENTRIES)?
            .into_iter()
            .filter(|e| e.workspace_id == workspace_id)
            .collect())
    }

    pub fn remove_tt_entry(&self, id: &str) -> anyhow::Result<()> {
        self.remove_key(TT_ENTRIES, id)
    }

    pub fn put_tt_category(&self, category: &TimeCategory) -> anyhow::Result<()> {
        self.put_json(TT_CATEGORIES, &category.id, category)
    }

    pub fn list_tt_categories(&self, workspace_id: &str) -> anyhow::Result<Vec<TimeCategory>> {
        Ok(self
            .list_json::<TimeCategory>(TT_CATEGORIES)?
            .into_iter()
            .filter(|c| c.workspace_id == workspace_id)
            .collect())
    }

    pub fn remove_tt_category(&self, id: &str) -> anyhow::Result<()> {
        self.remove_key(TT_CATEGORIES, id)
    }

    pub fn put_tt_rule(&self, rule: &CategoryRule) -> anyhow::Result<()> {
        self.put_json(TT_RULES, &rule.id, rule)
    }

    pub fn list_tt_rules(&self, workspace_id: &str) -> anyhow::Result<Vec<CategoryRule>> {
        Ok(self
            .list_json::<CategoryRule>(TT_RULES)?
            .into_iter()
            .filter(|r| r.workspace_id == workspace_id)
            .collect())
    }

    pub fn remove_tt_rule(&self, id: &str) -> anyhow::Result<()> {
        self.remove_key(TT_RULES, id)
    }

    pub fn put_tt_project(&self, project: &TimeProject) -> anyhow::Result<()> {
        self.put_json(TT_PROJECTS, &project.id, project)
    }

    pub fn list_tt_projects(&self, workspace_id: &str) -> anyhow::Result<Vec<TimeProject>> {
        Ok(self
            .list_json::<TimeProject>(TT_PROJECTS)?
            .into_iter()
            .filter(|p| p.workspace_id == workspace_id)
            .collect())
    }

    pub fn remove_tt_project(&self, id: &str) -> anyhow::Result<()> {
        self.remove_key(TT_PROJECTS, id)
    }

    pub fn put_tt_focus_session(&self, session: &FocusSession) -> anyhow::Result<()> {
        self.put_json(TT_FOCUS, &session.id, session)
    }

    pub fn list_tt_focus_sessions(&self, workspace_id: &str) -> anyhow::Result<Vec<FocusSession>> {
        Ok(self
            .list_json::<FocusSession>(TT_FOCUS)?
            .into_iter()
            .filter(|s| s.workspace_id == workspace_id)
            .collect())
    }

    pub fn remove_tt_focus_session(&self, id: &str) -> anyhow::Result<()> {
        self.remove_key(TT_FOCUS, id)
    }

    pub fn list_timetracking_bundle(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<TimetrackingBundle> {
        Ok(TimetrackingBundle {
            entries: self.list_tt_entries(workspace_id)?,
            categories: self.list_tt_categories(workspace_id)?,
            rules: self.list_tt_rules(workspace_id)?,
            projects: self.list_tt_projects(workspace_id)?,
            focus_sessions: self.list_tt_focus_sessions(workspace_id)?,
        })
    }

    pub fn kv_set(
        &self,
        namespace: &str,
        key: &str,
        value: &serde_json::Value,
    ) -> anyhow::Result<()> {
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

    pub fn append_audit_log(
        &self,
        event_type: &str,
        payload: &serde_json::Value,
    ) -> anyhow::Result<()> {
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
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
            // The incoming update_b64 is a full Y.encodeStateAsUpdate snapshot (the
            // new flush() contract). Store it directly as snapshot_b64 and clear any
            // accumulated partial updates so that reload never depends on a sequence
            // of incremental updates that may have missing CRDT dependencies.
            let new_state = NoteDocState {
                snapshot_b64: update.update_b64.clone(),
                last_compacted_update_id: update.client_seq,
                updates: vec![],
            };
            let merged_payload = serde_json::to_string(&new_state)?;
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

    // ── Cloud sync outbox ─────────────────────────────────────────────────

    pub fn sync_outbox_push(&self, entry: &serde_json::Value) -> anyhow::Result<()> {
        let id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("outbox entry missing id"))?;
        let key = format!(
            "{}:{}",
            entry.get("table_name").and_then(|v| v.as_str()).unwrap_or("unknown"),
            id
        );
        self.put_json(SYNC_CLOUD_OUTBOX, &key, entry)
    }

    pub fn sync_outbox_list(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        let read_txn = self.db.begin_read()?;
        let table = match read_txn.open_table(SYNC_CLOUD_OUTBOX) {
            Ok(t) => t,
            Err(_) => return Ok(vec![]),
        };
        let mut entries = Vec::new();
        for item in table.iter()? {
            let (_, v) = item?;
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(v.value()) {
                entries.push(parsed);
            }
        }
        Ok(entries)
    }

    pub fn sync_outbox_delete(&self, table_name: &str, id: &str) -> anyhow::Result<()> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let key = format!("{table_name}:{id}");
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(SYNC_CLOUD_OUTBOX)?;
            table.remove(key.as_str())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn sync_outbox_increment_attempts(
        &self,
        table_name: &str,
        id: &str,
        max_attempts: u8,
    ) -> anyhow::Result<bool> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let key = format!("{table_name}:{id}");
        let write_txn = self.db.begin_write()?;
        let dead = {
            let mut table = write_txn.open_table(SYNC_CLOUD_OUTBOX)?;
            // Read value first, drop guard before mutating.
            let existing: Option<String> = table
                .get(key.as_str())?
                .map(|v| v.value().to_string());
            if let Some(raw) = existing {
                let mut entry: serde_json::Value = serde_json::from_str(&raw)?;
                let attempts = entry
                    .get("attempts")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    + 1;
                entry["attempts"] = serde_json::Value::Number(attempts.into());
                if attempts >= max_attempts as u64 {
                    table.remove(key.as_str())?;
                    true
                } else {
                    let encoded = serde_json::to_string(&entry)?;
                    table.insert(key.as_str(), encoded.as_str())?;
                    false
                }
            } else {
                false
            }
        };
        write_txn.commit()?;
        Ok(dead)
    }

    pub fn sync_get_pull_cursor(&self, table_name: &str) -> anyhow::Result<Option<String>> {
        let read_txn = self.db.begin_read()?;
        let table = match read_txn.open_table(SYNC_PULL_CURSOR) {
            Ok(t) => t,
            Err(_) => return Ok(None),
        };
        let value = table.get(table_name)?.map(|v| v.value().to_string());
        Ok(value)
    }

    pub fn sync_set_pull_cursor(&self, table_name: &str, cursor: &str) -> anyhow::Result<()> {
        let _lock = self.write_guard.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(SYNC_PULL_CURSOR)?;
            table.insert(table_name, cursor)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn dump_workspace_hashes(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<HashMap<String, String>> {
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
