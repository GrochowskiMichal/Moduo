# CV-5: Addressed to you: Catch up rows and the bell (server)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-5-catchup-server`; record `docs/build/chat-v2/CV-5.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 5 | **CV-5** Addressed to you: Catch up rows and the bell *(server)* | the fan-out in send, edit and agent post; `chat_catchup` items per reason with `held_at`; bell twins; `notifications_op_dismiss/_undismiss` redefined; `chat_op_mark_read` closing items; `chat_op_catchup_done/_reopen`, `chat_op_follow_chain`; `chat_catchup.test.sql` | AC7.1 (items and bell), AC7.2, AC7.3, AC7.4, AC7.10, AC1.7 | 2b, 0 (spike 3) |

**Depends on:** CV-2b; CV-0 spike 3. (CV-6a, the device notices, depends on this block.)

## 2. What to build

**§9 Catch up** (prototype frame 1)
- **Done** clears it; reading it in its conversation clears it too; **the bell and Catch up are one state** (a mention cleared in either is gone from both, CH38). **Later** brings it back at a time you pick (in 1 hour · this evening · tomorrow · pick); **Remind me** on any message does the same from its ⋯ (CH51); `/remind` in the composer reminds you about the conversation. The ⋯ offers "Done all in this conversation" with Undo.
- **The rules behind the counts:** an `@you` in a conversation set to "Nothing" waits here silently, no ping, no count (CH40); when quiet hours, do not disturb, a vacation or Focus end, nothing pings and everything waits here (CH41).

**§11 table rows**
| Event | Who hears | When | OS / browser | Bell | Catch up | Count | Email after 1 h away | Turned off by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A direct message | The other people in it | At once, one per conversation per burst | Yes | No (the bell is for work items) | Yes | Yes | Yes | Direct messages · the DM's level Nothing · a paused workspace · quiet hours · do not disturb · Focus holds it · "Email when away" |
| `@you` in a channel | You, if you can read it | At once | Yes | Yes | Yes | Yes | Yes | Mentions and replies · level Nothing (then Catch up only: no bell row, no notice, no count, CH40) · pause · quiet hours · do not disturb · Focus holds it |
| `@Team` | Each member of the team who can read it, once | At once | As `@you` | Yes | Yes | Yes | Yes | As `@you`, plus the team's mute (TV-D13) |
| `@channel` | Every member not on Nothing, once | At once | Yes | Yes | Yes | Yes | No | Mentions and replies · level Nothing · pause · quiet hours · do not disturb · Focus |
| A reply in a chain you're in (you wrote its first message, replied, or were mentioned in it), or a reply to your own message | Those people | At once, grouped per chain | Yes | Yes | Yes, one item per chain | Yes | No | Mentions and replies · "Stop following" · level Nothing · pause · quiet hours · do not disturb · Focus |
| A post in an announcement channel | Every member | At once, once | Yes | Yes | Yes | Yes | No | Announcements · level Nothing (CH23a) · pause; never breaks through quiet hours, do not disturb or Focus (CH41) |
| A message in a conversation set to Every message | Members on Every message | One per burst, only when Moduo isn't in front (CH39) | Yes | No | Yes, one line per conversation (CH73) | Yes | No | Every message · the level · pause · quiet hours · do not disturb · Focus |
| A mention added by an edit | Only the people named for the first time (CH75) | At once | Yes | Yes | Yes | Yes | No | As `@you` |

**Edge cases this block handles** (§Edge cases)
- A mention in a conversation set to "Nothing" → in Catch up, no notice, no count, not in the bell's count.
- A mention cleared in the bell → gone from Catch up; Done in Catch up → dismissed in the bell; read in the conversation → both cleared.

## 3. Acceptance criteria

**AC7 — Catch up and notifications**
- **AC7.1** the table in §11 holds row by row (who hears, where, when, turned off by)
- **AC7.2** the bell and Catch up are one state
- **AC7.3** "Every message" pings once per burst and lists one line per conversation
- **AC7.4** "Nothing" keeps `@you` in Catch up silently
- **AC7.10** an edit notifies only people named for the first time.

