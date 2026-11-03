//! Mail engine integration tests against the local Dovecot + SMTP sink
//! (`scripts/mail/test-server.sh up`, its own containers). Frozen skeletons from
//! MR-0: each is skipped unless `MODUO_MAIL_IT=1`, and fails until the block named
//! in its body implements it (specs/mail-rebuild.md, Tests table).
//!
//! ```sh
//! scripts/mail/test-server.sh up && MODUO_MAIL_IT=1 cargo test --test mail_it -- --nocapture
//! ```

fn enabled() -> bool {
    std::env::var("MODUO_MAIL_IT").as_deref() == Ok("1")
}

/// Connection details the harness prints (`scripts/mail/test-server.sh env`).
#[allow(dead_code)]
pub struct TestServer {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_port: u16,
    pub user: String,
    pub password: String,
}

#[allow(dead_code)]
fn server() -> TestServer {
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
    TestServer {
        imap_host: env("MODUO_MAIL_IT_HOST", "127.0.0.1"),
        imap_port: env("MODUO_MAIL_IT_IMAP_PORT", "31143").parse().unwrap(),
        smtp_port: env("MODUO_MAIL_IT_SMTP_PORT", "31025").parse().unwrap(),
        user: env("MODUO_MAIL_IT_USER", "mike@gmail.test"),
        password: env("MODUO_MAIL_IT_PASSWORD", "moduo-test"),
    }
}

macro_rules! it_skeleton {
    ($($name:ident => $block:literal),+ $(,)?) => {$(
        #[test]
        fn $name() {
            if !enabled() { return; }
            let _s = server();
            todo!(concat!($block, ": implement ", stringify!($name)));
        }
    )+};
}

it_skeleton! {
    idle_new_mail_reaches_event_stream => "MR-3",
    first_sync_newest_first => "MR-3",
    backfill_progress_and_cancel => "MR-3",
    external_flag_change_deep_history => "MR-3",
    external_expunge_deep_history => "MR-3",
    burst_of_200_no_gaps => "MR-3",
    uidvalidity_reset_requeues_ops => "MR-3/MR-5",
    folders_roles_special_use => "MR-3",
    draft_append_replace => "MR-6",
    server_draft_appears => "MR-6",
    smtp_send_and_sent_copy => "MR-6",
}
