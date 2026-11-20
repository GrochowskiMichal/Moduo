# A live write jumps an older queued write for the same task

**Mechanism:** `queue-bypass`. A write sent straight to the server while an older write for the same entity still waits in (or is being flushed from) the outbox lands first; the older write then lands last and wins, undoing the person's newer change.

**Escaped in:** `origin/mike` before PR #509; found by the manual audit of 2026-10-20.
**Fix commit:** [`9a4590545`](https://github.com/GrochowskiMichal/Moduo/commit/9a45905456d59aab9ea8535b25c284bcd2c901ff) (PR #509). Any check-off for a task that still has outbox entries, including the one being flushed, goes through the outbox (`hasOutboxEntries`).

**Sites fixed:**
- `apps/app/src/lib/sync/store.ts`
- `apps/app/src/features/tasks/hooks/use-tasks-module.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/lib/sync/store.test.ts` · "a check-off made while an older one for the same task is flushing waits behind it"  
  `bun run --cwd apps/app test src/lib/sync/store.test.ts`

**What a variant looks like:** Every fast path that calls the server directly when online (`send*`, `op*`) next to a queue for the same entity: does it check the queue (including the entry in flight) first?
