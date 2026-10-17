//! Received-message attachment handling (EM-7).
//!
//! Metadata, on-demand save-to-disk, a compose-side file picker, and inline
//! `cid:` image extraction — all built on the same full-message fetch the body
//! path uses ([`super::body_fetch`]). **Attachment bytes never touch redb**: they
//! are fetched on demand, decoded, and either written to a user-chosen path or
//! returned as base64 (inline images only, < 2 MiB). The body cache stays
//! text-only.
//!
//! The stable attachment `id` is the part's **index path** through the MIME tree
//! (e.g. `"1.2"` = the 3rd child of the 2nd child of the root). It is derived the
//! same way on list and on save, so a save re-locates the exact part without any
//! server-side handle.

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use mailparse::{DispositionType, ParsedMail};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::account_config::ensure_account_config;
use super::account_config::select_mailbox_for_folder;
use super::connection::open_imap_session;
use super::model::{
    EmailAttachmentMeta, EmailGetInlineImagesInput, EmailInlineImage, EmailListAttachmentsInput,
    EmailPickedAttachment, EmailSaveAttachmentInput, EmailSaveAttachmentResult, StoredEmailAccount,
};
use super::storage::resolve_accounts_for_target;
use crate::AppState;

/// Inline images above this decoded size are not inlined into the reader HTML —
/// they'd bloat the payload. A `cid:` reference to a larger image is left for the
/// on-demand save path.
const INLINE_IMAGE_MAX_BYTES: usize = 2 * 1024 * 1024;

// ── Pure MIME walk (unit-tested; no IMAP) ──────────────────────────────────────

/// Strip the angle brackets from a raw `Content-ID` header value, e.g.
/// `<abc123@host>` → `abc123@host`. Returns `None` for an empty/blank value.
fn normalize_content_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('<').trim_end_matches('>').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// The `Content-ID` header for a part (brackets stripped), if present.
fn part_content_id(part: &ParsedMail<'_>) -> Option<String> {
    part.headers
        .iter()
        .find(|h| h.get_key_ref().eq_ignore_ascii_case("Content-ID"))
        .and_then(|h| normalize_content_id(&h.get_value()))
}

/// A part's filename: the Content-Disposition `filename` param wins, then the
/// Content-Type `name` param. Both are MIME-header-decoded by mailparse already.
fn part_filename(part: &ParsedMail<'_>) -> Option<String> {
    let disposition = part.get_content_disposition();
    if let Some(name) = disposition
        .params
        .get("filename")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        return Some(name);
    }
    part.ctype
        .params
        .get("name")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Whether a part is one of the message's *body* renderings (top-level text/plain
/// or text/html with no filename and not an explicit attachment) — those are shown
/// as the message body, never listed as attachments.
fn is_body_part(part: &ParsedMail<'_>) -> bool {
    let disposition = part.get_content_disposition().disposition;
    if matches!(disposition, DispositionType::Attachment) {
        return false;
    }
    if part_filename(part).is_some() {
        return false;
    }
    let mime = part.ctype.mimetype.to_ascii_lowercase();
    mime == "text/plain" || mime == "text/html"
}

/// Whether a part should be surfaced as an attachment: an explicit
/// Content-Disposition: attachment, OR any part carrying a filename, OR an inline
/// part with a Content-ID (an embedded image). Body text parts are excluded.
fn is_attachment_part(part: &ParsedMail<'_>) -> bool {
    // Never treat a container (multipart/*) or the message envelope as a leaf
    // attachment — only its children can be.
    if !part.subparts.is_empty() {
        return false;
    }
    if is_body_part(part) {
        return false;
    }
    let disposition = part.get_content_disposition().disposition;
    matches!(disposition, DispositionType::Attachment)
        || part_filename(part).is_some()
        || (matches!(disposition, DispositionType::Inline) && part_content_id(part).is_some())
        || part_content_id(part).is_some()
}

