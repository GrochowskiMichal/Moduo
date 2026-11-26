//! Rows as PostgREST returns them, the in-memory store, and the position keys.
//! Only the columns the spike shows or writes are named; the rest are ignored.

use std::collections::HashMap;

use anyhow::Result;
use jiff::{Timestamp, ToSpan};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{Api, HasId};

#[derive(Clone, Debug, Deserialize)]
pub struct Workspace {
    pub id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Bucket {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_system: bool,
    #[serde(default)]
    pub position: String,
    #[serde(default)]
    pub archived_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Section {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub position: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Status {
    pub id: String,
    /// `None` is the workspace default set, which the Inbox uses.
    #[serde(default)]
    pub project_id: Option<String>,
    pub category: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub position: i64,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Task {
    pub id: String,
    pub bucket_id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub section_id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// The due day, `YYYY-MM-DD`. Never read the day off `due_date` (a noon-UTC mirror).
    #[serde(default)]
    pub due_on: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub status_id: Option<String>,
    #[serde(default)]
    pub status_category: String,
    #[serde(default)]
    pub position: String,
    #[serde(default)]
    pub number: i64,
    #[serde(default)]
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub updated_at: String,
}

impl Task {
    pub fn is_closed(&self) -> bool {
        matches!(self.status_category.as_str(), "done" | "wont_do")
    }
    pub fn is_done(&self) -> bool {
        self.status_category == "done"
    }
    fn stamp(&self) -> Option<Timestamp> {
        self.updated_at.parse().ok()
    }
}

macro_rules! has_id {
    ($($t:ty),*) => { $(impl HasId for $t { fn id(&self) -> &str { &self.id } })* };
}
has_id!(Bucket, Section, Status, Task);

// ── Store ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub enum Nav {
    /// Every open task across projects.
    AllOpen,
    Bucket(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Row {
    Header(String),
    Task { id: String, depth: usize },
}

#[derive(Default)]
pub struct Store {
    pub tasks: HashMap<String, Task>,
    pub buckets: Vec<Bucket>,
    pub sections: Vec<Section>,
    pub statuses: Vec<Status>,
    /// The newest server `updated_at` seen; the next delta reads from five
    /// minutes before it (the web kernel's lookback).
    pub cursor: Option<Timestamp>,
}

pub struct Structure {
    pub buckets: Vec<Bucket>,
    pub sections: Vec<Section>,
    pub statuses: Vec<Status>,
}

impl Store {
    pub fn set_structure(&mut self, s: Structure) {
        self.buckets = s.buckets;
        self.buckets.sort_by(|a, b| {
            // Inbox first, then manual order.
            b.is_system.cmp(&a.is_system).then(a.position.cmp(&b.position)).then(a.id.cmp(&b.id))
        });
        self.sections = s.sections;
        self.sections.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id)));
        self.statuses = s.statuses;
        self.statuses.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id)));
    }

    /// Apply rows read from the server. A polled row only wins when it is
    /// strictly newer than what is held, so a poll that raced an optimistic
    /// edit cannot roll it back; `force` is for an RPC's own answer.
    pub fn apply(&mut self, rows: Vec<Task>, force: bool) -> bool {
        let mut changed = false;
        for row in rows {
            let stamp = row.stamp();
            if let Some(ts) = stamp {
                if self.cursor.map_or(true, |c| ts > c) {
                    self.cursor = Some(ts);
                }
            }
            if row.deleted_at.is_some() {
                changed |= self.tasks.remove(&row.id).is_some();
                continue;
            }
            let newer = match self.tasks.get(&row.id) {
                None => true,
                Some(held) => force || stamp > held.stamp(),
            };
            if newer {
                self.tasks.insert(row.id.clone(), row);
                changed = true;
            }
        }
        changed
    }

    pub fn bucket_name(&self, id: &str) -> String {
        self.buckets.iter().find(|b| b.id == id).map(|b| b.name.clone()).unwrap_or_default()
    }

    pub fn inbox(&self) -> Option<&Bucket> {
        self.buckets.iter().find(|b| b.is_system)
    }

    /// The statuses a task in this project can take: the project's own set,
    /// else the workspace default set.
    pub fn statuses_for(&self, bucket_id: &str) -> Vec<&Status> {
        let own: Vec<&Status> = self
            .statuses
            .iter()
            .filter(|s| !s.hidden && s.project_id.as_deref() == Some(bucket_id))
            .collect();
        if !own.is_empty() {
            return own;
        }
        self.statuses.iter().filter(|s| !s.hidden && s.project_id.is_none()).collect()
    }

    pub fn status_name(&self, task: &Task) -> String {
        task.status_id
            .as_ref()
            .and_then(|id| self.statuses.iter().find(|s| &s.id == id))
            .map(|s| s.name.clone())
            .unwrap_or_else(|| task.status_category.replace('_', " "))
    }

    /// The flat list the view renders: section headers, tasks in manual order,
    /// subtasks (one level) under their parent.
    pub fn rows(&self, nav: &Nav, show_closed: bool) -> Vec<Row> {
        let visible = |t: &&Task| show_closed || !t.is_closed();
        let by_position = |a: &&Task, b: &&Task| a.position.cmp(&b.position).then(a.id.cmp(&b.id));
        let mut children: HashMap<&str, Vec<&Task>> = HashMap::new();
        for t in self.tasks.values().filter(visible) {
            if let Some(p) = t.parent_id.as_deref() {
                // A subtask whose parent is filtered out still shows, at top level.
                if self.tasks.get(p).map_or(false, |parent| visible(&parent)) {
                    children.entry(p).or_default().push(t);
                }
            }
        }
        let is_child = |t: &Task| t.parent_id.as_deref().map_or(false, |p| children.contains_key(p));
        let mut rows = Vec::new();
        let push_group = |rows: &mut Vec<Row>, header: Option<String>, mut group: Vec<&Task>| {
            if group.is_empty() {
                return;
            }
            group.sort_by(by_position);
            if let Some(h) = header {
                rows.push(Row::Header(h));
            }
            for t in group {
                rows.push(Row::Task { id: t.id.clone(), depth: 0 });
                if let Some(kids) = children.get(t.id.as_str()) {
                    let mut kids = kids.clone();
                    kids.sort_by(by_position);
                    rows.extend(kids.into_iter().map(|k| Row::Task { id: k.id.clone(), depth: 1 }));
                }
            }
        };
        match nav {
            Nav::AllOpen => {
                for b in self.buckets.iter().filter(|b| b.archived_at.is_none()) {
                    let group: Vec<&Task> = self
                        .tasks
                        .values()
                        .filter(visible)
                        .filter(|t| t.bucket_id == b.id && !is_child(t))
                        .collect();
                    push_group(&mut rows, Some(b.name.clone()), group);
                }
            }
            Nav::Bucket(id) => {
                let in_bucket: Vec<&Task> = self
                    .tasks
                    .values()
                    .filter(visible)
                    .filter(|t| &t.bucket_id == id && !is_child(t))
                    .collect();
                let sections: Vec<&Section> = self.sections.iter().filter(|s| &s.project_id == id).collect();
                let known = |sid: &Option<String>| {
                    sid.as_ref().map_or(false, |sid| sections.iter().any(|s| &s.id == sid))
                };
                let loose: Vec<&Task> = in_bucket.iter().copied().filter(|t| !known(&t.section_id)).collect();
                push_group(&mut rows, None, loose);
                for s in sections {
                    let group: Vec<&Task> = in_bucket
                        .iter()
                        .copied()
                        .filter(|t| t.section_id.as_deref() == Some(s.id.as_str()))
                        .collect();
                    push_group(&mut rows, Some(s.name.clone()), group);
                }
            }
        }
        rows
    }

    /// The manual-order siblings of a task: same project, section and parent.
    pub fn siblings(&self, task: &Task) -> Vec<&Task> {
        let mut out: Vec<&Task> = self
            .tasks
            .values()
            .filter(|t| t.bucket_id == task.bucket_id && t.section_id == task.section_id && t.parent_id == task.parent_id)
            .collect();
        out.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id)));
        out
    }
}

