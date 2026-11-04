//! [`MailServer`] and [`Idle`] over the real async-imap session (MR-2's
//! [`crate::mail::session::Session`]). Exercised by `tests/mail_it.rs` against
//! Dovecot; the algorithms themselves are unit-tested on the fake.

use std::time::Duration;

use async_imap::imap_proto::{BodyStructure, ContentDisposition, ContentType};
use async_imap::types::{Flag, NameAttribute};
use futures_util::TryStreamExt;

use super::roles::FolderInfo;
use super::server::*;
use crate::mail::contracts::{FLAG_ANSWERED, FLAG_DELETED, FLAG_DRAFT, FLAG_FLAGGED, FLAG_SEEN};
use crate::mail::session::{Capabilities, TlsStream};
use crate::mail::store::AttachmentInput;

/// Generic over the stream so the integration tests can talk plain TCP to the
/// local Dovecot; the engine uses the TLS stream.
pub struct ImapServer<T = TlsStream>
where
    T: Stream,
{
    pub session: async_imap::Session<T>,
    pub caps: Capabilities,
}

pub trait Stream:
    tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send + Sync + 'static
{
}
impl<
        T: tokio::io::AsyncRead
            + tokio::io::AsyncWrite
            + Unpin
            + std::fmt::Debug
            + Send
            + Sync
            + 'static,
    > Stream for T
{
}

fn e(err: async_imap::error::Error) -> String {
    format!("imap:{err}")
}

/// `1,3:7,9` from a sorted or unsorted UID list.
pub fn uid_set(uids: &[u32]) -> String {
    let mut v = uids.to_vec();
    v.sort_unstable();
    v.dedup();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < v.len() {
        let start = v[i];
        let mut end = start;
        while i + 1 < v.len() && v[i + 1] == end + 1 {
            i += 1;
            end = v[i];
        }
        out.push(if start == end {
            start.to_string()
        } else {
            format!("{start}:{end}")
        });
        i += 1;
    }
    out.join(",")
}

pub fn flag_bits<'a>(flags: impl Iterator<Item = Flag<'a>>) -> u32 {
    flags.fold(0, |acc, f| {
        acc | match f {
            Flag::Seen => FLAG_SEEN,
            Flag::Flagged => FLAG_FLAGGED,
            Flag::Answered => FLAG_ANSWERED,
            Flag::Draft => FLAG_DRAFT,
            Flag::Deleted => FLAG_DELETED,
            _ => 0,
        }
    })
}

fn attr_name(a: &NameAttribute) -> String {
    match a {
        NameAttribute::NoInferiors => "\\Noinferiors".into(),
        NameAttribute::NoSelect => "\\Noselect".into(),
        NameAttribute::Marked => "\\Marked".into(),
        NameAttribute::Unmarked => "\\Unmarked".into(),
        NameAttribute::All => "\\All".into(),
        NameAttribute::Archive => "\\Archive".into(),
        NameAttribute::Drafts => "\\Drafts".into(),
        NameAttribute::Flagged => "\\Flagged".into(),
        NameAttribute::Junk => "\\Junk".into(),
        NameAttribute::Sent => "\\Sent".into(),
        NameAttribute::Trash => "\\Trash".into(),
        NameAttribute::Extension(s) => s.to_string(),
        _ => String::new(),
    }
}

fn param<'a>(
    p: &'a Option<Vec<(std::borrow::Cow<'a, str>, std::borrow::Cow<'a, str>)>>,
    key: &str,
) -> Option<String> {
    p.as_ref()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.to_string())
}

fn leaf(
    ty: &ContentType,
    disp: &Option<ContentDisposition>,
    id: &Option<std::borrow::Cow<str>>,
    octets: u32,
    part: &str,
    out: &mut Vec<AttachmentInput>,
) {
    let mime = format!("{}/{}", ty.ty, ty.subtype).to_ascii_lowercase();
    let disp_ty = disp.as_ref().map(|d| d.ty.to_ascii_lowercase());
    let name = disp
        .as_ref()
        .and_then(|d| param(&d.params, "filename"))
        .or_else(|| param(&ty.params, "name"));
    let is_attachment =
        disp_ty.as_deref() == Some("attachment") || name.is_some() || mime == "text/calendar";
    let body_text =
        mime.starts_with("text/") && disp_ty.as_deref() != Some("attachment") && name.is_none();
    if !is_attachment || body_text && mime != "text/calendar" {
        return;
    }
    out.push(AttachmentInput {
        part_id: part.to_string(),
        filename: name.unwrap_or_else(|| {
            if mime == "text/calendar" {
                "invite.ics".into()
            } else {
                "attachment".into()
            }
        }),
        mime,
        size: octets as i64,
        is_inline: disp_ty.as_deref() == Some("inline") && id.is_some(),
        content_id: id.as_ref().map(|s| super::headers::bare_id(s)),
    });
}

