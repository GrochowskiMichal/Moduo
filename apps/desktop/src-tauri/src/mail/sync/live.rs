//! Live folders and the account loop (decision 5, AC5/AC6).
//!
//! - INBOX holds one IDLE session (Gmail: All Mail, which carries the Inbox
//!   label). A change wakes a round at once; IDLE is re-issued every 25 min.
//!   A server without IDLE polls every 60 s on that session only, never for life.
//! - Sent and Drafts get a cheap `STATUS (UIDNEXT HIGHESTMODSEQ MESSAGES)` every
//!   60 s; every other folder every 10 min, and on open ([`AccountSync::open_folder`]).
//!   A round runs only when STATUS says something moved.
//! - Backfill runs on a command session after the first round, with progress and cancel.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use super::classify::ClassifyConfig;
use super::engine::{
    backfill, sync_folders, sync_mailbox, LabelMap, MailboxPlan, RoundReport, SyncCtx, SyncError,
    SyncResult,
};
use super::events::{EventBus, MailEvent};
use super::server::{Idle, MailServer, StatusInfo};
use crate::mail::contracts::{MailboxRole, SyncState};
use crate::mail::store::Store;

pub const IDLE_TIMEOUT: Duration = Duration::from_secs(25 * 60);
pub const POLL_FALLBACK: Duration = Duration::from_secs(60);
pub const LIVE_STATUS_EVERY_MS: i64 = 60_000;
pub const SWEEP_EVERY_MS: i64 = 10 * 60_000;

/// When each non-IDLE folder is next due a STATUS check.
#[derive(Debug, Default)]
pub struct Schedule {
    last: HashMap<String, i64>,
}

impl Schedule {
    pub fn interval(plan: &MailboxPlan) -> i64 {
        if plan.live {
            LIVE_STATUS_EVERY_MS
        } else {
            SWEEP_EVERY_MS
        }
    }
    /// The synced folders due now (the IDLE folder is never due: IDLE covers it).
    pub fn due<'p>(
        &self,
        plans: &'p [MailboxPlan],
        idle_id: Option<&str>,
        now: i64,
    ) -> Vec<&'p MailboxPlan> {
        plans
            .iter()
            .filter(|p| p.synced && Some(p.id.as_str()) != idle_id)
            .filter(|p| {
                self.last
                    .get(&p.id)
                    .is_none_or(|t| now - t >= Self::interval(p))
            })
            .collect()
    }
    pub fn mark(&mut self, id: &str, now: i64) {
        self.last.insert(id.to_string(), now);
    }
}

/// STATUS says the mailbox moved since its stored cursor.
pub fn status_moved(store: &Store, plan: &MailboxPlan, s: &StatusInfo) -> SyncResult<bool> {
    let Some(c) = store.mailbox_cursor(&plan.id)? else {
        return Ok(true);
    };
    let stored = store.r().query_row(
        "SELECT COUNT(*) FROM message_mailboxes WHERE mailbox_id = ?1 AND uid > 0",
        [&plan.id],
        |r| r.get::<_, i64>(0),
    )?;
    Ok(c.uidnext != s.uidnext.map(i64::from)
        || (s.highestmodseq.is_some() && c.highestmodseq != s.highestmodseq.map(|m| m as i64))
        || s.uidvalidity
            .is_some_and(|v| c.uidvalidity != Some(v as i64))
        || s.messages.is_some_and(|m| i64::from(m) != stored)
        || s.highestmodseq.is_none())
}

/// Owned per-account sync state; builds a [`SyncCtx`] for each round.
pub struct AccountSync {
    pub account_id: String,
    pub store: Arc<Store>,
    pub events: EventBus,
    pub classify: Arc<RwLock<ClassifyConfig>>,
    pub since_ms: Option<i64>,
    /// Cancels the running backfill (Cancel in the rail); cleared on the next start.
    pub cancel_backfill: Arc<AtomicBool>,
    never: AtomicBool,
}

impl AccountSync {
    pub fn new(
        account_id: &str,
        store: Arc<Store>,
        events: EventBus,
        classify: Arc<RwLock<ClassifyConfig>>,
        since_ms: Option<i64>,
    ) -> Self {
        Self {
            account_id: account_id.to_string(),
            store,
            events,
            classify,
            since_ms,
            cancel_backfill: Arc::new(AtomicBool::new(false)),
            never: AtomicBool::new(false),
        }
    }

