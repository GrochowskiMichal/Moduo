# Manual test checklist — CV-10-fix "Mentioned in" rows are Chat's

> Generated 2026-10-16 · branch `t/maciej/cv-checkpoint-4`, folded from the record [`CV-10-fix`](../../build/chat-v2/CV-10-fix.md) (block branch `t/maciej/cv-10-fix-mention-rows`, landed `0c5e26ac`) · **Live-verified:** `chat_links.test.sql` § CV-10-fix, `key-scopes.test.ts`, the app tests, and `db:test` for chat, `tasks_ops`, `ops_parity`, `mcp_tools`; the steps below are the human pass. Tier 2 (migration `20261016145000_chat_v2_mention_rows.sql`).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## In the app

- [ ] **Do:** in a note, `@` a channel → **Expect:** a chip shows, no error toast _(Notes)_
- [ ] **Do:** send a message with a task chip → **Expect:** the task's Linked shows "Mentioned in …" and the link can't be removed from the task _(Tasks)_
- [ ] **Do:** mark a mentioned task as a duplicate → **Expect:** it completes; its "Mentioned in" line stays on it _(Tasks)_

## Verify before release

- [ ] **Do:** run the migration on prod after CV-10's → **Expect:** the data steps touch only rows with a chat end and the chat registry rows _(prod)_
- [ ] **Do:** note that `moduo-mcp` needs no redeploy for this block _(release)_

## Known gaps / not-yet-testable

- ❓ Needs Maciej: should `@conversation` in a note or task write a plain reference link instead of staying a chip with no link?

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-10-fix](../../build/chat-v2/CV-10-fix.md).*