/// Attachment parts from BODYSTRUCTURE, with IMAP part numbers (`1.2`).
pub fn attachments(bs: &BodyStructure, part: &str, out: &mut Vec<AttachmentInput>) {
    let here = |i: usize| {
        if part.is_empty() {
            (i + 1).to_string()
        } else {
            format!("{part}.{}", i + 1)
        }
    };
    match bs {
        BodyStructure::Multipart { bodies, .. } => {
            for (i, b) in bodies.iter().enumerate() {
                attachments(b, &here(i), out);
            }
        }
        BodyStructure::Basic { common, other, .. } | BodyStructure::Text { common, other, .. } => {
            let p = if part.is_empty() { "1" } else { part };
            leaf(
                &common.ty,
                &common.disposition,
                &other.id,
                other.octets,
                p,
                out,
            );
        }
        BodyStructure::Message { common, other, .. } => {
            // A forwarded message is one attachment (.eml); its own parts aren't listed.
            let p = if part.is_empty() { "1" } else { part };
            out.push(AttachmentInput {
                part_id: p.into(),
                filename: common
                    .disposition
                    .as_ref()
                    .and_then(|d| param(&d.params, "filename"))
                    .unwrap_or_else(|| "message.eml".into()),
                mime: "message/rfc822".into(),
                size: other.octets as i64,
                is_inline: false,
                content_id: None,
            });
        }
    }
}

fn since(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.format("%d-%b-%Y").to_string())
        .unwrap_or_else(|| "01-Jan-1970".into())
}

impl<T: Stream> MailServer for ImapServer<T> {
    fn caps(&self) -> &Capabilities {
        &self.caps
    }

    async fn list_folders(&mut self) -> SrvResult<Vec<FolderInfo>> {
        let names: Vec<_> = self
            .session
            .list(Some(""), Some("*"))
            .await
            .map_err(e)?
            .try_collect()
            .await
            .map_err(e)?;
        Ok(names
            .iter()
            .map(|n| FolderInfo {
                path: n.name().to_string(),
                delimiter: n.delimiter().map(str::to_string),
                attributes: n
                    .attributes()
                    .iter()
                    .map(attr_name)
                    .filter(|s| !s.is_empty())
                    .collect(),
            })
            .collect())
    }

    async fn select(&mut self, path: &str) -> SrvResult<SelectInfo> {
        let mb = if self.caps.condstore {
            self.session.select_condstore(path).await
        } else {
            self.session.select(path).await
        }
        .map_err(e)?;
        Ok(SelectInfo {
            uidvalidity: mb.uid_validity.ok_or("imap:no_uidvalidity")?,
            uidnext: mb.uid_next,
            highestmodseq: mb.highest_modseq,
            exists: mb.exists,
        })
    }

    async fn search_uids(&mut self, since_ms: Option<i64>) -> SrvResult<Vec<u32>> {
        let q = since_ms.map_or_else(|| "ALL".to_string(), |s| format!("SINCE {}", since(s)));
        let mut v: Vec<u32> = self
            .session
            .uid_search(q)
            .await
            .map_err(e)?
            .into_iter()
            .collect();
        v.sort_unstable();
        Ok(v)
    }

