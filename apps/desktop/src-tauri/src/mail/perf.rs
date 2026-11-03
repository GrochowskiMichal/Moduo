//! Engine resident-memory and idle-CPU budget (AC7). Frozen skeleton from MR-0;
//! MR-1/MR-3 make it pass.

pub const RSS_BUDGET_BYTES: u64 = 250 * 1024 * 1024;

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "perf: needs the store and the account actors (MR-1, MR-3)"]
    fn mail_perf_rss_idle() {
        let _rows = crate::mail::fixture::load_fixture().expect("generate the fixture first");
        todo!("MR-1/MR-3: load the fixture into the engine, assert RSS <= RSS_BUDGET_BYTES and no idle wakeups");
    }
}
