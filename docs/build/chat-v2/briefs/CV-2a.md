# CV-2a: Message ops v2 (server)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-2a-message-ops`; record `docs/build/chat-v2/CV-2a.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 2a | **CV-2a** Message ops v2 *(server)* | `chat_op_send`, `_edit`, `_delete`, `_react`, `_pin`, `_restore`, `_typing` redefined from their live bodies (v2 form, mentions, teams and `@channel` read on the server, client-minted ids, the v1 signature wrappers, the blank-deleted job, activity rows); `chat_ops.test.sql` (messages) | AC12.1, AC1.4, AC12.4 | 1 |

**Depends on:** CV-1 (the new columns, stamp triggers, `format_version`, `body_text`, `reply_to_id`, `kind`/`event`, the mention columns, `api_key_id`).

## 2. What to build

**§3 The conversation: toolbar, stream and message row** (prototype frames 5, 6, 7)
- **Edit and delete:** ↑ in an empty composer edits your last message; an edit that names someone new notifies only them (CH75). Delete hides the message at once with **"Deleted · Undo" for 8 s**, no confirm (§6 #10); after the toast the text, mentions, reactions and pin are blanked on the server and files go to the trash clock.
- **Sending states** (frame 6): your message is visible under 50 ms after ⏎; offline it sits in place as **"Waiting to send"** and sends itself in order when you're back (CH64); only when the server refuses it does it show **"Not sent · Retry"** (a viewer, an announcement channel, a paused plan). Reactions, edits, deletes and pins while offline say "Offline".

**§5 Replies, chains, Wrap up and tidying up** (prototype frame 5)
- **One action, Reply.** A reply posts at the bottom, in time order, visible to everyone, with one muted line quoting what it answers (click it to jump). No "Reply in thread", no second reply button. A reply to a reply joins the same chain.

**§12 table rows**
| Action | Admin | Manager | Author | Member | Viewer | From |
| --- | --- | --- | --- | --- | --- | --- |
| Post, reply | ✓ ¹ | ✓ | — | ✓ ¹ | — | PERM-7 |
| Delete a message | anyone's ² | own | own | own | — | §6 #10 |
| Edit a message | — | — | own | — | — | v1 |
| Pin, unpin | ✓ | ✓ | — | ✓ | — | agent's choice |
| React | ✓ | ✓ | — | ✓ | ✓ | CH60 |

**Edge cases this block handles** (§Edge cases)
- An edit adds `@Anna` → Anna hears once; nobody else hears about the edit; an edit that removes a mention sends nothing.
- Delete then Undo within 8 s → the message is back with its reactions and files; after 8 s the server blanks the text, mentions, reactions and pin and the files start the trash clock; a deleted root with replies reads "Deleted message" and keeps its chain.
- A message of 8,000 stored characters (references included) → refused with the count, nothing partial; a message of 10 files → the eleventh is refused before upload.
- A reply to a reply → joins the root's chain, quotes the reply it answers; "N replies" counts it.
- An `@channel` from a role without "Mention everyone" → sent as plain text, nobody is pinged, the composer says so.

## 3. Acceptance criteria

**AC12 — Platform**
- **AC12.1** every write is a `chat_op_*` op that re-checks membership (and the plan, except the read-state, Catch up, reaction, preference and leave ops that §1 keeps working while paused), is idempotent on a resent id, and logs an attributed activity row for the ops of §Assumptions #15 (sends, typing, read marks, Catch up ops, reminders, follows, heartbeats, acks and preferences log none)
- **AC12.4** typing events reach only a conversation's members and name the sender from the session; presence is display only
- **AC12.9** old desktop builds send through the wrappers for one release and are told to update after `min_build`

**AC1 — Trust pass (v1's fourteen trust bugs, REPLAN §1.3 B)**
- **AC1.4** no message is lost at a page boundary or after a reconnect

**Tests that prove them** (file · name · AC · plain English)

- `supabase/tests/chat_ops.test.sql` · "every op, every role" · proves AC10.1, AC12.1, AC6.5 · Each op is tried as owner, admin, manager, member, viewer, outsider and a key: §12's table holds; the ops of §Assumptions #15 write one attributed activity row and the quiet ones write none; a resent id returns the stored row; `chat_people` flags a former member.
- `src/lib/min-build.test.ts` + `supabase/tests/chat_wrappers.test.sql` · "old builds" · proves AC12.9 · The v1 send and edit signatures convert and succeed for one release; a build below `min_build` sees the update notice and runs read-only.

## 4. Decisions that bind it

**Already live, not on this branch:** `supabase/migrations/20261014090000_chat_privacy_rules.sql` (local stack and prod; on `origin/maciej` once PR #365 merges; don't fetch it here) holds the live `chat_op_typing(p_channel_id uuid, p_parent_id uuid default null, p_stop boolean default false)`, `perm_can_see_entity`'s chat branches, `chat_caps_get`, `share_op_announce`. Round-3 §2.3's draft `chat_op_typing(channel, stopped)` differs: **the live signature wins**, don't redo it, only fold it into this block's test.

**Redefine from the live bodies** (round-3 §2.3, §2.25 c; #3, #4, #12, #15, #25):
- `chat_op_send(id, channel, body, reply_to_id)`: the client-minted `id` is the idempotency key (a retry returns the stored row); v2 stored form (≤ 8,000 stored characters, references included, refused with the count, nothing partial); mentions, teams and `@channel` read **from the text on the server**, never from the client (`@channel` without "Mention everyone" is stored as plain text); the excerpt built on the server; a reply joins the root's chain (`parent_id` = root, `reply_to_id` = what it quotes) and keeps `reply_count`, `last_reply_at`, `reply_user_ids`; the sender's `last_read_id` moves to it; announcement channels take managers' posts only; event lines (`kind = 'event'`) pass `share_chat_message_guard`, which reads the parsed `@channel` flag, not words. Reopening a wrapped chain arrives with CV-12.
- `chat_op_edit(message, body)`: v2 form, mentions re-read, `edited_at`; a person named for the first time is told by CV-5's fan-out, not here.
- `chat_op_delete(message)` hides at once; a minute job `chat-blank-deleted` blanks text, mentions, reactions and pin once 8 s have passed (files go to the trash clock in CV-9); `chat_op_restore(message)` inside the window. Author, or others' with "Delete others' messages". Schedule the job like `20261013110000_notifications_v3.sql` does (unschedule if present, then `cron.schedule` with a `statement_timeout`).
- `chat_op_react(message, key, on)`: explicit on/off (idempotent, no toggle), never notifies, readers including viewers (CH60). The shared key format and the 20-kinds cap are CV-7c's `reactions__key_ok`: keep the live key check here (my reading of the split; record it).
- `chat_op_pin(message, pinned)`: messages only, not event lines, ≤ 100 per conversation.
- **Wrappers, one release:** v1 `chat_op_send(p_channel_id, p_body, p_parent_id, p_mentioned_user_ids, p_notify_channel, p_client_id, p_excerpt)` and `chat_op_edit(p_message_id, p_body, p_mentioned_user_ids)` stay as thin functions that convert with `chat__v1_to_v2` and call the v2 op; CV-23 drops them.
- **Plan and roles:** `chat_op__guard` keeps the plan check; `chat_op_react` skips it (#25: a paused workspace can still react). Posters per §12; errors use `42501`, `P0002`, `22023` so the client tells "the server said no" from a lost connection (round-3 §2.25 l).
- **Activity (#15):** attributed rows with ids only (no message text) for `chat.message_edit`, `chat.message_delete`, `chat.message_restore`, `chat.react`, `chat.pin`; a plain send, typing and read marks log none.

## 5. Files

New: `supabase/migrations/<stamp>_chat_v2_core_ops.sql` (#35 names one file for "CV-2"; 2a's file applies before 2b starts and applied files are never edited, so **2b needs its own file: the orchestrator names it**); `supabase/tests/chat_ops.test.sql` (messages half), `chat_wrappers.test.sql`. v1 origins: `20261006150000_chat_module.sql`, `20261008124000_chat_agent_post_checks_creator.sql` (`share_chat_message_guard`). Client: `src/lib/runtime.chat.web.ts` and `src/features/chat/hooks/use-chat-module.ts` call v1 signatures: keep v1's screens working through the wrappers; CV-3 re-scopes them.

## 6. From earlier blocks

From CV-1: the new message columns (`format_version`, `body_text`, `reply_to_id`, `kind`/`event`, mention columns, `api_key_id`), `last_read_id`, `chat__v1_to_v2`, `chat__body_text`, the stamp triggers. Check the catalog before starting.

## 7. Watch out

- Round-3 §5 risk 3 (builds before `min_build` keep calling v1 signatures: the wrappers are why they still send), risk 2 (shared-function redefinitions).
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Hot files:** `src/lib/runtime.chat.web.ts` and `src/features/chat/store/*` (CV-3 owns them; this block touches the client only to keep v1's screens mounting). Keep edits there small; another builder may change them too.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Conversation ops (CV-2b); Catch up and notice fan-out (CV-5, CV-6a); "Mentioned in" links (CV-10); file adoption (CV-9); reaction key widening (CV-7c); wrap-up, reopen, move, decisions (CV-12, 16, 14); `chat_op_agent_post` (CV-21); the store (CV-3).
