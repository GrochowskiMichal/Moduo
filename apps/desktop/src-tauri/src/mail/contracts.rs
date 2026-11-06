//! Local mail vocabularies, mirrored from `@contracts/mail` and drift-tested
//! against `supabase/functions/_shared/contracts/mail-local.json` (decision 25).

use serde::{Deserialize, Serialize};

macro_rules! vocab {
    ($name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $s)] $variant),+ }
        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];
            pub fn as_str(self) -> &'static str { match self { $($name::$variant => $s),+ } }
            pub fn parse(s: &str) -> Option<Self> { match s { $($s => Some($name::$variant),)+ _ => None } }
        }
    };
}

vocab!(MailboxRole { Inbox => "inbox", Sent => "sent", Drafts => "drafts", Archive => "archive", All => "all", Trash => "trash", Spam => "spam", Custom => "custom" });
vocab!(TabKind { Personal => "personal", Custom => "custom", Notifications => "notifications", Newsletters => "newsletters" });
vocab!(ClassifyStage { Block => "block", Rules => "rules", SenderOverride => "sender_override", CustomTabs => "custom_tabs", KnownContact => "known_contact", HeaderHeuristics => "header_heuristics" });
vocab!(OpKind { Done => "done", Undone => "undone", Move => "move", Delete => "delete", Restore => "restore", MarkRead => "mark_read", MarkUnread => "mark_unread", Pin => "pin", Unpin => "unpin", Snooze => "snooze", Unsnooze => "unsnooze", Mute => "mute", Unmute => "unmute", Spam => "spam", NotSpam => "not_spam", LabelAdd => "label_add", LabelRemove => "label_remove", BlockSender => "block_sender" });
vocab!(OpState { Pending => "pending", InFlight => "in_flight", Done => "done", Failed => "failed" });
vocab!(RuleCondition { From => "from", Domain => "domain", To => "to", SubjectContains => "subject_contains", IsNewsletter => "is_newsletter" });
vocab!(RuleAction { MoveToFolder => "move_to_folder", AddLabel => "add_label", PutInTab => "put_in_tab", MarkRead => "mark_read", SkipInbox => "skip_inbox", MarkPriority => "mark_priority", Block => "block" });
vocab!(BlockDestination { Trash => "trash", Spam => "spam", Archive => "archive", Folder => "folder" });
vocab!(EventKind { ThreadsChanged => "threads_changed", Counts => "counts", SyncStatus => "sync_status", OpFailed => "op_failed", NewMail => "new_mail", DraftChanged => "draft_changed" });
vocab!(BodyState { None => "none", TextOnly => "text_only", Full => "full", Evicted => "evicted" });
vocab!(SyncState { Idle => "idle", FirstSync => "first_sync", Syncing => "syncing", Backfilling => "backfilling", Offline => "offline", Reconnect => "reconnect", Error => "error" });
vocab!(Provider { Gmail => "gmail", GoogleWorkspace => "google_workspace", Icloud => "icloud", Outlook => "outlook", Imap => "imap" });

impl RuleAction {
    /// Exclusive actions: the first matching rule wins (AC26).
    pub fn is_exclusive(self) -> bool {
        matches!(
            self,
            RuleAction::MoveToFolder
                | RuleAction::PutInTab
                | RuleAction::SkipInbox
                | RuleAction::Block
        )
    }
}

pub const FLAG_SEEN: u32 = 1;
pub const FLAG_FLAGGED: u32 = 2;
pub const FLAG_ANSWERED: u32 = 4;
pub const FLAG_DRAFT: u32 = 8;
pub const FLAG_DELETED: u32 = 16;
pub const MAX_CUSTOM_TABS: u32 = 3;

#[cfg(test)]
mod tests {
    use super::*;

    const JSON: &str =
        include_str!("../../../../../supabase/functions/_shared/contracts/mail-local.json");

    fn list(v: &serde_json::Value, key: &str) -> Vec<String> {
        v[key]
            .as_array()
            .unwrap_or_else(|| panic!("missing {key}"))
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect()
    }
    fn strs<T: Copy>(all: &[T], f: fn(T) -> &'static str) -> Vec<String> {
        all.iter().map(|x| f(*x).to_string()).collect()
    }

    #[test]
    fn rust_enums_match_mail_local_json() {
        let v: serde_json::Value = serde_json::from_str(JSON).unwrap();
        assert_eq!(
            list(&v, "mailbox_roles"),
            strs(MailboxRole::ALL, MailboxRole::as_str)
        );
        assert_eq!(list(&v, "tab_kinds"), strs(TabKind::ALL, TabKind::as_str));
        assert_eq!(
            list(&v, "classify_order"),
            strs(ClassifyStage::ALL, ClassifyStage::as_str)
        );
        assert_eq!(list(&v, "op_kinds"), strs(OpKind::ALL, OpKind::as_str));
        assert_eq!(list(&v, "op_states"), strs(OpState::ALL, OpState::as_str));
        assert_eq!(
            list(&v, "rule_conditions"),
            strs(RuleCondition::ALL, RuleCondition::as_str)
        );
        assert_eq!(
            list(&v, "rule_actions"),
            strs(RuleAction::ALL, RuleAction::as_str)
        );
        let excl: Vec<String> = RuleAction::ALL
            .iter()
            .filter(|a| a.is_exclusive())
            .map(|a| a.as_str().to_string())
            .collect();
        assert_eq!(list(&v, "rule_exclusive_actions"), excl);
        assert_eq!(
            list(&v, "block_destinations"),
            strs(BlockDestination::ALL, BlockDestination::as_str)
        );
        assert_eq!(
            list(&v, "event_kinds"),
            strs(EventKind::ALL, EventKind::as_str)
        );
        assert_eq!(
            list(&v, "body_states"),
            strs(BodyState::ALL, BodyState::as_str)
        );
        assert_eq!(
            list(&v, "sync_states"),
            strs(SyncState::ALL, SyncState::as_str)
        );
        assert_eq!(list(&v, "providers"), strs(Provider::ALL, Provider::as_str));
        let bits = &v["flag_bits"];
        assert_eq!(bits["seen"], FLAG_SEEN);
        assert_eq!(bits["flagged"], FLAG_FLAGGED);
        assert_eq!(bits["answered"], FLAG_ANSWERED);
        assert_eq!(bits["draft"], FLAG_DRAFT);
        assert_eq!(bits["deleted"], FLAG_DELETED);
        assert_eq!(v["max_custom_tabs"], MAX_CUSTOM_TABS);
    }

    #[test]
    fn parse_roundtrip() {
        for k in OpKind::ALL {
            assert_eq!(OpKind::parse(k.as_str()), Some(*k));
        }
        assert_eq!(OpKind::parse("nuke"), None);
    }
}
