# CV-9 — Files

> Branch `t/maciej/cv-9-files-2` (from `t/maciej/cv-9-files`, build head merged after CV-10-fix) · status: built, ready to land
> Migration: `supabase/migrations/20261016170000_chat_v2_files.sql` · applied to the local stack 2026-10-16, after CV-11 (`20261016150000`) and CV-17 (`20261016160000`); every redefined function re-based on its live body first (none of them changed since)

## Delivered against the row

- **Upload first, send after** (round-3 §2.25 g, #26): the composer mints the next message's id, files start uploading under it at once through the app's upload queue (AT-2) as `chat_message` uploads in their conversation; the send carries the id and the count; the outbox waits for that message's uploads (`files/gate.ts`) and then sends; `chat_op_send` takes the sender's finished files under that id and stores `chat_messages.file_count`.
- **Server** (`20261016170000_chat_v2_files.sql`): `attachments_op_begin` gains `p_channel_id` (old signature dropped; grants re-stated) and a `chat_message` branch: only someone who may post there (plan, archive, removed, managers-only) uploads; a message that exists takes no new files; up to 10 files a message, the eleventh refused before upload (`too_many_files`); per-file cap and the owner's pool as for tasks. Row and Storage policies get a chat branch (never in `can_access`): a sent message's file is read by whoever reads its conversation while the message isn't deleted; the uploader alone sees their own unfinished upload. Finalize fails a file whose message already went. `attachments_op_delete` lets the uploader take a file out of an unsent message. `chat_op_delete` sends the message's files to the trash on its own clock (`deleted_reason = 'chat_message'`), `chat_op_restore` (Undo) brings them back. Access ends at once (the policies read only files of a message that isn't deleted); the bytes and names go with the daily purge job (04:23 UTC) once the 10 s Undo has passed, as do files whose message never came (a day after upload) or was purged with its conversation. `chat__activity` (from its live body): a message of files only reads "Sent a file" / "Sent N files" in the bell, Catch up and device notices. `chat_files(channel, before, limit, before_id)` reads the Files view. `ATTACHMENT_DELETED_REASONS` + CHECK gain `chat_message` (drift gate re-pointed).
- **Composer:** × on a file the server holds (finished, or finishing as you click) takes it out there too, and the send waits until it's out; if that fails the chip comes back saying it still goes. ⏎ while files are being read in or taken out says "Waiting for the files…" and sends once they are. Files that waited past 23 h are taken out at send with a line (the server drops an unsent message's files after a day); send again to post without them.
- **Composer (as before):** paste of files only (a screenshot), drop anywhere on the conversation, `+` → "Upload a file" (top of the menu); chips above the line (frame 6 "upload": 48-tall, thumbnail or icon, name, progress), × takes one out; a message of files only may have no words; the cap line when files are refused.
- **Stream:** pictures (PNG, JPEG, GIF, WebP) preview inline inside the 360 × 240 media box (`--feed-media-max-w/h`, new `@theme` keys `feed-media` / `feed-media-h`), their stored size fit so the row's height is known before load, equal space above and below (`my-2`); a PDF is a document card the size of the media box; everything else is a file chip (frame 5 `.mfile`). A click opens the app's viewer. Your unsent message shows its uploads with progress.
- **Files view** (⌥3, the panel slot CV-8b left): every file sent here, newest first, who and when, "Show more", opens in the viewer; re-read when a message with files lands or leaves.
- **Client reads:** `runtime.chat.files` (the RPC) and `runtime.chat.messageFiles` (the attachments table through its policy, batched per burst of rows, cached per message). `min-build` READ_RPCS: `chat_files`. `attachments.list` now reads task files only.

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC2.3 (server) | `supabase/tests/chat_files.test.sql` · "files follow the message" (64 checks, dry-run) |
| AC2.3 (client rules) | `src/features/chat/files/files.test.ts` (media fit, cap, shapes, gate, composer files, a send waiting for its files) |
| AC2.3 (app) | `tests/chat-files.spec.ts` · "paste, drop, Files view" (green on the local stack) |
| A key reads no chat file | `chat_files.test.sql` (begin and the Files view refuse a key) · `supabase/functions/moduo-mcp/chat-files.test.ts` |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **A PDF is a document card, not a rendered page** (a deviation from the drawn frame, which shows the page: open call for Maciej) · agent's choice, deferred — confirmed for building, revisitable · drawing an uploaded file's bytes in a frame inside the app is off the table, and browsers won't draw a PDF in a locked-down frame · rejected: an embedded PDF frame. A first-page picture made at upload would give a real preview later.
- **Only PNG, JPEG, GIF and WebP draw inline, and only when the name agrees with the type**; SVG, HTML, XML, scripts and anything unknown are chips that download · agent · rejected: anything `image/*`.
- **A message with an upload still moving waits alone; later messages go** · agent · a big file shouldn't hold the conversation · rejected: strict order.
- **A stopped upload turns the message into "Not sent"; Retry sends it with the files that made it** · agent · rejected: silently dropping the file.
- **Files only in the main composer** (not the reply-chain composer or edit) · agent · keep this block's surface small · CV-12's chain composer can pass `files`.
- **A file in a sent message isn't removed on its own**; it leaves with its message · agent · rejected: per-file delete on messages (no frame for it).
- **Chat links are shorter-lived than task links** (`CHAT_FILE_LINK_TTL_SECONDS`: previews 10 min, originals 3 min; tasks keep `ATTACHMENT_LINK_TTL_SECONDS`, previews 1 h, originals 10 min) · agent · the stream re-signs its previews two minutes before they die, past the shared link cache (else it handed back the same link) · rejected: tasks' 1 h previews.
- **Chat files don't show in Settings → Storage's largest files** (they count in the pool; `attachments_largest` lists task files) · agent's choice, deferred — confirmed for building, revisitable (open call for Maciej) · rejected: listing them there without a way to open their conversation.
- **A draft's file older than 23 h is taken out at send, with a line, and the send holds** · agent · the server drops it after a day: rejected: a words message silently going without it, or a files-only one failing "empty" forever.
- **A message of files only whose files all stopped says "Not sent · its files didn't upload" with Delete only** · agent · Retry could only fail "empty" · rejected: a Retry that never works.
- **× on a file the server holds waits for the server; a failed take-out brings the chip back** · agent · else the file still went unseen · rejected: fire and forget.
- **Details has no Files section** (CV-8b's choice kept): the Files view is one switch away.
- **Drop target = the whole conversation column**, no drag-over highlight · agent · rejected: a composer-only zone.
- **No `download=` on signed links** · agent · a download already fetches the bytes and saves them under the file's name; a link is never opened in the browser · rejected: a second signing path for chat.
- **A picture without a stored preview opens in the viewer from the picture itself** (only the four inline types) · agent · rejected: a "no preview" card for a picture the stream draws.

## Gotchas (area: ui)

- With the React Compiler on, a hook must return what `useSyncExternalStore` hands it (RF-1): `useComposerFiles` read the store beside a version token and the chips never showed; it now returns `store.view(channel)`, and `useMessageFiles` returns the cached files as its snapshot. Only the e2e caught it.
- The attachment viewer looks a preview up by **path** (`previews.get(rec.previewPath)`), not by file id.

## Gotchas (area: supabase)

- The Storage policies read `public.attachments` through its own row policy: a pending chat row must be visible to its uploader in `attachments_select`, or the upload's INSERT policy can't see it.
- `can_access('chat_message', …)` is false: chat files need their own policy branch.
- `attachments_largest` lists task files only, `attachments_op_restore` restores task files only, `storage__unsettled_bytes` and `attachments_op_abandon` already cover chat uploads (checked).

- **Open:** `message-stream.tsx`'s row height adds 256 px for any message with files (only `fileCount` is known before the files load, not their kind); the loading placeholder is likewise kind-agnostic. A chip-only message is over-estimated until measured.

## For later blocks

- **CV-12 / CV-14:** pass `files={useComposerFiles(...)}` to the chain composer to let replies carry files.
- **CV-19:** "has a file" = `chat_messages.file_count > 0`.
- **CV-22:** the export's files: `chat_files` per conversation (attachments.list no longer returns chat files).

## Manual checklist (step → expect → surface)

- [ ] Paste a screenshot in a conversation → a chip uploads above the line, ⏎ sends a message of just the picture, drawn inline at most 360 × 240 → Chat stream
- [ ] + → Upload a file → pick a PDF and a zip → two chips; send with words → a PDF card and a zip chip under the words → stream
- [ ] Drop a file on the conversation → it joins the composer → stream
- [ ] Add 11 files → "A message holds up to 10 files: 1 wasn't added" → composer
- [ ] Panel → Files (⌥3) → the files, newest first; a click opens the viewer → right panel
- [ ] Delete a message with a picture → it's gone from the stream and Files; Undo → back → stream, Files
- [ ] Someone removed from a private channel → its pictures no longer load for them → their stream

## Verify before release

- `chat__activity` was redefined from its live body (CV-5's) on 2026-10-16; CV-13's migration (`20261016180000_chat_v2_linked_channels.sql`) doesn't touch it. Only that statement was re-applied to the local stack.
- The migration applies after CV-10/15/11/17 in order; `chat_op_send`, `chat_op_delete`, `chat_op_restore` and the attachments ops were re-checked against the live bodies on 2026-10-16 (CV-10 and CV-15 included).
- The stored type of a file is what the uploader's device said; the app's safety rests on never drawing anything but the four picture types (with `<img>`) and downloading the rest.
