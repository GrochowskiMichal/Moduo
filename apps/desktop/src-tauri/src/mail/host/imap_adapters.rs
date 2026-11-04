//! The real server legs of the ops outbox ([`OpServer`]) and the drafts and
//! send outbox ([`SendTransport`]) over one async-imap session (MR-16a).
//!
//! Both traits are synchronous (the store drives them inside its own loop), so
//! each call blocks the current worker thread on the session future with
//! `block_in_place`. That needs a multi-thread Tokio runtime, which Tauri's
//! async runtime and the integration tests both are.

use futures_util::TryStreamExt;

use crate::mail::contracts::{FLAG_ANSWERED, FLAG_DELETED, FLAG_DRAFT, FLAG_FLAGGED, FLAG_SEEN};
use crate::mail::ops::{OpError, OpServer, ResolvedStep, StepAction};
use crate::mail::send::{SendError, SendTransport};
use crate::mail::sync::imap::{uid_set, ImapServer, Stream};
use crate::mail::sync::server::MailServer;

/// Runs one future to completion from synchronous code on a runtime worker.
fn block<F: std::future::Future>(f: F) -> F::Output {
    let handle = tokio::runtime::Handle::current();
    tokio::task::block_in_place(|| handle.block_on(f))
}

/// `(\Seen \Flagged)` for the flag bits the store keeps.
pub fn flag_list(bits: u32) -> String {
    let names: Vec<&str> = [
        (FLAG_SEEN, "\\Seen"),
        (FLAG_FLAGGED, "\\Flagged"),
        (FLAG_ANSWERED, "\\Answered"),
        (FLAG_DRAFT, "\\Draft"),
        (FLAG_DELETED, "\\Deleted"),
    ]
    .into_iter()
    .filter(|(b, _)| bits & b != 0)
    .map(|(_, n)| n)
    .collect();
    format!("({})", names.join(" "))
}

/// Errors on a live session retry; a NO/BAD on the command fails for good.
fn op_err(e: async_imap::error::Error) -> OpError {
    match e {
        async_imap::error::Error::No(m) | async_imap::error::Error::Bad(m) => {
            OpError::Permanent(format!("imap:{m}"))
        }
        other => OpError::Transient(format!("imap:{other}")),
    }
}

fn send_err(e: async_imap::error::Error) -> SendError {
    match e {
        async_imap::error::Error::No(m) | async_imap::error::Error::Bad(m) => {
            SendError::Permanent(format!("imap:{m}"))
        }
        other => SendError::Transient(format!("imap:{other}")),
    }
}

fn uids_u32(uids: &[i64]) -> Vec<u32> {
    uids.iter().filter_map(|u| u32::try_from(*u).ok()).collect()
}

async fn run_step<T: Stream>(srv: &mut ImapServer<T>, step: &ResolvedStep) -> Result<(), OpError> {
    let sel = srv
        .select(&step.mailbox_path)
        .await
        .map_err(OpError::Transient)?;
    // Never touch whatever now holds the old UID: wait for the next sync round
    // to reset the mailbox and re-target the op by Message-ID.
    if let Some(v) = step.uidvalidity {
        if i64::from(sel.uidvalidity) != v {
            return Err(OpError::Transient("uidvalidity_changed".into()));
        }
    }
    let set = uid_set(&uids_u32(&step.uids));
    if set.is_empty() {
        return Ok(());
    }
    let s = &mut srv.session;
    match &step.action {
        StepAction::AddFlags { bits } => {
            let _: Vec<_> = s
                .uid_store(&set, format!("+FLAGS.SILENT {}", flag_list(*bits)))
                .await
                .map_err(op_err)?
                .try_collect()
                .await
                .map_err(op_err)?;
        }
        StepAction::RemoveFlags { bits } => {
            let _: Vec<_> = s
                .uid_store(&set, format!("-FLAGS.SILENT {}", flag_list(*bits)))
                .await
                .map_err(op_err)?
                .try_collect()
                .await
                .map_err(op_err)?;
        }
        StepAction::CopyTo { path, .. } => s.uid_copy(&set, path).await.map_err(op_err)?,
        StepAction::MoveTo { path, .. } => {
            if srv.caps.r#move {
                srv.session.uid_mv(&set, path).await.map_err(op_err)?;
            } else {
                s.uid_copy(&set, path).await.map_err(op_err)?;
                let _: Vec<_> = s
                    .uid_store(&set, "+FLAGS.SILENT (\\Deleted)")
                    .await
                    .map_err(op_err)?
                    .try_collect()
                    .await
                    .map_err(op_err)?;
                let _: Vec<_> = s
                    .uid_expunge(&set)
                    .await
                    .map_err(op_err)?
                    .try_collect()
                    .await
                    .map_err(op_err)?;
            }
        }
    }
    Ok(())
}

