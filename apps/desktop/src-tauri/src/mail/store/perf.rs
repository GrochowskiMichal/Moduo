//! Store perf budgets on the 100k fixture (AC1, AC3, AC4). Frozen skeletons from
//! MR-0: they fail until MR-1 lands the SQLite store. Run with
//! `cargo test --release --lib -- --ignored mail_perf` after
//! `bun scripts/mail/write-fixture.ts --format jsonl`.

use std::time::Duration;

pub const LIST_PAGE_BUDGET: Duration = Duration::from_millis(10);
pub const COUNTS_BUDGET: Duration = Duration::from_millis(5);
pub const THREAD_OPEN_BUDGET: Duration = Duration::from_millis(10);
pub const FTS_BUDGET: Duration = Duration::from_millis(50);

fn fixture() -> Vec<crate::mail::fixture::FixtureMessage> {
    let rows = crate::mail::fixture::load_fixture()
        .expect("generate the fixture first: bun scripts/mail/write-fixture.ts --format jsonl");
    assert!(
        rows.len() >= 100_000,
        "reference fixture is 100k messages, got {}",
        rows.len()
    );
    rows
}

#[test]
#[ignore = "perf: MR-1 implements the store"]
fn mail_perf_list_page() {
    let _rows = fixture();
    todo!("MR-1: load rows into the store, time a keyset list page (50 rows) against LIST_PAGE_BUDGET");
}

#[test]
#[ignore = "perf: MR-1 implements the store"]
fn mail_perf_counts() {
    let _rows = fixture();
    todo!("MR-1: time per-tab and per-folder unread counts against COUNTS_BUDGET");
}

#[test]
#[ignore = "perf: MR-1 implements the store"]
fn mail_perf_thread_open() {
    let _rows = fixture();
    todo!("MR-1: time a full thread load against THREAD_OPEN_BUDGET");
}

#[test]
#[ignore = "perf: MR-1 implements the store"]
fn mail_perf_fts() {
    let _rows = fixture();
    todo!("MR-1: time word and operator FTS queries against FTS_BUDGET");
}