// ── Reads ───────────────────────────────────────────────────────────────────

pub fn load_workspaces(api: &Api) -> Result<Vec<Workspace>> {
    api.select("workspaces", &[("select", "id,name".into()), ("deleted_at", "is.null".into()), ("order", "created_at".into())])
}

pub fn load_structure(api: &Api, ws: &str) -> Result<Structure> {
    let live = [("deleted_at", "is.null".to_string())];
    Ok(Structure {
        buckets: api.select_all("buckets", ws, &live)?,
        sections: api.select_all("sections", ws, &live)?,
        statuses: api.select_all("project_statuses", ws, &live)?,
    })
}

pub fn load_tasks(api: &Api, ws: &str) -> Result<Vec<Task>> {
    api.select_all("tasks", ws, &[("deleted_at", "is.null".to_string())])
}

/// Rows changed since the cursor, soft-deleted ones included (they mean "removed").
pub fn load_delta(api: &Api, ws: &str, cursor: Timestamp) -> Result<Vec<Task>> {
    let since = cursor - 5.minutes();
    api.select(
        "tasks",
        &[
            ("select", "*".into()),
            ("workspace_id", format!("eq.{ws}")),
            ("updated_at", format!("gte.{since}")),
            ("order", "updated_at,id".into()),
            ("limit", "1000".into()),
        ],
    )
}

