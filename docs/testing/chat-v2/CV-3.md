# Manual test checklist — CV-3 The chat store

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-3`](../../build/chat-v2/CV-3.md) (block branch `t/maciej/cv-3-store`) · **Live-verified:** partly. The probe passed 14/14 on the local stack and a throwaway smoke run of v1's Chat on the store passed once; after the review the smoke run stopped in setup (the reset stack had no workspace for the seed person). Client-only, no migration; v1's screens run on the store until CV-8a.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** `DOCKER_CONTEXT=orbstack bun supabase/probes/chat-store.probe.ts` → **Expect:** 14 PASS _(terminal)_

## In v1's Chat, on the store

- [ ] **Do:** sign in, open Chat in a Duo workspace; reload → **Expect:** General paints; after the reload the conversation shows at once from the device, then updates _(Chat)_
- [ ] **Do:** in a second browser as another member, send a message → **Expect:** it appears in the first without a reload and the Chat tab's dot follows _(Chat, nav)_
- [ ] **Do:** DevTools → Network → Offline, send a message; go back online → **Expect:** it shows at the bottom at once; once online it is sent, one copy on the server _(Chat)_
- [ ] **Do:** open a chat mention notice from the bell → **Expect:** Chat opens on that conversation at the message (its chain opens when it's a reply) _(bell, Chat)_
- [ ] **Do:** as the owner, remove a member from a private channel → **Expect:** within seconds it leaves their sidebar _(Chat, second browser)_

## Edge cases

- [ ] **Do:** a send the server refuses (rate limit, plan paused) → **Expect:** "Not sent · Retry" with the server's words; a lost network leaves it waiting, not failed _(Chat)_
- [ ] **Do:** two tabs of one person with a waiting send → **Expect:** it goes out once; a resend under the same id never doubles a message _(Chat)_

## Verify before release

- [ ] **Do:** measure Postgres Changes delivery p95 on the real project → **Expect:** under 500 ms; otherwise swap `postgresChangesSource` for Broadcast from the database behind `ChatLiveSource` _(prod)_
- [ ] **Do:** re-measure the cold open (≤ 100 ms for the newest 50 of 10,000) and the 500-row put in the real webviews with CV-7a's stream → **Expect:** inside budget _(desktop app)_

## Known gaps / not-yet-testable

- The e2e for the stream (`tests/chat-stream.spec.ts`) is CV-7a's; CV-3 owns no committed e2e.
- v1's screens still draw a refused presence as nobody online; the error state is in the store.
- The snapshot's sidebar records are rebuilt on every notify (cheap at chat's sizes).

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-3](../../build/chat-v2/CV-3.md).*
