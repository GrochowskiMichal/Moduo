//! The per-mailbox sync algorithms (decision 5, AC5/AC6/AC8).
//!
//! One round over a mailbox:
//! 1. `SELECT (CONDSTORE)`. A changed `UIDVALIDITY` drops the mailbox's rows
//!    ([`Store::reset_mailbox`]) and the round re-downloads it; the report
//!    says so, so the ops outbox (MR-5) re-targets queued ops by Message-ID.
//! 2. A UID set diff (`UID SEARCH ALL` against the stored UIDs) finds new mail
//!    and expunges anywhere in the synced range. New UIDs are fetched in
//!    chunks from the exact server set, so a burst of any size and
//!    non-contiguous UIDs lose nothing.
//! 3. Flags: `CHANGEDSINCE <stored HIGHESTMODSEQ>` over the synced range on
//!    CONDSTORE servers; otherwise a chunked flag diff that walks the whole
//!    range across rounds.
//! 4. The first sync takes the newest [`FIRST_BATCH`] only and records a floor;
//!    [`backfill`] then walks below it newest-first with progress and cancel.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::params;
use sha2::{Digest, Sha256};

use super::classify::{classify, ClassifyConfig, Outcome};
use super::events::{EventBus, MailEvent};
use super::headers::{self, ParsedHeader};
use super::roles::{assign_roles, is_live};
use super::server::{FetchedHeader, FlagUpdate, MailServer, SelectInfo};
use super::threading::Threader;
use crate::mail::contracts::{MailboxRole, SyncState, TabKind};
use crate::mail::store::query::view_key;
use crate::mail::store::{
    MailboxCursor, MailboxInput, MessageInput, Store, StoreError, TabRef, ViewRef,
};

/// Newest messages fetched on a mailbox's first sync, so it is usable at once.
pub const FIRST_BATCH: usize = 200;
pub const FETCH_CHUNK: usize = 100;
pub const BACKFILL_CHUNK: usize = 500;
/// UIDs whose flags one non-CONDSTORE round compares.
pub const FLAG_DIFF_CHUNK: usize = 2000;

#[derive(Debug)]
pub enum SyncError {
    Server(String),
    Store(StoreError),
    Cancelled,
}
impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::Server(s) => write!(f, "imap: {s}"),
            SyncError::Store(e) => write!(f, "{e}"),
            SyncError::Cancelled => write!(f, "cancelled"),
        }
    }
}
impl From<StoreError> for SyncError {
    fn from(e: StoreError) -> Self {
        SyncError::Store(e)
    }
}
impl From<rusqlite::Error> for SyncError {
    fn from(e: rusqlite::Error) -> Self {
        SyncError::Store(StoreError::Sql(e))
    }
}
impl From<String> for SyncError {
    fn from(e: String) -> Self {
        SyncError::Server(e)
    }
}
pub type SyncResult<T> = Result<T, SyncError>;

/// Everything a round needs besides the session.
pub struct SyncCtx<'a> {
    pub store: &'a Store,
    pub account_id: &'a str,
    pub classify: &'a ClassifyConfig,
    pub events: &'a EventBus,
    /// History depth: only mail on or after this date is synced.
    pub since_ms: Option<i64>,
    pub cancel: &'a AtomicBool,
}

/// A mailbox as the engine syncs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxPlan {
    pub id: String,
    pub path: String,
    pub role: MailboxRole,
    pub live: bool,
    /// False for Gmail label folders: their membership comes from All Mail.
    pub synced: bool,
}

#[derive(Debug, Clone, Default)]
pub struct RoundReport {
    pub reset: bool,
    pub new_uids: Vec<u32>,
    pub expunged: Vec<u32>,
    pub flag_updates: usize,
    pub thread_ids: BTreeSet<String>,
    /// Threads with mail above the previous UIDNEXT (genuinely new mail).
    pub new_thread_ids: BTreeSet<String>,
    /// Rule/block/screener outcomes the ops outbox applies on the server (MR-5/MR-12).
    pub effects: Vec<(String, Outcome)>,
    pub backfill_pending: bool,
}

pub fn mailbox_id(account_id: &str, path: &str) -> String {
    format!("{account_id}|{path}")
}

