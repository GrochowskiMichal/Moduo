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
    Bucket, CategoryRule, FocusSession, ModulePermissions, NoteCrdtUpdate, NoteDocState, NoteMeta,
    Tag, TagLink, Task, TasksModuleBundle, TimeCategory, TimeEntry, TimeProject, TimetrackingBundle,
    WorkspaceInvite, WorkspaceMember, WorkspaceNotification, WorkspaceSummary,
};

pub const NOTES_META: TableDefinition<&str, &str> = TableDefinition::new("notes_meta");
pub const NOTES_NODES: TableDefinition<&str, &str> = TableDefinition::new("notes_nodes");
pub const NOTES_DOC_STATE: TableDefinition<&str, &str> = TableDefinition::new("notes_doc_state");
pub const NOTES_OUTBOX: TableDefinition<&str, &str> = TableDefinition::new("notes_outbox");
pub const NOTES_OPLOG: TableDefinition<&str, &str> = TableDefinition::new("notes_oplog");

// Tasks module v1 (ADHD bucket / commit / execute model). The only Tasks model;
// the legacy tasks_projects/tasks_states/tasks_items/... tables were removed.
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
/// Local-search body-text sidecar (EM-9): an 8KB-truncated lowercase copy of each
/// cached body, keyed like the body cache (`account::folder::uid`) and co-pruned
/// with the body LRU so it never outlives its body.
pub const EMAIL_BODY_TEXT: TableDefinition<&str, &str> = TableDefinition::new("email_body_text");
pub const EMAIL_FLAG_OUTBOX: TableDefinition<&str, &str> =
    TableDefinition::new("email_flag_outbox");
/// Triage op outbox (archive/move/delete), mirrors the flag outbox (EM-5).
pub const EMAIL_OP_OUTBOX: TableDefinition<&str, &str> = TableDefinition::new("email_op_outbox");
pub const EMAIL_UI_STATE: TableDefinition<&str, &str> = TableDefinition::new("email_ui_state");

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

/// One envelope row plus the order-index row that mirrors it, ready to be written
/// in a single transaction. Keys and payloads are both minted by the caller —
/// `commands::email` owns the key formats, the store writes what it is handed.
pub struct EnvelopeWrite {
    pub envelope_key: String,
    pub envelope_json: String,
    pub order_key: String,
    pub order_json: String,
}

