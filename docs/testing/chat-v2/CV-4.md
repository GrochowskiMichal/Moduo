# Manual test checklist — CV-4 Chat in handed-out Team workspaces

> Generated 2026-10-15 · branch `t/maciej/cv-fold-2`, folded from the record [`CV-4`](../../build/chat-v2/CV-4.md) (block branch `t/maciej/cv-4-plan-source`) · **Live-verified:** no. The block is server-only (one function and a drift gate). It was proven in rolled-back transactions, then applied to the local stack; the paused line and the welcome line are UI and belong to CV-8a.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** with the migration `20261014100400_chat_v2_plan_source.sql` applied, run `bun run db:test chat` → **Expect:** every chat file passes, among them `chat_plan` (27 checks) _(terminal)_
- [ ] **Do:** run `scripts/agent/e2e.sh tests/chat-plan.spec.ts` → **Expect:** 2 passed (a lapsed plan keeps reading and search and refuses sends; a stubbed grant turns chat on in a Free owner's workspace and its end pauses it) _(terminal)_

## In v1's Chat

- [ ] **Do:** in a Duo workspace with two people, switch the owner to Free and reload Chat → **Expect:** every conversation still opens and search finds old messages; sending is refused _(Chat)_
- [ ] **Do:** give that workspace a stub grant (the SQL in `tests/chat-plan.spec.ts`) and reload → **Expect:** chat is on and sending works; end the grant → **Expect:** it is paused again _(Chat)_

## Edge cases

- [ ] **Do:** with no grant function at all (as today, before TX-9b), ask for chat on Duo, Team and Founder workspaces and on Free and Pro ones → **Expect:** the first three have it, the last two don't; an unknown workspace id is off _(psql)_
- [ ] **Do:** make the grant function fail (the test's raising stub) for a Free-owner workspace → **Expect:** chat reads as "no grant" and the log carries one warning with the error code; a Duo owner's workspace is unaffected and never calls the function _(psql)_

## Verify before release

- [ ] **Do:** check prod for `public.plan_grant_effective_tier(uuid)` → **Expect:** it doesn't exist unless TX-9b shipped it; if it does, it returns null for every workspace without an active grant before this migration applies (the plan check changes who can write the moment it applies) _(prod)_
- [ ] **Do:** after the migration on prod, check `chat_workspace_enabled` → **Expect:** it is owned by `postgres` and executable by `authenticated` and `service_role` only (the migration asserts its grants) _(prod)_

## Migrations / data

- [ ] **Do:** `select prosrc from pg_proc where proname = 'chat_workspace_enabled'` → **Expect:** the body names `plan_grant_effective_tier` and `to_regprocedure`; with no grant function present, `select proname from pg_proc where proname = 'plan_grant_effective_tier'` returns nothing _(psql)_

## Known gaps / not-yet-testable

- **The grant half runs on a stub** until TX-9b builds `public.plan_grant_effective_tier(p_workspace_id uuid)`; once it exists the spec's grant test skips with a reason, and TX-9b's own spec should cover a grant turning chat on and off.
- **AC10.8 is not complete here:** v1's Conversations widget shows "Chat comes with the Duo and Team plans" and v1's connector refuses reads when the plan is off. CV-22 (widgets) and CV-21 (MCP tools) finish it.
- **The paused line in place of the composer** and the welcome line are CV-8a's; v1's screens still show their own locked page (`chat-locked.tsx`).
- **Unread counts and presence on a paused plan:** v1's `chat_unread_counts` and the workspace presence topic still ask the plan, so a paused plan returns nothing there until CV-2b and CV-17 drop it.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-4](../../build/chat-v2/CV-4.md).*
