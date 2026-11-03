//! The triage ops outbox (MR-5, specs/mail-rebuild.md decision 12, AC11–AC13).
//!
//! Every triage action writes its local effect in the same SQLite transaction
//! that enqueues it, with `not_before = now + 8 s`. Local state is the truth, so
//! a reload or a sync round inside the window keeps the thread where the user
//! put it (`reapply_pending` re-asserts pending effects after ingest).
//!
//! - **Undo inside the window** (or while the op is still unsent) deletes the op
//!   and restores the exact pre-op snapshot atomically.
//! - **Undo after the op reached the server** enqueues a compensating op: the
//!   local effect reverts the snapshot and the server steps are the inverse.
//! - The **executor** retries transient errors with backoff up to 5 min for
//!   24 h, then marks the op `failed`. Failed ops are listed, never dropped;
//!   Retry re-queues one, Discard restores the server's state (the snapshot).
//! - **`uid_validity`**: steps carry the validity they were planned against.
//!   A changed mailbox is re-targeted by Message-ID, or the op fails with a
//!   reason; it is never applied to whatever now holds the old UID.
//! - **Bulk:** one action may span many threads and accounts: one row per
//!   account, sharing an `action` id that Undo takes.

#[cfg(test)]
mod tests;

use super::contracts::{MailboxRole, OpKind, OpState, FLAG_SEEN};
use super::store::write::refresh_thread;
use super::store::{now_ms, Store, StoreError, StoreResult, TabRef, ViewRef};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const UNDO_WINDOW_MS: i64 = 8_000;
pub const MAX_BACKOFF_MS: i64 = 5 * 60_000;
pub const GIVE_UP_AFTER_MS: i64 = 24 * 3_600_000;
/// Done rows are kept this long so a late `z` can still compensate.
pub const KEEP_DONE_MS: i64 = 24 * 3_600_000;

/// A triage action from the UI.
#[derive(Debug, Clone)]
pub struct OpRequest {
    pub kind: OpKind,
    pub thread_ids: Vec<String>,
    /// Move / block destination; Delete, Spam and Done find theirs by role.
    pub to_mailbox_id: Option<String>,
    /// Move source; defaults to the account's Inbox.
    pub from_mailbox_id: Option<String>,
    pub snooze_until_ms: Option<i64>,
}

