# Days read in UTC instead of the person's clock: a repeat's end, due chips, Mail Today, touches and edits

**Mechanism:** `stale-derived-field` (variant of seed 509-4).

**Escaped in:** `origin/mike`; found by HV-15 nightly variant hunts 2026-11-06 and 2026-11-18 (draft PRs #794, #816) and the parked 509-4 proofs.
**Fix commit:** [`965d608ce`](https://github.com/GrochowskiMichal/Moduo/commit/965d608ce9a6002898f89e757d619ba7c7253269) (PR #822). A repeat's UNTIL is the person's wall clock in the app engine, the SQL `tasks__rrule_floating` (migration 20261122120000) and the connector, which converts an agent's UTC UNTIL; `localDayOf` keeps a bare day as written; `taskDueDay` reads `dueOn`, else the local day of `dueDate`; `makeTask` sets `dueOn`.

**Sites fixed:**
- `apps/app/src/features/tasks/recurrence-engine.ts`
- `apps/app/src/features/tasks/repeat.ts`
- `apps/app/src/lib/task-rows.ts`
- `apps/app/src/features/calendar/lens.ts`
- `apps/app/src/features/contacts/rollup.ts`
- `apps/app/src/features/spine/snippet-format.ts`
- `apps/app/src/features/tasks/helpers.ts`
- `supabase/migrations/20261122120000_tasks_rrule_until_wall_clock.sql`
- `supabase/functions/moduo-mcp/tasks-helpers.ts`
- `supabase/functions/moduo-mcp/recurrence.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/features/tasks/repeat.509-4.test.ts` · "Los Angeles: a 6 PM daily repeat 'until Dec 15' still comes on Dec 15"  
  `bun run --cwd apps/app test src/features/tasks/repeat.509-4.test.ts`
- `apps/app/src/features/calendar/lens.509-4.test.ts` · "a task captured offline with a due date shows as a due chip on that day"  
  `bun run --cwd apps/app test src/features/calendar/lens.509-4.test.ts`

**What a variant looks like:** `iso.slice(0, 10)`, `new Date("YYYY-MM-DD")` or a `…Z` suffix on a local value: is a day computed in UTC where the person means their own clock?
