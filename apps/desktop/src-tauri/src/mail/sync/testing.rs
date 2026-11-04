//! In-memory IMAP server and store helpers for the sync tests. The fake keeps
//! real IMAP semantics where the engine depends on them: UIDs only grow,
//! UIDVALIDITY changes on recreate, every flag change bumps MODSEQ, and
//! `CHANGEDSINCE` returns exactly the messages changed after a modseq.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::roles::FolderInfo;
use super::server::*;
use crate::mail::contracts::{MailboxRole, TabKind};
use crate::mail::session::Capabilities;
use crate::mail::store::{AccountInput, Address, MailboxInput, MessageInput, Store, TabRef};

pub fn store(tag: &str) -> Store {
    let d = std::env::temp_dir().join(format!(
        "moduo-mail-sync-{tag}-{}-{}",
        std::process::id(),
        crate::mail::store::now_ms()
    ));
    let _ = std::fs::remove_dir_all(&d);
    let s = Store::open(&d).unwrap();
    s.upsert_account(&AccountInput {
        id: "a1".into(),
        address: "me@y.test".into(),
        display_name: "Me".into(),
        provider: "imap".into(),
        hue: 0,
    })
    .unwrap();
    s
}

/// Puts one message straight into the store (threading tests).
pub fn put(
    s: &Store,
    mailbox: &str,
    uid: i64,
    message_id: &str,
    thread: &str,
    subject: &str,
    date_ms: i64,
) {
    s.upsert_mailbox(&MailboxInput {
        id: mailbox.into(),
        account_id: "a1".into(),
        path: mailbox.into(),
        name: mailbox.into(),
        role: MailboxRole::Inbox,
        delimiter: None,
        live: true,
    })
    .unwrap();
    s.ingest(&[MessageInput {
        account_id: "a1".into(),
        ext_id: format!("mid:{message_id}"),
        mailbox_id: mailbox.into(),
        uid,
        modseq: None,
        message_id: Some(message_id.into()),
        in_reply_to: None,
        references: vec![],
        thread_id: thread.into(),
        from: Address {
            name: "".into(),
            email: "ann@x.test".into(),
        },
        to: vec![Address {
            name: "".into(),
            email: "me@y.test".into(),
        }],
        cc: vec![],
        subject: subject.into(),
        snippet: "".into(),
        date_ms,
        flags: 0,
        size: 1,
        list_unsubscribe: None,
        list_unsubscribe_post: None,
        precedence: None,
        auto_submitted: None,
        has_invite: false,
        tab: Some(TabRef::of(TabKind::Personal)),
        priority: false,
        attachments: vec![],
    }])
    .unwrap();
}

#[derive(Debug, Clone)]
pub struct FakeMsg {
    pub raw: Vec<u8>,
    pub flags: u32,
    pub modseq: u64,
    pub labels: Vec<String>,
    pub gm_msgid: Option<u64>,
    pub date_ms: i64,
}

#[derive(Debug, Clone)]
pub struct FakeBox {
    pub attrs: Vec<String>,
    pub uidvalidity: u32,
    pub uidnext: u32,
    pub modseq: u64,
    pub msgs: BTreeMap<u32, FakeMsg>,
}

#[derive(Default)]
pub struct FakeState {
    pub boxes: BTreeMap<String, FakeBox>,
    pub next_validity: u32,
    pub next_gm: u64,
    pub fetched: Vec<u32>,
}

#[derive(Clone)]
pub struct Fake {
    pub st: Arc<Mutex<FakeState>>,
    pub notify: Arc<tokio::sync::Notify>,
    pub caps: Capabilities,
    selected: Option<String>,
}

