//! Bodies and attachments (MR-4, decision 8).
//!
//! - [`PrefetchQueue`]: opened → visible → newest inbox → last 3 months →
//!   index-only, deduplicated, a re-push only ever raises priority.
//! - [`plan`]: ≤ 2 MB whole; larger, header plus the first 2 MB of the body
//!   (text parts come first in practice; attachments always on demand); older
//!   than 3 months and not opened, header plus ≤ 32 KB of text, only to index.
//! - [`fetch`]: the IMAP side behind [`fetch::RawSource`], one reused session.
//! - [`cap`]: the per-account disk cap with LRU eviction and the two Clear buttons.

pub mod cap;
pub mod fetch;

#[cfg(test)]
mod tests;

use std::collections::{BTreeSet, HashMap};

pub const WHOLE_MAX_BYTES: i64 = 2 * 1024 * 1024;
pub const LARGE_PREFIX_BYTES: u32 = 2 * 1024 * 1024;
pub const INDEX_TEXT_BYTES: u32 = 32 * 1024;
pub const RECENT_WINDOW_MS: i64 = 90 * 24 * 60 * 60 * 1000;

/// Lower sorts first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Priority {
    Opened = 0,
    Visible = 1,
    NewestInbox = 2,
    Recent = 3,
    IndexOnly = 4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchPlan {
    /// `BODY.PEEK[]`.
    Whole,
    /// `BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.max>`; `full` says whether the
    /// result counts as the readable body (large mail) or index text only.
    Prefix { max: u32, full: bool },
}

pub fn plan(size: i64, date_ms: i64, now_ms: i64, priority: Priority) -> FetchPlan {
    let old = now_ms - date_ms > RECENT_WINDOW_MS;
    if priority == Priority::IndexOnly || (old && priority > Priority::Visible) {
        return FetchPlan::Prefix {
            max: INDEX_TEXT_BYTES,
            full: false,
        };
    }
    if size > WHOLE_MAX_BYTES {
        FetchPlan::Prefix {
            max: LARGE_PREFIX_BYTES,
            full: true,
        }
    } else {
        FetchPlan::Whole
    }
}

/// Message row ids waiting for a body, by priority then arrival.
#[derive(Debug, Default)]
pub struct PrefetchQueue {
    order: BTreeSet<(Priority, u64, i64)>,
    by_id: HashMap<i64, (Priority, u64)>,
    seq: u64,
}

impl PrefetchQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Enqueues `id`, or raises its priority if it's already waiting lower.
    pub fn push(&mut self, id: i64, p: Priority) {
        if let Some(&(old, seq)) = self.by_id.get(&id) {
            if p >= old {
                return;
            }
            self.order.remove(&(old, seq, id));
        }
        self.seq += 1;
        self.order.insert((p, self.seq, id));
        self.by_id.insert(id, (p, self.seq));
    }

    /// The viewport changed: drop stale `Visible` entries, queue the new ones.
    pub fn set_visible(&mut self, ids: &[i64]) {
        let stale: Vec<i64> = self
            .by_id
            .iter()
            .filter(|(_, (p, _))| *p == Priority::Visible)
            .map(|(id, _)| *id)
            .collect();
        for id in stale {
            self.remove(id);
        }
        for &id in ids {
            self.push(id, Priority::Visible);
        }
    }

    pub fn pop(&mut self) -> Option<(i64, Priority)> {
        let first = *self.order.iter().next()?;
        self.order.remove(&first);
        self.by_id.remove(&first.2);
        Some((first.2, first.0))
    }

    pub fn remove(&mut self, id: i64) {
        if let Some((p, seq)) = self.by_id.remove(&id) {
            self.order.remove(&(p, seq, id));
        }
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }
}
