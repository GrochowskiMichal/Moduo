//! What the UI reads about ops: the failed-actions bar and `MailOpRecord`.

use super::{from_json, load_where, Args, StepAction};
use crate::mail::contracts::{OpKind, OpState};
use crate::mail::store::{Store, StoreResult};
use rusqlite::OptionalExtension;
use serde::Serialize;

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

/// `MailOpRecord` (runtime.types.mail-engine.ts): the failed line names each op's
/// threads and the first thread's subject.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpRecord {
    pub op_id: String,
    pub kind: OpKind,
    pub thread_ids: Vec<String>,
    pub state: OpState,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at_ms: i64,
    pub subject: Option<String>,
    /// `move` only: the destination mailbox's display name, for "Move to Receipts".
    pub target_name: Option<String>,
}

/// The mailbox a `move` op lands in: the forward effect's destination, else
/// (a compensating move) the first step's.
fn move_target(args: &Args) -> Option<&str> {
    args.effect
        .as_ref()
        .and_then(|e| e.add_to.as_deref())
        .or_else(|| {
            args.steps.iter().find_map(|s| match &s.action {
                StepAction::MoveTo { mailbox_id, .. } | StepAction::CopyTo { mailbox_id, .. } => {
                    Some(mailbox_id.as_str())
                }
                _ => None,
            })
        })
}

impl Store {
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

    /// One op as the UI's `MailOpRecord`, with the first thread's subject.
    pub fn op_record(&self, op_id: &str) -> StoreResult<Option<OpRecord>> {
        let conn = self.w();
        #[allow(clippy::type_complexity)]
        let row: Option<(String, String, String, i64, Option<String>, i64, String)> = conn
            .query_row(
                "SELECT kind, thread_ids_json, state, attempts, last_error, created_at_ms, args_json
                 FROM ops WHERE id = ?1",
                [op_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .optional()?;
        let Some((kind, threads, state, attempts, last_error, created_at_ms, args)) = row else {
            return Ok(None);
        };
        let thread_ids: Vec<String> = from_json(&threads)?;
        let kind = OpKind::parse(&kind).unwrap_or(OpKind::Move);
        let target_name = if kind == OpKind::Move {
            let args: Args = from_json(&args)?;
            match move_target(&args) {
                Some(mb) => conn
                    .query_row("SELECT name FROM mailboxes WHERE id = ?1", [mb], |r| {
                        r.get(0)
                    })
                    .optional()?,
                None => None,
            }
        } else {
            None
        };
        let subject = match thread_ids.first() {
            Some(t) => conn
                .query_row(
                    "SELECT subject FROM messages WHERE thread_id = ?1 AND subject != ''
                     ORDER BY date_ms LIMIT 1",
                    [t],
                    |r| r.get(0),
                )
                .optional()?,
            None => None,
        };
        Ok(Some(OpRecord {
            op_id: op_id.to_string(),
            kind,
            thread_ids,
            state: OpState::parse(&state).unwrap_or(OpState::Failed),
            attempts,
            last_error,
            created_at_ms,
            subject,
            target_name,
        }))
    }
}
