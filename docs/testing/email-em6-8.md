# Manual test checklist — Email EM-6 · EM-7 · EM-8

> Generated 2026-07-04 · branch `claude/cranky-wiles-0bbf66` · **Live-verified:** no — the email engine (IMAP/SMTP, snooze move/restore, attachments, send) is desktop-only and headless-incompatible, and the two migrations are deploy-gated. `bun run verify` (788 unit tests) + `cargo check`/`cargo test` are green; everything below is the designer's desktop pass. Pure logic (snooze presets, follow-up reply-clear, compose prefill, undo-send hold, convert args) is unit-proven.

## Pre-req — deploy the two migrations
- [x] ✅ **DONE 2026-07-29 (OPS-1).** Applied `supabase/migrations/20260704180000_email_snooze_followup.sql` then `20260704190000_email_ref_remove.sql` to prod; regenerate `src/types/supabase.ts` (optional — the email runtime uses the untyped client). → **Expect:** `email_op_snooze_due`, `email_op_follow_up_due`, `email_op_ref_remove` exist; `spine_activity_targets_me` has the `notify_user_ids` branch; `email_refs.follow_up_notified_at` column present. _(cloud)_
- [ ] **Do:** Before deploy, open /email on desktop. → **Expect:** snooze/follow-up/convert still work locally; the cloud writes degrade quietly (an honest toast on the mutation), nothing crashes. _(desktop)_

## EM-6 — Snooze (AC6)
- [ ] **Do:** Select a thread, press `s` (or hover → clock icon) → pick "Tomorrow". → **Expect:** the thread leaves the inbox immediately; a toast "Snoozed — returns Tomorrow 9:00 AM · Undo". _(desktop)_
- [ ] **Do:** Press Undo within 8s. → **Expect:** the thread returns to the inbox; no server move happened (check webmail — still in inbox). _(desktop)_
- [ ] **Do:** Snooze a thread and let the 8s window pass. → **Expect:** in webmail the message is now in `Moduo/Snoozed`; the Moduo inbox no longer shows it; the rail "Snoozed" count increments. _(desktop + webmail)_
- [ ] **Do:** Click the rail "Snoozed" section. → **Expect:** the center lists the snoozed thread(s) with "Returns <when>" + an Unsnooze button. _(desktop)_
- [ ] **Do:** Click Unsnooze. → **Expect:** the mail moves back to INBOX (webmail confirms) and reappears in the Moduo inbox. _(desktop)_
- [ ] **Do:** Snooze a thread with a custom time ~2 minutes out; wait past it (keep /email open). → **Expect:** within ~60s of due, the thread returns to the inbox AND a grouped notification "…is back in your inbox" appears in the bell, deep-linking to it. _(desktop)_
- [ ] **Do:** On a custom-IMAP account that refuses folder creation, snooze a thread. → **Expect:** it still leaves the Moduo inbox (local-hide fallback) and returns on time; no error spam. _(desktop)_

