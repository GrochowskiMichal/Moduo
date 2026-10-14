# CV-2b: Conversation ops v2 (server)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-2b-conversation-ops`; record `docs/build/chat-v2/CV-2b.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 2b | **CV-2b** Conversation ops v2 *(server)* | `chat_op_create_channel`, `_open_dm`, `_update_channel`, `_archive_channel`, `_join`, `_leave`, `_add_members`, `_remove_member`, `_set_prefs`, `_mark_read`, `_mark_unread`, `_bootstrap` redefined (names as typed, leaving as a stamp, the manager rules, the read mark as a message); `chat_unread_counts`, `chat_sync_ids`, `chat_people`; the General-join trigger; the erasure redefined; `chat_ops.test.sql` (conversations), `chat_counts.test.sql` | AC1.2, AC1.7, AC1.12, AC10.1–10.2, AC10.7, AC6.5 | 2a |

**Depends on:** CV-2a (and through it CV-1).

## 2. What to build

**§1 Words, shape and who sees Chat**
- **Channel names are as typed** ("Acme rebrand", "Launch v1"): spaces and capitals allowed, 1–80 characters, trimmed, unique in the workspace ignoring case among live channels (CH3a). A channel's icon is **one glyph for every channel, plus a lock for a private one you're in**; what it's linked to shows in its header chip and Details, never as an icon (CH32).

**§12 Channels: lifecycle and who may do what** (prototype frames 3, 4, 7)
- **When someone leaves the workspace** (CH36): their messages stay with their name and a quiet "former member" label; a direct message with them stays readable with "Jana left the workspace" in the composer's place; a deleted account reads "Former member".

**§12 table rows**
| Action | Admin | Manager | Author | Member | Viewer | From |
| --- | --- | --- | --- | --- | --- | --- |
| Read a public channel; join it | ✓ | ✓ | — | ✓ | ✓ | v1 |
| Start a direct message | ✓ | — | — | ✓ | — (receives) | §12 |
| Rename | ✓ | ✓ | — | — | — | §6 #11 |
| Topic | ✓ | ✓ | — | ✓ | — | agent's choice |
| Archive, unarchive | ✓ | ✓ | — | — | — | §12 |
| Add people to a public channel | ✓ | ✓ | — | ✓ | — | v1 |
| Add people to a private channel | ✓ | ✓ | — | — | — | CH58 |
| Remove people | ✓ | ✓ | — | leave only | leave only | CH61 |
| Create a channel | with "Create public / private channels" | | | | — | PERM-7 |

**Edge cases this block handles** (§Edge cases)
- Channel names: "Launch v1" and "launch v1" → the second is refused as a duplicate; 81 characters → refused; a name of spaces → refused.
- The last manager leaves → the channel passes to the workspace owner if they can read it, else its earliest remaining member; a manager can't un-manage themselves while last.
- A former member → their messages keep their name with a quiet label; their direct message reads "Jana left the workspace"; a deleted account reads "Former member".
- 200 unread when a channel opens → only the messages that were on screen become read; the read mark moves to the last one seen; the "New" pill sits before the first unseen one and never jumps as older pages load.

## 3. Acceptance criteria