pub fn load_task(api: &Api, id: &str) -> Result<Vec<Task>> {
    api.select("tasks", &[("select", "*".into()), ("id", format!("eq.{id}"))])
}

// ── Writes: the same RPCs the web app calls ─────────────────────────────────

pub fn create_task(api: &Api, ws: &str, task: Value) -> Result<Vec<Task>> {
    let row: Task = api.rpc("tasks_op_create", json!({ "p_workspace_id": ws, "p_task": task }))?;
    Ok(vec![row])
}

/// Returns the task, then any subtasks the change carried.
pub fn update_task(api: &Api, ws: &str, id: &str, patch: Value) -> Result<Vec<Task>> {
    api.rpc("tasks_op_update", json!({ "p_workspace_id": ws, "p_task_id": id, "p_patch": patch }))
}

/// `status` is a status id or a category word. Status changes go through this
/// RPC, never `tasks_op_update`, so the server's repeat and queue rules run.
pub fn set_status(api: &Api, ws: &str, id: &str, status: &str) -> Result<Vec<Task>> {
    let value: Value =
        api.rpc("tasks_op_set_status", json!({ "p_workspace_id": ws, "p_task_id": id, "p_status": status }))?;
    // One row or a set of rows, depending on the function's return type.
    Ok(match value {
        Value::Array(items) => items.into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect(),
        other => serde_json::from_value(other).map(|t| vec![t]).unwrap_or_default(),
    })
}

// ── Position keys (apps/app/src/features/tasks/helpers.ts) ──────────────────
// Base-36 digit strings compared bytewise; fresh keys are 10 wide and spaced
// 2^20 apart, and a key between two neighbours extends precision when needed.

const POS_WIDTH: usize = 10;
const POS_STEP: u64 = 1 << 20;
const ALPHABET: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

fn encode_pos(n: u64) -> String {
    let mut digits = Vec::new();
    let mut n = n;
    while n > 0 {
        digits.push(ALPHABET[(n % 36) as usize]);
        n /= 36;
    }
    while digits.len() < POS_WIDTH {
        digits.push(b'0');
    }
    digits.reverse();
    String::from_utf8(digits).unwrap()
}

fn digit(c: u8) -> usize {
    ALPHABET.iter().position(|a| *a == c).unwrap_or(0)
}

/// A key that sorts after every key in `existing`.
pub fn end_position<'a>(existing: impl Iterator<Item = &'a str>) -> String {
    let max = existing.max().unwrap_or("");
    if max.is_empty() {
        return encode_pos(POS_STEP);
    }
    if max.len() == POS_WIDTH {
        if let Ok(n) = u64::from_str_radix(max, 36) {
            return encode_pos(n + POS_STEP);
        }
    }
    format!("{max}i")
}