    fn status(&self, state: SyncState, progress: Option<f64>, err: Option<&str>) {
        let _ = self
            .store
            .set_account_sync(&self.account_id, state.as_str(), progress, err);
        self.events.emit(MailEvent::SyncStatus {
            account_id: self.account_id.clone(),
            state,
            progress,
        });
    }

    /// LIST plus one round over every synced folder, live ones first.
    pub async fn first_round<S: MailServer>(&self, srv: &mut S) -> SyncResult<Vec<MailboxPlan>> {
        let fresh: bool = self.store.r().query_row(
            "SELECT EXISTS(SELECT 1 FROM mailboxes WHERE account_id = ?1 AND uidnext IS NOT NULL)",
            [&self.account_id],
            |r| r.get(0),
        )?;
        self.status(
            if fresh {
                SyncState::Syncing
            } else {
                SyncState::FirstSync
            },
            None,
            None,
        );
        let cfg = self
            .classify
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let ctx = SyncCtx {
            store: &self.store,
            account_id: &self.account_id,
            classify: &cfg,
            events: &self.events,
            since_ms: self.since_ms,
            cancel: &self.never,
        };
        let mut plans = sync_folders(srv, &ctx).await?;
        plans.sort_by_key(|p| {
            (
                !p.live,
                p.role != MailboxRole::Inbox,
                p.role != MailboxRole::All,
            )
        });
        let labels = LabelMap::new(&plans).filter(|_| srv.caps().gmail_ext);
        let label_plans: Vec<MailboxPlan> = plans.iter().filter(|p| !p.synced).cloned().collect();
        for p in plans.iter().filter(|p| p.synced) {
            let l = labels.as_ref().filter(|l| l.all_mail == p.id);
            sync_mailbox(
                srv,
                &ctx,
                p,
                l,
                if l.is_some() { &label_plans } else { &[] },
            )
            .await?;
        }
        self.status(SyncState::Idle, None, None);
        Ok(plans)
    }

    /// One round over one folder (the folder was opened, or STATUS moved).
    pub async fn round<S: MailServer>(
        &self,
        srv: &mut S,
        plans: &[MailboxPlan],
        plan: &MailboxPlan,
    ) -> SyncResult<RoundReport> {
        let cfg = self
            .classify
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let ctx = SyncCtx {
            store: &self.store,
            account_id: &self.account_id,
            classify: &cfg,
            events: &self.events,
            since_ms: self.since_ms,
            cancel: &self.never,
        };
        let labels = LabelMap::new(plans).filter(|l| l.all_mail == plan.id && srv.caps().gmail_ext);
        let label_plans: Vec<MailboxPlan> = if labels.is_some() {
            plans.iter().filter(|p| !p.synced).cloned().collect()
        } else {
            vec![]
        };
        sync_mailbox(srv, &ctx, plan, labels.as_ref(), &label_plans).await
    }

    /// Opening a folder in the UI: a label view syncs its All Mail source.
    pub async fn open_folder<S: MailServer>(
        &self,
        srv: &mut S,
        plans: &[MailboxPlan],
        mailbox_id: &str,
    ) -> SyncResult<()> {
        let Some(p) = plans.iter().find(|p| p.id == mailbox_id) else {
            return Ok(());
        };
        let target = if p.synced {
            p
        } else {
            match plans.iter().find(|x| x.role == MailboxRole::All) {
                Some(a) => a,
                None => return Ok(()),
            }
        };
        self.round(srv, plans, target).await.map(|_| ())
    }

