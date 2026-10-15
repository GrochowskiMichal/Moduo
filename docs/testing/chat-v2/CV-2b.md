# Manual test checklist — CV-2b Conversation ops v2

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-2b`](../../build/chat-v2/CV-2b.md) (block branch `t/maciej/cv-2b-conversation-ops`) · **Live-verified:** no. The block is server-only plus two small changes to v1's client; its ops are proven by `chat_ops.test.sql` (262 checks) and `chat_counts.test.sql` (45), and `tests/chat-plan.spec.ts` ran green (2 passed). The UI items below run in v1's screens until CV-8a.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** with `20261014160000_chat_v2_conversation_ops.sql` applied, run `bun run db:test chat` → **Expect:** every chat file passes, among them `chat_ops` and `chat_counts` _(terminal)_

## In v1's Chat

- [ ] **Do:** leave a public channel, reload → **Expect:** it leaves the sidebar and stays gone; its `chat_members` row has `left_at` set _(Chat + psql)_
- [ ] **Do:** as a channel's creator, remove someone → **Expect:** the channel leaves their sidebar live; their Browse → Join answers "You were removed from this channel. A manager can add you back." _(Chat, two browsers)_
- [ ] **Do:** open Chat in a new workspace with two people → **Expect:** "General" exists and both are in it _(Chat)_
- [ ] **Do:** create "Launch v1", then "launch v1" → **Expect:** the second is refused as a duplicate _(Chat)_
- [ ] **Do:** mention someone in a channel, then send a plain message → **Expect:** the mention raises their number; the plain message only bolds the name _(Chat, two browsers)_

## Edge cases

- [ ] **Do:** open a direct message with only yourself from v1's dialog → **Expect:** refused ("A direct message needs someone besides you.") _(Chat)_
- [ ] **Do:** as the last manager of a public channel, leave → **Expect:** the workspace owner manages it; for a private channel the owner isn't in, its earliest remaining member whose role posts _(psql)_
- [ ] **Do:** try to archive General → **Expect:** refused _(psql)_

## Verify before release

- [ ] **Do:** time `chat_people` on a workspace with 100k messages, `chat_unread_counts` with many unread replies and `chat_sync_ids` at a few hundred channels → **Expect:** the research workspace gave 2.5 ms, 16 ms and 2.4 ms; stay in that range _(psql)_
- [ ] **Do:** call `chat_op_create_channel` with v1's five named arguments and `chat_op_mark_read(p_channel_id, p_at)` → **Expect:** both resolve (the new op, the wrapper) _(psql)_
- [ ] **Do:** weigh `min_build` at the release → **Expect:** an old desktop build without this block's `mapMember` change reads a stamped row as a membership, so a channel left or removed from stays in its sidebar until the build updates _(release)_
- [ ] **Do:** release order → **Expect:** this file after CV-2a's and the v1 limits'; `chat_join_general` then fires for every workspace member insert _(release)_

## Migrations / data

- [ ] **Do:** after applying twice → **Expect:** it re-runs cleanly; after applying, `chat_channels_live_dm_uq` exists and `chat_channels_dm_uq` does not _(psql)_

## Known gaps / not-yet-testable

- Adding managers, the announcement switch after creation, and the quiet "added" / "removed" lines are CV-15's; the activity feed has no lines yet for CV-2a's message ops.
- v1's New conversation dialog still offers a DM with yourself until CV-8a.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-2b](../../build/chat-v2/CV-2b.md).*