pub fn raw(message_id: &str, refs: &[&str], from: &str, subject: &str, date_ms: i64) -> Vec<u8> {
    let date = chrono::DateTime::from_timestamp_millis(date_ms)
        .unwrap()
        .to_rfc2822();
    let mut h = format!("Message-ID: <{message_id}>\r\nFrom: {from}\r\nTo: me@y.test\r\nSubject: {subject}\r\nDate: {date}\r\n");
    if let Some(last) = refs.last() {
        h.push_str(&format!(
            "In-Reply-To: <{last}>\r\nReferences: {}\r\n",
            refs.iter()
                .map(|r| format!("<{r}>"))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    h.push_str("\r\n");
    h.into_bytes()
}

impl Fake {
    pub fn new(condstore: bool, gmail: bool) -> Self {
        Self {
            st: Arc::new(Mutex::new(FakeState {
                next_validity: 100,
                ..Default::default()
            })),
            notify: Arc::new(tokio::sync::Notify::new()),
            caps: Capabilities {
                idle: true,
                condstore,
                gmail_ext: gmail,
                special_use: true,
                uidplus: true,
                ..Default::default()
            },
            selected: None,
        }
    }
    /// A second session on the same server state.
    pub fn session(&self) -> Self {
        Self {
            selected: None,
            ..self.clone()
        }
    }
    pub fn add_folder(&self, path: &str, attrs: &[&str]) {
        let mut st = self.st.lock().unwrap();
        st.next_validity += 1;
        let v = st.next_validity;
        st.boxes.insert(
            path.into(),
            FakeBox {
                attrs: attrs.iter().map(|s| s.to_string()).collect(),
                uidvalidity: v,
                uidnext: 1,
                modseq: 1,
                msgs: BTreeMap::new(),
            },
        );
    }
    pub fn append_raw(&self, path: &str, raw: Vec<u8>, date_ms: i64, labels: &[&str]) -> u32 {
        let uid = {
            let mut st = self.st.lock().unwrap();
            st.next_gm += 1;
            let gm = st.next_gm;
            let b = st.boxes.get_mut(path).expect("folder");
            let uid = b.uidnext;
            b.uidnext += 1;
            b.modseq += 1;
            let ms = b.modseq;
            b.msgs.insert(
                uid,
                FakeMsg {
                    raw,
                    flags: 0,
                    modseq: ms,
                    labels: labels.iter().map(|s| s.to_string()).collect(),
                    gm_msgid: Some(gm),
                    date_ms,
                },
            );
            uid
        };
        self.notify.notify_one();
        uid
    }
    pub fn append(&self, path: &str, id: &str, date_ms: i64) -> u32 {
        self.append_raw(
            path,
            raw(
                id,
                &[],
                "Ann <ann@x.test>",
                &format!("Subject {id}"),
                date_ms,
            ),
            date_ms,
            &[],
        )
    }
    /// Skips UIDs (another client appended and expunged in between).
    pub fn skip_uids(&self, path: &str, n: u32) {
        self.st.lock().unwrap().boxes.get_mut(path).unwrap().uidnext += n;
    }
    pub fn set_flags(&self, path: &str, uid: u32, flags: u32) {
        let mut st = self.st.lock().unwrap();
        let b = st.boxes.get_mut(path).unwrap();
        b.modseq += 1;
        let ms = b.modseq;
        let m = b.msgs.get_mut(&uid).unwrap();
        m.flags = flags;
        m.modseq = ms;
    }
    pub fn set_labels(&self, path: &str, uid: u32, labels: &[&str]) {
        let mut st = self.st.lock().unwrap();
        let b = st.boxes.get_mut(path).unwrap();
        b.modseq += 1;
        let ms = b.modseq;
        let m = b.msgs.get_mut(&uid).unwrap();
        m.labels = labels.iter().map(|s| s.to_string()).collect();
        m.modseq = ms;
    }
    pub fn expunge(&self, path: &str, uid: u32) {
        let mut st = self.st.lock().unwrap();
        let b = st.boxes.get_mut(path).unwrap();
        b.msgs.remove(&uid);
        b.modseq += 1;
    }
    /// The server recreates the mailbox: new UIDVALIDITY, messages renumbered.
    pub fn recreate(&self, path: &str) {
        let mut st = self.st.lock().unwrap();
        st.next_validity += 1;
        let v = st.next_validity;
        let b = st.boxes.get_mut(path).unwrap();
        let msgs: Vec<FakeMsg> = std::mem::take(&mut b.msgs).into_values().collect();
        b.uidvalidity = v;
        b.uidnext = 1000;
        for m in msgs {
            b.msgs.insert(b.uidnext, m);
            b.uidnext += 1;
        }
    }
    pub fn fetched(&self) -> Vec<u32> {
        std::mem::take(&mut self.st.lock().unwrap().fetched)
    }
    fn sel(&self) -> String {
        self.selected.clone().expect("no mailbox selected")
    }
}

impl MailServer for Fake {
    fn caps(&self) -> &Capabilities {
        &self.caps
    }
    async fn list_folders(&mut self) -> SrvResult<Vec<FolderInfo>> {
        let st = self.st.lock().unwrap();
        Ok(st
            .boxes
            .iter()
            .map(|(p, b)| FolderInfo {
                path: p.clone(),
                delimiter: Some("/".into()),
                attributes: b.attrs.clone(),
            })
            .collect())
    }
    async fn select(&mut self, path: &str) -> SrvResult<SelectInfo> {
        let st = self.st.lock().unwrap();
        let b = st
            .boxes
            .get(path)
            .ok_or_else(|| format!("NO no such mailbox {path}"))?;
        let info = SelectInfo {
            uidvalidity: b.uidvalidity,
            uidnext: Some(b.uidnext),
            highestmodseq: self.caps.condstore.then_some(b.modseq),
            exists: b.msgs.len() as u32,
        };
        drop(st);
        self.selected = Some(path.to_string());
        Ok(info)
    }
    async fn search_uids(&mut self, since_ms: Option<i64>) -> SrvResult<Vec<u32>> {
        let p = self.sel();
        let st = self.st.lock().unwrap();
        Ok(st.boxes[&p]
            .msgs
            .iter()
            .filter(|(_, m)| since_ms.is_none_or(|s| m.date_ms >= s))
            .map(|(u, _)| *u)
            .collect())
    }
    async fn fetch_headers(&mut self, uids: &[u32]) -> SrvResult<Vec<FetchedHeader>> {
        let p = self.sel();
        let mut st = self.st.lock().unwrap();
        st.fetched.extend_from_slice(uids);
        let b = &st.boxes[&p];
        Ok(uids
            .iter()
            .filter_map(|u| b.msgs.get(u).map(|m| (u, m)))
            .map(|(u, m)| FetchedHeader {
                uid: *u,
                flags: m.flags,
                modseq: self.caps.condstore.then_some(m.modseq),
                internal_date_ms: Some(m.date_ms),
                size: m.raw.len() as i64,
                raw: m.raw.clone(),
                gm_msgid: m.gm_msgid.filter(|_| self.caps.gmail_ext),
                gm_labels: m.labels.clone(),
                attachments: vec![],
            })
            .collect())
    }
    async fn fetch_flags(
        &mut self,
        lo: u32,
        hi: Option<u32>,
        changed_since: Option<u64>,
    ) -> SrvResult<Vec<FlagUpdate>> {
        let p = self.sel();
        let st = self.st.lock().unwrap();
        Ok(st.boxes[&p]
            .msgs
            .range(lo..=hi.unwrap_or(u32::MAX))
            .filter(|(_, m)| changed_since.is_none_or(|c| m.modseq > c))
            .map(|(u, m)| FlagUpdate {
                uid: *u,
                flags: m.flags,
                modseq: self.caps.condstore.then_some(m.modseq),
                gm_labels: self.caps.gmail_ext.then(|| m.labels.clone()),
            })
            .collect())
    }
    async fn status(&mut self, path: &str) -> SrvResult<StatusInfo> {
        let st = self.st.lock().unwrap();
        let b = st.boxes.get(path).ok_or("NO")?;
        Ok(StatusInfo {
            uidnext: Some(b.uidnext),
            highestmodseq: self.caps.condstore.then_some(b.modseq),
            messages: Some(b.msgs.len() as u32),
            uidvalidity: Some(b.uidvalidity),
        })
    }
}

impl Idle for Fake {
    async fn idle(self, timeout: Duration) -> SrvResult<(Self, bool)> {
        let n = self.notify.clone();
        let changed = tokio::time::timeout(timeout, n.notified()).await.is_ok();
        Ok((self, changed))
    }
}
