//! Gmail (decision 6): `[Gmail]/All Mail` is the one canonical copy, plus Spam
//! and Trash. `X-GM-MSGID` is the message identity and `X-GM-LABELS` the folder
//! membership, so a multi-label message is one row in each label's view. The
//! mapping lives in [`super::engine::LabelMap`]; this file holds its tests.

pub use super::engine::LabelMap;

#[cfg(test)]
mod tests {
    use super::super::engine::mailbox_id;
    use super::super::testing::{raw, store, Fake};
    use super::super::{classify::ClassifyConfig, events::EventBus, live::AccountSync};
    use crate::mail::store::{ListInput, ViewRef};
    use std::sync::{Arc, RwLock};

    fn gmail() -> Fake {
        let f = Fake::new(true, true);
        f.add_folder("INBOX", &[]);
        f.add_folder("[Gmail]", &["\\Noselect"]);
        f.add_folder("[Gmail]/All Mail", &["\\All"]);
        f.add_folder("[Gmail]/Sent Mail", &["\\Sent"]);
        f.add_folder("[Gmail]/Spam", &["\\Junk"]);
        f.add_folder("[Gmail]/Trash", &["\\Trash"]);
        f.add_folder("Receipts", &[]);
        f.add_folder("Travel", &[]);
        f
    }

    fn count(s: &crate::mail::store::Store, mb: &str) -> usize {
        s.list_threads(&ListInput {
            view: ViewRef::Mailbox(mailbox_id("a1", mb)),
            tab: None,
            after: None,
            limit: 100,
        })
        .unwrap()
        .rows
        .len()
    }

    #[tokio::test]
    async fn labels_map_to_folders() {
        let f = gmail();
        let uid = f.append_raw(
            "[Gmail]/All Mail",
            raw("m1", &[], "Air <air@x.test>", "Ticket", 1_000),
            1_000,
            &["\\Inbox", "Receipts", "Travel"],
        );
        f.append_raw(
            "[Gmail]/All Mail",
            raw("m2", &[], "Ann <ann@x.test>", "Hi", 2_000),
            2_000,
            &["\\Sent"],
        );
        let s = Arc::new(store("gm1"));
        let sync = AccountSync::new(
            "a1",
            s.clone(),
            EventBus::new(),
            Arc::new(RwLock::new(ClassifyConfig::default())),
            None,
        );
        let mut srv = f.session();
        let plans = sync.first_round(&mut srv).await.unwrap();
        // INBOX and label folders are views, never selected; All Mail, Spam and Trash sync.
        let synced: Vec<&str> = plans
            .iter()
            .filter(|p| p.synced)
            .map(|p| p.path.as_str())
            .collect();
        assert_eq!(synced.len(), 3);
        assert!(synced.contains(&"[Gmail]/All Mail"));
        assert_eq!(
            (
                count(&s, "INBOX"),
                count(&s, "Receipts"),
                count(&s, "Travel")
            ),
            (1, 1, 1)
        );
        assert_eq!(count(&s, "[Gmail]/Sent Mail"), 1);
        assert_eq!(count(&s, "[Gmail]/All Mail"), 2);
        // One message row, not one per label.
        let n: i64 = s
            .r()
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
        // Done elsewhere removes the Inbox label: the next round drops it from INBOX only.
        f.set_labels("[Gmail]/All Mail", uid, &["Receipts"]);
        let all = plans
            .iter()
            .find(|p| p.path == "[Gmail]/All Mail")
            .unwrap()
            .clone();
        sync.round(&mut srv, &plans, &all).await.unwrap();
        assert_eq!(
            (
                count(&s, "INBOX"),
                count(&s, "Receipts"),
                count(&s, "Travel")
            ),
            (0, 1, 0)
        );
        // A label added elsewhere shows up too.
        f.set_labels("[Gmail]/All Mail", uid, &["Receipts", "\\Inbox"]);
        sync.round(&mut srv, &plans, &all).await.unwrap();
        assert_eq!(count(&s, "INBOX"), 1);
    }
}
