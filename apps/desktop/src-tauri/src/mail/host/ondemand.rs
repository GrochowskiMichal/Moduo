//! What the webview asks of a running account (reader commands): sessions
//! checked out of the account's pool for raw source, attachments and opened
//! threads; folder rounds and backfill queued to the worker's own session;
//! and the body prefetch the worker drains each tick (decision 8: opened →
//! visible → newest inbox → last 3 months → index-only).

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::Actor;
use crate::mail::bodies::fetch::{load_body, BodyError, ImapSource};
use crate::mail::bodies::{PrefetchQueue, Priority};
use crate::mail::contracts::SyncState;
use crate::mail::store::{now_ms, Store};
use crate::mail::sync::engine::MailboxPlan;
use crate::mail::sync::events::{EventBus, MailEvent};
use crate::mail::sync::imap::ImapServer;
use crate::mail::sync::live::AccountSync;

/// Bodies fetched per worker tick, so prefetch never starves the sweep.
pub const PREFETCH_BUDGET: usize = 20;
/// Seeds pulled from the store when the queue runs dry.
const PREFETCH_SEED: u32 = 100;
/// Consecutive failed fetches that end a tick's prefetch (the session is likely gone).
const PREFETCH_MAX_FAILS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerCmd {
    /// Round this folder now (a label view rounds its All Mail source).
    OpenFolder(String),
    /// Walk history below every folder's floor.
    Backfill,
}

/// One running account, as the commands see it.
pub struct Slot {
    pub actor: Arc<Actor>,
    pub sync: Arc<AccountSync>,
    cmds: Mutex<VecDeque<WorkerCmd>>,
    prefetch: Mutex<PrefetchQueue>,
    /// Messages whose fetch failed for a reason other than the session; not retried this run.
    skip: Mutex<HashSet<i64>>,
}

#[derive(Default)]
pub struct OnDemand {
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    /// Threads with a body load in flight (one per thread).
    loading: Mutex<HashSet<String>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Queues `cmd` unless the same one already waits.
pub fn push_cmd(q: &mut VecDeque<WorkerCmd>, cmd: WorkerCmd) {
    if !q.contains(&cmd) {
        q.push_back(cmd);
    }
}

impl OnDemand {
    pub fn register(&self, account_id: &str, actor: Arc<Actor>, sync: Arc<AccountSync>) {
        lock(&self.slots).insert(
            account_id.to_string(),
            Arc::new(Slot {
                actor,
                sync,
                cmds: Mutex::new(VecDeque::new()),
                prefetch: Mutex::new(PrefetchQueue::new()),
                skip: Mutex::new(HashSet::new()),
            }),
        );
    }

    pub fn clear(&self) {
        lock(&self.slots).clear();
    }

    /// The account's slot, or `account_not_running` (no worker, or parked).
    pub fn slot(&self, account_id: &str) -> Result<Arc<Slot>, String> {
        lock(&self.slots)
            .get(account_id)
            .cloned()
            .ok_or_else(|| "account_not_running".to_string())
    }

    pub fn queue(&self, account_id: &str, cmd: WorkerCmd) -> Result<(), String> {
        let slot = self.slot(account_id)?;
        push_cmd(&mut lock(&slot.cmds), cmd);
        Ok(())
    }

    /// Raises these messages to Visible in the account's prefetch queue.
    pub fn visible(&self, account_id: &str, ids: &[i64]) -> Result<(), String> {
        let slot = self.slot(account_id)?;
        lock(&slot.prefetch).set_visible(ids);
        Ok(())
    }

    /// Sleeps up to `tick`, waking early when a command is queued.
    pub async fn wait(&self, account_id: &str, tick: Duration) {
        let step = Duration::from_millis(200);
        let mut waited = Duration::ZERO;
        while waited < tick {
            if self
                .slot(account_id)
                .map(|s| !lock(&s.cmds).is_empty())
                .unwrap_or(false)
            {
                return;
            }
            tokio::time::sleep(step).await;
            waited += step;
        }
    }