impl OpRequest {
    pub fn new(kind: OpKind, thread_ids: Vec<String>) -> Self {
        OpRequest {
            kind,
            thread_ids,
            to_mailbox_id: None,
            from_mailbox_id: None,
            snooze_until_ms: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionHandle {
    pub action_id: String,
    pub op_ids: Vec<String>,
    pub undo_until_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UndoOutcome {
    /// The op never reached the server: deleted and reverted.
    Cancelled,
    /// It had: a compensating action is queued.
    Compensated(ActionHandle),
    Nothing,
}

/// One server-side step against one mailbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StepAction {
    AddFlags { bits: u32 },
    RemoveFlags { bits: u32 },
    MoveTo { mailbox_id: String, path: String },
    CopyTo { mailbox_id: String, path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Target {
    msg: i64,
    rfc: Option<String>,
    /// None: resolve at execution (copies the server made, e.g. after a move).
    uid: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Step {
    mailbox_id: String,
    path: String,
    uidvalidity: Option<i64>,
    action: StepAction,
    targets: Vec<Target>,
}

/// What the executor hands the account actor: concrete UIDs, checked validity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedStep {
    pub mailbox_path: String,
    pub uidvalidity: Option<i64>,
    pub uids: Vec<i64>,
    pub action: StepAction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpError {
    /// Offline, timeout, server busy: retried with backoff.
    Transient(String),
    /// The server refused for good: failed now.
    Permanent(String),
}

/// The IMAP side, implemented by the account actor (and a fake in tests).
pub trait OpServer {
    fn run(&mut self, account_id: &str, step: &ResolvedStep) -> Result<(), OpError>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Effect {
    /// Drop memberships in these mailboxes.
    remove_from: Vec<String>,
    /// Or drop every membership except the destination's.
    remove_all: bool,
    /// Add a provisional membership here for `moved` messages lacking one.
    add_to: Option<String>,
    moved: Vec<i64>,
    flag_on: u32,
    flag_off: u32,
    pinned: Option<bool>,
    muted: Option<bool>,
    snooze_set: bool,
    snooze_until: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Args {
    action: String,
    /// Forward ops apply `effect`; compensating ops re-assert `revert_to`.
    effect: Option<Effect>,
    revert_to: Option<Snapshot>,
    steps: Vec<Step>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Snapshot {
    threads: Vec<ThreadSnap>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThreadSnap {
    id: String,
    account_id: String,
    state: Option<(bool, bool, Option<i64>)>,
    messages: Vec<(i64, u32)>,
    memberships: Vec<(String, i64, i64, Option<i64>)>,
}

/// A row for the "Couldn't sync N actions" bar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedOp {
    pub id: String,
    pub action_id: String,
    pub account_id: String,
    pub kind: OpKind,
    pub thread_ids: Vec<String>,
    pub error: String,
    pub attempts: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunReport {
    pub done: Vec<String>,
    pub retrying: Vec<String>,
    /// Newly failed op ids: the engine emits `op_failed` for each.
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpRow {
    pub id: String,
    pub account_id: String,
    pub kind: OpKind,
    pub state: OpState,
    pub attempts: i64,
    pub not_before_ms: i64,
    pub last_error: Option<String>,
}

fn sql_err(s: impl Into<String>) -> StoreError {
    StoreError::Invalid(s.into())
}

fn to_json<T: Serialize>(v: &T) -> StoreResult<String> {
    serde_json::to_string(v).map_err(|e| sql_err(format!("ops json: {e}")))
}
fn from_json<T: serde::de::DeserializeOwned>(s: &str) -> StoreResult<T> {
    serde_json::from_str(s).map_err(|e| sql_err(format!("corrupt op row: {e}")))
}

pub fn backoff_ms(attempts: i64) -> i64 {
    let exp = (attempts.clamp(1, 20) - 1) as u32;
    (2_000i64.saturating_mul(1i64 << exp)).min(MAX_BACKOFF_MS)
}

/// The kind a compensating op is labelled with.
pub fn inverse_kind(k: OpKind) -> OpKind {
    use OpKind::*;
    match k {
        Done => Undone,
        Undone => Done,
        Delete => Restore,
        Restore => Delete,
        MarkRead => MarkUnread,
        MarkUnread => MarkRead,
        Pin => Unpin,
        Unpin => Pin,
        Snooze => Unsnooze,
        Unsnooze => Snooze,
        Mute => Unmute,
        Unmute => Mute,
        Spam => NotSpam,
        NotSpam => Spam,
        LabelAdd => LabelRemove,
        LabelRemove => LabelAdd,
        Move => Move,
        BlockSender => Move,
    }
}

struct MailboxInfo {
    id: String,
    path: String,
    role: String,
    uidvalidity: Option<i64>,
}

fn mailbox(tx: &Transaction, id: &str) -> StoreResult<MailboxInfo> {
    tx.query_row(
        "SELECT id, path, role, uidvalidity FROM mailboxes WHERE id = ?1",
        [id],
        |r| {
            Ok(MailboxInfo {
                id: r.get(0)?,
                path: r.get(1)?,
                role: r.get(2)?,
                uidvalidity: r.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| sql_err(format!("unknown mailbox {id}")))
}

fn by_role(tx: &Transaction, account: &str, role: MailboxRole) -> StoreResult<Option<MailboxInfo>> {
    let id: Option<String> = tx
        .query_row(
            "SELECT id FROM mailboxes WHERE account_id = ?1 AND role = ?2 ORDER BY id LIMIT 1",
            params![account, role.as_str()],
            |r| r.get(0),
        )
        .optional()?;
    id.map(|id| mailbox(tx, &id)).transpose()
}

fn need_role(tx: &Transaction, account: &str, role: MailboxRole) -> StoreResult<MailboxInfo> {
    by_role(tx, account, role)?
        .ok_or_else(|| sql_err(format!("account has no {} folder", role.as_str())))
}

fn thread_messages(tx: &Transaction, account: &str, thread: &str) -> StoreResult<Vec<(i64, u32)>> {
    let mut s = tx.prepare_cached(
        "SELECT id, flags FROM messages WHERE account_id = ?1 AND thread_id = ?2 ORDER BY id",
    )?;
    let v = s
        .query_map(params![account, thread], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(v)
}

/// (mailbox_id, uid, message_id, modseq) of every message of the thread.
fn memberships(
    tx: &Transaction,
    account: &str,
    thread: &str,
) -> StoreResult<Vec<(String, i64, i64, Option<i64>)>> {
    let mut s = tx.prepare_cached(
        "SELECT mm.mailbox_id, mm.uid, mm.message_id, mm.modseq FROM message_mailboxes mm
         JOIN messages m ON m.id = mm.message_id
         WHERE m.account_id = ?1 AND m.thread_id = ?2 ORDER BY mm.mailbox_id, mm.uid",
    )?;
    let v = s
        .query_map(params![account, thread], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<Result<_, _>>()?;
    Ok(v)
}

fn snapshot(tx: &Transaction, account: &str, threads: &[String]) -> StoreResult<Snapshot> {
    let mut out = Snapshot::default();
    for t in threads {
        let state = tx
            .query_row(
                "SELECT pinned, muted, snoozed_until_ms FROM threads WHERE id = ?1",
                [t],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        out.threads.push(ThreadSnap {
            id: t.clone(),
            account_id: account.to_string(),
            state,
            messages: thread_messages(tx, account, t)?,
            memberships: memberships(tx, account, t)?,
        });
    }
    Ok(out)
}

/// Puts every snapshotted thread back exactly as it was. Messages that arrived
/// since are left alone; messages a sync purged since are skipped.
fn revert(tx: &Transaction, snap: &Snapshot) -> StoreResult<()> {
    for t in &snap.threads {
        for (id, flags) in &t.messages {
            tx.execute(
                "UPDATE messages SET flags = ?2 WHERE id = ?1",
                params![id, flags],
            )?;
            tx.execute("DELETE FROM message_mailboxes WHERE message_id = ?1", [id])?;
        }
        for (mb, uid, msg, modseq) in &t.memberships {
            tx.execute(
                "INSERT OR IGNORE INTO message_mailboxes (mailbox_id, uid, message_id, modseq)
                 SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM messages WHERE id = ?3)
                   AND EXISTS (SELECT 1 FROM mailboxes WHERE id = ?1)",
                params![mb, uid, msg, modseq],
            )?;
        }
        match t.state {
            Some((p, m, s)) => {
                tx.execute(
                    "INSERT OR REPLACE INTO threads (id, account_id, pinned, muted, snoozed_until_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![t.id, t.account_id, p, m, s],
                )?;
            }
            None => {
                tx.execute("DELETE FROM threads WHERE id = ?1", [&t.id])?;
            }
        }
        refresh_thread(tx, &t.id)?;
    }
    Ok(())
}

/// Applies a forward effect. Idempotent, so a sync round can re-assert it.
fn apply(tx: &Transaction, account: &str, threads: &[String], e: &Effect) -> StoreResult<()> {
    for t in threads {
        let msgs = thread_messages(tx, account, t)?;
        for (id, _) in &msgs {
            if e.remove_all {
                tx.execute(
                    "DELETE FROM message_mailboxes WHERE message_id = ?1 AND mailbox_id IS NOT ?2",
                    params![id, e.add_to],
                )?;
            }
            for mb in &e.remove_from {
                tx.execute(
                    "DELETE FROM message_mailboxes WHERE message_id = ?1 AND mailbox_id = ?2",
                    params![id, mb],
                )?;
            }
            if e.flag_on != 0 {
                tx.execute(
                    "UPDATE messages SET flags = flags | ?2 WHERE id = ?1",
                    params![id, e.flag_on],
                )?;
            }
            if e.flag_off != 0 {
                tx.execute(
                    "UPDATE messages SET flags = flags & ~?2 WHERE id = ?1",
                    params![id, e.flag_off],
                )?;
            }
        }
        if let Some(to) = &e.add_to {
            for id in msgs.iter().map(|m| m.0).filter(|id| e.moved.contains(id)) {
                let has: bool = tx.query_row(
                    "SELECT EXISTS (SELECT 1 FROM message_mailboxes WHERE mailbox_id = ?1 AND message_id = ?2)",
                    params![to, id],
                    |r| r.get(0),
                )?;
                if !has {
                    let min: i64 = tx.query_row(
                        "SELECT MIN(0, COALESCE(MIN(uid), 0)) FROM message_mailboxes WHERE mailbox_id = ?1",
                        [to],
                        |r| r.get(0),
                    )?;
                    tx.execute(
                        "INSERT INTO message_mailboxes (mailbox_id, uid, message_id) VALUES (?1, ?2, ?3)",
                        params![to, min - 1, id],
                    )?;
                }
            }
        }
        if e.pinned.is_some() || e.muted.is_some() || e.snooze_set {
            tx.execute(
                "INSERT OR IGNORE INTO threads (id, account_id) VALUES (?1, ?2)",
                params![t, account],
            )?;
            if let Some(p) = e.pinned {
                tx.execute("UPDATE threads SET pinned = ?2 WHERE id = ?1", params![t, p])?;
            }
            if let Some(m) = e.muted {
                tx.execute("UPDATE threads SET muted = ?2 WHERE id = ?1", params![t, m])?;
            }
            if e.snooze_set {
                tx.execute(
                    "UPDATE threads SET snoozed_until_ms = ?2 WHERE id = ?1",
                    params![t, e.snooze_until],
                )?;
            }
        }
        refresh_thread(tx, t)?;
    }
    Ok(())
}

fn rfc_of(tx: &Transaction, msg: i64) -> StoreResult<Option<String>> {
    Ok(tx
        .query_row("SELECT message_id FROM messages WHERE id = ?1", [msg], |r| {
            r.get(0)
        })
        .optional()?
        .flatten())
}

/// Plans a move/copy: the effect plus one server step per source mailbox.
fn plan_move(
    tx: &Transaction,
    snap: &Snapshot,
    sources: Option<&[&MailboxInfo]>,
    dest: &MailboxInfo,
    copy: bool,
) -> StoreResult<(Effect, Vec<Step>)> {
    let mut by_mb: BTreeMap<String, Vec<Target>> = BTreeMap::new();
    let mut moved = Vec::new();
    for t in &snap.threads {
        for (mb, uid, msg, _) in &t.memberships {
            let hit = match sources {
                Some(list) => list.iter().any(|s| &s.id == mb),
                None => mb != &dest.id,
            };
            if !hit {
                continue;
            }
            if !moved.contains(msg) {
                moved.push(*msg);
            }
            // Provisional (negative) memberships were never on the server.
            if *uid > 0 {
                by_mb.entry(mb.clone()).or_default().push(Target {
                    msg: *msg,
                    rfc: rfc_of(tx, *msg)?,
                    uid: Some(*uid),
                });
            }
        }
    }
    let action = if copy {
        StepAction::CopyTo {
            mailbox_id: dest.id.clone(),
            path: dest.path.clone(),
        }
    } else {
        StepAction::MoveTo {
            mailbox_id: dest.id.clone(),
            path: dest.path.clone(),
        }
    };
    let mut steps = Vec::new();
    for (mb, targets) in by_mb {
        let info = mailbox(tx, &mb)?;
        steps.push(Step {
            mailbox_id: info.id,
            path: info.path,
            uidvalidity: info.uidvalidity,
            action: action.clone(),
            targets,
        });
    }
    let effect = Effect {
        remove_from: if copy || sources.is_none() {
            vec![]
        } else {
            sources.unwrap_or(&[]).iter().map(|s| s.id.clone()).collect()
        },
        remove_all: !copy && sources.is_none(),
        add_to: Some(dest.id.clone()),
        moved,
        ..Effect::default()
    };
    Ok((effect, steps))
}

fn plan_flag(tx: &Transaction, snap: &Snapshot, bit: u32, on: bool) -> StoreResult<(Effect, Vec<Step>)> {
    let mut by_mb: BTreeMap<String, Vec<Target>> = BTreeMap::new();
    for t in &snap.threads {
        let changing: Vec<i64> = t
            .messages
            .iter()
            .filter(|(_, f)| (f & bit != 0) != on)
            .map(|(id, _)| *id)
            .collect();
        for (mb, uid, msg, _) in &t.memberships {
            if *uid > 0 && changing.contains(msg) {
                by_mb.entry(mb.clone()).or_default().push(Target {
                    msg: *msg,
                    rfc: rfc_of(tx, *msg)?,
                    uid: Some(*uid),
                });
            }
        }
    }
    let action = if on {
        StepAction::AddFlags { bits: bit }
    } else {
        StepAction::RemoveFlags { bits: bit }
    };
    let mut steps = Vec::new();
    for (mb, targets) in by_mb {
        let info = mailbox(tx, &mb)?;
        steps.push(Step {
            mailbox_id: info.id,
            path: info.path,
            uidvalidity: info.uidvalidity,
            action: action.clone(),
            targets,
        });
    }
    let effect = Effect {
        flag_on: if on { bit } else { 0 },
        flag_off: if on { 0 } else { bit },
        ..Effect::default()
    };
    Ok((effect, steps))
}

fn plan(
    tx: &Transaction,
    account: &str,
    req: &OpRequest,
    snap: &Snapshot,
) -> StoreResult<(Effect, Vec<Step>)> {
    use OpKind::*;
    let inbox = || need_role(tx, account, MailboxRole::Inbox);
    let archive = || -> StoreResult<MailboxInfo> {
        match by_role(tx, account, MailboxRole::Archive)? {
            Some(a) => Ok(a),
            None => need_role(tx, account, MailboxRole::All),
        }
    };
    let pick = |id: &Option<String>| -> StoreResult<Option<MailboxInfo>> {
        id.as_deref().map(|id| mailbox(tx, id)).transpose()
    };
    match req.kind {
        Done => {
            let (src, dst) = (inbox()?, archive()?);
            plan_move(tx, snap, Some(&[&src]), &dst, false)
        }
        Undone => {
            let (src, dst) = (archive()?, inbox()?);
            // Gmail's All Mail keeps the message: re-adding the label is a COPY.
            let copy = src.role == MailboxRole::All.as_str();
            plan_move(tx, snap, Some(&[&src]), &dst, copy)
        }
        Move => {
            let src = match pick(&req.from_mailbox_id)? {
                Some(m) => m,
                None => inbox()?,
            };
            let dst = pick(&req.to_mailbox_id)?.ok_or_else(|| sql_err("move needs a destination"))?;
            plan_move(tx, snap, Some(&[&src]), &dst, false)
        }
        Delete => plan_move(tx, snap, None, &need_role(tx, account, MailboxRole::Trash)?, false),
        Spam => plan_move(tx, snap, None, &need_role(tx, account, MailboxRole::Spam)?, false),
        BlockSender => {
            let dst = match pick(&req.to_mailbox_id)? {
                Some(m) => m,
                None => need_role(tx, account, MailboxRole::Trash)?,
            };
            plan_move(tx, snap, None, &dst, false)
        }
        Restore => {
            let src = need_role(tx, account, MailboxRole::Trash)?;
            plan_move(tx, snap, Some(&[&src]), &inbox()?, false)
        }
        NotSpam => {
            let src = need_role(tx, account, MailboxRole::Spam)?;
            plan_move(tx, snap, Some(&[&src]), &inbox()?, false)
        }
        MarkRead => plan_flag(tx, snap, FLAG_SEEN, true),
        MarkUnread => plan_flag(tx, snap, FLAG_SEEN, false),
        Pin | Unpin => Ok((
            Effect {
                pinned: Some(req.kind == Pin),
                ..Effect::default()
            },
            vec![],
        )),
        Mute | Unmute => Ok((
            Effect {
                muted: Some(req.kind == Mute),
                ..Effect::default()
            },
            vec![],
        )),
        Snooze | Unsnooze => {
            let until = if req.kind == Snooze {
                Some(
                    req.snooze_until_ms
                        .ok_or_else(|| sql_err("snooze needs a time"))?,
                )
            } else {
                None
            };
            Ok((
                Effect {
                    snooze_set: true,
                    snooze_until: until,
                    ..Effect::default()
                },
                vec![],
            ))
        }
        LabelAdd | LabelRemove => Err(sql_err("labels are not ops-outbox actions yet")),
    }
}

/// The server steps that undo `steps`: flags flip; moves go back from the
/// destination, whose UIDs the server assigned, so they resolve at execution.
fn inverse_steps(tx: &Transaction, steps: &[Step]) -> StoreResult<Vec<Step>> {
    let mut out = Vec::new();
    for s in steps.iter().rev() {
        match &s.action {
            StepAction::AddFlags { bits } | StepAction::RemoveFlags { bits } => {
                let action = match s.action {
                    StepAction::AddFlags { .. } => StepAction::RemoveFlags { bits: *bits },
                    _ => StepAction::AddFlags { bits: *bits },
                };
                out.push(Step {
                    action,
                    ..s.clone()
                });
            }
            StepAction::MoveTo { mailbox_id, .. } | StepAction::CopyTo { mailbox_id, .. } => {
                let dest = mailbox(tx, mailbox_id)?;
                let back = if matches!(s.action, StepAction::MoveTo { .. }) {
                    StepAction::MoveTo {
                        mailbox_id: s.mailbox_id.clone(),
                        path: s.path.clone(),
                    }
                } else {
                    // Undo a label re-add: drop the copy from the destination.
                    StepAction::MoveTo {
                        mailbox_id: s.mailbox_id.clone(),
                        path: s.path.clone(),
                    }
                };
                out.push(Step {
                    mailbox_id: dest.id,
                    path: dest.path,
                    uidvalidity: dest.uidvalidity,
                    action: back,
                    targets: s
                        .targets
                        .iter()
                        .map(|t| Target {
                            msg: t.msg,
                            rfc: t.rfc.clone(),
                            uid: None,
                        })
                        .collect(),
                });
            }
        }
    }
    Ok(out)
}

enum Resolve {
    Ok(ResolvedStep),
    Wait(String),
    Fail(String),
}

/// Concrete UIDs for a step against the mailbox as it is now.
fn resolve(tx: &Transaction, account: &str, s: &Step) -> StoreResult<Resolve> {
    let mb = match mailbox(tx, &s.mailbox_id) {
        Ok(m) => m,
        Err(_) => return Ok(Resolve::Fail(format!("folder {} no longer exists", s.path))),
    };
    let rebuilt = s.uidvalidity.is_some() && mb.uidvalidity != s.uidvalidity;
    let mut uids = Vec::new();
    for t in &s.targets {
        if let (Some(uid), false) = (t.uid, rebuilt) {
            uids.push(uid);
            continue;
        }
        let found: Option<i64> = tx
            .query_row(
                "SELECT mm.uid FROM message_mailboxes mm JOIN messages m ON m.id = mm.message_id
                 WHERE mm.mailbox_id = ?1 AND mm.uid > 0 AND m.account_id = ?2
                   AND (m.id = ?3 OR (?4 IS NOT NULL AND m.message_id = ?4))
                 ORDER BY mm.uid DESC LIMIT 1",
                params![s.mailbox_id, account, t.msg, t.rfc],
                |r| r.get(0),
            )
            .optional()?;
        match (found, t.uid) {
            (Some(u), _) => uids.push(u),
            (None, None) => {
                return Ok(Resolve::Wait(format!(
                    "waiting for the server copy in {}",
                    s.path
                )))
            }
            (None, Some(_)) => {
                return Ok(Resolve::Fail(format!(
                    "{} was rebuilt on the server and the message is no longer there",
                    s.path
                )))
            }
        }
    }
    uids.sort_unstable();
    uids.dedup();
    Ok(Resolve::Ok(ResolvedStep {
        mailbox_path: mb.path,
        uidvalidity: mb.uidvalidity,
        uids,
        action: s.action.clone(),
    }))
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[allow(dead_code)]
struct Loaded {
    id: String,
    account_id: String,
    kind: String,
    thread_ids: Vec<String>,
    args: Args,
    undo: Option<Snapshot>,
    state: String,
    attempts: i64,
    not_before: i64,
    created: i64,
}

fn load_where(tx: &Transaction, clause: &str, args: &[Value]) -> StoreResult<Vec<Loaded>> {
    let sql = format!(
        "SELECT id, account_id, kind, thread_ids_json, args_json, undo_json, state, attempts,
                not_before_ms, created_at_ms FROM ops WHERE {clause} ORDER BY created_at_ms, rowid"
    );
    let mut s = tx.prepare(&sql)?;
    let raw: Vec<(String, String, String, String, String, Option<String>, String, i64, i64, i64)> = s
        .query_map(params_from_iter(args.iter()), |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    raw.into_iter()
        .map(|(id, account_id, kind, t, a, u, state, attempts, not_before, created)| {
            Ok(Loaded {
                id,
                account_id,
                kind,
                thread_ids: from_json(&t)?,
                args: from_json(&a)?,
                undo: u.as_deref().map(from_json).transpose()?,
                state,
                attempts,
                not_before,
                created,
            })
        })
        .collect()
}

fn group_accounts(tx: &Transaction, threads: &[String]) -> StoreResult<BTreeMap<String, Vec<String>>> {
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut s = tx.prepare_cached("SELECT DISTINCT account_id FROM messages WHERE thread_id = ?1")?;
    for t in threads {
        let accts: Vec<String> = s
            .query_map([t], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        for a in accts {
            let list = out.entry(a).or_default();
            if !list.contains(t) {
                list.push(t.clone());
            }
        }
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn insert_op(
    tx: &Transaction,
    id: &str,
    account: &str,
    kind: OpKind,
    threads: &[String],
    args: &Args,
    undo: &Snapshot,
    not_before: i64,
    now: i64,
) -> StoreResult<()> {
    tx.execute(
        "INSERT INTO ops (id, account_id, kind, thread_ids_json, args_json, undo_json, state,
           attempts, not_before_ms, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, ?8)",
        params![
            id,
            account,
            kind.as_str(),
            to_json(&threads)?,
            to_json(args)?,
            to_json(undo)?,
            not_before,
            now
        ],
    )?;
    Ok(())
}

impl Store {
    /// Applies the action locally and queues it, in one transaction.
    pub fn enqueue_op(&self, req: &OpRequest) -> StoreResult<ActionHandle> {
        self.enqueue_op_at(req, now_ms())
    }

    pub fn enqueue_op_at(&self, req: &OpRequest, now: i64) -> StoreResult<ActionHandle> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let action = new_id();
        let mut op_ids = Vec::new();
        let not_before = now + UNDO_WINDOW_MS;
        for (account, threads) in group_accounts(&tx, &req.thread_ids)? {
            let snap = snapshot(&tx, &account, &threads)?;
            let (effect, steps) = plan(&tx, &account, req, &snap)?;
            apply(&tx, &account, &threads, &effect)?;
            let id = new_id();
            let args = Args {
                action: action.clone(),
                effect: Some(effect),
                revert_to: None,
                steps,
            };
            insert_op(&tx, &id, &account, req.kind, &threads, &args, &snap, not_before, now)?;
            op_ids.push(id);
        }
        tx.commit()?;
        Ok(ActionHandle {
            action_id: action,
            op_ids,
            undo_until_ms: not_before,
        })
    }

    /// `z`: cancel if unsent, else queue the compensating action.
    pub fn undo_action(&self, action_id: &str) -> StoreResult<UndoOutcome> {
        self.undo_action_at(action_id, now_ms())
    }

    pub fn undo_action_at(&self, action_id: &str, now: i64) -> StoreResult<UndoOutcome> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let ops = load_where(
            &tx,
            "json_extract(args_json, '$.action') = ?1",
            &[Value::Text(action_id.into())],
        )?;
        if ops.is_empty() {
            return Ok(UndoOutcome::Nothing);
        }
        let mut comp_ids = Vec::new();
        let comp_action = new_id();
        // Newest first, so stacked rows of one action unwind in order.
        for op in ops.iter().rev() {
            let snap = op.undo.clone().unwrap_or_default();
            let unsent = op.state == OpState::Pending.as_str() || op.state == OpState::Failed.as_str();
            if unsent {
                revert(&tx, &snap)?;
                tx.execute("DELETE FROM ops WHERE id = ?1", [&op.id])?;
                continue;
            }
            let current = snapshot(&tx, &op.account_id, &op.thread_ids)?;
            revert(&tx, &snap)?;
            let kind = OpKind::parse(&op.kind).unwrap_or(OpKind::Move);
            let args = Args {
                action: comp_action.clone(),
                effect: None,
                revert_to: Some(snap),
                steps: inverse_steps(&tx, &op.args.steps)?,
            };
            let id = new_id();
            insert_op(
                &tx,
                &id,
                &op.account_id,
                inverse_kind(kind),
                &op.thread_ids,
                &args,
                &current,
                now,
                now,
            )?;
            comp_ids.push(id);
        }
        tx.commit()?;
        Ok(if comp_ids.is_empty() {
            UndoOutcome::Cancelled
        } else {
            UndoOutcome::Compensated(ActionHandle {
                action_id: comp_action,
                op_ids: comp_ids,
                undo_until_ms: now,
            })
        })
    }

    /// Re-asserts every unsent op's local effect. Sync calls this after an
    /// ingest round so server state cannot resurrect a thread inside the window.
    pub fn reapply_pending_ops(&self) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        for mut op in load_where(&tx, "state IN ('pending', 'in_flight')", &[])? {
            // Learn the UIDs a sync just reported for server-made copies before
            // the local effect hides those memberships again.
            let mut learned = false;
            for st in op.args.steps.iter_mut() {
                if st.targets.iter().all(|t| t.uid.is_some()) {
                    continue;
                }
                if let Resolve::Ok(r) = resolve(&tx, &op.account_id, st)? {
                    if r.uids.len() == st.targets.len() {
                        for (t, u) in st.targets.iter_mut().zip(r.uids.iter()) {
                            t.uid = Some(*u);
                        }
                        st.uidvalidity = r.uidvalidity;
                        learned = true;
                    }
                }
            }
            if learned {
                tx.execute(
                    "UPDATE ops SET args_json = ?2 WHERE id = ?1",
                    params![op.id, to_json(&op.args)?],
                )?;
            }
            if let Some(e) = &op.args.effect {
                apply(&tx, &op.account_id, &op.thread_ids, e)?;
            } else if let Some(s) = &op.args.revert_to {
                revert(&tx, s)?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Sync calls this after `reset_mailbox`: queued steps against the old
    /// validity get the new UIDs by Message-ID, or their op fails with a reason.
    pub fn retarget_ops(&self, mailbox_id: &str) -> StoreResult<Vec<String>> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let mut failed = Vec::new();
        for mut op in load_where(&tx, "state = 'pending'", &[])? {
            let mut changed = false;
            let mut fail = None;
            for s in op.args.steps.iter_mut().filter(|s| s.mailbox_id == mailbox_id) {
                match resolve(&tx, &op.account_id, s)? {
                    Resolve::Ok(r) => {
                        if r.uidvalidity != s.uidvalidity {
                            s.uidvalidity = r.uidvalidity;
                            let mut it = r.uids.iter();
                            for t in s.targets.iter_mut() {
                                t.uid = it.next().copied().or(t.uid);
                            }
                            changed = true;
                        }
                    }
                    Resolve::Wait(_) => {}
                    Resolve::Fail(why) => fail = Some(why),
                }
            }
            if let Some(why) = fail {
                tx.execute(
                    "UPDATE ops SET state = 'failed', last_error = ?2 WHERE id = ?1",
                    params![op.id, why],
                )?;
                failed.push(op.id.clone());
            } else if changed {
                tx.execute(
                    "UPDATE ops SET args_json = ?2 WHERE id = ?1",
                    params![op.id, to_json(&op.args)?],
                )?;
            }
        }
        tx.commit()?;
        Ok(failed)
    }

    /// Ops left `in_flight` by a crash go back to pending (run once at start).
    pub fn recover_in_flight_ops(&self) -> StoreResult<()> {
        self.w()
            .execute("UPDATE ops SET state = 'pending' WHERE state = 'in_flight'", [])?;
        Ok(())
    }

    /// Runs every due op against the server, oldest first.
    pub fn run_due_ops<S: OpServer>(&self, server: &mut S, now: i64) -> StoreResult<RunReport> {
        let mut report = RunReport::default();
        let due = {
            let mut conn = self.w();
            let tx = conn.transaction()?;
            tx.execute(
                "DELETE FROM ops WHERE state = 'done' AND created_at_ms < ?1",
                [now - KEEP_DONE_MS],
            )?;
            let due = load_where(
                &tx,
                "state = 'pending' AND not_before_ms <= ?1",
                &[Value::Integer(now)],
            )?;
            for op in &due {
                tx.execute("UPDATE ops SET state = 'in_flight' WHERE id = ?1", [&op.id])?;
            }
            tx.commit()?;
            due
        };
        for op in due {
            let mut outcome: Result<(), OpError> = Ok(());
            for step in &op.args.steps {
                let resolved = {
                    let mut conn = self.w();
                    let tx = conn.transaction()?;
                    let r = resolve(&tx, &op.account_id, step)?;
                    tx.commit()?;
                    r
                };
                let r = match resolved {
                    Resolve::Ok(r) if r.uids.is_empty() => continue,
                    Resolve::Ok(r) => server.run(&op.account_id, &r),
                    Resolve::Wait(why) => Err(OpError::Transient(why)),
                    Resolve::Fail(why) => Err(OpError::Permanent(why)),
                };
                if r.is_err() {
                    outcome = r;
                    break;
                }
            }
            let conn = self.w();
            match outcome {
                Ok(()) => {
                    conn.execute(
                        "UPDATE ops SET state = 'done', last_error = NULL WHERE id = ?1",
                        [&op.id],
                    )?;
                    report.done.push(op.id);
                }
                Err(OpError::Transient(why)) if now - op.created < GIVE_UP_AFTER_MS => {
                    let attempts = op.attempts + 1;
                    conn.execute(
                        "UPDATE ops SET state = 'pending', attempts = ?2, last_error = ?3,
                           not_before_ms = ?4 WHERE id = ?1",
                        params![op.id, attempts, why, now + backoff_ms(attempts)],
                    )?;
                    report.retrying.push(op.id);
                }
                Err(OpError::Transient(why)) | Err(OpError::Permanent(why)) => {
                    conn.execute(
                        "UPDATE ops SET state = 'failed', attempts = attempts + 1, last_error = ?2
                         WHERE id = ?1",
                        params![op.id, why],
                    )?;
                    report.failed.push(op.id);
                }
            }
        }
        Ok(report)
    }

    /// The failed-actions bar: every failed op, oldest first.
    pub fn failed_ops(&self) -> StoreResult<Vec<FailedOp>> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let rows = load_where(&tx, "state = 'failed'", &[])?;
        let errors: Vec<(String, Option<String>)> = {
            let mut s = tx.prepare("SELECT id, last_error FROM ops WHERE state = 'failed'")?;
            let v = s
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            v
        };
        tx.commit()?;
        Ok(rows
            .into_iter()
            .map(|o| FailedOp {
                error: errors
                    .iter()
                    .find(|(id, _)| id == &o.id)
                    .and_then(|(_, e)| e.clone())
                    .unwrap_or_default(),
                kind: OpKind::parse(&o.kind).unwrap_or(OpKind::Move),
                action_id: o.args.action,
                id: o.id,
                account_id: o.account_id,
                thread_ids: o.thread_ids,
                attempts: o.attempts,
            })
            .collect())
    }

    /// Retry: back to pending, due now, with a fresh 24 h budget.
    pub fn retry_op(&self, op_id: &str, now: i64) -> StoreResult<bool> {
        let n = self.w().execute(
            "UPDATE ops SET state = 'pending', attempts = 0, not_before_ms = ?2, created_at_ms = ?2
             WHERE id = ?1 AND state = 'failed'",
            params![op_id, now],
        )?;
        Ok(n > 0)
    }

    /// Discard: drop the op and put its threads back as the server has them.
    pub fn discard_op(&self, op_id: &str) -> StoreResult<bool> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let Some(op) = load_where(
            &tx,
            "id = ?1 AND state = 'failed'",
            &[Value::Text(op_id.into())],
        )?
        .pop() else {
            return Ok(false);
        };
        revert(&tx, &op.undo.unwrap_or_default())?;
        tx.execute("DELETE FROM ops WHERE id = ?1", [op_id])?;
        tx.commit()?;
        Ok(true)
    }

    pub fn op(&self, op_id: &str) -> StoreResult<Option<OpRow>> {
        let conn = self.w();
        let row = conn
            .query_row(
                "SELECT id, account_id, kind, state, attempts, not_before_ms, last_error FROM ops WHERE id = ?1",
                [op_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .optional()?;
        Ok(row.map(|(id, account_id, kind, state, attempts, not_before_ms, last_error)| OpRow {
            id,
            account_id,
            kind: OpKind::parse(&kind).unwrap_or(OpKind::Move),
            state: OpState::parse(&state).unwrap_or(OpState::Failed),
            attempts,
            not_before_ms,
            last_error,
        }))
    }

    /// "Get me to zero": every thread in the view (and tab) whose newest
    /// message is older than `before_ms`, marked Done as one undoable action.
    pub fn zero_out_older(
        &self,
        view: &ViewRef,
        tab: Option<&TabRef>,
        before_ms: i64,
        now: i64,
    ) -> StoreResult<Option<ActionHandle>> {
        let ids = self.thread_ids_older(view, tab, before_ms)?;
        if ids.is_empty() {
            return Ok(None);
        }
        self.enqueue_op_at(&OpRequest::new(OpKind::Done, ids), now)
            .map(Some)
    }

    pub fn thread_ids_older(
        &self,
        view: &ViewRef,
        tab: Option<&TabRef>,
        before_ms: i64,
    ) -> StoreResult<Vec<String>> {
        let mut filter = String::from("last_date_ms < ?");
        let mut args = vec![Value::Integer(before_ms)];
        match view {
            ViewRef::Unified(role) => {
                filter.push_str(" AND role = ?");
                args.push(Value::Text(role.as_str().into()));
            }
            ViewRef::Mailbox(id) => {
                filter.push_str(" AND mailbox_id = ?");
                args.push(Value::Text(id.clone()));
            }
            ViewRef::Snoozed => filter.push_str(" AND snoozed_until_ms IS NOT NULL"),
        }
        if let Some(t) = tab {
            filter.push_str(" AND tab = ?");
            args.push(Value::Text(t.encode()));
        }
        let conn = self.r();
        let mut s = conn.prepare(&format!(
            "SELECT DISTINCT thread_id FROM thread_views WHERE {filter} ORDER BY thread_id"
        ))?;
        let v = s
            .query_map(params_from_iter(args.iter()), |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(v)
    }
}

