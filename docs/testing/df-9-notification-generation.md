# Manual test checklist — DF-9 Notification generation v1

> Generated 2026-07-12 · branch `t/maciej/df-9-notification-generation` · **Live-verified:** generation round-trip-verified against the **real prod schema** (rolled-back probe on `wtoonrvuqumihpkbvwvs` / "Claude Test S2": unblocked=1, self_assigned=0, assigned=1, zero residue). Frontend logic unit-covered + `bun run verify` 1145 green. ✅ **The prod apply landed 2026-07-13** (prod version `20260713093048`; re-confirmed against the catalog by OPS-1 on 2026-07-29 — function + trigger present, `tgenabled='O'`), so the end-to-end bell steps below are exercisable. _(This line read "PENDING" until 2026-07-29 — that staleness is why OPS-1's ledger entry wrongly listed this migration as unapplied.)_ The read path (`notifications_list`/predicate) is unchanged by DF-9 and already powers the live @mention/email notifications.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## What this block does
The notification **bell + grouping + read-state already existed**. DF-9 only **generates** two new quiet notification types server-side and fixes email deep-linking. No new UI. The two new types ride the existing `module_activity` → `spine_activity_targets_me` → `notifications_list` substrate (same path as @mention and email snooze/follow-up-due).

## Migration (do this FIRST — the trigger must be live)
- [x] ✅ **DONE 2026-07-13** — `supabase/migrations/20260712120000_df9_task_notifications.sql` applied to `wtoonrvuqumihpkbvwvs` (prod version `20260713093048`). Re-confirmed against the catalog by OPS-1 on 2026-07-29: `public.tasks_notify_spine()` + trigger `tasks_notify_spine` on `public.tasks` both present, `tgenabled='O'`. _(cloud / both)_

## Blocked-task-unblocked (fully self-verifiable, single user)
- [ ] **Do:** In the "Claude Test S2" workspace, the demo data already has **"Untagged filter-test task"** blocked by **"Verify cloud consolidation end-to-end"** (a `task_relations` edge). Mark **"Verify cloud consolidation end-to-end"** as **done**. → **Expect:** open the bell (top bar) → a card **"You finished “Verify cloud consolidation end-to-end”, unblocking this"** appears, grouped, unread dot showing. _(web / both)_
- [ ] **Do:** Click that notification card. → **Expect:** it navigates to `/tasks` and **selects "Untagged filter-test task"** (opens its detail), and the card marks read. _(web)_
- [ ] **Do:** Re-open "Verify cloud consolidation end-to-end" and mark it done a second time (or edit its title while done). → **Expect:** **no new** unblocked notification is generated for an already-done→done re-save (only a genuine open→closed transition fires). _(web)_

## Assigned-to-you (needs a second workspace member to observe in-bell)
- [ ] **Do:** As member **B**, create or reassign a task whose **owner** is member **A** (e.g. seed a task row with `owner_id = A` via REST while authed as B). → **Expect:** signed in as **A**, the bell shows **"<B's name> assigned this to you"**, grouped, deep-linking to that task on `/tasks`. _(web / both)_
- [ ] **Do:** As member A, create a normal task for yourself (owner = you). → **Expect:** **no** "assigned to you" notification — self-owned tasks never notify (quiet-core). _(web)_
- [ ] **Do (generation-only check, single user):** As the test user, seed a task with `owner_id = <another member id>` and then `SELECT op, payload FROM module_activity WHERE op='tasks.assigned' ORDER BY created_at DESC LIMIT 1`. → **Expect:** a row with `payload.mentioned_user_ids = ["<that member id>"]` and `payload.title`. (Confirms the trigger fires + writes the correct target even when you can't read the recipient's bell.) _(cloud)_

## Email deep-linking (email_thread routing)
- [ ] **Do (desktop, requires an email account synced + a snoozed/follow-up thread that became due):** In the bell, click a **snooze-due** or **follow-up-due** email notification. → **Expect:** it now navigates to `/email` and **opens/scrolls to that thread** (`?thread=<id>`), instead of dead-ending on the plain inbox. _(desktop)_
- [ ] **Do (any):** Trust the unit test `notifications.test.ts › routes an email_thread notification to /email` for the pure routing; the desktop step above confirms the end-to-end nav. _(both)_

## Regression checks (no new type outside the quiet set)
- [ ] **Do:** Post a comment on an entity that @mentions a member. → **Expect:** the existing @mention notification still lands unchanged (predicate untouched). _(web)_
- [ ] **Do:** Open the bell with existing notifications. → **Expect:** grouping, unread dots, "Mark all read", and the Workspace/Global scope tabs all behave exactly as before. _(web)_

## Known gaps / not-yet-testable
- The **DB round-trip** (both new types actually landing in the bell) was **not** exercised in the build session because the migration could not be applied there (no authed Supabase session in a non-interactive `/s2`). The migration is additive and **degrades gracefully** — until it's applied, no `tasks.assigned`/`tasks.unblocked` rows generate, but nothing breaks (read path, predicate, bell, and every existing notification are untouched). Apply the migration, then the Blocked-task-unblocked steps above are a full single-user proof.
- **assigned-to-you** in-bell display needs a **second workspace member** (the notification is deliberately hidden from the actor). The generation-only SQL check verifies the trigger writes the correct targeted row without a second account.
- "Assignee" == `owner_id` at alpha (the live tasks model has no dedicated assignee column). The hook fires the moment any path (a future assignment UI, the MCP connector, or a direct write) sets a task's owner to another member.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
