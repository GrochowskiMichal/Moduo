# Manual test checklist — CV-9 Files

> Generated 2026-10-16 · branch `t/maciej/cv-checkpoint-4`, folded from the record [`CV-9`](../../build/chat-v2/CV-9.md) (block branch `t/maciej/cv-9-files-2`, landed `3fbe6404`) · **Live-verified:** `chat_files.test.sql` (64 checks), `files.test.ts`, `tests/chat-files.spec.ts` and `moduo-mcp/chat-files.test.ts`; the steps below are the human pass. Migration `20261017115000_chat_v2_files.sql`.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## In the app

- [ ] **Do:** paste a screenshot in a conversation → **Expect:** a chip uploads above the line; ⏎ sends a message of just the picture, drawn inline at most 360 × 240 _(Chat stream)_
- [ ] **Do:** + → Upload a file → pick a PDF and a zip → **Expect:** two chips; send with words and a PDF card and a zip chip sit under the words _(Chat stream)_
- [ ] **Do:** drop a file on the conversation → **Expect:** it joins the composer _(Chat stream)_
- [ ] **Do:** add 11 files → **Expect:** "A message holds up to 10 files: 1 wasn't added" _(composer)_
- [ ] **Do:** panel → Files (⌥3) → **Expect:** the files, newest first; a click opens the viewer _(right panel)_
- [ ] **Do:** delete a message with a picture → **Expect:** it is gone from the stream and Files; Undo brings it back to both _(Chat stream, Files)_
- [ ] **Do:** remove someone from a private channel → **Expect:** its pictures no longer load for them _(their stream)_

## Verify before release

- [ ] **Do:** apply order → **Expect:** after CV-10, CV-15, CV-11, CV-17 (`chat_op_send`, `chat_op_delete`, `chat_op_restore`, `chat__activity` and the attachments ops re-based on live bodies on 2026-10-16) _(release)_
- [ ] **Do:** check what the app does with a file's stored type → **Expect:** only the four picture types draw (with `<img>`), everything else downloads; the type is what the uploader's device said _(web)_

## Known gaps / not-yet-testable

- ❓ Needs Maciej: a PDF is a document card, not a rendered page as the frame draws it; and chat files don't appear in Settings → Storage's largest files.
- The first round of preview links may reuse a cached link with about a minute left; the stream's row height adds 256 px for any message with files until measured.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-9](../../build/chat-v2/CV-9.md).*
