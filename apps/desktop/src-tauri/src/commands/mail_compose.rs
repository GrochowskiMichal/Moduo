//! The compose and device-local settings commands behind `MailComposeEngine`
//! and `MailSettingsEngine` (apps/app/src/lib/runtime.types.mail-compose.ts,
//! runtime.types.mail-settings.ts; MR-6, MR-11, MR-15). Inputs come from the
//! webview and are validated here; every command reads or writes the signed-in
//! user's store through [`MailHost`].

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::mail::host::MailHost;
use crate::mail::send::{staging, DraftDoc, DraftRow, OutboxItem, SendHandle};
use crate::mail::store::{StorageStats, Store, StoreResult};
use crate::mail::sync::events::MailEvent;

const MAX_ID_LEN: usize = 512;
const MAX_RECIPIENTS: usize = 500;
const MAX_ATTACHMENTS: usize = 100;
/// The smallest disk cap Settings may set (the default is 2 GB).
pub const MIN_DISK_CAP: i64 = 100 * 1024 * 1024;

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err("invalid_id".into());
    }
    Ok(())
}

fn check_opt(id: &Option<String>) -> Result<(), String> {
    id.as_deref().map(check_id).transpose().map(|_| ())
}

/// `None` and `""` both mean "every account" to the store.
fn account_filter(a: Option<String>) -> Result<String, String> {
    check_opt(&a)?;
    Ok(a.unwrap_or_default())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftIn {
    #[serde(default)]
    pub draft_id: Option<String>,
    pub account_id: String,
    #[serde(default)]
    pub thread_id: Option<String>,
    pub doc: DraftDoc,
}

/// Bounds on what the webview may store; attachments are opaque staging ids
/// that must resolve to a regular file inside the user's staging dir
/// (`store_root/staging`), never a path the webview chose.
pub fn check_draft(i: &SaveDraftIn, store_root: &std::path::Path) -> Result<(), String> {
    check_opt(&i.draft_id)?;
    check_id(&i.account_id)?;
    check_opt(&i.thread_id)?;
    let d = &i.doc;
    if d.to.len() + d.cc.len() + d.bcc.len() > MAX_RECIPIENTS {
        return Err("too_many_recipients".into());
    }
    if d.attachments.len() > MAX_ATTACHMENTS {
        return Err("too_many_attachments".into());
    }
    for a in &d.attachments {
        staging::resolve(store_root, &a.id).map_err(|_| "invalid_attachment".to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedAttachment {
    pub id: String,
    pub filename: String,
    pub size: u64,
}

/// Stages dropped or pasted bytes (Finder drop, clipboard image); returns the
/// opaque id a draft references.
#[tauri::command]
pub fn mail_stage_attachment_bytes(
    bytes: Vec<u8>,
    host: State<'_, MailHost>,
) -> Result<String, String> {
    staging::stage_bytes(host.store()?.root(), &bytes)
}

/// Opens the native file picker in Rust and stages each chosen file. The
/// paths come from the OS dialog, never from the webview.
#[tauri::command]
pub async fn mail_pick_attachments(
    app: tauri::AppHandle,
    host: State<'_, MailHost>,
) -> Result<Vec<StagedAttachment>, String> {
    use tauri_plugin_dialog::DialogExt;
    let root = host.store()?.root().to_path_buf();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_files(move |files| {
        let _ = tx.send(files);
    });
    let Some(files) = rx.await.map_err(s)? else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for f in files {
        let path = f.into_path().map_err(s)?;
        let id = staging::stage_file(&root, &path)?;
        let size = std::fs::metadata(staging::resolve(&root, &id)?)
            .map_err(s)?
            .len();
        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "attachment".into());
        out.push(StagedAttachment { id, filename, size });
    }
    Ok(out)
}

/// Drops a staged file the composer no longer references.
#[tauri::command]
pub fn mail_unstage_attachment(id: String, host: State<'_, MailHost>) -> Result<(), String> {
    staging::remove(host.store()?.root(), &id)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftIdOut {
    pub draft_id: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoSendOut {
    pub draft_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSendIn {
    pub draft_id: String,
    pub undo_seconds: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrespondentsIn {
    pub prefix: String,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Correspondent {
    pub name: String,
    pub email: String,
    pub count: i64,
}

fn like_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Recipient autocomplete: everyone you mailed (Sent recipients) or who
/// mailed you, matched on an address or name-word prefix, most frequent
/// first. Your own addresses are left out.
pub fn correspondents(store: &Store, prefix: &str, limit: u32) -> StoreResult<Vec<Correspondent>> {
    let p = prefix.trim().to_lowercase();
    if p.is_empty() {
        return Ok(vec![]);
    }
    let pat = format!("{}%", like_escape(&p));
    let word = format!("% {}%", like_escape(&p));
    let c = store.r();
    let mut st = c.prepare_cached(
        "WITH addrs(email, name) AS (
           SELECT lower(trim(from_email)), from_name FROM messages WHERE from_email <> ''
           UNION ALL
           SELECT lower(trim(json_extract(j.value, '$.email'))), json_extract(j.value, '$.name')
           FROM messages m
           JOIN message_mailboxes mm ON mm.message_id = m.id
           JOIN mailboxes b ON b.id = mm.mailbox_id AND b.role = 'sent',
           json_each(m.to_json) j
         )
         SELECT email, COALESCE(MAX(NULLIF(name, '')), ''), COUNT(*) AS n FROM addrs
         WHERE email <> '' AND email NOT IN (SELECT lower(address) FROM accounts)
           AND (email LIKE ?1 ESCAPE '\\' OR lower(name) LIKE ?1 ESCAPE '\\'
                OR lower(name) LIKE ?2 ESCAPE '\\')
         GROUP BY email ORDER BY n DESC, email LIMIT ?3",
    )?;
    let rows = st
        .query_map(rusqlite::params![pat, word, limit.clamp(1, 50)], |r| {
            Ok(Correspondent {
                email: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn draft_changed(host: &MailHost, draft_id: &str) {
    host.events.emit(MailEvent::DraftChanged {
        draft_id: draft_id.to_string(),
    });
}

#[tauri::command]
pub fn mail_save_draft(input: SaveDraftIn, host: State<'_, MailHost>) -> Result<DraftIdOut, String> {
    let store = host.store()?;
    check_draft(&input, store.root())?;
    let id = store
        .save_draft(
            input.draft_id.as_deref(),
            &input.account_id,
            input.thread_id.as_deref(),
            input.doc,
        )
        .map_err(s)?;
    draft_changed(&host, &id);
    Ok(DraftIdOut { draft_id: id })
}

#[tauri::command]
pub fn mail_get_draft(draft_id: String, host: State<'_, MailHost>) -> Result<Option<DraftRow>, String> {
    check_id(&draft_id)?;
    host.store()?.draft(&draft_id).map_err(s)
}

#[tauri::command]
pub fn mail_list_drafts(
    account_id: Option<String>,
    host: State<'_, MailHost>,
) -> Result<Vec<DraftRow>, String> {
    let a = account_filter(account_id)?;
    host.store()?.drafts(&a).map_err(s)
}

#[tauri::command]
pub fn mail_discard_draft(draft_id: String, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&draft_id)?;
    if host.store()?.discard_draft(&draft_id).map_err(s)? {
        draft_changed(&host, &draft_id);
    }
    Ok(())
}

#[tauri::command]
pub fn mail_queue_send(input: QueueSendIn, host: State<'_, MailHost>) -> Result<SendHandle, String> {
    check_id(&input.draft_id)?;
    let h = host
        .store()?
        .queue_send(&input.draft_id, input.undo_seconds)
        .map_err(s)?;
    draft_changed(&host, &input.draft_id);
    Ok(h)
}

#[tauri::command]
pub fn mail_undo_send(outbox_id: String, host: State<'_, MailHost>) -> Result<UndoSendOut, String> {
    check_id(&outbox_id)?;
    let draft_id = host.store()?.undo_send(&outbox_id).map_err(s)?;
    if let Some(d) = &draft_id {
        draft_changed(&host, d);
    }
    Ok(UndoSendOut { draft_id })
}

#[tauri::command]
pub fn mail_list_outbox(
    account_id: Option<String>,
    host: State<'_, MailHost>,
) -> Result<Vec<OutboxItem>, String> {
    let a = account_filter(account_id)?;
    host.store()?.outbox_items(&a).map_err(s)
}

#[tauri::command]
pub fn mail_correspondents(
    input: CorrespondentsIn,
    host: State<'_, MailHost>,
) -> Result<Vec<Correspondent>, String> {
    if input.prefix.len() > 256 {
        return Err("invalid_prefix".into());
    }
    correspondents(&*host.store()?, &input.prefix, input.limit).map_err(s)
}

#[tauri::command]
pub fn mail_size_limit(account_id: String, host: State<'_, MailHost>) -> Result<usize, String> {
    check_id(&account_id)?;
    host.store()?.send_size_limit(&account_id).map_err(s)
}

// ---- Settings → Mail (device-local) ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskCapIn {
    pub account_id: String,
    pub bytes: i64,
}

#[tauri::command]
pub fn mail_storage_stats(host: State<'_, MailHost>) -> Result<Vec<StorageStats>, String> {
    host.store()?.storage_stats().map_err(s)
}

/// Sets the cap and evicts down to it at once.
pub fn set_disk_cap(store: &Store, i: &DiskCapIn) -> Result<(), String> {
    check_id(&i.account_id)?;
    if i.bytes < MIN_DISK_CAP {
        return Err("disk_cap_too_small".into());
    }
    store.set_disk_cap(&i.account_id, i.bytes).map_err(s)?;
    store.enforce_disk_cap(&i.account_id).map_err(s)?;
    Ok(())
}

#[tauri::command]
pub fn mail_set_disk_cap(input: DiskCapIn, host: State<'_, MailHost>) -> Result<(), String> {
    set_disk_cap(&*host.store()?, &input)
}

#[tauri::command]
pub fn mail_clear_attachments(account_id: String, host: State<'_, MailHost>) -> Result<usize, String> {
    check_id(&account_id)?;
    host.store()?.clear_attachments(&account_id).map_err(s)
}

#[tauri::command]
pub fn mail_clear_downloaded(account_id: String, host: State<'_, MailHost>) -> Result<usize, String> {
    check_id(&account_id)?;
    host.store()?.clear_downloaded(&account_id).map_err(s)
}

/// Whether macOS routes `mailto:` to this app (Launch Services).
#[tauri::command]
pub fn mail_is_default_app(app: tauri::AppHandle) -> bool {
    default_app::is_default(&app.config().identifier)
}

/// Asks Launch Services to route `mailto:` here; false when refused.
#[tauri::command]
pub fn mail_make_default_app(app: tauri::AppHandle) -> bool {
    default_app::make_default(&app.config().identifier)
}

#[cfg(target_os = "macos")]
mod default_app {
    use std::ffi::{c_char, c_void, CStr, CString};

    type CFStringRef = *const c_void;
    const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: *const c_void, s: *const c_char, enc: u32) -> CFStringRef;
        fn CFStringGetCString(s: CFStringRef, buf: *mut c_char, len: isize, enc: u32) -> u8;
        fn CFRelease(cf: *const c_void);
    }
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultHandlerForURLScheme(scheme: CFStringRef) -> CFStringRef;
        fn LSSetDefaultHandlerForURLScheme(scheme: CFStringRef, bundle: CFStringRef) -> i32;
    }

    /// An owned CFString, released on drop.
    struct Cf(CFStringRef);
    impl Cf {
        fn new(s: &str) -> Option<Cf> {
            let c = CString::new(s).ok()?;
            // SAFETY: a valid NUL-terminated UTF-8 string; null allocator is the default.
            let r = unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) };
            (!r.is_null()).then_some(Cf(r))
        }
        fn to_string(&self) -> Option<String> {
            let mut buf = vec![0 as c_char; 512];
            // SAFETY: self.0 is a live CFString; buf is writable for its length.
            let ok = unsafe { CFStringGetCString(self.0, buf.as_mut_ptr(), buf.len() as isize, UTF8) };
            if ok == 0 {
                return None;
            }
            // SAFETY: CFStringGetCString wrote a NUL-terminated string.
            Some(unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned())
        }
    }
    impl Drop for Cf {
        fn drop(&mut self) {
            // SAFETY: we own exactly one reference.
            unsafe { CFRelease(self.0) }
        }
    }

    pub fn is_default(bundle_id: &str) -> bool {
        let Some(scheme) = Cf::new("mailto") else { return false };
        // SAFETY: scheme is a live CFString; the result follows the Copy rule.
        let r = unsafe { LSCopyDefaultHandlerForURLScheme(scheme.0) };
        if r.is_null() {
            return false;
        }
        Cf(r)
            .to_string()
            .is_some_and(|h| h.eq_ignore_ascii_case(bundle_id))
    }

    pub fn make_default(bundle_id: &str) -> bool {
        let (Some(scheme), Some(bundle)) = (Cf::new("mailto"), Cf::new(bundle_id)) else {
            return false;
        };
        // SAFETY: both are live CFStrings.
        let status = unsafe { LSSetDefaultHandlerForURLScheme(scheme.0, bundle.0) };
        status == 0 && is_default(bundle_id)
    }
}

#[cfg(not(target_os = "macos"))]
mod default_app {
    pub fn is_default(_bundle_id: &str) -> bool {
        false
    }
    pub fn make_default(_bundle_id: &str) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::contracts::{MailboxRole, TabKind};
    use crate::mail::store::{AccountInput, Address, MailboxInput, MessageInput, TabRef};
    use serde_json::json;

    fn store(tag: &str) -> (std::path::PathBuf, Store) {
        let d = std::env::temp_dir().join(format!(
            "moduo-mail-compose-cmd-{tag}-{}-{}",
            std::process::id(),
            crate::mail::store::now_ms()
        ));
        let _ = std::fs::remove_dir_all(&d);
        let s = Store::open(&d).unwrap();
        s.upsert_account(&AccountInput {
            id: "a".into(),
            address: "Me@x.test".into(),
            display_name: "Me".into(),
            provider: "imap".into(),
            hue: 1,
        })
        .unwrap();
        for (id, role) in [("inbox", MailboxRole::Inbox), ("sent", MailboxRole::Sent)] {
            s.upsert_mailbox(&MailboxInput {
                id: format!("a-{id}"),
                account_id: "a".into(),
                path: id.to_uppercase(),
                name: id.into(),
                role,
                delimiter: Some("/".into()),
                live: true,
            })
            .unwrap();
        }
        (d, s)
    }

    fn msg(ext: &str, mb: &str, uid: i64, from: (&str, &str), to: Vec<(&str, &str)>) -> MessageInput {
        let addr = |(n, e): (&str, &str)| Address {
            name: n.into(),
            email: e.into(),
        };
        MessageInput {
            account_id: "a".into(),
            ext_id: ext.into(),
            mailbox_id: format!("a-{mb}"),
            uid,
            modseq: None,
            message_id: Some(format!("<{ext}@x>")),
            in_reply_to: None,
            references: vec![],
            thread_id: ext.into(),
            from: addr(from),
            to: to.into_iter().map(addr).collect(),
            cc: vec![],
            subject: "s".into(),
            snippet: String::new(),
            date_ms: uid,
            flags: 0,
            size: 1,
            list_unsubscribe: None,
            list_unsubscribe_post: None,
            precedence: None,
            auto_submitted: None,
            has_invite: false,
            tab: Some(TabRef::of(TabKind::Personal)),
            priority: false,
            attachments: vec![],
        }
    }

    #[test]
    fn correspondents_rank_by_frequency_and_skip_me() {
        let (_d, s) = store("corr");
        s.ingest(&[
            msg("m1", "inbox", 1, ("Ann Lee", "ann@x.test"), vec![("Me", "me@x.test")]),
            msg("m2", "sent", 2, ("Me", "me@x.test"), vec![("Ann Lee", "Ann@x.test"), ("Andy", "andy@y.test")]),
            msg("m3", "sent", 3, ("Me", "me@x.test"), vec![("", "ann@x.test")]),
            msg("m4", "inbox", 4, ("Bob 100%", "bob@z.test"), vec![]),
        ])
        .unwrap();
        let r = correspondents(&s, "an", 10).unwrap();
        assert_eq!(
            r.iter().map(|c| (c.email.as_str(), c.count)).collect::<Vec<_>>(),
            vec![("ann@x.test", 3), ("andy@y.test", 1)]
        );
        assert_eq!(r[0].name, "Ann Lee");
        assert_eq!(correspondents(&s, "lee", 10).unwrap()[0].email, "ann@x.test", "name-word prefix");
        assert!(correspondents(&s, "me", 10).unwrap().is_empty(), "never yourself");
        assert!(correspondents(&s, "%", 10).unwrap().is_empty(), "LIKE wildcards are literal");
        assert!(correspondents(&s, "  ", 10).unwrap().is_empty());
    }

    #[test]
    fn save_draft_input_maps_from_the_ts_shape_and_is_bounded() {
        let v = json!({"draftId": null, "accountId": "a", "threadId": null, "doc": {
            "messageId": "", "fromName": null, "fromAddr": "me@x.test", "to": ["b@x.test"], "cc": [], "bcc": [],
            "subject": "Hi", "text": "t", "html": null, "inReplyTo": null, "references": [],
            "attachments": [{"filename": "a.pdf", "contentType": "application/pdf", "id": "ID", "size": 3}],
            "calendarReply": null, "lastError": null}});
        let (_d, s) = store("save");
        let root = s.root().to_path_buf();
        let staged = staging::stage_bytes(&root, b"pdf").unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&v.to_string().replace("\"ID\"", &format!("\"{staged}\"")))
                .unwrap();
        let i: SaveDraftIn = serde_json::from_value(v).unwrap();
        assert!(check_draft(&i, &root).is_ok());
        let id = s.save_draft(None, &i.account_id, None, i.doc.clone()).unwrap();
        assert_eq!(s.draft(&id).unwrap().unwrap().doc.subject, "Hi");
        let mut rel = i;
        // Hostile references: outside staging, traversal, a symlink in staging.
        std::fs::write(root.join("secret"), b"s").unwrap();
        let link = uuid::Uuid::new_v4().to_string();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/passwd", staging::staging_dir(&root).join(&link))
            .unwrap();
        for bad in ["/etc/passwd", "../etc/passwd", "../secret", "/tmp/a.pdf", link.as_str()] {
            rel.doc.attachments[0].id = bad.into();
            assert_eq!(
                check_draft(&rel, &root),
                Err("invalid_attachment".into()),
                "{bad}"
            );
        }
        rel.doc.attachments.clear();
        rel.account_id = String::new();
        assert!(check_draft(&rel, &root).is_err());
        assert_eq!(account_filter(None).unwrap(), "");
        assert!(account_filter(Some("x".repeat(600))).is_err());
    }

    #[test]
    fn disk_cap_is_bounded_and_size_limit_follows_provider() {
        let (_d, s) = store("cap");
        let small = DiskCapIn { account_id: "a".into(), bytes: 5 };
        assert_eq!(set_disk_cap(&s, &small), Err("disk_cap_too_small".into()));
        set_disk_cap(&s, &DiskCapIn { account_id: "a".into(), bytes: MIN_DISK_CAP }).unwrap();
        let st = s.storage_stats().unwrap();
        assert_eq!(st[0].disk_cap_bytes, MIN_DISK_CAP);
        assert_eq!(s.send_size_limit("a").unwrap(), 25 * 1024 * 1024);
        assert!(s.send_size_limit("nope").is_err());
    }
}
