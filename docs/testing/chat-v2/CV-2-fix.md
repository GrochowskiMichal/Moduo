# Manual test checklist — CV-2-fix Rules CV-2a and CV-2b share

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-2-fix`](../../build/chat-v2/CV-2-fix.md) (block branch `t/maciej/cv-2-fix-rules`) · **Live-verified:** no. Server-only; proven by `chat_rules.test.sql` (69 checks) and every SQL file passing (48) with the migration applied.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** with `20261017105000_chat_v2_rules_fix.sql` applied, run `bun run db:test chat` → **Expect:** every chat file passes, among them `chat_rules` _(terminal)_

## In v1's Chat

- [ ] **Do:** as a channel's creator, remove someone, then `select removed_at, removed_by from chat_members …` → **Expect:** both are set _(Chat + psql)_
- [ ] **Do:** make a private channel "Skunkworks"; as someone not in it, create a public "skunkworks" → **Expect:** it is made; as someone in it, the same name → **Expect:** "already exists" _(Chat, two browsers)_
- [ ] **Do:** in an announcement channel, a member posts → **Expect:** refused; its manager posts and pins → **Expect:** fine _(Chat)_

## Edge cases

- [ ] **Do:** a manager who left an announcement channel tries to post, pin or switch announcement-only → **Expect:** all refused, and trying to post doesn't bring them back _(psql)_
- [ ] **Do:** erase the account of a person who removed someone, then that person tries to rejoin or post (also through their app's key) → **Expect:** the removal stands and posting is refused until a manager adds them back _(psql)_

## Verify before release

- [ ] **Do:** on prod before applying, `select count(*) from chat_members where removed_by is not null` → **Expect:** 0 expected (v1 deleted rows on removal); each such row gets `removed_at = left_at` _(prod)_
- [ ] **Do:** check no two live public channels share a name ignoring case → **Expect:** none, so the new unique index builds _(prod)_
- [ ] **Do:** release order → **Expect:** after CV-2b's file; nothing deployed calls `chat__name_taken(uuid, text, uuid)` (only the ops did) _(release)_

## Known gaps / not-yet-testable

- The erasure's order of choice for a new manager still differs from `chat__hand_over`'s (CV-15 aligns them).
- A public and a private channel (or two private ones) can share a name; someone added to both sees two.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-2-fix](../../build/chat-v2/CV-2-fix.md).*
