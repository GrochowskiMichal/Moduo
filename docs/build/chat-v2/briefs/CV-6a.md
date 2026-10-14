# CV-6a: Device notices (server)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-6a-device-notices-server`; record `docs/build/chat-v2/CV-6a.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 6a | **CV-6a** Device notices *(server)* | the six notice kinds with server-built title, text and link; push at once (kick trigger + claim); `user_clients` + `user_op_client_seen` + `notice_op_ack` (**erasure and export for `user_clients`**); `notice__gate` sending everything until CV-18 gives it rules; `user_op_set_chat_prefs` + `user_chat_prefs()`; the `chat_waiting` email kind, template and job; `chat_notices.test.sql` (delivery). *Prod:* `email-worker` deploys before this migration | AC7.1 (device notices), AC3.2, AC7.9, AC12.8 (its table) | 5 |

**Depends on:** CV-5 (`chat_catchup` items, the fan-out, bell twins). `email-worker` with the `chat_waiting` template must be **deployed before** this migration reaches prod (release train; not a local step).

## 2. What to build

**§11 Notifications: the table, all of it** (prototype frame 9)
Chat adds rows to the app's one pipeline (TV-D12) and never builds its own sender. A device notice reaches you **only when Moduo isn't in front of you** (another app, another module or another workspace counts), **in any workspace**, with the workspace's name; a message's push goes out **at once** from the write, not on the minute; **only one device rings** (your most recently active client; a client that has your attention shows the message in place and acknowledges); a browser rings only when nothing acknowledged within 8 s; a burst in one conversation replaces the last notice ("Sofia · 3 messages"); a click lands on the message. What a notice shows: the sender and the conversation, and the text, with a switch "Show message text" for people who share their screen (CH33); references are drawn as names you can see. **Sound:** one soft sound for direct messages and `@you`, off by default (CH34). **The web app asks once**, the first time you open Chat in a browser ("Get a notice when someone messages you · Allow · Not now"); refused, Catch up says notifications are off in this browser (CH44). **"Count":** a conversation's number is how many of its unread messages are addressed to you (on "Every message", every unread one); the Chat tab, the workspace switcher and the dock or taskbar badge count open Catch up items (an "Every message" conversation is one item; an item from a conversation set to "Nothing" never counts, CH40), per workspace and summed. **The switches** in Settings → Notifications are Direct messages · Mentions and replies · Announcements · Every message · each key's notifications; a switch turns off the device notice and the email for its rows and nothing else (the bell row and the Catch up item are always written).
**The email** (CH43, CH74): on by default ("Email when away"); an unread direct message, `@you` or `@Team` that is over an hour old while no Moduo has been open for an hour, **at most one email per conversation per hour**, with the text only under "Show message text"; never for something that arrived during quiet hours, do not disturb or a vacation (such an item is stamped *held* when it's written, and the email job skips it); never for a paused workspace. Subject: "Sofia Ortiz messaged you in Moduo Studio" (or "3 messages are waiting in Acme"); body: the sender, the conversation, the count, the text when allowed, one button "Open in Moduo". **Pausing one workspace** (CH46) from the workspace switcher stops its device and email notices; its bell, Catch up and counts keep filling quietly.

**Edge cases this block handles** (§Edge cases)
- An unread direct message, an hour old, Moduo closed for an hour → one email; a second message in the same conversation within the hour → no second email; "Email when away" off → none; a paused workspace → none.

## 3. Acceptance criteria

**AC7 — Catch up and notifications**
- **AC7.1** the table in §11 holds row by row (who hears, where, when, turned off by)
- **AC7.9** "Show message text" off hides the text from notices and emails

**AC3 — A duo's week**
- **AC3.2** an unread direct message emails after an hour away, once per conversation per hour, never during quiet hours or a vacation

**AC12 — Platform**
- **AC12.8** the lossless export carries every conversation you can read, with files; every new per-person table is erased with the account

AC7.1 is split: yours are the **device notice** and **email** columns of the §11 table (spec lines 109–126; CV-5 quotes it); CV-5 has Catch up and bell, CV-18 the holds. AC12.8 here means `user_clients` only.

**Tests that prove them** (file · name · AC · plain English)

- `supabase/tests/chat_notices.test.sql` · "the email after an hour" · proves AC3.2, AC7.9 · One `chat_waiting` email per person, conversation and hour; none within the hour of a client seen; none for something that arrived during quiet hours; the text only under "Show message text".

The row also names `chat_notices.test.sql` (delivery), which the table lacks: cover each of the six kinds' rows (server-built title, text, link, `push_after`, `tag`, gate answering *send*). CV-18 adds "holds and the gate" to the same file.

## 4. Decisions that bind it

- **Kinds** (round-3 §2.14 b, #7, #29): `NOTICE_DELIVERY_KINDS` (now `["reminder", "agent"]`) gains `chat_message`, `chat_mention`, `chat_reply`, `chat_announcement`, `chat_reminder`, `chat_focus_summary`; the CHECK `notice_deliveries_kind_check` (live list from `20261013220000_agents_imports_mcp.sql`) is re-stated with them, and `drift-gates.test.ts` follows. `EMAIL_KINDS` gains `chat_waiting` and the `email_outbox` CHECK is re-stated from its **live** list (TX-5 extended it too). `CLIENT_SURFACES` (`desktop`, `web`).
- **`notice_deliveries` gains** `channel_id, message_id, tag, push_after, acked_at, held_for_focus` and the index `(push_after) where pushed_at is null and acked_at is null`. Title, text and link are built **on the server**: "Sofia Ortiz · Acme" plus the workspace's name; the text only when the person keeps "Show message text" on (CH33), references drawn as names that person can see, else "Private item"; link `/chat?c=<conversation>&m=<message>`. `tag = 'chat:<conversation>'` (a chain's own for replies); `push_after` = created + 8 s. Kinds: DM and Every-message burst `chat_message`; `@you`/`@Team`/`@channel` `chat_mention`; chain reply `chat_reply`; announcement `chat_announcement`.
- **Push at once** (§2.14 d): an `AFTER INSERT` trigger calls `notice_deliveries__kick()` when a chat kind arrived (Vault-gated). `push-send` drains: redefine `notice_deliveries__claim` from its live body to claim only rows past `push_after`, not acknowledged, not held for Focus; if rows remain inside their hold, wait for the earliest (≤ 10 s, `EdgeRuntime.waitUntil`) and claim again; the minute job stays the sweeper.
- **One device rings** (§2.14 e): `user_clients` (`id` client-minted, `user_id`, `surface`, `last_seen_at`, `last_active_at`, `user_agent`; own-rows RLS), `user_op_client_seen(client_id, surface, active)` (sender from the session), `notice_op_ack(ids)`. **Erasure and export for `user_clients`** are this block's (#31): cascade from `profiles`, counted in the preview (`account_erase_workspace_data`, live body).
- **`notice__gate(user, ws, kind, at)`** answers send | hold | drop; here always *send*, CV-18 gives it rules. The fan-out asks it before inserting.
- **Prefs:** `user_op_set_chat_prefs(patch)` and the read `user_chat_prefs()` over new op-only `user_preferences` columns (`reaction_row`, `show_online`, `show_focus_task`, `notice_show_text`, `email_when_away`), guarded like Time & region.
- **The email job** `chat-waiting-emails` every 5 minutes, `chat__queue_waiting_emails()` (§2.14 g): Catch up items `dm` / `mention` / `team_mention` over an hour old, open, not emailed, for people with "Email when away" on, no `user_clients.last_seen_at` in the last hour; at most one per person, conversation and hour through `email_enqueue('chat_waiting', …)` (dedupe key `chat_waiting:<person>:<conversation>:<hour>`), stamping `emailed_at`; skip items with `held_at` set.

## 5. Files

New: `supabase/migrations/<stamp>_chat_v2_device_notices.sql` (#35); `supabase/tests/chat_notices.test.sql`; the `chat_waiting` template (`supabase/functions/_shared/email/templates/chat-waiting.ts`, a line in `index.ts`, a fixture in `fixtures.ts`). Touch: `vocabularies.ts`, `drift-gates.test.ts`, `supabase/functions/push-send/handler.ts`, `src/lib/notices/deliveries.ts` (`noticeCopy`). Origins: `20261013110000_notifications_v3.sql`, `20261008160000_email_outbox.sql`, `20261008233000` (`email_enqueue`).

## 6. From earlier blocks

CV-5: `chat_catchup` items with `held_at`, the fan-out, bell twins. CV-1: the tables. TV-D12's kick, claim and `push-send` are landed.

## 7. Watch out

- **Prod order:** `email-worker` with the `chat_waiting` template deploys **before** this migration (TX-3 rule); round-3 §5 risk 6.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

The clients that ring, acknowledge and count (CV-6b); the gate's rules and `held_at` stamping, quiet hours, pause, Focus holds (CV-18); the reminder and Focus-summary writers (CV-11, CV-18); the Settings switches (CV-6b).