/// A digit string strictly between the fractions `lo` and `hi` (`None` = open
/// top), never ending in zero. The caller guarantees `lo < hi`.
pub fn midpoint(lo: &str, hi: Option<&str>) -> String {
    let (lo_b, hi_b) = (lo.as_bytes(), hi.map(str::as_bytes));
    if let Some(hi_b) = hi_b {
        let mut n = 0;
        while n < hi_b.len() && lo_b.get(n).copied().unwrap_or(b'0') == hi_b[n] {
            n += 1;
        }
        if n > 0 {
            let tail = &hi.unwrap()[n..];
            let lo_tail = if n <= lo.len() { &lo[n..] } else { "" };
            return format!("{}{}", &hi.unwrap()[..n], midpoint(lo_tail, (!tail.is_empty()).then_some(tail)));
        }
    }
    let digit_lo = lo_b.first().map_or(0, |c| digit(*c));
    let digit_hi = hi_b.and_then(|h| h.first()).map_or(36, |c| digit(*c));
    if digit_hi > digit_lo + 1 {
        // JS Math.round rounds halves up.
        return (ALPHABET[(digit_lo + digit_hi + 1) / 2] as char).to_string();
    }
    if let Some(hi) = hi {
        if hi.len() > 1 {
            return hi[..1].to_string();
        }
    }
    let rest = if lo.is_empty() { "" } else { &lo[1..] };
    format!("{}{}", ALPHABET[digit_lo] as char, midpoint(rest, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_position_steps_past_the_last_key() {
        assert_eq!(end_position(std::iter::empty()), "000000mh34");
        let first = end_position(std::iter::empty());
        let second = end_position([first.as_str()].into_iter());
        assert!(second > first && second.len() == POS_WIDTH);
        // A subdivided (longer) key falls back to appending a middle digit.
        assert_eq!(end_position(["00000000mh34i"].into_iter()), "00000000mh34ii");
    }

    #[test]
    fn midpoint_lands_strictly_between_and_never_ends_in_zero() {
        let cases = [
            ("", Some("00000000mh34")),
            ("00000000mh34", Some("00000000mh35")),
            ("00000000mh34", Some("0000000192mo")),
            ("00000000mh34", None),
            ("a", Some("b")),
            ("az", Some("b")),
            ("a", Some("a1")),
        ];
        for (lo, hi) in cases {
            let mid = midpoint(lo, hi);
            assert!(mid.as_str() > lo, "{mid} > {lo}");
            if let Some(hi) = hi {
                assert!(mid.as_str() < hi, "{mid} < {hi}");
            }
            assert!(!mid.ends_with('0'), "{mid} ends in zero");
        }
    }

    fn task(id: &str, updated_at: &str, title: &str) -> Task {
        serde_json::from_value(json!({
            "id": id, "bucket_id": "b", "title": title, "updated_at": updated_at,
            "status_category": "todo", "position": "0000000001"
        }))
        .unwrap()
    }

    #[test]
    fn a_polled_row_never_rolls_back_a_held_one_unless_newer() {
        let mut store = Store::default();
        store.apply(vec![task("1", "2026-11-26T10:00:00.5+00:00", "server")], false);
        store.tasks.get_mut("1").unwrap().title = "optimistic".into();
        // The same server row again (a poll inside the lookback window).
        assert!(!store.apply(vec![task("1", "2026-11-26T10:00:00.5+00:00", "server")], false));
        assert_eq!(store.tasks["1"].title, "optimistic");
        // A strictly newer row wins; so does an RPC's own answer.
        assert!(store.apply(vec![task("1", "2026-11-26T10:00:01+00:00", "newer")], false));
        assert_eq!(store.tasks["1"].title, "newer");
        assert!(store.apply(vec![task("1", "2026-11-26T10:00:01+00:00", "answer")], true));
        assert_eq!(store.tasks["1"].title, "answer");
    }

    #[test]
    fn a_soft_deleted_row_removes_the_task() {
        let mut store = Store::default();
        store.apply(vec![task("1", "2026-11-26T10:00:00+00:00", "a")], false);
        let mut gone = task("1", "2026-11-26T10:00:02+00:00", "a");
        gone.deleted_at = Some("2026-11-26T10:00:02+00:00".into());
        assert!(store.apply(vec![gone], false));
        assert!(store.tasks.is_empty());
    }
}