    /// Backfills every synced folder below its floor. Cancel stops between
    /// chunks and keeps the floor; a later call resumes.
    pub async fn backfill_all<S: MailServer>(
        &self,
        srv: &mut S,
        plans: &[MailboxPlan],
    ) -> SyncResult<()> {
        self.cancel_backfill.store(false, Ordering::SeqCst);
        let cancel = self.cancel_backfill.clone();
        let cfg = self
            .classify
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let ctx = SyncCtx {
            store: &self.store,
            account_id: &self.account_id,
            classify: &cfg,
            events: &self.events,
            since_ms: self.since_ms,
            cancel: &cancel,
        };
        let labels = LabelMap::new(plans).filter(|_| srv.caps().gmail_ext);
        let label_plans: Vec<MailboxPlan> = plans.iter().filter(|p| !p.synced).cloned().collect();
        for p in plans.iter().filter(|p| p.synced) {
            let l = labels.as_ref().filter(|l| l.all_mail == p.id);
            backfill(
                srv,
                &ctx,
                p,
                l,
                if l.is_some() { &label_plans } else { &[] },
            )
            .await?;
        }
        Ok(())
    }

    pub fn cancel_backfill(&self) {
        self.cancel_backfill.store(true, Ordering::SeqCst);
    }

    /// STATUS sweep: rounds only the due folders whose STATUS moved.
    pub async fn sweep<S: MailServer>(
        &self,
        srv: &mut S,
        plans: &[MailboxPlan],
        sched: &mut Schedule,
        idle_id: Option<&str>,
        now: i64,
    ) -> SyncResult<usize> {
        let due: Vec<MailboxPlan> = sched
            .due(plans, idle_id, now)
            .into_iter()
            .cloned()
            .collect();
        let mut ran = 0;
        for p in &due {
            sched.mark(&p.id, now);
            let s = srv.status(&p.path).await?;
            if status_moved(&self.store, p, &s)? {
                self.round(srv, plans, p).await?;
                ran += 1;
            }
        }
        Ok(ran)
    }

    /// The folder IDLE watches: INBOX, or All Mail on Gmail.
    pub fn idle_target<'p>(plans: &'p [MailboxPlan], gmail: bool) -> Option<&'p MailboxPlan> {
        let role = if gmail {
            MailboxRole::All
        } else {
            MailboxRole::Inbox
        };
        plans.iter().find(|p| p.role == role && p.synced)
    }

    /// The IDLE loop on a dedicated session: round, wait, repeat, until `stop`.
    /// Returns the session's error so the caller reconnects with backoff.
    pub async fn idle_loop<S: Idle>(
        &self,
        mut srv: S,
        plans: &[MailboxPlan],
        stop: &AtomicBool,
    ) -> SyncResult<()> {
        let gmail = srv.caps().gmail_ext;
        let Some(target) = Self::idle_target(plans, gmail).cloned() else {
            return Ok(());
        };
        while !stop.load(Ordering::SeqCst) {
            self.round(&mut srv, plans, &target).await?;
            if srv.caps().idle {
                // Mail that landed between the round and IDLE shows in SELECT:
                // run another round instead of waiting on it.
                let sel = srv.select(&target.path).await?;
                let c = self.store.mailbox_cursor(&target.id)?.unwrap_or_default();
                if c.uidnext != sel.uidnext.map(i64::from)
                    || c.highestmodseq != sel.highestmodseq.map(|m| m as i64)
                {
                    continue;
                }
                let (s, _changed) = srv.idle(IDLE_TIMEOUT).await.map_err(SyncError::Server)?;
                srv = s;
            } else {
                tokio::time::sleep(POLL_FALLBACK).await;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(id: &str, role: MailboxRole) -> MailboxPlan {
        MailboxPlan {
            id: id.into(),
            path: id.into(),
            role,
            live: super::super::roles::is_live(role),
            synced: true,
        }
    }

    #[test]
    fn live_folders_every_minute_others_every_ten() {
        let plans = vec![
            plan("in", MailboxRole::Inbox),
            plan("sent", MailboxRole::Sent),
            plan("arch", MailboxRole::Archive),
        ];
        let mut s = Schedule::default();
        let ids = |v: Vec<&MailboxPlan>| v.into_iter().map(|p| p.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(s.due(&plans, Some("in"), 0)), vec!["sent", "arch"]);
        s.mark("sent", 0);
        s.mark("arch", 0);
        assert!(s.due(&plans, Some("in"), 59_000).is_empty());
        assert_eq!(ids(s.due(&plans, Some("in"), 60_000)), vec!["sent"]);
        assert_eq!(
            ids(s.due(&plans, Some("in"), 600_000)),
            vec!["sent", "arch"]
        );
    }
}
