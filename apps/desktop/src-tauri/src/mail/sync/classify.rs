//! Classification at ingest (AC25). The order is fixed by the contract
//! (`ClassifyStage::ALL`): block → rules → per-sender overrides → custom tabs →
//! known contact → header heuristics. The first stage that names a tab decides
//! it; rule additive actions (mark read, label, Priority) always all apply.
//! The config is the engine's local mirror of `email_settings_items` (MR-7);
//! MR-12 fills it from there and adds the UI.

use std::collections::{HashMap, HashSet};

use super::headers::ParsedHeader;
use crate::mail::contracts::{BlockDestination, ClassifyStage, RuleAction, RuleCondition, TabKind};
use crate::mail::store::TabRef;

#[derive(Debug, Clone, PartialEq)]
pub struct Rule {
    pub id: String,
    /// Every condition must match (AND).
    pub conditions: Vec<(RuleCondition, String)>,
    pub actions: Vec<(RuleAction, Option<String>)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CustomTab {
    pub id: String,
    pub senders: Vec<String>,
    pub domains: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ClassifyConfig {
    /// Lowercased addresses, or `@domain` / `domain` entries.
    pub blocked: Vec<String>,
    pub block_destination: BlockDestination,
    pub block_folder: Option<String>,
    pub rules: Vec<Rule>,
    /// Sender address or domain → tab.
    pub sender_overrides: HashMap<String, TabRef>,
    pub custom_tabs: Vec<CustomTab>,
    pub contacts: HashSet<String>,
    pub priority_people: HashSet<String>,
    pub screener: bool,
    /// Addresses you've exchanged mail with (Sent recipients), for the Screener.
    pub correspondents: HashSet<String>,
    /// Your own addresses: your own mail is always Personal and never screened.
    pub own_addresses: HashSet<String>,
}

impl Default for ClassifyConfig {
    fn default() -> Self {
        Self {
            blocked: vec![],
            block_destination: BlockDestination::Trash,
            block_folder: None,
            rules: vec![],
            sender_overrides: HashMap::new(),
            custom_tabs: vec![],
            contacts: HashSet::new(),
            priority_people: HashSet::new(),
            screener: false,
            correspondents: HashSet::new(),
            own_addresses: HashSet::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub tab: TabRef,
    /// Which stage decided the tab.
    pub stage: ClassifyStage,
    pub priority: bool,
    pub mark_read: bool,
    pub skip_inbox: bool,
    pub move_to: Option<String>,
    pub labels: Vec<String>,
    pub blocked: Option<(BlockDestination, Option<String>)>,
    /// Held in New senders by the Screener.
    pub screened: bool,
}

fn domain(email: &str) -> &str {
    email.rsplit_once('@').map_or("", |(_, d)| d)
}

fn matches_entry(entry: &str, email: &str) -> bool {
    let e = entry.trim().to_ascii_lowercase();
    let d = e.trim_start_matches('@');
    e == email
        || (!d.is_empty()
            && !d.contains('@')
            && (domain(email) == d || domain(email).ends_with(&format!(".{d}"))))
}

pub fn is_newsletter(h: &ParsedHeader) -> bool {
    h.list_unsubscribe.is_some()
        || h.list_id.is_some()
        || matches!(h.precedence.as_deref(), Some("bulk" | "list"))
}

pub fn is_notification(h: &ParsedHeader) -> bool {
    let auto = h.auto_submitted.as_deref().is_some_and(|a| a != "no");
    let local = h.from.email.split('@').next().unwrap_or("");
    let robot = [
        "noreply",
        "no-reply",
        "donotreply",
        "do-not-reply",
        "notifications",
        "notification",
        "alerts",
        "mailer-daemon",
        "postmaster",
    ]
    .iter()
    .any(|p| {
        local == *p || local.starts_with(&format!("{p}+")) || local.starts_with(&format!("{p}-"))
    });
    auto || robot || h.precedence.as_deref() == Some("junk")
}

/// Newsletters group by sender in their tab (B-list): the grouping key.
pub fn newsletter_group_key(h: &ParsedHeader) -> String {
    h.from.email.clone()
}

fn condition(c: RuleCondition, v: &str, h: &ParsedHeader) -> bool {
    let v = v.trim().to_ascii_lowercase();
    match c {
        RuleCondition::From => {
            matches_entry(&v, &h.from.email) || h.from.name.to_lowercase().contains(&v)
        }
        RuleCondition::Domain => matches_entry(v.trim_start_matches('@'), &h.from.email),
        RuleCondition::To => {
            h.to.iter()
                .chain(&h.cc)
                .any(|a| matches_entry(&v, &a.email))
        }
        RuleCondition::SubjectContains => !v.is_empty() && h.subject.to_lowercase().contains(&v),
        RuleCondition::IsNewsletter => is_newsletter(h) == (v != "false"),
    }
}

fn tab_from_arg(arg: Option<&str>) -> TabRef {
    TabRef::decode(arg.unwrap_or("personal"))
}

pub fn classify(h: &ParsedHeader, cfg: &ClassifyConfig) -> Outcome {
    let sender = h.from.email.as_str();
    let mut out = Outcome {
        tab: TabRef::of(TabKind::Personal),
        stage: ClassifyStage::HeaderHeuristics,
        priority: cfg.priority_people.contains(sender),
        mark_read: false,
        skip_inbox: false,
        move_to: None,
        labels: vec![],
        blocked: None,
        screened: false,
    };
    let own = cfg.own_addresses.contains(sender);

    // 1. Block.
    if !own && cfg.blocked.iter().any(|b| matches_entry(b, sender)) {
        out.blocked = Some((cfg.block_destination, cfg.block_folder.clone()));
        out.stage = ClassifyStage::Block;
        return out;
    }

    // 2. Rules: first match wins per exclusive action; additive ones accumulate.
    let mut tab: Option<(TabRef, ClassifyStage)> = None;
    let mut exclusive_taken: HashSet<RuleAction> = HashSet::new();
    for rule in &cfg.rules {
        if rule.conditions.is_empty() || !rule.conditions.iter().all(|(c, v)| condition(*c, v, h)) {
            continue;
        }
        let mut fresh: Vec<RuleAction> = vec![];
        for (a, arg) in &rule.actions {
            if a.is_exclusive() {
                if exclusive_taken.contains(a) {
                    continue;
                }
                fresh.push(*a);
            }
            match a {
                RuleAction::MoveToFolder => out.move_to = arg.clone(),
                RuleAction::PutInTab => {
                    tab = Some((tab_from_arg(arg.as_deref()), ClassifyStage::Rules))
                }
                RuleAction::SkipInbox => out.skip_inbox = true,
                RuleAction::Block => {
                    out.blocked = Some((cfg.block_destination, cfg.block_folder.clone()));
                    out.stage = ClassifyStage::Block;
                }
                RuleAction::MarkRead => out.mark_read = true,
                RuleAction::AddLabel => {
                    if let Some(l) = arg {
                        if !out.labels.contains(l) {
                            out.labels.push(l.clone());
                        }
                    }
                }
                RuleAction::MarkPriority => out.priority = true,
            }
        }
        exclusive_taken.extend(fresh);
    }
    if out.blocked.is_some() {
        return out;
    }

    // 3. Per-sender overrides (address beats domain).
    if tab.is_none() {
        let o = cfg
            .sender_overrides
            .get(sender)
            .or_else(|| cfg.sender_overrides.get(domain(sender)))
            .or_else(|| cfg.sender_overrides.get(&format!("@{}", domain(sender))));
        if let Some(t) = o {
            tab = Some((t.clone(), ClassifyStage::SenderOverride));
        }
    }

    // 4. Custom tabs.
    if tab.is_none() {
        for ct in cfg
            .custom_tabs
            .iter()
            .take(crate::mail::contracts::MAX_CUSTOM_TABS as usize)
        {
            let hit = ct.senders.iter().any(|s| s.eq_ignore_ascii_case(sender))
                || ct.domains.iter().any(|d| matches_entry(d, sender));
            if hit {
                tab = Some((
                    TabRef {
                        kind: TabKind::Custom,
                        custom_id: Some(ct.id.clone()),
                    },
                    ClassifyStage::CustomTabs,
                ));
                break;
            }
        }
    }

    // 5. Known contact (and your own mail) is Personal.
    let known = cfg.contacts.contains(sender);
    if tab.is_none() && (known || own) {
        tab = Some((TabRef::of(TabKind::Personal), ClassifyStage::KnownContact));
    }

    // 6. Header heuristics.
    let (t, stage) = tab.unwrap_or_else(|| {
        let k = if is_newsletter(h) {
            TabKind::Newsletters
        } else if is_notification(h) {
            TabKind::Notifications
        } else {
            TabKind::Personal
        };
        (TabRef::of(k), ClassifyStage::HeaderHeuristics)
    });
    out.tab = t;
    out.stage = stage;

    // Screener: first-time non-contact senders wait in New senders. A known
    // contact is never screened, even from a new address of theirs only if
    // that address is itself a contact (edge case: unknown addresses are).
    out.screened = cfg.screener
        && !own
        && !known
        && !cfg.correspondents.contains(sender)
        && !cfg.priority_people.contains(sender);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::store::Address;

    fn h(from: &str) -> ParsedHeader {
        ParsedHeader {
            from: Address {
                name: "".into(),
                email: from.into(),
            },
            subject: "Hello".into(),
            ..Default::default()
        }
    }
    fn rule(id: &str, c: (RuleCondition, &str), a: &[(RuleAction, Option<&str>)]) -> Rule {
        Rule {
            id: id.into(),
            conditions: vec![(c.0, c.1.into())],
            actions: a.iter().map(|(x, v)| (*x, v.map(Into::into))).collect(),
        }
    }

    #[test]
    fn pinned_order() {
        let mut m = h("news@shop.test");
        m.list_unsubscribe = Some("<https://u>".into());
        let mut cfg = ClassifyConfig::default();
        assert_eq!(classify(&m, &cfg).tab.kind, TabKind::Newsletters);
        assert_eq!(classify(&m, &cfg).stage, ClassifyStage::HeaderHeuristics);
        cfg.contacts.insert("news@shop.test".into());
        assert_eq!(classify(&m, &cfg).stage, ClassifyStage::KnownContact);
        assert_eq!(classify(&m, &cfg).tab.kind, TabKind::Personal);
        cfg.custom_tabs.push(CustomTab {
            id: "shops".into(),
            senders: vec![],
            domains: vec!["shop.test".into()],
        });
        assert_eq!(classify(&m, &cfg).stage, ClassifyStage::CustomTabs);
        cfg.sender_overrides
            .insert("news@shop.test".into(), TabRef::of(TabKind::Notifications));
        assert_eq!(classify(&m, &cfg).stage, ClassifyStage::SenderOverride);
        cfg.rules.push(rule(
            "r",
            (RuleCondition::Domain, "shop.test"),
            &[(RuleAction::PutInTab, Some("newsletters"))],
        ));
        let o = classify(&m, &cfg);
        assert_eq!(
            (o.stage, o.tab.kind),
            (ClassifyStage::Rules, TabKind::Newsletters)
        );
        cfg.blocked.push("@shop.test".into());
        assert_eq!(classify(&m, &cfg).stage, ClassifyStage::Block);
        // Deterministic: the same input gives the same answer.
        assert_eq!(classify(&m, &cfg), classify(&m, &cfg));
    }

    #[test]
    fn custom_tabs() {
        let cfg = ClassifyConfig {
            custom_tabs: vec![
                CustomTab {
                    id: "team".into(),
                    senders: vec!["Ann@Work.test".into()],
                    domains: vec![],
                },
                CustomTab {
                    id: "work".into(),
                    senders: vec![],
                    domains: vec!["work.test".into()],
                },
            ],
            ..Default::default()
        };
        assert_eq!(
            classify(&h("ann@work.test"), &cfg).tab.custom_id.as_deref(),
            Some("team")
        );
        assert_eq!(
            classify(&h("bob@eu.work.test"), &cfg)
                .tab
                .custom_id
                .as_deref(),
            Some("work")
        );
        assert_eq!(
            classify(&h("bob@other.test"), &cfg).tab.kind,
            TabKind::Personal
        );
    }

    #[test]
    fn newsletter_grouping() {
        let mut a = h("digest@paper.test");
        a.precedence = Some("bulk".into());
        let mut n = h("no-reply@bank.test");
        n.subject = "Your statement".into();
        let cfg = ClassifyConfig::default();
        assert_eq!(classify(&a, &cfg).tab.kind, TabKind::Newsletters);
        assert_eq!(classify(&n, &cfg).tab.kind, TabKind::Notifications);
        let mut auto = h("bot@ci.test");
        auto.auto_submitted = Some("auto-generated".into());
        assert_eq!(classify(&auto, &cfg).tab.kind, TabKind::Notifications);
        assert_eq!(newsletter_group_key(&a), "digest@paper.test");
    }

    #[test]
    fn first_match_exclusive_additive_all() {
        let cfg = ClassifyConfig {
            rules: vec![
                rule(
                    "1",
                    (RuleCondition::SubjectContains, "invoice"),
                    &[
                        (RuleAction::MoveToFolder, Some("Finance")),
                        (RuleAction::MarkRead, None),
                        (RuleAction::AddLabel, Some("money")),
                    ],
                ),
                rule(
                    "2",
                    (RuleCondition::From, "ann@x.test"),
                    &[
                        (RuleAction::MoveToFolder, Some("Ann")),
                        (RuleAction::MarkPriority, None),
                        (RuleAction::AddLabel, Some("ann")),
                    ],
                ),
            ],
            ..Default::default()
        };
        let mut m = h("ann@x.test");
        m.subject = "Invoice 42".into();
        let o = classify(&m, &cfg);
        assert_eq!(
            o.move_to.as_deref(),
            Some("Finance"),
            "first exclusive wins"
        );
        assert!(o.mark_read && o.priority, "additive from both rules");
        assert_eq!(o.labels, vec!["money", "ann"]);
    }

    #[test]
    fn screener_holds_first_time() {
        let mut cfg = ClassifyConfig {
            screener: true,
            ..Default::default()
        };
        assert!(classify(&h("stranger@x.test"), &cfg).screened);
        cfg.contacts.insert("friend@x.test".into());
        cfg.correspondents.insert("pen@x.test".into());
        assert!(!classify(&h("friend@x.test"), &cfg).screened);
        assert!(!classify(&h("pen@x.test"), &cfg).screened);
        assert!(
            classify(&h("friend.new@x.test"), &cfg).screened,
            "unknown address of a contact is screened"
        );
        cfg.screener = false;
        assert!(
            !classify(&h("stranger@x.test"), &cfg).screened,
            "off by default"
        );
    }

    #[test]
    fn priority_notify() {
        let mut cfg = ClassifyConfig::default();
        cfg.priority_people.insert("boss@x.test".into());
        assert!(classify(&h("boss@x.test"), &cfg).priority);
        assert!(!classify(&h("peer@x.test"), &cfg).priority);
    }

    #[test]
    fn blocked_destination_setting() {
        let mut cfg = ClassifyConfig {
            blocked: vec!["spam@x.test".into()],
            ..Default::default()
        };
        assert_eq!(
            classify(&h("spam@x.test"), &cfg).blocked,
            Some((BlockDestination::Trash, None))
        );
        cfg.block_destination = BlockDestination::Folder;
        cfg.block_folder = Some("Blocked".into());
        assert_eq!(
            classify(&h("spam@x.test"), &cfg).blocked,
            Some((BlockDestination::Folder, Some("Blocked".into())))
        );
        assert_eq!(classify(&h("ok@x.test"), &cfg).blocked, None);
    }
}