/// Decoded byte length of a part's body (Content-Transfer-Encoding unapplied).
fn part_decoded_len(part: &ParsedMail<'_>) -> usize {
    part.get_body_raw().map(|b| b.len()).unwrap_or(0)
}

/// A sensible display filename for a part that has none (e.g. an inline image with
/// only a Content-ID), derived from the mime subtype.
fn fallback_filename(part: &ParsedMail<'_>, index_path: &str) -> String {
    let mime = part.ctype.mimetype.to_ascii_lowercase();
    let ext = mime.rsplit('/').next().filter(|s| !s.is_empty());
    match ext {
        Some(ext) => format!("attachment-{index_path}.{ext}"),
        None => format!("attachment-{index_path}"),
    }
}

/// Build one [`EmailAttachmentMeta`] for a leaf part at `index_path`.
fn meta_for_part(part: &ParsedMail<'_>, index_path: &str) -> EmailAttachmentMeta {
    let content_id = part_content_id(part);
    let is_inline = matches!(
        part.get_content_disposition().disposition,
        DispositionType::Inline
    ) || (content_id.is_some()
        && !matches!(
            part.get_content_disposition().disposition,
            DispositionType::Attachment
        ));
    let filename = part_filename(part).unwrap_or_else(|| fallback_filename(part, index_path));
    EmailAttachmentMeta {
        id: index_path.to_string(),
        filename,
        mime: part.ctype.mimetype.clone(),
        size: part_decoded_len(part) as u32,
        is_inline,
        content_id,
    }
}

/// Recursively walk the MIME tree, appending an [`EmailAttachmentMeta`] for every
/// leaf part that qualifies as an attachment. `index_path` is the running dotted
/// path to `part` (empty for the root).
fn walk(part: &ParsedMail<'_>, index_path: &str, out: &mut Vec<EmailAttachmentMeta>) {
    if part.subparts.is_empty() {
        // A leaf. The root-with-no-subparts case (a bare single-part message) is
        // its own body, so index_path == "" is skipped by is_attachment_part via
        // is_body_part / no-filename checks.
        if !index_path.is_empty() && is_attachment_part(part) {
            out.push(meta_for_part(part, index_path));
        }
        return;
    }
    for (i, child) in part.subparts.iter().enumerate() {
        let child_path = if index_path.is_empty() {
            (i + 1).to_string()
        } else {
            format!("{index_path}.{}", i + 1)
        };
        walk(child, &child_path, out);
    }
}

/// Pure attachment extraction over a parsed message. Testable without IMAP: the
/// unit test parses a hand-built multipart byte string and asserts the shape.
pub(super) fn collect_attachments(parsed: &ParsedMail<'_>) -> Vec<EmailAttachmentMeta> {
    let mut out = Vec::new();
    walk(parsed, "", &mut out);
    out
}

/// Locate a leaf part by its index path (the stable attachment id) and return the
/// borrowed `ParsedMail`. Mirrors [`walk`]'s numbering so list + save agree.
fn find_part_by_path<'a, 'b>(
    part: &'a ParsedMail<'b>,
    target: &str,
) -> Option<&'a ParsedMail<'b>> {
    fn recurse<'a, 'b>(
        part: &'a ParsedMail<'b>,
        index_path: &str,
        target: &str,
    ) -> Option<&'a ParsedMail<'b>> {
        if index_path == target {
            return Some(part);
        }
        for (i, child) in part.subparts.iter().enumerate() {
            let child_path = if index_path.is_empty() {
                (i + 1).to_string()
            } else {
                format!("{index_path}.{}", i + 1)
            };
            if target == child_path || target.starts_with(&format!("{child_path}.")) {
                if let Some(found) = recurse(child, &child_path, target) {
                    return Some(found);
                }
            }
        }
        None
    }
    recurse(part, "", target)
}

// ── IMAP fetch (blocking) ──────────────────────────────────────────────────────