    /// The worker's share: queued folder rounds and backfill, then a budget of
    /// prefetch, all on the worker's session. A sync error ends the session;
    /// prefetch errors only skip.
    pub async fn worker_tick(
        &self,
        account_id: &str,
        srv: &mut ImapServer,
        plans: &[MailboxPlan],
        store: &Store,
        events: &EventBus,
    ) -> Result<(), String> {
        let Ok(slot) = self.slot(account_id) else {
            return Ok(());
        };
        loop {
            let Some(cmd) = lock(&slot.cmds).pop_front() else {
                break;
            };
            match cmd {
                WorkerCmd::OpenFolder(id) => {
                    slot.sync
                        .open_folder(srv, plans, &id)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                WorkerCmd::Backfill => {
                    slot.sync
                        .backfill_all(srv, plans)
                        .await
                        .map_err(|e| e.to_string())?;
                    let _ = store.set_account_sync(account_id, SyncState::Idle.as_str(), None, None);
                    events.emit(MailEvent::SyncStatus {
                        account_id: account_id.to_string(),
                        state: SyncState::Idle,
                        progress: None,
                    });
                }
            }
        }
        self.prefetch_tick(&slot, account_id, srv, store).await;
        Ok(())
    }

    async fn prefetch_tick(&self, slot: &Slot, account_id: &str, srv: &mut ImapServer, store: &Store) {
        let empty = lock(&slot.prefetch).is_empty();
        if empty {
            if let Ok(seeds) = store.prefetch_candidates(account_id, now_ms(), PREFETCH_SEED) {
                let skip = lock(&slot.skip);
                let mut q = lock(&slot.prefetch);
                for (id, p) in seeds.into_iter().filter(|(id, _)| !skip.contains(id)) {
                    q.push(id, p);
                }
            }
        }
        let mut src = ImapSource::new(&mut srv.session);
        let mut fails = 0;
        for _ in 0..PREFETCH_BUDGET {
            let Some((id, p)) = lock(&slot.prefetch).pop() else {
                break;
            };
            match load_body(store, &mut src, id, p).await {
                Ok(_) | Err(BodyError::NotFound) => fails = 0,
                Err(e) => {
                    eprintln!("[mail] prefetch {id}: {e}");
                    lock(&slot.skip).insert(id);
                    fails += 1;
                    if fails >= PREFETCH_MAX_FAILS {
                        break;
                    }
                }
            }
        }
    }

    /// Opening a thread: loads its missing bodies over a pooled session in the
    /// background and announces the thread when done. One load per thread.
    pub fn load_thread_bg(self: &Arc<Self>, store: Arc<Store>, events: EventBus, account_id: String, thread_id: String) {
        if !lock(&self.loading).insert(thread_id.clone()) {
            return;
        }
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let r = me.load_thread_now(&store, &account_id, &thread_id).await;
            lock(&me.loading).remove(&thread_id);
            match r {
                Ok(n) if n > 0 => events.emit(MailEvent::ThreadsChanged {
                    view_keys: vec![],
                    thread_ids: vec![thread_id],
                }),
                Ok(_) => {}
                Err(e) => eprintln!("[mail] open {thread_id}: {e}"),
            }
        });
    }

    async fn load_thread_now(&self, store: &Store, account_id: &str, thread_id: &str) -> Result<usize, String> {
        let slot = self.slot(account_id)?;
        let mut lease = slot.actor.checkout().await.map_err(|e| format!("offline:{e:?}"))?;
        let srv = lease.session.as_mut().ok_or("offline")?;
        let ids = store.thread_missing_bodies(thread_id).map_err(|e| e.to_string())?;
        let mut src = ImapSource::new(&mut srv.session);
        let mut done = 0;
        for &id in &ids {
            match load_body(store, &mut src, id, Priority::Opened).await {
                Ok(_) => done += 1,
                Err(BodyError::NotFound) => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        let _ = store.touch_thread_bodies(thread_id);
        slot.actor.checkin(lease);
        Ok(done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_dedupe_in_order() {
        let mut q = VecDeque::new();
        push_cmd(&mut q, WorkerCmd::OpenFolder("a".into()));
        push_cmd(&mut q, WorkerCmd::Backfill);
        push_cmd(&mut q, WorkerCmd::OpenFolder("a".into()));
        push_cmd(&mut q, WorkerCmd::OpenFolder("b".into()));
        assert_eq!(
            q.into_iter().collect::<Vec<_>>(),
            vec![
                WorkerCmd::OpenFolder("a".into()),
                WorkerCmd::Backfill,
                WorkerCmd::OpenFolder("b".into())
            ]
        );
    }

    #[test]
    fn unknown_account_is_not_running() {
        let d = OnDemand::default();
        assert_eq!(d.queue("x", WorkerCmd::Backfill).unwrap_err(), "account_not_running");
        assert!(d.visible("x", &[1]).is_err());
    }
}
