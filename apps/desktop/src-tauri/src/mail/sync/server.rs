//! What the sync engine needs from an IMAP session, as a trait, so the
//! algorithms run unchanged against the real async-imap session
//! ([`super::imap`]) and the in-memory test server ([`super::testing`]).

use std::future::Future;
use std::time::Duration;

use super::roles::FolderInfo;
use crate::mail::session::Capabilities;
use crate::mail::store::AttachmentInput;

pub type SrvResult<T> = Result<T, String>;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelectInfo {
    pub uidvalidity: u32,
    pub uidnext: Option<u32>,
    pub highestmodseq: Option<u64>,
    pub exists: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StatusInfo {
    pub uidnext: Option<u32>,
    pub highestmodseq: Option<u64>,
    pub messages: Option<u32>,
    pub uidvalidity: Option<u32>,
}

#[derive(Debug, Clone, Default)]
pub struct FetchedHeader {
    pub uid: u32,
    pub flags: u32,
    pub modseq: Option<u64>,
    pub internal_date_ms: Option<i64>,
    pub size: i64,
    /// The raw `HEADER.FIELDS` block.
    pub raw: Vec<u8>,
    pub gm_msgid: Option<u64>,
    pub gm_labels: Vec<String>,
    pub attachments: Vec<AttachmentInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlagUpdate {
    pub uid: u32,
    pub flags: u32,
    pub modseq: Option<u64>,
    /// Only on Gmail (`X-GM-LABELS`).
    pub gm_labels: Option<Vec<String>>,
}

pub trait MailServer: Send {
    fn caps(&self) -> &Capabilities;
    fn list_folders(&mut self) -> impl Future<Output = SrvResult<Vec<FolderInfo>>> + Send;
    /// SELECT, with `(CONDSTORE)` when the server has it.
    fn select(&mut self, path: &str) -> impl Future<Output = SrvResult<SelectInfo>> + Send;
    /// Every UID in the selected mailbox (`UID SEARCH ALL`, or `SINCE` the depth).
    fn search_uids(
        &mut self,
        since_ms: Option<i64>,
    ) -> impl Future<Output = SrvResult<Vec<u32>>> + Send;
    fn fetch_headers(
        &mut self,
        uids: &[u32],
    ) -> impl Future<Output = SrvResult<Vec<FetchedHeader>>> + Send;
    /// FLAGS (and MODSEQ / X-GM-LABELS) for `lo:hi` (`hi` None = `*`),
    /// `CHANGEDSINCE` the given modseq when set.
    fn fetch_flags(
        &mut self,
        lo: u32,
        hi: Option<u32>,
        changed_since: Option<u64>,
    ) -> impl Future<Output = SrvResult<Vec<FlagUpdate>>> + Send;
    fn status(&mut self, path: &str) -> impl Future<Output = SrvResult<StatusInfo>> + Send;
}

/// The IDLE half: consumes the session for the wait and gives it back. `true`
/// means the server reported a change; `false` a timeout (re-issue IDLE).
pub trait Idle: MailServer + Sized {
    fn idle(self, timeout: Duration) -> impl Future<Output = SrvResult<(Self, bool)>> + Send;
}
