# A task's status write overtakes an older one still on its way live

**Mechanism:** `queue-bypass`. A status write for a task went live (or the flush sent a queued one) while an older status write for it was still unanswered, or the older one failed on the network and was queued behind it. The server applies arrival order, so the older status won.

**Escaped in:** `origin/mike` before PR #642; found by the HV-17 outbox property harness (PR #626). Moduo MOD-587.
**Fix commit:** [`a1623827b`](https://github.com/GrochowskiMichal/Moduo/commit/a1623827b19c1f909ffb1e44343c9e5a39d5bc97) (PR #642). Status writes wait while anything for the task is queued **or** an older one is live (per person, workspace and task, across stores); the flush waits for the live one; a failed live write goes back in front of newer entries.

**Sites fixed:**
- `apps/app/src/lib/sync/store.ts`
- `apps/app/src/lib/sync/status-order.ts`
- `apps/app/src/features/tasks/commands/shared.ts`

**Regression tests** (fail with the fix reverted):
- `apps/app/src/lib/sync/store.order.test.ts` · "MOD-587: a second check-off waits for a live one still on its way"  
  `bun run --cwd apps/app test src/lib/sync/store.order.test.ts`
- `apps/app/src/lib/sync/store.order.test.ts` · "MOD-587: a live check-off that fails on the network goes back in front of the newer one"  
  `bun run --cwd apps/app test src/lib/sync/store.order.test.ts`

**What a variant looks like:** Any second write path for one entity that checks only the queue, not a request still in flight.
