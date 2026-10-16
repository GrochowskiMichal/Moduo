# CV-9: Files

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-9-files`; record `docs/build/chat-v2/CV-9.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 9 | **CV-9** Files | the attachments branches for `chat_message` (ops, policies, storage), upload-then-send adoption, `chat_files`, inline previews with the media cap, file chips, paste and drop, the Files view, 10 per message, trash on delete; `chat_files.test.sql`, `tests/chat-files` | AC2.3 | 8b |

**Depends on:** CV-8b. AT-1 and AT-2 (attachments) are landed on this branch; AT-3's `20261013272000_attachments_everywhere` redefined parts of the attachments functions (read the live bodies).

## 2. What to build

**§7 Files** (prototype frames 5, 9)
Paste, drop or attach through the app's attachments pipeline (AT-2): images and PDFs preview inline (a size cap keeps the stream calm), everything else is a file chip; up to 10 files per message; limits follow the owner's plan or the grant's. A file's access follows its message's conversation; deleting the message sends its files to the trash clock. Files are listed in the conversation's **Files** view. Before uploads land in prod, the stop-gap is files as task attachments or links (CH68).

**Edge cases this block handles** (§Edge cases)
- A message of 8,000 stored characters (references included) → refused with the count, nothing partial; a message of 10 files → the eleventh is refused before upload.

## 3. Acceptance criteria

**AC2 — A hackathon team's weekend (the hackathon cut)**
- **AC2.3** screenshots and the deck are pasted into the conversation and listed in Files

**Tests that prove them** (file · name · AC · plain English)

- `supabase/tests/chat_files.test.sql` · "files follow the message" · proves AC2.3 · A pending upload is seen by its uploader only; send adopts it; readers of the conversation read it; deleting the message starts the trash clock; the eleventh file is refused.
- `tests/chat-files.spec.ts` · "paste, drop, Files view" · proves AC2.3 · A pasted screenshot previews inline with equal space above and below; a PDF previews; a zip is a chip; the Files view lists them.

## 4. Decisions that bind it

- **Upload first, send after** (round-3 §2.25 g, #26): `attachments_op_begin` accepts `entity_type = 'chat_message'` with the conversation's id; **the client mints the message id**, uploads under it, then sends; until the message exists only the uploader sees the pending row; `chat_op_send` (live body) adopts the uploader's pending files for that id.
- **Access follows the conversation:** a branch in the attachments policies and ops (rows **and** storage objects), never in `can_access`, because a conversation is not a shared item with grants. Readers of the conversation read the file; reading never needs the plan (CV-1); uploading does.
- **Deleting the message** sends its files to the trash clock: `deleted_reason = 'chat_message'` (`ATTACHMENT_DELETED_REASONS` in `vocabularies.ts` is `user`, `task`, `bucket` today: add the value and the CHECK together; `drift-gates.test.ts` pins it). A restored message (Undo within 8 s, CV-2a's `chat_op_restore`) brings its files back (`attachments_op_restore`).
- **Limits:** up to 10 files per message, the eleventh refused **before upload**; per-file limits follow the owner's plan or the grant's (`ATTACHMENT_PER_FILE_BYTES`, platform cap `ATTACHMENT_PLATFORM_FILE_CAP_BYTES` in `_shared/contracts/attachments.ts`).
- **Read:** `chat_files(channel, before, limit)` feeds the **Files** view (panel view, ⌥3, registered in CV-8b; make it available here).
- **Client** (§7): paste, drop or attach through AT-2's pipeline (`src/features/attachments/*`: `files.ts`, `capture.ts`, `signed-urls.ts`, `hooks/use-attachments.ts`, `use-file-drop-guard.ts`, `ui/attachment-strip.tsx`, `attachment-viewer.tsx`). Images and PDFs preview inline under the media size cap CV-7a added; everything else is a file chip; equal space above and below media. Uploads ride CV-3's outbox. A file's access is the message's conversation.
- AT-3 (`20261013272000_attachments_everywhere.sql`) added `attachments_op_abandon`, `storage__unsettled_bytes` and `attachments_largest` (the last filters `entity_type = 'task'`): check chat rows don't break them and note it in your record.

## 5. Files

New: `supabase/migrations/<stamp>_chat_v2_files.sql` (#35); `supabase/tests/chat_files.test.sql`; `tests/chat-files.spec.ts`; the chat Files view and attachment chips under `src/features/chat/`. Touch: `vocabularies.ts` + `drift-gates.test.ts`, `src/lib/runtime.chat.web.ts` and the store's outbox (hot), `src/lib/runtime.web.ts` (`attachments_op_begin` caller near line 1695), `src/lib/min-build.ts` (`READ_RPCS`: `chat_files`). Live bodies: `20261008210500_attachments_storage.sql`, `20261013272000_attachments_everywhere.sql`; existing test `supabase/tests/attachments_everywhere.test.sql`.

## 6. From earlier blocks

CV-8b: the panel registry's Files view slot. CV-7a: the media size cap. CV-3: the outbox. CV-2a: `chat_op_send` v2, delete and restore. AT-1/AT-2/AT-3 are landed on this branch.

## 7. Watch out

- Storage policies are easy to get wrong: upsert needs SELECT + INSERT + UPDATE, a new bucket needs `type` (`docs/gotchas/supabase.md`); the object guard only takes writes to pending rows.
- `chat_op_send` is redefined by CV-2a, 5, 9 and 10: start from the live body, change only the adoption.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Hot files:** `src/features/chat/store/*` and `src/lib/runtime.chat.web.ts`. Keep edits there small; another builder may change them too.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Custom-emoji images and their bucket (CV-20); the stop-gap of files as task attachments or links (a release matter, CH68); search by "has a file" (CV-19); the export's files-as-files (CV-22).