## EM-6 — Follow-ups (AC7)
- [ ] **Do:** On a thread you sent, hover → the reply-arrow icon (or the row action) → pick a time. → **Expect:** toast "Follow-up set …"; the rail "Follow-ups" count increments. _(desktop)_
- [ ] **Do:** Have the counterpart reply to that thread, then wait for a sync. → **Expect:** the follow-up clears silently (leaves the Follow-ups section). _(desktop)_
- [ ] **Do:** Reply to your own followed-up thread from another of YOUR connected accounts. → **Expect:** the follow-up does NOT clear (self-replies don't count). _(desktop)_
- [ ] **Do:** Set a follow-up ~2 min out and don't reply; keep /email open. → **Expect:** at due, a single grouped notification deep-links the thread and offers context; it fires ONCE (not every minute). _(desktop)_
- [ ] **Do:** Open the Follow-ups section. → **Expect:** awaiting follow-ups list with the deadline (overdue ones show "No reply yet" in the warning color) + a Clear button. _(desktop)_

## EM-7 — Compose + send (AC10 / AC11)
- [ ] **Do:** Click "New message" (center header). Fill To/Subject, type a body (try Bold, a bullet list, a link), Send. → **Expect:** toast "Sending… · Undo" for 10s, then "Message sent"; the message arrives with HTML + plain parts; a copy is in Sent (no Gmail duplicate). _(desktop)_
- [ ] **Do:** Send, then press Undo within 10s. → **Expect:** compose reopens with everything intact (recipients, subject, body, attachments); nothing was sent. _(desktop)_
- [ ] **Do:** Start a send, then quit the app within the 10s window; reopen. → **Expect:** the mail did NOT send; the draft is offered on next open. _(desktop)_
- [ ] **Do:** From the reader, click Reply / All / Forward. → **Expect:** compose opens with the right recipients (reply → sender; reply-all → sender + others minus your addresses; forward → empty To), a Re:/Fwd: subject, the quoted original, and your signature; recipients' clients thread it correctly (In-Reply-To/References). _(desktop)_
- [ ] **Do:** In compose, click Attach → pick a file → Send. In the reader on the received copy, click the attachment chip → Save. → **Expect:** the file arrives intact and the saved file opens correctly (decoded bytes match). _(desktop)_
- [ ] **Do:** Open a received email that has attachments. → **Expect:** attachment chips (name + size) show under the message; inline images are NOT listed as chips. _(desktop)_

## EM-8 — Convert → task (the great moment) (AC8)
- [ ] **Do:** Select a thread, press `t` (or reader → "To task"). → **Expect:** a task is created in the Tasks Inbox (title = subject minus Re:/Fwd:, description = snippet + a back-link); the email STAYS in the inbox; the right panel flips to the **Task** variant with the new task's detail; toast "Task created · Undo · Also mark done". _(desktop)_
- [ ] **Do:** After converting, check the task's links (Tasks module or the Detail panel). → **Expect:** task **spawned-from** the email thread; if the sender is a known contact, the email thread **references** that contact. _(desktop)_
- [ ] **Do:** Press Undo on the convert toast. → **Expect:** the task, both links, and (if it was freshly created) the tissue ref are all removed; the panel returns to Reader. _(desktop, post-deploy for clean ref removal)_
- [ ] **Do:** Press "Also mark done" on the convert toast. → **Expect:** the email is archived (Done) with its own 8s Undo, and the task remains. _(desktop)_

## EM-8 — Contact context + spine (AC9 + tags/detail)
- [ ] **Do:** Open a thread from a known contact; switch the right panel to **Contact**. → **Expect:** the contact's name/email + their linked items (spine hub). _(desktop)_
- [ ] **Do:** Open a thread from an UNKNOWN sender → **Contact** panel → "Add as contact". → **Expect:** a contact is created (prefilled from the From header) and the thread links to it; no contact is ever auto-created without this click. _(desktop)_
- [ ] **Do:** Convert or link a thread, then switch the right panel to **Detail**. → **Expect:** the email_thread's EntityHub (links/activity) + a tag row; add a tag (e.g. `#waiting`) and confirm it persists + shares the workspace tag pool. _(desktop, post-deploy)_
- [ ] **Do:** In the Detail/Contact panels, click a linked entity. → **Expect:** it deep-links (`moduo:entity:open`) to that entity's module. _(desktop)_

## Edge cases
- [ ] **Do:** Snooze then immediately Unsnooze (before the 8s commit). → **Expect:** clean — no server move, thread stays. _(desktop)_
- [ ] **Do:** Convert the SAME thread twice. → **Expect:** two tasks, both linked; the second convert reuses the existing tissue ref (no duplicate ref). _(desktop)_
- [ ] **Do:** Reply arrives while a thread is snoozed. → **Expect:** (known gap — see below) the thread stays snoozed until its due time; the reply is visible when it returns. _(desktop)_

## Known gaps / not-yet-testable
- **Engine round-trips unverified here** — snooze move/restore, send, attachment save/decode, OAuth all need the real desktop app + a live IMAP account (`MODUO_TEST_IMAP_CREDS_PATH` harness exists for the scripted ones).
- **Background snooze restore** — the 60s restore loop runs while /email is mounted; a snooze coming due while the app is on another route (or closed) restores on the next /email visit / focus, not in the true background. App-level mounting is a follow-up.
- **Reply-arrives-while-snoozed auto-unsnooze** (spec AC6 nice-to-have) is NOT implemented — a snoozed thread returns at its due time regardless of an early reply. Follow-up.
- **drag-email-anywhere (CT-3)** and **@contact recipient autocomplete** are deferred (see decisions) — linking is via convert + the Contact/Detail panels; recipients are typed addresses.
- **Compose rich-text** is Lexical (spec assumption 13) — bounded Bold/Italic/Underline/List/Link toolbar, HTML in/out. A headless round-trip test proves formatting survives; the in-browser editor (toolbar clicks, seeding the quoted reply, autofocus in the dialog) is desktop manual-test since the worktree can't render Storybook/preview.
- **`Also mark done` + `Undo`** on the same convert toast are independent; pressing both is possible (mark-done archives; undo removes the task) — by design.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up".*