/// Fetch a message's full raw RFC822 bytes (`BODY.PEEK[]`, same as the body path)
/// without persisting anything. Runs on a blocking thread.
fn fetch_raw_message(
    state: &AppState,
    account: &StoredEmailAccount,
    folder: &str,
    uid: u32,
) -> Result<Vec<u8>, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let _ = select_mailbox_for_folder(&mut session, account.provider.as_str(), folder)?;

    let fetches = session
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(|e| format!("uid_fetch_body_failed:{}", e))?;
    let result = match fetches.iter().next() {
        Some(first) => match first.body() {
            Some(raw) => Ok(raw.to_vec()),
            None => Err("email_body_missing".to_string()),
        },
        None => Err("email_not_found".to_string()),
    };
    let _ = session.logout();
    result
}

/// Shared prologue for the fetch-based commands: resolve the account and refresh an
/// expiring OAuth token, flipping the row to `reauth_required` on a hard failure
/// (mirrors [`super::email_get_message_body`]).
async fn resolve_account_with_fresh_token(
    state: &State<'_, AppState>,
    account_id: &str,
) -> Result<StoredEmailAccount, String> {
    let accounts = resolve_accounts_for_target(state, Some(account_id))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };
    if let Err(err) = super::oauth::ensure_fresh_access(state, &account.id, &account.provider).await
    {
        if err == "account_reauth_required" {
            let _ = super::storage::patch_account_sync_state(
                state,
                &account.id,
                "reauth_required",
                Some("oauth_reauth_required".to_string()),
            );
            return Err(err);
        }
        // Transient refresh failure: fall through and let the blocking fetch surface it.
    }
    Ok(account)
}

// ── Commands ───────────────────────────────────────────────────────────────────

/// List a received message's attachments — metadata only. Bytes are NEVER returned
/// here and NEVER stored in redb.
#[tauri::command]
pub async fn email_list_attachments(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailListAttachmentsInput,
) -> Result<Vec<EmailAttachmentMeta>, String> {
    let account = resolve_account_with_fresh_token(&state, &input.account_id).await?;

    let app_inner = app.clone();
    let folder = input.folder.clone();
    let uid = input.uid;
    let metas = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        let raw = fetch_raw_message(&state_inner, &account, &folder, uid)?;
        let parsed = mailparse::parse_mail(&raw).map_err(|e| format!("mail_parse_failed:{e}"))?;
        Ok::<Vec<EmailAttachmentMeta>, String>(collect_attachments(&parsed))
    })
    .await
    .map_err(|e| format!("list_attachments_task_failed:{e}"))??;

    Ok(metas)
}

/// Decode one attachment and write it to a user-chosen path via a native Save
/// dialog. `saved` is false when the user cancels.
#[tauri::command]
pub async fn email_save_attachment(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSaveAttachmentInput,
) -> Result<EmailSaveAttachmentResult, String> {
    let account = resolve_account_with_fresh_token(&state, &input.account_id).await?;

    // Fetch + decode the exact part on a blocking thread. The dialog itself is also
    // opened here (its blocking_* methods dispatch to the main thread internally and
    // are safe from a worker thread — but not from the main thread).
    let app_inner = app.clone();
    let folder = input.folder.clone();
    let uid = input.uid;
    let attachment_id = input.attachment_id.clone();
    let default_filename = input.default_filename.clone();

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        let raw = fetch_raw_message(&state_inner, &account, &folder, uid)?;
        let parsed = mailparse::parse_mail(&raw).map_err(|e| format!("mail_parse_failed:{e}"))?;
        let part = find_part_by_path(&parsed, &attachment_id)
            .ok_or_else(|| "attachment_not_found".to_string())?;
        let bytes = part
            .get_body_raw()
            .map_err(|e| format!("attachment_decode_failed:{e}"))?;

        // Native Save dialog (blocks this worker thread until the user responds).
        let Some(file_path) = app_inner
            .dialog()
            .file()
            .set_file_name(&default_filename)
            .blocking_save_file()
        else {
            return Ok::<EmailSaveAttachmentResult, String>(EmailSaveAttachmentResult {
                saved: false,
                path: None,
            });
        };
        let path = file_path
            .into_path()
            .map_err(|e| format!("attachment_path_invalid:{e}"))?;
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("attachment_write_failed:{}:{e}", path.display()))?;

        Ok(EmailSaveAttachmentResult {
            saved: true,
            path: Some(path.to_string_lossy().to_string()),
        })
    })
    .await
    .map_err(|e| format!("save_attachment_task_failed:{e}"))??;

    Ok(outcome)
}

