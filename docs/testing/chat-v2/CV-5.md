# Manual test checklist — CV-5 Addressed to you: Catch up rows and the bell

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-5`](../../build/chat-v2/CV-5.md) (block branch `t/maciej/cv-5-catchup-server`) · **Live-verified:** no. Server-only; proven by `chat_catchup.test.sql` (81 checks) and `chat_counts.test.sql`. Its review fixes were checked in a scratch database, so the changed migration must be re-applied to the shared stack on its next reload.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** with `20261017106000_chat_v2_catchup.sql` applied, run `bun run db:test chat` → **Expect:** every chat file passes, among them `chat_catchup` _(terminal)_

## In v1's Chat and the bell

- [ ] **Do:** A sends B a direct message → **Expect:** B's Chat tab count +1 and no bell row _(Chat, bell)_
- [ ] **Do:** A writes `@B` in a channel → **Expect:** B's bell shows "A mentioned you in #channel: “…”" with names, not URIs; Catch up has the item _(bell, Chat)_
- [ ] **Do:** B dismisses it in the bell → **Expect:** the Chat tab count drops by one _(bell, Chat)_
- [ ] **Do:** B opens the channel and reads it → **Expect:** the bell row is dismissed _(Chat, bell)_
- [ ] **Do:** C sets the channel to Nothing; A writes `@C` → **Expect:** no bell row and no count, but the item exists _(Chat)_
- [ ] **Do:** three replies in a chain B started → **Expect:** one bell row (the newest) and one Catch up item _(bell, Chat)_
- [ ] **Do:** B on Every message in a channel, three plain messages → **Expect:** the conversation shows 3, the tab 1 _(Chat)_

## Edge cases

- [ ] **Do:** edit a message to drop a name, then put it back → **Expect:** the mention item closes and its bell row goes; naming them again tells nobody twice _(psql)_
- [ ] **Do:** Stop following a chain → **Expect:** its open item closes and the bell twin is dismissed; follow again → the mute is removed _(psql)_
- [ ] **Do:** Done on an item, then Undo → **Expect:** the item and its twin reopen, only in a conversation you can read and follow _(psql)_

## Verify before release

- [ ] **Do:** `@channel` in a 100-person channel → **Expect:** 100 items (100 Realtime changes on `chat_catchup`) plus one bell row; Every message members get an update per message; count these in spike 3's delivery budget (CH31) _(local or prod stack)_

## Known gaps / not-yet-testable

- An `@you` to a reader who isn't a member writes the item and the bell row but no `chat_unread_counts` row counts it; CV-3 / CV-11 decide how the tab counts those.
- The bell's dismiss and undismiss sync with Catch up only through `notifications_op_dismiss` / `_undismiss`; a future bulk dismiss must call `chat__close` too.
- Closing items on leaving, removal, archive and delete is CV-15's.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-5](../../build/chat-v2/CV-5.md).*