**AC1 — Trust pass (v1's fourteen trust bugs, REPLAN §1.3 B)**
- **AC1.2** opening a conversation marks read only what was on screen
- **AC1.7** counts count what's addressed to you, replies included, and a creator is never forced onto "Every message"
- **AC1.12** managers can be added, the announcement switch flips later, "Manage any channel" is read, "Start calls" is hidden

**AC10 — Channels and permissions**
- **AC10.1** §12's table holds row by row (the SQL tests run as owner, admin, manager, member, viewer, outsider and a key)
- **AC10.2** names as typed, unique ignoring case
- **AC10.7** the last manager rule

**AC6 — An agency's week (internal chat)**
- **AC6.5** a contractor who left reads as a former member and their direct message stays readable

**Tests that prove them** (file · name · AC · plain English)

- `supabase/tests/chat_ops.test.sql` · "every op, every role" · proves AC10.1, AC12.1, AC6.5 · Each op is tried as owner, admin, manager, member, viewer, outsider and a key: §12's table holds; the ops of §Assumptions #15 write one attributed activity row and the quiet ones write none; a resent id returns the stored row; `chat_people` flags a former member.
- `supabase/tests/chat_counts.test.sql` · "counts count what's addressed to you" · proves AC1.7 · Replies count; a channel's creator lands on Mentions and replies; Mark unread counts the whole conversation, not what's loaded; an "Every message" conversation is one Catch up item in the tab's count.
- `supabase/tests/chat_ops.test.sql` · "names as typed, General, the last manager" · proves AC10.2, AC10.7, AC1.12 · "Launch v1" is stored as typed and "launch v1" is refused; General can't be deleted and joins new members by trigger; the last manager can't un-manage and leaving hands the channel on.

## 4. Decisions that bind it

**Redefine from the live bodies** (round-3 §2.3, §2.23, §2.25 b; #1, #11, #13, #15, #25, #30). Who may call each op is §12's table (rows above).
- `chat_op_bootstrap(ws)`: makes General (`is_default`) if missing and joins every member who hasn't left it; the store calls it once per workspace. A trigger on `workspace_members` insert joins new members to General unless a `left_at` row exists (leaving is a stamp, never a deleted row).
- `chat_op_create_channel(ws, name, topic, is_private, member_ids, announcement, …)`: names as typed (trimmed, 1–80, unique ignoring case among live channels: CV-1's index), topic ≤ 250, creator joins at Mentions and replies (never forced onto Every message); needs "Create public / private channels". The link arguments wait for CV-13's columns (my reading; CV-13 redefines this op).
- `chat_op_open_dm(ws, user_ids)`: ≤ 9 people, one per set; the opener must be able to post (viewers receive, never start one).
- `chat_op_update_channel(channel, name, topic)`: rename managers and admins, topic any poster; the registry label follows the name.
- `chat_op_archive_channel`, `_join` (public only, clears `left_at`; viewers may join), `_leave` (stamps `left_at`; leaving General sticks; a last manager leaving hands the channel to the workspace owner if they can read it, else the earliest remaining member), `_add_members` (public: any poster; private: managers and admins), `_remove_member` (stamps `left_at` + `removed_by`; managers and admins), `_set_prefs(channel, level, pinned)` (`starred` is "Pin to sidebar"). The quiet `added`/`removed` Catch up lines and closing Catch up items on archive are CV-15's.
- `chat_op_mark_read(channel, message_id)` moves `last_read_id` **forward only**, to the last message seen, never by clock; `chat_op_mark_unread(channel, message_id)` moves it to just before that message (#15, §6 #17). CV-5 adds closing Catch up items to `mark_read`.
- `chat_unread_counts(ws)`: counts replies, reads the mark as `(created_at, id)`, returns the number **addressed to you** per conversation (§2: "a number appears only for what's addressed to you (a direct message's unread, your mentions and replies in a channel, every message in a channel you set to 'Every message')"; a muted one still turns bold and never counts); a converted v1 reply is unread only if its root is; Mark unread counts the whole conversation, not what is loaded.
- New reads: `chat_sync_ids(ws)` (ids of conversations you can read and your memberships: the store's access check) and `chat_people(ws)` (names and avatars of everyone who wrote in or belongs to a conversation you can read, former members flagged).
- `account_erase_workspace_data` (live body): "a conversation nobody else is in" counts only current members who haven't left.
- Activity rows (#15, ids only): `chat.channel_create`, `channel_rename`, `channel_topic`, `channel_archive`/`_unarchive`, `join`, `leave`, `member_add`, `member_remove`; read marks and prefs log none. `mark_read`, `mark_unread`, `set_prefs`, `leave` skip the plan check (#25).

## 5. Files

New: a migration file for these ops (2a's file is applied by now and applied files are never edited; **the orchestrator names it**); `supabase/tests/chat_counts.test.sql`; extend `supabase/tests/chat_ops.test.sql` (conversations half: every op as owner, admin, manager, member, viewer, outsider, a key). v1 origin: `20261006150000_chat_module.sql` (`chat_unread_counts`, `share_chat_channel_guard`). v1's client (`src/lib/runtime.chat.web.ts`, a hot file) calls v1 signatures like `chat_op_mark_read(channel, at)`: keep v1's screens working until CV-3.

## 6. From earlier blocks

CV-1: `is_default`, `left_at`, `removed_by`, `last_read_id`, `deleted_at`, the unique-name index. CV-2a: v2 send (so replies exist in the stream), the wrappers, the live `chat_op_typing`. Check the catalog.

## 7. Watch out

- A removal must stamp the member row (`updated_at`) so it reaches the removed person live as an update of their own row (round-3 §2.7); never delete a membership row.
- Round-3 §5 risk 2: `account_erase_workspace_data` has been redefined by other blocks; start from the live body.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Manager ops, the announcement switch, make private, delete and restore channel, the quiet lines (CV-15); links (CV-13); Catch up closing (CV-5); search; every client piece.
