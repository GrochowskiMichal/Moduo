//! Engine resident-memory and idle-CPU budget (AC7). MR-1 covers the store
//! half (the 100k fixture loaded and queried stays under budget); MR-3 adds the
//! account actors and the idle-wakeup assertion.

pub const RSS_BUDGET_BYTES: u64 = 250 * 1024 * 1024;

/// This process's resident set size, via `ps` (macOS and Linux).
#[cfg(test)]
pub(crate) fn rss_bytes() -> u64 {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .expect("ps");
    let kb: u64 = String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .expect("rss kb");
    kb * 1024
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "perf: needs the 100k fixture"]
    fn mail_perf_rss_idle() {
        let dir = std::env::temp_dir().join(format!("moduo-mail-rss-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = crate::mail::store::Store::open(&dir).unwrap();
        {
            let rows = crate::mail::fixture::load_fixture().expect("generate the fixture first");
            crate::mail::store::perf_load_into(&store, &rows);
        }
        // Exercise the read paths so the page caches are warm, as in use.
        let c = store.counts().unwrap();
        assert!(c.badge > 0);
        let rss = rss_bytes();
        eprintln!("mail_perf: rss after 100k load {} MB", rss / 1024 / 1024);
        assert!(rss <= RSS_BUDGET_BYTES, "rss {rss} > {RSS_BUDGET_BYTES}");
        // MR-3: start the account actors on the store, idle 5 s, assert no wakeups.
        let _ = std::fs::remove_dir_all(&dir);
    }
}