/// The ops executor's IMAP leg over one session.
pub struct ImapOps<'a, T: Stream> {
    pub srv: &'a mut ImapServer<T>,
}

impl<T: Stream> OpServer for ImapOps<'_, T> {
    fn run(&mut self, _account_id: &str, step: &ResolvedStep) -> Result<(), OpError> {
        block(run_step(self.srv, step))
    }
}

/// The SMTP leg: `(from, rcpts, mime)`. Production wraps [`crate::mail::send::smtp::send_raw`].
pub type SmtpLeg<'a> = Box<dyn FnMut(&str, &[String], &[u8]) -> Result<(), SendError> + 'a>;

/// The drafts and send outbox transport for one account.
pub struct ImapSend<'a, T: Stream> {
    pub srv: &'a mut ImapServer<T>,
    pub smtp: SmtpLeg<'a>,
}

/// The `Message-ID` header value of a MIME message, if it has one.
pub fn header_message_id(mime: &[u8]) -> Option<String> {
    let head_end = mime
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .unwrap_or(mime.len());
    let head = String::from_utf8_lossy(&mime[..head_end]);
    head.split("\r\n")
        .find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.trim()
                .eq_ignore_ascii_case("message-id")
                .then(|| v.trim().to_string())
        })
        .filter(|v| !v.is_empty())
}

async fn append_uid<T: Stream>(
    srv: &mut ImapServer<T>,
    path: &str,
    flags: &[&str],
    mime: &[u8],
) -> Result<Option<i64>, SendError> {
    let flags = format!("({})", flags.join(" "));
    srv.session
        .append(path, Some(&flags), None, mime)
        .await
        .map_err(send_err)?;
    // No APPENDUID from async-imap: find the copy by its Message-ID instead.
    let Some(mid) = header_message_id(mime) else {
        return Ok(None);
    };
    if mid.contains('"') || mid.contains('\r') || mid.contains('\n') {
        return Ok(None);
    }
    srv.select(path).await.map_err(SendError::Transient)?;
    let hits = srv
        .session
        .uid_search(format!("HEADER Message-ID \"{mid}\""))
        .await
        .map_err(send_err)?;
    Ok(hits.into_iter().max().map(i64::from))
}

async fn delete_one<T: Stream>(srv: &mut ImapServer<T>, path: &str, uid: i64) -> Result<(), SendError> {
    let Ok(uid) = u32::try_from(uid) else {
        return Err(SendError::Permanent(format!("bad uid {uid}")));
    };
    srv.select(path).await.map_err(SendError::Transient)?;
    let set = uid.to_string();
    let _: Vec<_> = srv
        .session
        .uid_store(&set, "+FLAGS.SILENT (\\Deleted)")
        .await
        .map_err(send_err)?
        .try_collect()
        .await
        .map_err(send_err)?;
    let _: Vec<_> = srv
        .session
        .uid_expunge(&set)
        .await
        .map_err(send_err)?
        .try_collect()
        .await
        .map_err(send_err)?;
    Ok(())
}

impl<T: Stream> SendTransport for ImapSend<'_, T> {
    fn smtp_send(
        &mut self,
        _account_id: &str,
        from: &str,
        rcpts: &[String],
        mime: &[u8],
    ) -> Result<(), SendError> {
        let leg = &mut self.smtp;
        tokio::task::block_in_place(|| leg(from, rcpts, mime))
    }

    fn graph_send(&mut self, _account_id: &str, _mime: &[u8]) -> Result<(), SendError> {
        // Graph sendMail lands with the Microsoft send fallback; until then the
        // message returns to Drafts with a reason instead of retrying for a day.
        Err(SendError::Permanent("graph_send_unavailable".into()))
    }

    fn append(
        &mut self,
        _account_id: &str,
        mailbox_path: &str,
        flags: &[&str],
        mime: &[u8],
    ) -> Result<Option<i64>, SendError> {
        block(append_uid(self.srv, mailbox_path, flags, mime))
    }

    fn delete_uid(
        &mut self,
        _account_id: &str,
        mailbox_path: &str,
        uid: i64,
    ) -> Result<(), SendError> {
        block(delete_one(self.srv, mailbox_path, uid))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_lists() {
        assert_eq!(flag_list(FLAG_SEEN), "(\\Seen)");
        assert_eq!(flag_list(FLAG_SEEN | FLAG_FLAGGED), "(\\Seen \\Flagged)");
        assert_eq!(flag_list(0), "()");
    }

    #[test]
    fn message_id_from_headers_only() {
        let m = b"From: a@b\r\nMessage-ID: <x@y>\r\n\r\nMessage-ID: <body@z>";
        assert_eq!(header_message_id(m).as_deref(), Some("<x@y>"));
        assert_eq!(header_message_id(b"From: a\r\n\r\nbody"), None);
    }
}