impl RedbStore {
    fn ensure_schema(db: &Database) -> anyhow::Result<()> {
        let write_txn = db.begin_write()?;
        let _ = write_txn.open_table(NOTES_META)?;
        let _ = write_txn.open_table(NOTES_NODES)?;
        let _ = write_txn.open_table(NOTES_DOC_STATE)?;
        let _ = write_txn.open_table(NOTES_OUTBOX)?;
        let _ = write_txn.open_table(NOTES_OPLOG)?;

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

        let _ = write_txn.open_table(OP_IDEMPOTENCY)?;
        let _ = write_txn.open_table(DEVICE_SEQ)?;
        let _ = write_txn.open_table(AUDIT_LOG)?;

        let _ = write_txn.open_table(EMAIL_ACCOUNTS_V2)?;
        let _ = write_txn.open_table(EMAIL_FOLDER_STATE)?;
        let _ = write_txn.open_table(EMAIL_ENVELOPES)?;
        let _ = write_txn.open_table(EMAIL_ENVELOPE_ORDER)?;
        let _ = write_txn.open_table(EMAIL_BODIES)?;
        let _ = write_txn.open_table(EMAIL_BODY_LRU)?;
        let _ = write_txn.open_table(EMAIL_BODY_TEXT)?;
        let _ = write_txn.open_table(EMAIL_FLAG_OUTBOX)?;
        let _ = write_txn.open_table(EMAIL_OP_OUTBOX)?;
        let _ = write_txn.open_table(EMAIL_UI_STATE)?;

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
            OP_IDEMPOTENCY,
            DEVICE_SEQ,
            AUDIT_LOG,
            EMAIL_ACCOUNTS_V2,
            EMAIL_FOLDER_STATE,
            EMAIL_ENVELOPES,
            EMAIL_ENVELOPE_ORDER,
            EMAIL_BODIES,
            EMAIL_BODY_LRU,
            EMAIL_BODY_TEXT,
            EMAIL_FLAG_OUTBOX,
            EMAIL_OP_OUTBOX,
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

    /// Rows whose key starts with `prefix`, in key order. Seeks straight to the
    /// prefix and stops at the first key past it, so rows outside the prefix are
    /// never read — let alone deserialized.
    fn scan_json_prefix<T: DeserializeOwned>(
        &self,
        table_def: TableDefinition<&str, &str>,
        prefix: &str,
    ) -> anyhow::Result<Vec<T>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(table_def)?;
        let mut items = Vec::new();
        for result in table.range(prefix..)? {
            let (key, value) = result?;
            if !key.value().starts_with(prefix) {
                break;
            }
            items.push(serde_json::from_str::<T>(value.value())?);
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
            // Blocked-by edges live in Supabase only (desktop tasks ride the
            // web runtime); a redb table comes with the lite/offline version.
            task_relations: Vec::new(),
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

    pub fn get_email_envelope(&self, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(EMAIL_ENVELOPES, key)
    }

    pub fn list_email_envelopes(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_ENVELOPES)
    }

    /// Envelope rows under one `{account}::{folder}::` key prefix.
    pub fn scan_email_envelopes_prefix(
        &self,
        prefix: &str,
    ) -> anyhow::Result<Vec<serde_json::Value>> {
        self.scan_json_prefix(EMAIL_ENVELOPES, prefix)
    }

    /// Envelope rows for one folder across *every* account in the table.
    ///
    /// Keys are `{account}::{folder}::{uid}` and the account segment isn't known up
    /// front, so this walks the key index rather than seeking a prefix — but it only
    /// **deserializes** a row whose key carries the folder, which is where the cost
    /// is. `needle` may over-match (an account id that itself contains
    /// `::{folder}::`); callers field-filter, so a false positive can't change the
    /// result set — though, like the old whole-table read, an unparseable value on a
    /// matched key still fails the listing. Never *under*-matching is what keeps
    /// this exactly equivalent to that read.
    pub fn scan_email_envelopes_in_folder(
        &self,
        needle: &str,
    ) -> anyhow::Result<Vec<serde_json::Value>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(EMAIL_ENVELOPES)?;
        let mut items = Vec::new();
        for result in table.iter()? {
            let (key, value) = result?;
            if !key.value().contains(needle) {
                continue;
            }
            items.push(serde_json::from_str(value.value())?);
        }
        Ok(items)
    }

