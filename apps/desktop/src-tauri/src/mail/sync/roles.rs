//! Folder roles (decision 5): SPECIAL-USE attributes first (RFC 6154, and
//! Gmail's XLIST names), then the well-known name lists the legacy engine used.

use crate::mail::contracts::MailboxRole;

/// One LIST row as the server sent it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderInfo {
    pub path: String,
    pub delimiter: Option<String>,
    /// Raw attributes, e.g. `\Sent`, `\Noselect`, `\HasChildren`.
    pub attributes: Vec<String>,
}

impl FolderInfo {
    pub fn selectable(&self) -> bool {
        !self.attributes.iter().any(|a| {
            let a = a.to_ascii_lowercase();
            a == "\\noselect" || a == "\\nonexistent"
        })
    }

    /// The last path segment, for display.
    pub fn name(&self) -> String {
        match &self.delimiter {
            Some(d) if !d.is_empty() => self
                .path
                .rsplit(d.as_str())
                .next()
                .unwrap_or(&self.path)
                .to_string(),
            _ => self.path.clone(),
        }
    }
}

fn by_attribute(attrs: &[String]) -> Option<MailboxRole> {
    for a in attrs {
        let role = match a.to_ascii_lowercase().as_str() {
            "\\inbox" => MailboxRole::Inbox,
            "\\sent" => MailboxRole::Sent,
            "\\drafts" => MailboxRole::Drafts,
            "\\archive" => MailboxRole::Archive,
            "\\all" | "\\allmail" => MailboxRole::All,
            "\\trash" => MailboxRole::Trash,
            "\\junk" | "\\spam" => MailboxRole::Spam,
            _ => continue,
        };
        return Some(role);
    }
    None
}

fn by_name(path: &str, delimiter: Option<&str>) -> MailboxRole {
    if path.eq_ignore_ascii_case("INBOX") {
        return MailboxRole::Inbox;
    }
    let leaf = match delimiter {
        Some(d) if !d.is_empty() => path.rsplit(d).next().unwrap_or(path),
        _ => path,
    }
    .to_ascii_lowercase();
    // Only top-level or provider-prefixed folders ("[Gmail]/Sent Mail", "INBOX.Sent").
    let depth = delimiter
        .filter(|d| !d.is_empty())
        .map_or(0, |d| path.matches(d).count());
    let parent = delimiter
        .filter(|d| !d.is_empty())
        .and_then(|d| path.rsplit_once(d).map(|(p, _)| p.to_ascii_lowercase()));
    let prefixed = matches!(
        parent.as_deref(),
        Some("[gmail]" | "[google mail]" | "inbox")
    );
    if depth > 1 || (depth == 1 && !prefixed) {
        return MailboxRole::Custom;
    }
    match leaf.as_str() {
        "sent" | "sent mail" | "sent items" | "sent messages" | "gesendet" | "envoyés" => {
            MailboxRole::Sent
        }
        "drafts" | "draft" | "entwürfe" | "brouillons" => MailboxRole::Drafts,
        "archive" | "archives" | "archiv" => MailboxRole::Archive,
        "all mail" => MailboxRole::All,
        "trash" | "bin" | "deleted" | "deleted items" | "deleted messages" | "papierkorb"
        | "corbeille" => MailboxRole::Trash,
        "spam" | "junk" | "junk e-mail" | "junk email" | "bulk mail" => MailboxRole::Spam,
        _ => MailboxRole::Custom,
    }
}

pub fn role_for(f: &FolderInfo) -> MailboxRole {
    if f.path.eq_ignore_ascii_case("INBOX") {
        return MailboxRole::Inbox;
    }
    by_attribute(&f.attributes).unwrap_or_else(|| by_name(&f.path, f.delimiter.as_deref()))
}

/// Live folders get IDLE (Inbox) or the 60 s STATUS check (Sent, Drafts).
pub fn is_live(role: MailboxRole) -> bool {
    matches!(
        role,
        MailboxRole::Inbox | MailboxRole::Sent | MailboxRole::Drafts
    )
}

/// Assigns roles to a whole LIST, so each special role goes to one folder only:
/// a SPECIAL-USE match beats a name match, and later duplicates become Custom.
pub fn assign_roles(folders: &[FolderInfo]) -> Vec<(FolderInfo, MailboxRole)> {
    let mut out: Vec<(FolderInfo, MailboxRole, bool)> = folders
        .iter()
        .filter(|f| f.selectable())
        .map(|f| {
            let attr =
                by_attribute(&f.attributes).is_some() || f.path.eq_ignore_ascii_case("INBOX");
            (f.clone(), role_for(f), attr)
        })
        .collect();
    let mut taken = std::collections::HashSet::new();
    for pass_attr in [true, false] {
        for (_, role, _) in out.iter_mut().filter(|(_, _, a)| *a == pass_attr) {
            if *role == MailboxRole::Custom {
                continue;
            }
            if !taken.insert(*role) {
                *role = MailboxRole::Custom;
            }
        }
    }
    out.into_iter().map(|(f, r, _)| (f, r)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, attrs: &[&str]) -> FolderInfo {
        FolderInfo {
            path: path.into(),
            delimiter: Some("/".into()),
            attributes: attrs.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn folders_roles_special_use() {
        let list = vec![
            f("INBOX", &[]),
            f("Outgoing", &["\\Sent"]),
            f("Sent", &[]),
            f("[Gmail]", &["\\Noselect"]),
            f("[Gmail]/All Mail", &["\\All"]),
            f("[Gmail]/Spam", &["\\Junk"]),
            f("Deleted Items", &[]),
            f("Drafts", &["\\Drafts"]),
            f("Projects/Archive", &[]),
            f("Receipts", &[]),
        ];
        let roles: Vec<(String, MailboxRole)> = assign_roles(&list)
            .into_iter()
            .map(|(f, r)| (f.path, r))
            .collect();
        let get = |p: &str| roles.iter().find(|(x, _)| x == p).map(|(_, r)| *r);
        assert_eq!(get("INBOX"), Some(MailboxRole::Inbox));
        assert_eq!(get("Outgoing"), Some(MailboxRole::Sent));
        assert_eq!(
            get("Sent"),
            Some(MailboxRole::Custom),
            "attribute wins, duplicate is custom"
        );
        assert_eq!(get("[Gmail]"), None, "noselect is skipped");
        assert_eq!(get("[Gmail]/All Mail"), Some(MailboxRole::All));
        assert_eq!(get("[Gmail]/Spam"), Some(MailboxRole::Spam));
        assert_eq!(get("Deleted Items"), Some(MailboxRole::Trash));
        assert_eq!(get("Drafts"), Some(MailboxRole::Drafts));
        assert_eq!(get("Projects/Archive"), Some(MailboxRole::Custom));
        assert_eq!(get("Receipts"), Some(MailboxRole::Custom));
        assert!(is_live(MailboxRole::Sent) && !is_live(MailboxRole::Archive));
    }

    #[test]
    fn name_fallback_with_prefixes() {
        let mut x = f("INBOX.Sent", &[]);
        x.delimiter = Some(".".into());
        assert_eq!(role_for(&x), MailboxRole::Sent);
        assert_eq!(role_for(&f("[Gmail]/Sent Mail", &[])), MailboxRole::Sent);
        assert_eq!(f("A/B/C", &[]).name(), "C");
    }
}