/// Native multi-file OPEN dialog for composing. Returns paths + metadata only; the
/// send path reads the bytes from these paths at send time. Empty vec on cancel.
#[tauri::command]
pub async fn email_pick_attachments(
    app: tauri::AppHandle,
) -> Result<Vec<EmailPickedAttachment>, String> {
    let app_inner = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let Some(files) = app_inner.dialog().file().blocking_pick_files() else {
            return Vec::<EmailPickedAttachment>::new();
        };
        files
            .into_iter()
            .filter_map(|file_path| {
                let path = file_path.into_path().ok()?;
                let filename = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "attachment".to_string());
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) as u32;
                let mime_type = mime_from_extension(&path);
                Some(EmailPickedAttachment {
                    path: path.to_string_lossy().to_string(),
                    filename,
                    mime_type,
                    size,
                })
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| format!("pick_attachments_task_failed:{e}"))?;

    Ok(picked)
}

/// Small inline `cid:` image parts as base64, for substituting `<img src="cid:...">`
/// in the reader HTML. Only `image/*` parts with a Content-ID and decoded size
/// < 2 MiB are returned.
#[tauri::command]
pub async fn email_get_inline_images(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailGetInlineImagesInput,
) -> Result<Vec<EmailInlineImage>, String> {
    let account = resolve_account_with_fresh_token(&state, &input.account_id).await?;

    let app_inner = app.clone();
    let folder = input.folder.clone();
    let uid = input.uid;
    let images = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        let raw = fetch_raw_message(&state_inner, &account, &folder, uid)?;
        let parsed = mailparse::parse_mail(&raw).map_err(|e| format!("mail_parse_failed:{e}"))?;
        Ok::<Vec<EmailInlineImage>, String>(collect_inline_images(&parsed))
    })
    .await
    .map_err(|e| format!("inline_images_task_failed:{e}"))??;

    Ok(images)
}

/// Pure inline-image extraction: every `image/*` part with a Content-ID whose
/// decoded size is under [`INLINE_IMAGE_MAX_BYTES`], base64-encoded.
fn collect_inline_images(parsed: &ParsedMail<'_>) -> Vec<EmailInlineImage> {
    let mut out = Vec::new();
    for part in parsed.parts() {
        if !part.subparts.is_empty() {
            continue;
        }
        let Some(content_id) = part_content_id(part) else {
            continue;
        };
        let mime = part.ctype.mimetype.clone();
        if !mime.to_ascii_lowercase().starts_with("image/") {
            continue;
        }
        let Ok(bytes) = part.get_body_raw() else {
            continue;
        };
        if bytes.len() >= INLINE_IMAGE_MAX_BYTES {
            continue;
        }
        out.push(EmailInlineImage {
            content_id,
            mime,
            data_base64: BASE64_STANDARD.encode(&bytes),
        });
    }
    out
}

// ── Extension → MIME (compose picker) ──────────────────────────────────────────

