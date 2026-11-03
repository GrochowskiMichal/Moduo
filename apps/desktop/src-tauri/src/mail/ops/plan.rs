//! Planning and local effects for the ops outbox: mailbox lookups, snapshots,
//! revert/apply of local effects, step planning, inverses and step resolution.

use super::*;

pub(super) struct MailboxInfo {
    pub(super) id: String,
    pub(super) path: String,
    pub(super) role: String,
    pub(super) uidvalidity: Option<i64>,
}

pub(super) fn mailbox(tx: &Transaction, id: &str) -> StoreResult<MailboxInfo> {
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

pub(super) fn by_role(tx: &Transaction, account: &str, role: MailboxRole) -> StoreResult<Option<MailboxInfo>> {
    let id: Option<String> = tx
        .query_row(
            "SELECT id FROM mailboxes WHERE account_id = ?1 AND role = ?2 ORDER BY id LIMIT 1",
            params![account, role.as_str()],
            |r| r.get(0),
        )
        .optional()?;
    id.map(|id| mailbox(tx, &id)).transpose()
}

pub(super) fn need_role(tx: &Transaction, account: &str, role: MailboxRole) -> StoreResult<MailboxInfo> {
    by_role(tx, account, role)?
        .ok_or_else(|| sql_err(format!("account has no {} folder", role.as_str())))
}

pub(super) fn thread_messages(tx: &Transaction, account: &str, thread: &str) -> StoreResult<Vec<(i64, u32)>> {
    let mut s = tx.prepare_cached(
        "SELECT id, flags FROM messages WHERE account_id = ?1 AND thread_id = ?2 ORDER BY id",
    )?;
    let v = s
        .query_map(params![account, thread], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(v)
}

/// (mailbox_id, uid, message_id, modseq) of every message of the thread.
pub(super) fn memberships(
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

pub(super) fn snapshot(tx: &Transaction, account: &str, threads: &[String]) -> StoreResult<Snapshot> {
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
pub(super) fn revert(tx: &Transaction, snap: &Snapshot) -> StoreResult<()> {
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
pub(super) fn apply(tx: &Transaction, account: &str, threads: &[String], e: &Effect) -> StoreResult<()> {
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

pub(super) fn rfc_of(tx: &Transaction, msg: i64) -> StoreResult<Option<String>> {
    Ok(tx
        .query_row("SELECT message_id FROM messages WHERE id = ?1", [msg], |r| {
            r.get(0)
        })
        .optional()?
        .flatten())
}

/// Plans a move/copy: the effect plus one server step per source mailbox.
pub(super) fn plan_move(
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

pub(super) fn plan_flag(tx: &Transaction, snap: &Snapshot, bit: u32, on: bool) -> StoreResult<(Effect, Vec<Step>)> {
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

pub(super) fn plan(
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
pub(super) fn inverse_steps(tx: &Transaction, steps: &[Step]) -> StoreResult<Vec<Step>> {
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

pub(super) enum Resolve {
    Ok(ResolvedStep),
    Wait(String),
    Fail(String),
}

/// Concrete UIDs for a step against the mailbox as it is now.
/// Resolves every target of a step to its UID, in target order (one UID per
/// target), or says why the step must wait or fail.
pub(super) fn resolve_aligned(
    tx: &Transaction,
    account: &str,
    s: &Step,
) -> StoreResult<Result<(MailboxInfo, Vec<i64>), Resolve>> {
    let mb = match mailbox(tx, &s.mailbox_id) {
        Ok(m) => m,
        Err(_) => return Ok(Err(Resolve::Fail(format!("folder {} no longer exists", s.path)))),
    };
    let rebuilt = s.uidvalidity.is_some() && mb.uidvalidity != s.uidvalidity;
    let mut uids = Vec::with_capacity(s.targets.len());
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
                return Ok(Err(Resolve::Wait(format!(
                    "waiting for the server copy in {}",
                    s.path
                ))))
            }
            (None, Some(_)) => {
                return Ok(Err(Resolve::Fail(format!(
                    "{} was rebuilt on the server and the message is no longer there",
                    s.path
                ))))
            }
        }
    }
    Ok(Ok((mb, uids)))
}

pub(super) fn resolve(tx: &Transaction, account: &str, s: &Step) -> StoreResult<Resolve> {
    let (mb, mut uids) = match resolve_aligned(tx, account, s)? {
        Ok(v) => v,
        Err(r) => return Ok(r),
    };
    uids.sort_unstable();
    uids.dedup();
    Ok(Resolve::Ok(ResolvedStep {
        mailbox_path: mb.path,
        uidvalidity: mb.uidvalidity,
        uids,
        action: s.action.clone(),
    }))
}

