# A due-date edit leaves the derived `dueOn` stale

**Mechanism:** `derived-field-drift`. A partial patch changes a source field (`dueDate`) but not the field derived from it (`dueOn`), so readers of the derived field show the old value; readers that fall back used the UTC day (`.slice(0, 10)`) instead of the local day.

**Escaped in:** `origin/mike` before PR #509; found by the manual audit of 2026-10-20.
**Fix commit:** [`9a4590545`](https://github.com/GrochowskiMichal/Moduo/commit/9a45905456d59aab9ea8535b25c284bcd2c901ff) (PR #509). `withDueOn` derives `dueOn` on every patch that sets `dueDate` (used by `patchTask` and bulk ops); exports and the client rollup read the local day.

**Sites fixed:**
- `apps/app/src/lib/task-rows.ts`
- `apps/app/src/features/tasks/write-plan.ts` (bulk ops; was `hooks/use-bulk-ops.ts` in the fix commit)
- `apps/app/src/features/tasks/project-overview.ts`
- `apps/app/src/features/tasks/list-export.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/features/tasks/due-on.test.ts` · "a single due-date edit carries the local day"  
  `bun run --cwd apps/app test src/features/tasks/due-on.test.ts`
- `apps/app/src/features/tasks/due-on.test.ts` · "a task without dueOn exports its due date's local day"  
  `bun run --cwd apps/app test src/features/tasks/due-on.test.ts`

**What a variant looks like:** Pairs of stored fields where one is computed from the other (dates and their day, status and statusCategory, title and search text, counts and lists): every writer that patches one must patch both. Also `toISOString().slice(0, 10)` used as a local day.