/// Best-effort MIME from a file extension for the compose picker. The send path
/// carries this through to the outgoing part's Content-Type. Defaults to
/// `application/octet-stream`.
fn mime_from_extension(path: &std::path::Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "heic" => "image/heic",
        "txt" | "text" | "log" => "text/plain",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "xml" => "application/xml",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        "tar" => "application/x-tar",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "doc" => "application/msword",
        "docx" => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "ics" => "text/calendar",
        _ => "application/octet-stream",
    };
    mime.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A three-part multipart/mixed message: a text/plain body, an
    /// application/pdf attachment (Content-Disposition + filename), and an inline
    /// image/png with a Content-ID. Built as raw bytes so the walk is exercised
    /// end-to-end through `mailparse::parse_mail` — no IMAP.
    fn sample_message() -> Vec<u8> {
        // "hello" and a 1x1-ish PNG stand-in, base64-encoded so the transfer
        // decoding path (get_body_raw) is exercised. The PDF payload is the ASCII
        // "%PDF-1.4\n%%EOF\n" so we can assert an exact decoded size.
        let pdf_b64 = BASE64_STANDARD.encode(b"%PDF-1.4\n%%EOF\n"); // 15 bytes decoded
        let png_bytes: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01];
        let png_b64 = BASE64_STANDARD.encode(png_bytes); // 10 bytes decoded

        format!(
            "From: a@x.com\r\n\
             To: b@x.com\r\n\
             Subject: With attachments\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: multipart/mixed; boundary=BOUND\r\n\
             \r\n\
             --BOUND\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             \r\n\
             This is the body text, not an attachment.\r\n\
             --BOUND\r\n\
             Content-Type: application/pdf; name=\"report.pdf\"\r\n\
             Content-Transfer-Encoding: base64\r\n\
             Content-Disposition: attachment; filename=\"report.pdf\"\r\n\
             \r\n\
             {pdf_b64}\r\n\
             --BOUND\r\n\
             Content-Type: image/png\r\n\
             Content-Transfer-Encoding: base64\r\n\
             Content-Disposition: inline\r\n\
             Content-ID: <logo123@moduo>\r\n\
             \r\n\
             {png_b64}\r\n\
             --BOUND--\r\n"
        )
        .into_bytes()
    }

    #[test]
    fn collect_attachments_lists_pdf_and_inline_png_but_not_body() {
        let raw = sample_message();
        let parsed = mailparse::parse_mail(&raw).expect("parse");
        let atts = collect_attachments(&parsed);

        assert_eq!(atts.len(), 2, "body text must NOT be listed; pdf + png only");

        let pdf = atts
            .iter()
            .find(|a| a.mime == "application/pdf")
            .expect("pdf attachment present");
        assert_eq!(pdf.filename, "report.pdf");
        assert!(!pdf.is_inline, "pdf is a real attachment, not inline");
        assert_eq!(pdf.content_id, None);
        assert_eq!(pdf.size, 15, "decoded %PDF-1.4\\n%%EOF\\n is 15 bytes");
        // The pdf is the 2nd child of the root → stable id "2".
        assert_eq!(pdf.id, "2");

        let png = atts
            .iter()
            .find(|a| a.mime == "image/png")
            .expect("inline png present");
        assert!(png.is_inline, "png is Content-Disposition: inline");
        assert_eq!(png.content_id.as_deref(), Some("logo123@moduo"));
        assert_eq!(png.size, 10, "decoded png stand-in is 10 bytes");
        assert_eq!(png.id, "3", "png is the 3rd child of the root");

        // The text/plain body is absent from the list.
        assert!(
            !atts.iter().any(|a| a.mime == "text/plain"),
            "text/plain body must never be listed as an attachment"
        );
    }

    #[test]
    fn find_part_by_path_relocates_the_pdf_for_save() {
        let raw = sample_message();
        let parsed = mailparse::parse_mail(&raw).expect("parse");
        let part = find_part_by_path(&parsed, "2").expect("part 2 found");
        assert_eq!(part.ctype.mimetype, "application/pdf");
        let decoded = part.get_body_raw().expect("decode");
        assert_eq!(decoded, b"%PDF-1.4\n%%EOF\n");
    }

    #[test]
    fn collect_inline_images_returns_the_png_only() {
        let raw = sample_message();
        let parsed = mailparse::parse_mail(&raw).expect("parse");
        let images = collect_inline_images(&parsed);
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].content_id, "logo123@moduo");
        assert_eq!(images[0].mime, "image/png");
        // Round-trips back to the original bytes.
        let decoded = BASE64_STANDARD
            .decode(images[0].data_base64.as_bytes())
            .expect("b64");
        assert_eq!(decoded, &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01]);
    }
}
