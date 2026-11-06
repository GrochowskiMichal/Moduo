//! The engine → UI event stream (decision 10). Change sets are compact: view
//! keys and thread ids, never rows; the UI re-reads the windows it shows. The
//! serde shape is `MailEvent` in `apps/app/src/lib/runtime.types.mail-engine.ts`.
//!
//! [`EventBus`] fans out to every subscriber; [`forward_to_channel`] pumps one
//! subscription into a Tauri v2 `ipc::Channel` (the `mail_subscribe` command
//! MR-8 registers).

use serde::Serialize;
use tokio::sync::broadcast;

use crate::mail::contracts::SyncState;
use crate::mail::store::Counts;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum MailEvent {
    ThreadsChanged {
        view_keys: Vec<String>,
        thread_ids: Vec<String>,
    },
    Counts {
        counts: Counts,
    },
    SyncStatus {
        account_id: String,
        state: SyncState,
        progress: Option<f64>,
    },
    /// The op record as MR-5 serializes it (`MailOpRecord`).
    OpFailed {
        op: serde_json::Value,
    },
    NewMail {
        account_id: String,
        thread_ids: Vec<String>,
    },
    /// `server_uid` is set once the draft's upload reached the server's Drafts.
    DraftChanged {
        draft_id: String,
        server_uid: Option<i64>,
    },
}

impl MailEvent {
    pub fn kind(&self) -> crate::mail::contracts::EventKind {
        use crate::mail::contracts::EventKind as K;
        match self {
            MailEvent::ThreadsChanged { .. } => K::ThreadsChanged,
            MailEvent::Counts { .. } => K::Counts,
            MailEvent::SyncStatus { .. } => K::SyncStatus,
            MailEvent::OpFailed { .. } => K::OpFailed,
            MailEvent::NewMail { .. } => K::NewMail,
            MailEvent::DraftChanged { .. } => K::DraftChanged,
        }
    }
}

/// Bounded fan-out. A subscriber that falls more than `CAPACITY` events behind
/// gets `Lagged` and should re-read everything it shows (the UI does a full
/// refresh on lag), so a stuck webview never grows engine memory.
#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<MailEvent>,
}

pub const CAPACITY: usize = 1024;

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            tx: broadcast::channel(CAPACITY).0,
        }
    }
    pub fn emit(&self, e: MailEvent) {
        // No subscriber is fine: the UI reads current state when it mounts.
        let _ = self.tx.send(e);
    }
    pub fn subscribe(&self) -> broadcast::Receiver<MailEvent> {
        self.tx.subscribe()
    }
}

/// Pumps one subscription into a Tauri channel until the webview drops it. On
/// lag it sends a `threads_changed` with no keys, which the UI treats as
/// "refresh every visible window".
pub async fn forward_to_channel(
    mut rx: broadcast::Receiver<MailEvent>,
    channel: tauri::ipc::Channel<MailEvent>,
) {
    loop {
        let e = match rx.recv().await {
            Ok(e) => e,
            Err(broadcast::error::RecvError::Lagged(_)) => MailEvent::ThreadsChanged {
                view_keys: vec![],
                thread_ids: vec![],
            },
            Err(broadcast::error::RecvError::Closed) => return,
        };
        if channel.send(e).is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::contracts::EventKind;

    #[test]
    fn serializes_like_the_ts_union() {
        let e = MailEvent::SyncStatus {
            account_id: "a1".into(),
            state: SyncState::Backfilling,
            progress: Some(0.4),
        };
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            serde_json::json!({"kind":"sync_status","accountId":"a1","state":"backfilling","progress":0.4})
        );
        let t = MailEvent::ThreadsChanged {
            view_keys: vec!["unified:inbox".into()],
            thread_ids: vec!["t1".into()],
        };
        assert_eq!(
            serde_json::to_value(&t).unwrap(),
            serde_json::json!({"kind":"threads_changed","viewKeys":["unified:inbox"],"threadIds":["t1"]})
        );
        // Every contract event kind has a variant whose tag is its name.
        let samples = [
            t,
            MailEvent::Counts {
                counts: Default::default(),
            },
            e,
            MailEvent::OpFailed {
                op: serde_json::json!({}),
            },
            MailEvent::NewMail {
                account_id: "a".into(),
                thread_ids: vec![],
            },
            MailEvent::DraftChanged {
                draft_id: "d".into(),
                server_uid: None,
            },
        ];
        let kinds: Vec<EventKind> = samples.iter().map(MailEvent::kind).collect();
        assert_eq!(kinds, EventKind::ALL);
        for s in &samples {
            assert_eq!(serde_json::to_value(s).unwrap()["kind"], s.kind().as_str());
        }
        assert_eq!(
            serde_json::to_value(MailEvent::DraftChanged {
                draft_id: "d".into(),
                server_uid: Some(4),
            })
            .unwrap(),
            serde_json::json!({"kind":"draft_changed","draftId":"d","serverUid":4})
        );
    }

    #[tokio::test]
    async fn fan_out_to_subscribers() {
        let bus = EventBus::new();
        let mut a = bus.subscribe();
        let mut b = bus.subscribe();
        bus.emit(MailEvent::DraftChanged {
            draft_id: "d1".into(),
            server_uid: Some(7),
        });
        assert_eq!(a.recv().await.unwrap(), b.recv().await.unwrap());
    }
}