    /// Test-only: write an envelope row's value verbatim, bypassing JSON encoding.
    /// Lets a test plant an unparseable row *outside* a scan's prefix, so "the
    /// prefix scan never touched it" is provable rather than assumed.
    #[cfg(test)]
    pub fn put_email_envelope_raw(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(EMAIL_ENVELOPES)?;
            table.insert(key, value)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Write a batch of envelopes and their order-index rows in ONE transaction.
    ///
    /// The old path took the write guard and ran a full `begin_write` + `commit`
    /// twice per envelope (once for the row, once for its order row), so a 50-UID
    /// sync chunk cost 100 commits; this costs one.
    ///
    /// `stale_order_key` maps the *raw stored JSON* of an envelope to the order key
    /// it was written under. A message whose timestamp moves — most commonly one
    /// with no `Date` header, which falls back to "now" on every refetch — would
    /// otherwise leave its previous order row behind on each sync; here it is
    /// removed in the same transaction, so an envelope written through this path
    /// always has exactly one order row. (Rows orphaned by the *old* two-commit
    /// write predate this and are not swept — see `remove_email_envelope_with_order`.)
    pub fn write_email_envelopes<F>(
        &self,
        rows: &[EnvelopeWrite],
        stale_order_key: F,
    ) -> anyhow::Result<()>
    where
        F: Fn(&str) -> Option<String>,
    {
        if rows.is_empty() {
            return Ok(());
        }
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        {
            let mut envelopes = write_txn.open_table(EMAIL_ENVELOPES)?;
            let mut order = write_txn.open_table(EMAIL_ENVELOPE_ORDER)?;
            for row in rows {
                // Read the previous row into an owned String first: the access
                // guard borrows the table, and the insert below needs it mutably.
                let previous: Option<String> = envelopes
                    .get(row.envelope_key.as_str())?
                    .map(|value| value.value().to_string());
                if let Some(stale) = previous.as_deref().and_then(&stale_order_key) {
                    if stale != row.order_key {
                        let _ = order.remove(stale.as_str())?;
                    }
                }
                envelopes.insert(row.envelope_key.as_str(), row.envelope_json.as_str())?;
                order.insert(row.order_key.as_str(), row.order_json.as_str())?;
            }
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Remove an envelope and its order-index row in one transaction.
    ///
    /// The order key is derived from the stored row *inside* the transaction, so a
    /// concurrent upsert can't move the timestamp between the read and the delete.
    /// This stays a point delete — the old path scanned the entire order table per
    /// removal, which made a full-reset prune of n envelopes O(n²). The flip side:
    /// only the row this envelope currently points at is removed, so index rows
    /// orphaned before IM-2a survive. Nothing reads the index yet; IM-2b, its first
    /// consumer, has to reconcile or rebuild it before trusting the invariant.
    ///
    /// The envelope row itself is removed unconditionally — a row whose JSON no
    /// longer parses must still be deletable.
    pub fn remove_email_envelope_with_order<F>(
        &self,
        envelope_key: &str,
        order_key_for: F,
    ) -> anyhow::Result<()>
    where
        F: Fn(&str) -> Option<String>,
    {
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        {
            let mut envelopes = write_txn.open_table(EMAIL_ENVELOPES)?;
            let stored: Option<String> = envelopes
                .get(envelope_key)?
                .map(|value| value.value().to_string());
            let _ = envelopes.remove(envelope_key)?;
            if let Some(order_key) = stored.as_deref().and_then(&order_key_for) {
                let mut order = write_txn.open_table(EMAIL_ENVELOPE_ORDER)?;
                let _ = order.remove(order_key.as_str())?;
            }
        }
        write_txn.commit()?;
        Ok(())
    }

    /// The order index is written by [`Self::write_email_envelopes`] and not yet
    /// read by any product path — IM-2b's backward backfill is its first consumer.
    /// Kept (and covered by the storage tests) so that consumer inherits a write
    /// path that keeps exactly one row per envelope going forward.
    pub fn list_email_envelope_order(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_ENVELOPE_ORDER)
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

    pub fn put_email_body_text(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_BODY_TEXT, key, value)
    }

    pub fn list_email_body_text(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_BODY_TEXT)
    }

    pub fn remove_email_body_text(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_BODY_TEXT, key)
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

    pub fn put_email_op_outbox(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_OP_OUTBOX, key, value)
    }

    pub fn list_email_op_outbox(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.list_json(EMAIL_OP_OUTBOX)
    }

    pub fn remove_email_op_outbox(&self, key: &str) -> anyhow::Result<()> {
        self.remove_key(EMAIL_OP_OUTBOX, key)
    }

    pub fn put_email_ui_state(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_UI_STATE, key, value)
    }

    pub fn get_email_ui_state(&self, key: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_json(EMAIL_UI_STATE, key)
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
        let bundle = self.list_tasks_module_bundle(workspace_id)?;
        let notes_hash = format!("{}:{}", notes.len(), stable_hash(&notes)?);
        let task_hash = format!(
            "{}:{}:{}:{}",
            bundle.buckets.len() + bundle.tasks.len() + bundle.tags.len() + bundle.tag_links.len(),
            stable_hash(&bundle.buckets)?,
            stable_hash(&bundle.tasks)?,
            stable_hash(&bundle.tags)?
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