**AC1 — Trust pass (v1's fourteen trust bugs, REPLAN §1.3 B)**
- **AC1.7** counts count what's addressed to you, replies included, and a creator is never forced onto "Every message"

AC7.1 is split: this block owns the **Catch up item** and **bell** columns of the table; CV-6a the device-notice and email columns; CV-18 the holds.

**Tests that prove them** (file · name · AC · plain English)

- `supabase/tests/chat_catchup.test.sql` · "addressed to you, row by row" · proves AC7.1, AC7.3, AC7.4, AC7.10 · Each event in §11 writes exactly the listed Catch up item, bell row and device notice, with the listed switch; "Every message" makes one line per conversation; "Nothing" keeps a mention silent; an edit notifies only the newly named.
- `supabase/tests/chat_catchup.test.sql` · "one state with the bell" · proves AC7.2 · Done dismisses the bell twin; dismissing in the bell closes the item; reading closes both; undismiss reopens.
- `supabase/tests/chat_counts.test.sql` · "counts count what's addressed to you" · proves AC1.7 · Replies count; a channel's creator lands on Mentions and replies; Mark unread counts the whole conversation, not what's loaded; an "Every message" conversation is one Catch up item in the tab's count.

`chat_counts.test.sql` is CV-2b's; extend it only for "an Every message conversation is one Catch up item in the tab's count".

## 4. Decisions that bind it

- **The fan-out** (round-3 §2.14 a–c, #7, #8): inside `chat_op_send`, `chat_op_edit` (only people named for the first time, CH75) and the live `chat_op_agent_post`, in the same transaction, among people who can read the conversation, per recipient: a `chat_catchup` item, and a bell row (`module_activity`) where the table says. The device notice and the gate arrive with CV-6a; until CV-18 `held_at` stays null. Nothing is decided in the client.
- **Items** (`chat_catchup`, CV-1's table): reason per event (`dm`, `mention`, `team_mention`, `everyone`, `reply`, `announcement`, `every_message`); `every_message` is one line per conversation (CH73); one item per message and reason whatever retries (unique index); `activity_id` is the bell twin. A direct message has no bell row. An `@you` in a conversation on **Nothing**: item only, no bell row, no count (CH40).
- **Bell ops:** `chat.mention` (payload `reason`: `person` · `team` · `everyone`), `chat.reply`, `chat.announcement`; payloads carry ids, the excerpt is built on the server and read only by recipients and the conversation's readers (§2.25 a). Add the three to `module_activity__gate_recipients`' list (a second guard; `20261013220000_agents_imports_mcp.sql` shows its latest anchored-replace pattern).
- **Who hears a reply:** the root's author, everyone who replied, everyone mentioned in the chain, minus `chat_chain_mutes` (§2.18); one item per chain. `@Team`: each member who can read, once, plus the team's mute (look at `20261013170000_teams_mention_once.sql` and `comments_op_mention_teams`). `@channel`: every member not on Nothing, once.
- **One state with the bell** (§2.15): `chat_op_catchup_done(item_ids)` dismisses the twin (`notification_state.dismissed_at`); `notifications_op_dismiss` / `_undismiss` (redefine from live bodies, `20260713120000_notification_dismiss`) close or reopen the item (`done_how = 'bell'`); `chat_op_mark_read` (CV-2b's, redefined here) closes items up to the message and dismisses twins (`done_how = 'read'`); `chat_op_catchup_reopen(item_ids)` undoes Done; `chat_op_follow_chain(root, following)` writes `chat_chain_mutes`. The bell's own read dot stays the bell's.
- **Counts** (§11, CH40): a conversation's number is its unread messages addressed to you (every unread one on Every message); the Chat tab counts open Catch up items (an Every message conversation is one item; an item from a conversation on Nothing never counts).
- These ops skip the plan check (#25) and log no activity row (#15).

## 5. Files

New: `supabase/migrations/<stamp>_chat_v2_catchup.sql` (#35); `supabase/tests/chat_catchup.test.sql`. Touch (client, small): `src/features/spine/activity.ts` (renders `chat.*` rows; v1 copy "replied in a thread" is stale) and the activity type list. Mapping the three ops to Chat's notification switches lands with CV-6b's switches (`src/lib/preferences.ts`, `OP_TO_NOTIFICATION_TYPE`; my reading).

## 6. From earlier blocks

CV-2a: v2 `chat_op_send`/`_edit` (mentions, teams, `@channel` flags read on the server), the chain columns `parent_id`/`reply_to_id`. CV-2b: `chat_op_mark_read`, `chat_unread_counts`. CV-1: `chat_catchup`, `chat_chain_mutes`, the `CHAT_CATCHUP_*` vocabularies, the registry/link read rules. Spike 3's numbers.

## 7. Watch out

- Round-3 §5 risk 2: `notifications_op_dismiss/_undismiss` are shared with Tasks: read the live bodies and keep Tasks' behaviour.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Migration:** stamp provisional (re-cut on apply day, chat's order kept); redefine from live bodies (`pg_get_functiondef`); re-state grants by name (`DROP` + `CREATE` resets them); re-assert the Realtime publication if you publish a table; apply only on your migration turn, then `bun run db:test chat`; never `local:reset` or `migration up` (runbook, `docs/gotchas/supabase.md`).
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Device notices, the gate, push, the email, `user_clients` (CV-6a); quiet hours, do not disturb, pausing, Focus holds (CV-18); the Catch up view and Remind me/Later (CV-11); the "added"/"removed" lines (CV-15); `chat_op_agent_post`'s creator rules (CV-21).
