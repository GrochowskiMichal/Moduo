//! Versioned forward migrations for the mail store (decision 3). Each entry runs
//! once, in order, inside one transaction; `PRAGMA user_version` records how many
//! have run. Never edit an entry that has shipped: append a new one.

use rusqlite::Connection;

pub const MIGRATIONS: &[&str] = &[
    // v1: the whole local schema.
    r#"
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  hue INTEGER NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL DEFAULT 'idle',
  backfill_progress REAL,
  last_error TEXT,
  history_depth_days INTEGER,
  disk_cap_bytes INTEGER NOT NULL DEFAULT 2147483648,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  delimiter TEXT,
  uidvalidity INTEGER,
  uidnext INTEGER,
  highestmodseq INTEGER,
  floor_uid INTEGER,
  backfill_state TEXT,
  live INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, path)
);

-- One row per RFC message per account; folder membership is message_mailboxes.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ext_id TEXT NOT NULL,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,
  thread_id TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  date_ms INTEGER NOT NULL,
  flags INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  list_unsubscribe TEXT,
  list_unsubscribe_post TEXT,
  precedence TEXT,
  auto_submitted TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  has_invite INTEGER NOT NULL DEFAULT 0,
  tab TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  body_state TEXT NOT NULL DEFAULT 'none',
  UNIQUE (account_id, ext_id)
);
CREATE INDEX messages_thread ON messages (thread_id, date_ms);
CREATE INDEX messages_msgid ON messages (account_id, message_id);
CREATE INDEX messages_date ON messages (date_ms DESC);

CREATE TABLE message_mailboxes (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  modseq INTEGER,
  PRIMARY KEY (mailbox_id, uid)
) WITHOUT ROWID;
CREATE INDEX message_mailboxes_msg ON message_mailboxes (message_id);

-- Thread-level user state that is not an IMAP flag.
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  snoozed_until_ms INTEGER
);

-- Denormalized list rows per (thread, mailbox). Aggregates span the whole thread,
-- so a conversation reads the same in every folder it touches.
CREATE TABLE thread_views (
  thread_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL,
  tab TEXT NOT NULL,
  last_date_ms INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  unread_count INTEGER NOT NULL,
  flagged INTEGER NOT NULL,
  has_attachments INTEGER NOT NULL,
  has_invite INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  snoozed_until_ms INTEGER,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  senders_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, mailbox_id)
) WITHOUT ROWID;
CREATE INDEX tv_mailbox_tab ON thread_views (mailbox_id, tab, last_date_ms DESC, thread_id DESC);
CREATE INDEX tv_mailbox ON thread_views (mailbox_id, last_date_ms DESC, thread_id DESC);
CREATE INDEX tv_role_tab ON thread_views (role, tab, last_date_ms DESC, thread_id DESC);
CREATE INDEX tv_role ON thread_views (role, last_date_ms DESC, thread_id DESC);
CREATE INDEX tv_unread ON thread_views (mailbox_id, tab, role) WHERE unread_count > 0;
CREATE INDEX tv_pinned ON thread_views (last_date_ms DESC, thread_id DESC) WHERE pinned = 1;
CREATE INDEX tv_snoozed ON thread_views (snoozed_until_ms) WHERE snoozed_until_ms IS NOT NULL;

-- From BODYSTRUCTURE at header time, so names are searchable before download.
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  is_inline INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  blob_hash TEXT,
  stored_bytes INTEGER NOT NULL DEFAULT 0,
  last_access_ms INTEGER
);
CREATE INDEX attachments_msg ON attachments (message_id);

CREATE TABLE bodies (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  html TEXT,
  text TEXT,
  quote_offset INTEGER,
  tracker_count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  last_access_ms INTEGER NOT NULL
);
CREATE INDEX bodies_lru ON bodies (last_access_ms);

-- The triage outbox (MR-5 fills it).
CREATE TABLE ops (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  thread_ids_json TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '{}',
  undo_json TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  not_before_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX ops_due ON ops (state, not_before_ms);

-- Sends (MR-6).
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  draft_id TEXT,
  mime BLOB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  not_before_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT,
  json TEXT NOT NULL,
  server_mailbox_id TEXT,
  server_uid INTEGER,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE avatars (
  domain TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data BLOB,
  fetched_at_ms INTEGER NOT NULL
);

CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE VIRTUAL TABLE messages_fts USING fts5 (
  subject, from_t, to_t, body, attachments,
  content = '', contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
"#,
];

pub fn migrate(conn: &mut Connection) -> rusqlite::Result<u32> {
    let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as u32)?;
        tx.commit()?;
    }
    Ok(MIGRATIONS.len() as u32)
}