/// LIST → mailbox rows with roles. Gmail syncs `[Gmail]/All Mail`, Spam and
/// Trash; every other folder there is a label view fed from All Mail (decision 6).
pub async fn sync_folders<S: MailServer>(
    srv: &mut S,
    ctx: &SyncCtx<'_>,
) -> SyncResult<Vec<MailboxPlan>> {
    let gmail = srv.caps().gmail_ext;
    let folders = srv.list_folders().await?;
    let mut plans = Vec::new();
    for (f, role) in assign_roles(&folders) {
        let synced = !gmail
            || matches!(
                role,
                MailboxRole::All | MailboxRole::Spam | MailboxRole::Trash
            );
        let plan = MailboxPlan {
            id: mailbox_id(ctx.account_id, &f.path),
            path: f.path.clone(),
            role,
            live: is_live(role),
            synced,
        };
        ctx.store.upsert_mailbox(&MailboxInput {
            id: plan.id.clone(),
            account_id: ctx.account_id.to_string(),
            path: f.path.clone(),
            name: f.name(),
            role,
            delimiter: f.delimiter.clone(),
            live: plan.live,
        })?;
        plans.push(plan);
    }
    // Folders gone from the server leave the store (their rows cascade).
    let keep: BTreeSet<&str> = plans.iter().map(|p| p.id.as_str()).collect();
    let stale: Vec<String> = ctx
        .store
        .list_mailboxes(ctx.account_id)?
        .into_iter()
        .map(|m| m.id)
        .filter(|id| !keep.contains(id.as_str()))
        .collect();
    if !stale.is_empty() {
        let conn = ctx.store.w();
        for id in &stale {
            conn.execute("DELETE FROM thread_views WHERE mailbox_id = ?1", [id])?;
            conn.execute("DELETE FROM mailboxes WHERE id = ?1", [id])?;
        }
    }
    Ok(plans)
}

