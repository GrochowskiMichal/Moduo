# OPS-1 — pending migrations applied + migration timestamps de-duplicated

> Generated 2026-07-29 · branch `claude/strange-ramanujan-f82364` · **Both halves done.**
> Prod project verified **`wtoonrvuqumihpkbvwvs` / org "Moduo"** before any write.
> Everything below marked _(verified)_ was proven in-session; the _(manual)_ items need a human at the app.

## What actually shipped

**Scope was 2 migrations, not 3.** An audit-first pass (`list_migrations` + a `pg_proc` / `information_schema.columns` / `pg_trigger` sweep) found `20260712120000_df9_task_notifications.sql` **already applied on 2026-07-13** (prod version `20260713093048`, trigger `tgenabled='O'`). The ledger entry was stale. Nothing was re-applied for it.

Applied to prod 2026-07-29:

| Migration | Applied as | Adds |
| --- | --- | --- |
| `20260704180000_email_snooze_followup.sql` | `email_snooze_followup` | `email_refs.follow_up_notified_at`, `email_op_snooze_due`, `email_op_follow_up_due`; patches `email_op_follow_up` to re-arm the one-shot guard |
| `20260704190000_email_ref_remove.sql` | `email_ref_remove` | `email_op_ref_remove` |

The first also re-asserts `spine_activity_targets_me` — a **no-op**: prod already carried the two-branch predicate from the *newer* `20260714120000` (applied 2026-07-27), and the executable SQL is identical (only comments differ). See gotchas §Supabase for why applying a back-dated migration is dangerous in general.

Timestamps de-duplicated (nothing else in the repo read that directory, which is why two collisions shipped unnoticed):

| Was | Now | Why this file moved |
| --- | --- | --- |
| `20260702160000_user_preferences_calendar_domain.sql` | `20260702155000_…` | idempotent `ADD COLUMN IF NOT EXISTS`; new slot matches prod's real order (`20260702192441` < `20260702200224`) |
| `20260712120000_user_preferences_preferences_domain.sql` | `20260712115000_…` | same; prod order was `20260712004956` < `20260713093048` |

## Already verified in-session — no need to re-do

- _(verified)_ **All four ops exist with correct grants.** `has_function_privilege('anon', …) = false` and `authenticated = true` on `email_op_snooze_due`, `email_op_follow_up_due`, `email_op_ref_remove`, `email_op_follow_up`. Neither migration uses `DROP`+`CREATE`, so the re-grant-to-PUBLIC footgun never applied.
- _(verified)_ **One authed rolled-back probe** (`set_config('request.jwt.claims', …, true)` as the real "Claude Test S2" owner, ending in `RAISE EXCEPTION 'ROLLBACK_OK'`) proved: follow-up guard re-armed to `NULL` · `follow_up_due` wrote exactly **1** activity row and `spine_activity_targets_me` returned **true** for it (so it becomes a notification) · a second call left it at **1** (one-shot guard holds) · `snooze_due` on a not-snoozed ref wrote **0** rows · after a real snooze it unsnoozed (`is_snoozed=false`) and wrote exactly **1** owner-targeted row, also `targets_me=true` · `ref_remove` soft-deleted the ref, dropped a seeded link **1→0**, tombstoned the registry entry, wrote **1** activity row.
- _(verified)_ **Prod left byte-clean.** Post-rollback residue check: 0 probe activity rows, 0 email-thread links, 0 deleted refs, 0 mutated refs, 0 tombstones; the single `email_refs` row untouched.
- _(verified)_ `src/types/supabase.ts` regenerated from prod — the 3 new RPCs + `follow_up_notified_at` are typed; `bun run verify` green (1234) including `typecheck`.

## Manual test list

- [ ] _(manual, web)_ **DF-21f's follow-up-due sweep is no longer inert.** Set a follow-up on an email thread with a deadline in the past, then reload the web app (the sweep runs on mount + focus). → **Expect:** a quiet "follow-up due" notification appears in the bell for the thread owner; the network tab shows `email_op_follow_up_due` returning **200**, not 404/PGRST202. Reload again → **expect** no duplicate notification (one-shot guard).
- [ ] _(manual, web)_ **Follow-up re-arm.** On that same thread, clear the follow-up and set a new past deadline. → **Expect:** it fires again exactly once (the patch resets `follow_up_notified_at`).
- [ ] _(manual, desktop)_ **Snooze-due.** Snooze a thread until a moment that passes, and let the desktop restore scheduler run. → **Expect:** the thread returns to the inbox, `is_snoozed` clears, and exactly one "snooze due" notification appears. _Snooze-due is deliberately desktop-only — the web sweep skips it so mail isn't unsnoozed without the IMAP restore._
- [ ] _(manual, desktop)_ **Convert-to-task undo.** Convert an email to a task, then Undo. → **Expect:** the task, its links, **and** the email ref all disappear (this is the `email_op_ref_remove` path; before this migration the ref was orphaned — see [`email-page-view.tsx`](../../src/features/email/ui/email-page-view.tsx) around the "not deployed yet" comment, which can now be removed).
- [ ] _(manual, ~1 min)_ **Fresh-bootstrap determinism.** `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` → **expect** no output. `bun run test -- src/lib/migration-order.test.ts` → **expect** 3 passed.

## ❗ Left deliberately undone — your call

- **The stuck "DF-2 email deep-link probe" ref in "Claude Test S2" is now removable but was NOT deleted.** It is the row OPS-1 cites as "stuck undeletable"; `email_op_ref_remove` now exists, so one RPC call clears it. I left it because deleting prod data wasn't part of applying the migrations. To clear it (soft-delete, reversible):

  ```sql
  select public.email_op_ref_remove('24dc8419-5343-4c94-94e1-8cc89ae6aa9c', 'b4138291-a045-424a-82a3-45719d705e7d');
  ```

  Run it as the workspace owner (it is `authenticated`-only, so a service-role `execute_sql` needs the JWT claim set first — see gotchas §Supabase).

## Notes for the next session

- **OPS-2 is now better-scoped by this block's findings:** the ledger was wrong in one direction (df9 listed unapplied when live) and the docs were wrong in the other (the EM-6 predicate sat undeployed ~3 weeks). Prod's `list_migrations` names are typed by hand at apply time and don't match filenames — reconcile against the **catalog**, not the migration list.
- `docs/testing/df-9-notification-generation.md:10` still reads as an open "apply this" step even though it shipped 2026-07-13; left alone as out-of-scope for OPS-1, worth sweeping in **DOC-1**.
