# CV-6a — Device notices (server)

> Branch `t/maciej/cv-6a-device-notices-server` · head: see the branch · status: built, not landed
> Migration: `supabase/migrations/20261015190000_chat_v2_device_notices.sql` · applied to the local stack: yes (re-runs cleanly)

## Delivered against the row

- **Six notice kinds** on `notice_deliveries` (`chat_message`, `chat_mention`, `chat_reply`, `chat_announcement`, `chat_reminder`, `chat_focus_summary`); CHECK re-stated; new columns `channel_id`, `message_id`, `tag`, `push_after`, `acked_at`, `held_for_focus`; index `(push_after) where pushed_at is null and acked_at is null`, plus tag, channel and message indexes.
- **The fan-out writes them** (`chat__fan_out` re-cut from its live body: one `chat__notify_devices` call per reason, one INSERT per reason so the kick runs once). Mapping: `dm` / `every_message` → `chat_message`; `mention` / `team_mention` / `everyone` → `chat_mention`; `reply` → `chat_reply`; `announcement` → `chat_announcement`. Nobody on Nothing, nobody who can't read the conversation, never the sender.
- **Server-built copy, per recipient:** title "Sender · #channel · Workspace" (a DM: "Sender · Workspace"; an app's post: the key's name); text only while "Show message text" is on, Markdown flattened, references drawn for that person (`chat__notice_ref`: people and teams of the workspace by name, a date as written, a task, note or conversation by title only while they can see it, else "Private item"); a burst on one tag reads "N messages: …"; link `/chat?c=<conversation>&m=<message>`; `tag = chat:<conversation>` (a chain adds `:<root>`); `push_after = written + 8 s`.
- **The gate** `notice__gate(user, ws, kind, at)` answers `send`; `hold` writes the row `held_for_focus`, `drop` writes none (plumbing tested with a stub gate).
- **Push at once:** statement trigger `notice_deliveries_kick_now` kicks push-send when a chat row arrives for someone with a browser (never fails the send). `notice_deliveries__kick` (live body) skips rows the claim would never take. `notice_deliveries__claim` (live body, DROP+CREATE, grants re-stated) takes only rows past `push_after`, not acknowledged, not held, not replaced by a newer row on the tag, still readable (conversation and message), and returns `tag`. `notice_deliveries__next_due()` gives push-send the wait (≤ 10 s); `drainPush` claims up to three times per kick.
- **Read rule:** a chat notice is readable by its person only while they can read the message's conversation and the message isn't deleted. Trigger `chat_messages_notices_follow`: a delete drops unsent notices and blanks the words of the rest and of a waiting `chat_waiting` payload; an edit redraws them.
- **One device rings:** `user_clients` (client-minted id, surface, user agent from the request headers, last seen / last active), own-rows SELECT and DELETE only; `user_op_client_seen(client_id, surface, active)` (session user; another person's id is refused; 20 per person; returns `latest`); `notice_op_ack(ids)` (own rows, ≤ 1,000); `user_clients__purge` daily (30 days unseen, each person's newest kept).
- **Prefs:** `reaction_row`, `show_online`, `show_focus_task`, `notice_show_text`, `email_when_away` on `user_preferences`, op-only (guard trigger), `user_op_set_chat_prefs(patch)` and `user_chat_prefs()`.
- **The email after an hour:** `chat__queue_waiting_emails(p_now)` every 5 minutes (`chat-waiting-emails`), `chat_waiting` in `EMAIL_KINDS` and the `email_outbox` CHECK (re-stated from the live list), template `templates/chat-waiting.ts` (+ fixture, label, outbox registration, test, snapshot).
- **Erasure:** `account_erase_workspace_data` counts and deletes `user_clients` (`user_clients_deleted`); the table cascades from `profiles`.
- **Contracts:** `NOTICE_DELIVERY_KINDS` (+6), `EMAIL_KINDS` (+`chat_waiting`), new `CLIENT_SURFACES`; drift gates point at this migration.
- **Client:** `noticeCopy` / `noticeDeliveryFromRow` read the chat kinds and columns (`isChatNotice`); `notice-deliveries.tsx` leaves chat rows alone until CV-6b. push-send says chat notices in the server's words with the row's tag.
- Realtime: `notice_deliveries` publication re-asserted; its table grants re-stated (people SELECT, server writes).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC7.1 (device notice + email columns) | `supabase/tests/chat_notices.test.sql` §1 "delivery": DM, burst, @you, @Team, @channel, chain reply, announcement, Every message, Nothing, private conversation, app post, edit-mention; §2 claim and wait; §7 gate answers |
| AC3.2 | `chat_notices.test.sql` §6 "the email after an hour": one per person, conversation and hour; none within the hour of a client seen; none with "Email when away" off; none while held; none on Nothing |
| AC7.9 | `chat_notices.test.sql` §5 (notice) and §6 (email payload); `templates/chat-waiting.test.ts` |
| AC12.8 (`user_clients`) | `chat_notices.test.sql` §8: preview count, delete, others untouched, cascade from profiles |

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Title shape** · agent · "Sender · #channel · Workspace", a DM "Sender · Workspace" · the spec's example plus the conversation it asks for · rejected: "Sender in #channel (Workspace)".
- **Burst text** · agent · the newest row on a tag says "N messages: <newest text>" (N counts unacknowledged rows on the tag in 10 minutes about messages still unread by the person's read mark); a row is skipped once a newer row on its tag is due or acknowledged, so a quiet burst rings once and a steady stream still rings every ~8 s · rejected: replacing by any newer row (a stream would never ring), pushing every row.
- **Claim lease** · agent · `push_claimed_at` makes a claimed row its run's for a minute · every chat insert kicks a run, and overlapping runs must not send twice · rejected: one run at a time (a database lock like the email worker's), which would delay bursts.
- **Edits and deletes follow the message** · agent · an edit redraws the words of its notices and of a queued `chat_waiting` payload (keeping the burst count); a delete drops unsent notices and blanks the rest · the old text is never pushed or kept · rejected: blanking on edit (loses the text people chose to see).
- **Reference names** · agent · person/team of the workspace, task/note/conversation title only when visible, everything else "Private item" · there is no server title registry · rejected: a per-type lookup table for every entity.
- **Email covers the conversation** · agent · the hour's email counts every open, unemailed, unheld dm/mention/team_mention item in that conversation (any age ≤ 7 days) and stamps them; the next email for that conversation waits an hour after the last · enforces "at most one per conversation per hour" across hour boundaries · rejected: a dedupe key alone (two emails 5 minutes apart across an hour boundary).
- **"Away" needs a known client** · agent · the email goes only to people with at least one `user_clients` row, none seen within the hour; the purge keeps each person's newest row · until CV-6b stamps clients nobody is "away", so old builds never trigger emails while people are active · rejected: emailing anyone with no row (everyone on an old build would be emailed while working).
- **Nothing older than a week** is emailed · agent · a rollout must not email a backlog · rejected: no age cap.
- **Desktop listener skips chat rows** until CV-6b · agent · the old listener would toast every message in front of you · rejected: letting it ring.
- **Export of `user_clients`:** none · agent · spec #31 lists `user_clients` for erasure; the rows are device telemetry, readable by their owner if the export (CV-22) wants them · rejected: adding it to an export that doesn't exist yet.
- **reaction_row check** · agent · ≤ 6 distinct keys, 1–32 characters, no letters, digits, spaces or control characters (CV-7c's `reactions__key_ok` narrows it) · rejected: waiting for CV-7c to add the column.

## Gotchas (area: supabase)

- One transaction gives every send the same `now()`: notices of one test share `created_at`, so tag replacement ("a newer row") needs distinct times in tests (set them).
- `UPDATE workspace_members SET perms = …` is recomputed by `perm_members_resolve`; tests that take chat away use `session_replication_role = replica` (as `chat_foundation` does).
- Heavy sends in one test hit the sending limit; move each message to an old minute after sending (`test.send` here).

## For later blocks

- **CV-6b:** ring from `notice_deliveries` rows (Realtime, own rows), only when Moduo isn't in front and `user_op_client_seen(...)->>'latest'` is true; `notice_op_ack(ids)` after showing in place or ringing; skip `held_for_focus`; throttle per `tag`. Stamp `user_op_client_seen` every 60 s (`active` when focused and not idle); mint a new client id on `22023 Unknown client.`. Remove the `isChatNotice` skip in `notice-deliveries.tsx`. `public/push-display.js` trims titles to 80 characters and its fallback says "You have a reminder": update for chat. `READ_RPCS`: `user_chat_prefs`. Settings: "Show message text" and "Email when away" through `user_op_set_chat_prefs`.
- **CV-6b / CV-18 (unowned, needs a home):** the five switches (Direct messages · Mentions and replies · Announcements · Every message · each key's notifications) must turn off the device notice **and the email** for their rows; the email job and `chat__notify_devices` read no switch today (the switches live in client prefs). Whoever owns it needs a server-readable source; the gate (`notice__gate`) is the natural place for the notice half.
- **CV-18:** give `notice__gate` its rules (pause, quiet hours, do not disturb, Focus → `hold`); stamp `chat_catchup.held_at` where the gate answers drop; the email job already skips `held_at`; "never for a paused workspace" in the email job is yours.
- **CV-11 / CV-18:** writers of `chat_reminder` / `chat_focus_summary` rows: set `tag`, `push_after`, and the title/text through the same helpers (`chat__sender_label`, `chat__notice_text`).
- **CV-22:** `user_clients` is not in the export (see choices).

## Manual checklist (step → expect → surface)

- [ ] A sends B a direct message with a browser subscribed and Vault set → after ~8 s B's browser shows "A · Workspace" with the text → browser
- [ ] B turns "Show message text" off (SQL op for now) → the next notice has no text → browser
- [ ] Three quick messages → one notice reading "3 messages: …" → browser
- [ ] B's apps closed for over an hour, an unread DM over an hour old → one "A messaged you in …" email in Mailpit; a second DM within the hour → no second email → Mailpit

## Verify before release

- Release order: `email-worker` (chat_waiting template) and `push-send` deploy **before** this migration.
- Probe prod's `email_outbox_kind_check` before applying: the migration re-states the full list; any kind added on prod since must be in it.
- Each chat notice for someone with a browser makes one push-send call that may wait up to ~20 s; watch Edge invocations in a busy workspace.
- `@channel` in a large channel renders the notice text once per recipient inside the send (per-reader references); measure send latency on a 100+ member channel.