fn stored_uids(store: &Store, mailbox_id: &str) -> SyncResult<BTreeMap<u32, u32>> {
    let conn = store.r();
    let mut st = conn.prepare_cached(
        "SELECT mm.uid, m.flags FROM message_mailboxes mm JOIN messages m ON m.id = mm.message_id
         WHERE mm.mailbox_id = ?1 AND mm.uid > 0",
    )?;
    let rows = st.query_map([mailbox_id], |r| {
        Ok((r.get::<_, i64>(0)? as u32, r.get::<_, u32>(1)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn view_keys(plan: &MailboxPlan, extra: &[MailboxPlan]) -> Vec<String> {
    let mut v = BTreeSet::new();
    for p in std::iter::once(plan).chain(extra) {
        v.insert(view_key(&ViewRef::Mailbox(p.id.clone()), None));
        v.insert(view_key(&ViewRef::Unified(p.role), None));
    }
    v.into_iter().collect()
}

/// Where a fetched header came from: the store identity of a non-Gmail
/// message is its (account, mailbox, UIDVALIDITY, UID).
#[derive(Clone, Copy)]
pub(crate) struct Origin<'a> {
    pub mailbox_id: &'a str,
    pub uidvalidity: u32,
}

fn hex12(parts: &str) -> String {
    Sha256::digest(parts.as_bytes())
        .iter()
        .take(12)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Store identity of a message. Gmail: X-GM-MSGID (server-assigned). Else
/// the Message-ID is sender-controlled, so it never identifies a message on
/// its own: a copy in another folder merges only when Message-ID, From, Date
/// and size all match; otherwise the identity is the mailbox UID.
fn ext_id_for(account_id: &str, o: Origin<'_>, h: &FetchedHeader, p: &ParsedHeader) -> String {
    if let Some(g) = h.gm_msgid {
        return format!("gm:{g}");
    }
    if let (Some(m), Some(d)) = (&p.message_id, p.date_ms) {
        if !p.from.email.is_empty() {
            return format!(
                "fp:{}",
                hex12(&format!(
                    "{m}\0{}\0{d}\0{}",
                    p.from.email.to_ascii_lowercase(),
                    h.size
                ))
            );
        }
    }
    format!(
        "u:{}",
        hex12(&format!(
            "{account_id}\0{}\0{}\0{}",
            o.mailbox_id, o.uidvalidity, h.uid
        ))
    )
}

/// Builds and ingests one chunk of fetched headers into `targets(header)`'s
/// mailboxes. Returns the touched thread ids.
fn ingest_chunk(
    ctx: &SyncCtx<'_>,
    origin: Origin<'_>,
    fetched: Vec<FetchedHeader>,
    targets: &dyn Fn(&FetchedHeader) -> Vec<String>,
    new_floor: u32,
    report: &mut RoundReport,
) -> SyncResult<()> {
    let mut parsed: Vec<(FetchedHeader, ParsedHeader)> = fetched
        .into_iter()
        .map(|h| {
            let p = headers::parse(&h.raw);
            (h, p)
        })
        .collect();
    parsed.sort_by_key(|(h, p)| (p.date_ms.or(h.internal_date_ms).unwrap_or(0), h.uid));
    let mut threader = Threader::new(ctx.store, ctx.account_id);
    let mut batch = Vec::with_capacity(parsed.len());
    for (h, p) in &parsed {
        let ext_id = ext_id_for(ctx.account_id, origin, h, p);
        let date_ms = p.date_ms.or(h.internal_date_ms).unwrap_or(0);
        let thread_id = threader.assign(&ext_id, p, date_ms)?;
        let mut cfg_hit = classify(p, ctx.classify);
        if cfg_hit.blocked.is_some()
            || cfg_hit.screened
            || cfg_hit.move_to.is_some()
            || cfg_hit.skip_inbox
            || cfg_hit.mark_read
            || !cfg_hit.labels.is_empty()
        {
            report.effects.push((thread_id.clone(), cfg_hit.clone()));
        }
        if cfg_hit.screened {
            // Held in New senders until Allow or Block releases it.
            ctx.store.set_screened(std::slice::from_ref(&thread_id), true)?;
        }
        if cfg_hit.blocked.is_some() {
            cfg_hit.tab = TabRef::of(TabKind::Personal);
        }
        let has_invite = p.is_calendar
            || h.attachments
                .iter()
                .any(|a| a.mime.eq_ignore_ascii_case("text/calendar"));
        for mb in targets(h) {
            batch.push(MessageInput {
                classify: Some(cfg_hit.reason()),
                account_id: ctx.account_id.to_string(),
                ext_id: ext_id.clone(),
                mailbox_id: mb,
                uid: h.uid as i64,
                modseq: h.modseq.map(|m| m as i64),
                message_id: p.message_id.clone(),
                in_reply_to: p.in_reply_to.clone(),
                references: p.references.clone(),
                thread_id: thread_id.clone(),
                from: p.from.clone(),
                to: p.to.clone(),
                cc: p.cc.clone(),
                subject: p.subject.clone(),
                snippet: String::new(),
                date_ms,
                flags: h.flags,
                size: h.size,
                list_unsubscribe: p.list_unsubscribe.clone(),
                list_unsubscribe_post: p.list_unsubscribe_post.clone(),
                precedence: p.precedence.clone(),
                auto_submitted: p.auto_submitted.clone(),
                has_invite,
                tab: Some(cfg_hit.tab.clone()),
                priority: cfg_hit.priority,
                attachments: h.attachments.clone(),
            });
        }
        report.thread_ids.insert(thread_id.clone());
        if h.uid >= new_floor {
            report.new_thread_ids.insert(thread_id);
        }
    }
    ctx.store.ingest(&batch)?;
    Ok(())
}

/// Fetches `uids` in chunks and ingests them; cancel is checked between chunks.
async fn fetch_and_ingest<S: MailServer>(
    srv: &mut S,
    ctx: &SyncCtx<'_>,
    origin: Origin<'_>,
    uids: &[u32],
    targets: &(dyn Fn(&FetchedHeader) -> Vec<String> + Sync),
    new_floor: u32,
    report: &mut RoundReport,
) -> SyncResult<()> {
    for chunk in uids.chunks(FETCH_CHUNK) {
        if ctx.cancel.load(Ordering::SeqCst) {
            return Err(SyncError::Cancelled);
        }
        let fetched = srv.fetch_headers(chunk).await?;
        ingest_chunk(ctx, origin, fetched, targets, new_floor, report)?;
    }
    Ok(())
}

/// Maps Gmail labels on an All Mail message to the label-view mailboxes.
pub struct LabelMap {
    pub all_mail: String,
    by_label: HashMap<String, String>,
}

impl LabelMap {
    pub fn new(plans: &[MailboxPlan]) -> Option<Self> {
        let all = plans.iter().find(|p| p.role == MailboxRole::All)?;
        let mut by_label = HashMap::new();
        for p in plans.iter().filter(|p| !p.synced) {
            let key = match p.role {
                MailboxRole::Inbox => "\\inbox".to_string(),
                MailboxRole::Sent => "\\sent".to_string(),
                MailboxRole::Drafts => "\\draft".to_string(),
                _ => p.path.to_lowercase(),
            };
            by_label.insert(key, p.id.clone());
        }
        Some(Self {
            all_mail: all.id.clone(),
            by_label,
        })
    }

    /// All Mail plus every known label's mailbox (unknown labels are ignored).
    pub fn targets(&self, labels: &[String]) -> Vec<String> {
        let mut v = vec![self.all_mail.clone()];
        for l in labels {
            let k = l.trim_matches('"').to_lowercase();
            let k = if k == "\\drafts" {
                "\\draft".to_string()
            } else {
                k
            };
            if let Some(id) = self.by_label.get(&k) {
                if !v.contains(id) {
                    v.push(id.clone());
                }
            }
        }
        v
    }

    pub fn label_mailboxes(&self) -> Vec<String> {
        self.by_label.values().cloned().collect()
    }
}

fn save_cursor(
    store: &Store,
    id: &str,
    sel: &SelectInfo,
    floor: Option<u32>,
    pending: bool,
) -> SyncResult<()> {
    store.set_mailbox_cursor(
        id,
        &MailboxCursor {
            uidvalidity: Some(sel.uidvalidity as i64),
            uidnext: sel.uidnext.map(|u| u as i64),
            highestmodseq: sel.highestmodseq.map(|m| m as i64),
            floor_uid: floor.map(|f| f as i64),
            backfill_state: Some(if pending { "pending" } else { "done" }.to_string()),
        },
    )?;
    Ok(())
}

/// One sync round over a synced mailbox. `labels` is set for Gmail All Mail.
pub async fn sync_mailbox<S: MailServer>(
    srv: &mut S,
    ctx: &SyncCtx<'_>,
    plan: &MailboxPlan,
    labels: Option<&LabelMap>,
    label_plans: &[MailboxPlan],
) -> SyncResult<RoundReport> {
    let mut report = RoundReport::default();
    let sel = srv.select(&plan.path).await?;
    let origin = Origin {
        mailbox_id: &plan.id,
        uidvalidity: sel.uidvalidity,
    };
    let mut cursor = ctx.store.mailbox_cursor(&plan.id)?.unwrap_or_default();
    if cursor
        .uidvalidity
        .is_some_and(|v| v != sel.uidvalidity as i64)
    {
        ctx.store.reset_mailbox(&plan.id, sel.uidvalidity as i64)?;
        if let Some(l) = labels {
            for mb in l.label_mailboxes() {
                ctx.store.reset_mailbox(&mb, sel.uidvalidity as i64)?;
            }
        }
        report.reset = true;
        cursor = MailboxCursor::default();
    }
    let first = cursor.uidnext.is_none();
    let prev_uidnext = cursor.uidnext.unwrap_or(0).max(0) as u32;
    let floor = cursor.floor_uid.map(|f| f as u32);

    let local = stored_uids(ctx.store, &plan.id)?;
    let server: BTreeSet<u32> = srv.search_uids(ctx.since_ms).await?.into_iter().collect();

    // Expunges anywhere in the synced range.
    report.expunged = local
        .keys()
        .filter(|u| !server.contains(u))
        .copied()
        .collect();
    if !report.expunged.is_empty() {
        let uids: Vec<i64> = report.expunged.iter().map(|u| *u as i64).collect();
        ctx.store.remove_uids(&plan.id, &uids)?;
        if let Some(l) = labels {
            for mb in l.label_mailboxes() {
                ctx.store.remove_uids(&mb, &uids)?;
            }
        }
    }

    // New mail: the exact missing set at or above the floor (gap-free).
    let missing: Vec<u32> = server
        .iter()
        .filter(|u| !local.contains_key(u) && floor.is_none_or(|f| **u >= f))
        .copied()
        .collect();
    let (now, new_floor, pending) = if first {
        let take = missing.len().min(FIRST_BATCH);
        let newest: Vec<u32> = missing[missing.len() - take..].to_vec();
        let f = newest.first().copied();
        let pending = missing.len() > take;
        (newest, f, pending)
    } else {
        let pending = floor.is_some_and(|f| server.iter().any(|u| *u < f));
        (missing, floor, pending)
    };
    report.new_uids = now.clone();
    let gm_targets = |h: &FetchedHeader| {
        labels.map_or_else(|| vec![plan.id.clone()], |l| l.targets(&h.gm_labels))
    };
    let new_mark = if first { u32::MAX } else { prev_uidnext };
    // Newest first, so the top of the list fills before older mail.
    let mut ordered = now;
    ordered.reverse();
    fetch_and_ingest(
        srv,
        ctx,
        origin,
        &ordered,
        &gm_targets,
        new_mark,
        &mut report,
    )
    .await?;

    // Flags.
    let synced_lo = new_floor.unwrap_or(1).max(1);
    let changed = if srv.caps().condstore && !first {
        match cursor.highestmodseq {
            Some(m) if sel.highestmodseq != Some(m as u64) => {
                srv.fetch_flags(synced_lo, None, Some(m as u64)).await?
            }
            Some(_) => vec![],
            None => diff_flags(srv, ctx, plan, &local, synced_lo).await?,
        }
    } else if !first {
        diff_flags(srv, ctx, plan, &local, synced_lo).await?
    } else {
        vec![]
    };
    apply_flag_updates(
        srv,
        ctx,
        origin,
        plan,
        labels,
        &changed,
        &local,
        &mut report,
    )
    .await?;

    // The ops outbox (MR-5): ops planned against the old UIDVALIDITY get the
    // new UIDs by Message-ID (or fail with a reason), and every unsent op's
    // local effect is re-asserted so this round can't resurrect a thread.
    if report.reset {
        ctx.store.retarget_ops(&plan.id)?;
        if let Some(l) = labels {
            for mb in l.label_mailboxes() {
                ctx.store.retarget_ops(&mb)?;
            }
        }
    }
    if !report.thread_ids.is_empty() || report.reset {
        ctx.store.reapply_pending_ops()?;
    }
    save_cursor(ctx.store, &plan.id, &sel, new_floor, pending)?;
    report.backfill_pending = pending;
    emit_round(ctx, plan, label_plans, &report)?;
    Ok(report)
}

/// The non-CONDSTORE flag diff: compares one chunk of the stored range per
/// round, rotating through the whole range (kv `flagdiff:<mailbox>`).
async fn diff_flags<S: MailServer>(
    srv: &mut S,
    ctx: &SyncCtx<'_>,
    plan: &MailboxPlan,
    local: &BTreeMap<u32, u32>,
    lo: u32,
) -> SyncResult<Vec<FlagUpdate>> {
    let uids: Vec<u32> = local.keys().copied().filter(|u| *u >= lo).collect();
    if uids.is_empty() {
        return Ok(vec![]);
    }
    let key = format!("flagdiff:{}", plan.id);
    let start: u32 = ctx
        .store
        .kv_get(&key)?
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let idx = uids.partition_point(|u| *u < start);
    let idx = if idx >= uids.len() { 0 } else { idx };
    let end = (idx + FLAG_DIFF_CHUNK).min(uids.len());
    let (a, b) = (uids[idx], uids[end - 1]);
    let got = srv.fetch_flags(a, Some(b), None).await?;
    let next = if end >= uids.len() { 0 } else { uids[end] };
    ctx.store.kv_set(&key, &next.to_string())?;
    Ok(got)
}

async fn apply_flag_updates<S: MailServer>(
    srv: &mut S,
    ctx: &SyncCtx<'_>,
    origin: Origin<'_>,
    plan: &MailboxPlan,
    labels: Option<&LabelMap>,
    updates: &[FlagUpdate],
    local: &BTreeMap<u32, u32>,
    report: &mut RoundReport,
) -> SyncResult<()> {
    let changed: Vec<(i64, u32, Option<i64>)> = updates
        .iter()
        .filter(|u| local.get(&u.uid).is_some_and(|f| *f != u.flags))
        .map(|u| (u.uid as i64, u.flags, u.modseq.map(|m| m as i64)))
        .collect();
    report.flag_updates = changed.len();
    if !changed.is_empty() {
        ctx.store.set_flags(&plan.id, &changed)?;
        report.thread_ids.extend(threads_of(
            ctx.store,
            &plan.id,
            changed.iter().map(|c| c.0),
        )?);
    }
    // Gmail label changes: drop memberships that lost their label, re-fetch the
    // ones that gained one (rare, and ingest needs the full header).
    if let Some(l) = labels {
        let mut regain = Vec::new();
        for u in updates.iter().filter(|u| local.contains_key(&u.uid)) {
            let Some(lbls) = &u.gm_labels else { continue };
            let want: BTreeSet<String> = l.targets(lbls).into_iter().collect();
            let have = memberships(ctx.store, &l.label_mailboxes(), u.uid)?;
            for mb in have.iter().filter(|m| !want.contains(*m)) {
                ctx.store.remove_uids(mb, &[u.uid as i64])?;
            }
            if want.iter().any(|w| *w != l.all_mail && !have.contains(w)) {
                regain.push(u.uid);
            }
            report
                .thread_ids
                .extend(threads_of(ctx.store, &plan.id, [u.uid as i64])?);
        }
        if !regain.is_empty() {
            let t = |h: &FetchedHeader| l.targets(&h.gm_labels);
            fetch_and_ingest(srv, ctx, origin, &regain, &t, u32::MAX, report).await?;
        }
    }
    Ok(())
}

fn memberships(store: &Store, mailboxes: &[String], uid: u32) -> SyncResult<BTreeSet<String>> {
    let conn = store.r();
    let mut st =
        conn.prepare_cached("SELECT 1 FROM message_mailboxes WHERE mailbox_id = ?1 AND uid = ?2")?;
    let mut out = BTreeSet::new();
    for mb in mailboxes {
        if st.exists(params![mb, uid as i64])? {
            out.insert(mb.clone());
        }
    }
    Ok(out)
}

fn threads_of(
    store: &Store,
    mailbox_id: &str,
    uids: impl IntoIterator<Item = i64>,
) -> SyncResult<Vec<String>> {
    let conn = store.r();
    let mut st = conn.prepare_cached(
        "SELECT m.thread_id FROM message_mailboxes mm JOIN messages m ON m.id = mm.message_id
         WHERE mm.mailbox_id = ?1 AND mm.uid = ?2",
    )?;
    let mut out = Vec::new();
    for u in uids {
        if let Some(t) = st
            .query_row(params![mailbox_id, u], |r| r.get::<_, String>(0))
            .ok()
        {
            out.push(t);
        }
    }
    Ok(out)
}

fn emit_round(
    ctx: &SyncCtx<'_>,
    plan: &MailboxPlan,
    label_plans: &[MailboxPlan],
    r: &RoundReport,
) -> SyncResult<()> {
    let any = r.reset || !r.thread_ids.is_empty() || !r.expunged.is_empty();
    if !any {
        return Ok(());
    }
    ctx.events.emit(MailEvent::ThreadsChanged {
        view_keys: view_keys(plan, label_plans),
        thread_ids: r.thread_ids.iter().cloned().collect(),
    });
    if !r.new_thread_ids.is_empty() {
        ctx.events.emit(MailEvent::NewMail {
            account_id: ctx.account_id.to_string(),
            thread_ids: r.new_thread_ids.iter().cloned().collect(),
        });
    }
    ctx.events.emit(MailEvent::Counts {
        counts: ctx.store.counts()?,
    });
    Ok(())
}

/// Backfill below the floor, newest first, in chunks: determinate progress on
/// the account (`backfilling`, 0–1) and a cancel that stops between chunks and
/// keeps the floor, so the next start resumes where it stopped (AC6).
pub async fn backfill<S: MailServer>(
    srv: &mut S,
    ctx: &SyncCtx<'_>,
    plan: &MailboxPlan,
    labels: Option<&LabelMap>,
    label_plans: &[MailboxPlan],
) -> SyncResult<RoundReport> {
    let mut report = RoundReport::default();
    let sel = srv.select(&plan.path).await?;
    let origin = Origin {
        mailbox_id: &plan.id,
        uidvalidity: sel.uidvalidity,
    };
    let cursor = ctx.store.mailbox_cursor(&plan.id)?.unwrap_or_default();
    if cursor.uidvalidity != Some(sel.uidvalidity as i64) {
        // Validity moved under us: the next round resets and starts over.
        return Ok(report);
    }
    let server: Vec<u32> = srv.search_uids(ctx.since_ms).await?;
    let total = server.len().max(1);
    let mut floor = cursor.floor_uid.map(|f| f as u32).unwrap_or(u32::MAX);
    let mut below: Vec<u32> = server.iter().copied().filter(|u| *u < floor).collect();
    below.reverse();
    let targets = |h: &FetchedHeader| {
        labels.map_or_else(|| vec![plan.id.clone()], |l| l.targets(&h.gm_labels))
    };
    let status = |p: f64| {
        let _ = ctx.store.set_account_sync(
            ctx.account_id,
            SyncState::Backfilling.as_str(),
            Some(p),
            None,
        );
        ctx.events.emit(MailEvent::SyncStatus {
            account_id: ctx.account_id.to_string(),
            state: SyncState::Backfilling,
            progress: Some(p),
        });
    };
    let mut done = server.len() - below.len();
    status(done as f64 / total as f64);
    for chunk in below.chunks(BACKFILL_CHUNK) {
        let mut sub = RoundReport::default();
        let cancelled = ctx.cancel.load(Ordering::SeqCst)
            || match fetch_and_ingest(srv, ctx, origin, chunk, &targets, u32::MAX, &mut sub).await {
                Ok(()) => false,
                // A cancel inside the chunk keeps the floor where it was, so
                // the resume refetches the part of this chunk not yet seen.
                Err(SyncError::Cancelled) => true,
                Err(e) => return Err(e),
            };
        if cancelled {
            save_cursor(
                ctx.store,
                &plan.id,
                &cursor_sel(&cursor, &sel),
                Some(floor),
                true,
            )?;
            ctx.store
                .set_account_sync(ctx.account_id, SyncState::Idle.as_str(), None, None)?;
            ctx.events.emit(MailEvent::SyncStatus {
                account_id: ctx.account_id.to_string(),
                state: SyncState::Idle,
                progress: None,
            });
            return Err(SyncError::Cancelled);
        }
        if !sub.thread_ids.is_empty() {
            ctx.store.reapply_pending_ops()?;
        }
        floor = *chunk.last().unwrap();
        done += chunk.len();
        save_cursor(
            ctx.store,
            &plan.id,
            &cursor_sel(&cursor, &sel),
            Some(floor),
            done < server.len(),
        )?;
        report.thread_ids.extend(sub.thread_ids);
        report.new_uids.extend_from_slice(chunk);
        emit_round(
            ctx,
            plan,
            label_plans,
            &RoundReport {
                thread_ids: report.thread_ids.clone(),
                ..Default::default()
            },
        )?;
        status(done as f64 / total as f64);
    }
    ctx.store
        .set_account_sync(ctx.account_id, SyncState::Idle.as_str(), None, None)?;
    ctx.events.emit(MailEvent::SyncStatus {
        account_id: ctx.account_id.to_string(),
        state: SyncState::Idle,
        progress: None,
    });
    Ok(report)
}

/// Backfill must not advance UIDNEXT/HIGHESTMODSEQ past what the last round
/// processed, or the next round would skip new mail and flag changes.
fn cursor_sel(c: &MailboxCursor, sel: &SelectInfo) -> SelectInfo {
    SelectInfo {
        uidvalidity: sel.uidvalidity,
        uidnext: c.uidnext.map(|u| u as u32),
        highestmodseq: c.highestmodseq.map(|m| m as u64),
        exists: sel.exists,
    }
}