    async fn fetch_headers(&mut self, uids: &[u32]) -> SrvResult<Vec<FetchedHeader>> {
        if uids.is_empty() {
            return Ok(vec![]);
        }
        let mut q =
            String::from("(UID FLAGS INTERNALDATE RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER]");
        if self.caps.condstore {
            q.push_str(" MODSEQ");
        }
        if self.caps.gmail_ext {
            q.push_str(" X-GM-MSGID X-GM-LABELS");
        }
        q.push(')');
        let fetches: Vec<_> = self
            .session
            .uid_fetch(uid_set(uids), q)
            .await
            .map_err(e)?
            .try_collect()
            .await
            .map_err(e)?;
        Ok(fetches
            .iter()
            .filter_map(|f| {
                let uid = f.uid?;
                let mut atts = Vec::new();
                if let Some(bs) = f.bodystructure() {
                    attachments(bs, "", &mut atts);
                }
                Some(FetchedHeader {
                    uid,
                    flags: flag_bits(f.flags()),
                    modseq: f.modseq,
                    internal_date_ms: f.internal_date().map(|d| d.timestamp_millis()),
                    size: f.size.unwrap_or(0) as i64,
                    raw: f.header().map(<[u8]>::to_vec).unwrap_or_default(),
                    gm_msgid: f.gmail_msg_id().copied(),
                    gm_labels: f
                        .gmail_labels()
                        .map(|l| l.iter().map(|s| s.to_string()).collect())
                        .unwrap_or_default(),
                    attachments: atts,
                })
            })
            .collect())
    }

    async fn fetch_flags(
        &mut self,
        lo: u32,
        hi: Option<u32>,
        changed_since: Option<u64>,
    ) -> SrvResult<Vec<FlagUpdate>> {
        let set = format!("{lo}:{}", hi.map_or("*".to_string(), |h| h.to_string()));
        let mut q = String::from("(UID FLAGS");
        if self.caps.condstore {
            q.push_str(" MODSEQ");
        }
        if self.caps.gmail_ext {
            q.push_str(" X-GM-LABELS");
        }
        q.push(')');
        if let Some(m) = changed_since {
            q.push_str(&format!(" (CHANGEDSINCE {m})"));
        }
        let fetches: Vec<_> = self
            .session
            .uid_fetch(set, q)
            .await
            .map_err(e)?
            .try_collect()
            .await
            .map_err(e)?;
        let gmail = self.caps.gmail_ext;
        Ok(fetches
            .iter()
            .filter_map(|f| {
                Some(FlagUpdate {
                    uid: f.uid?,
                    flags: flag_bits(f.flags()),
                    modseq: f.modseq,
                    gm_labels: gmail.then(|| {
                        f.gmail_labels()
                            .map(|l| l.iter().map(|s| s.to_string()).collect())
                            .unwrap_or_default()
                    }),
                })
            })
            // `lo:*` always returns the highest UID even below `lo` (RFC 3501).
            .filter(|u| u.uid >= lo)
            .collect())
    }

    async fn status(&mut self, path: &str) -> SrvResult<StatusInfo> {
        let items = if self.caps.condstore {
            "(UIDNEXT UIDVALIDITY MESSAGES HIGHESTMODSEQ)"
        } else {
            "(UIDNEXT UIDVALIDITY MESSAGES)"
        };
        let mb = self.session.status(path, items).await.map_err(e)?;
        Ok(StatusInfo {
            uidnext: mb.uid_next,
            highestmodseq: mb.highest_modseq,
            messages: Some(mb.exists),
            uidvalidity: mb.uid_validity,
        })
    }
}

impl<T: Stream> Idle for ImapServer<T> {
    async fn idle(self, timeout: Duration) -> SrvResult<(Self, bool)> {
        let caps = self.caps;
        let mut handle = self.session.idle();
        handle.init().await.map_err(e)?;
        let changed = {
            // Dropping the stop source would end the wait at once: keep it alive.
            let (wait, _stop) = handle.wait_with_timeout(timeout);
            matches!(
                wait.await.map_err(e)?,
                async_imap::extensions::idle::IdleResponse::NewData(_)
            )
        };
        let session = handle.done().await.map_err(e)?;
        Ok((ImapServer { session, caps }, changed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uid_sets_compress_ranges() {
        assert_eq!(uid_set(&[9, 1, 3, 4, 5, 7, 5]), "1,3:5,7,9");
        assert_eq!(uid_set(&[42]), "42");
    }

    #[test]
    fn since_is_imap_date() {
        assert_eq!(since(1_793_700_000_000), "03-Nov-2026");
    }
}
