# A bulk status change or Board drop overtakes an older queued check-off

**Mechanism:** `queue-bypass`. `bulkWrite` and `saveTaskWrite` (via `dropTask`) called `opSetStatus` directly, without checking the outbox, so an older offline check-off still sending landed last.

**Escaped in:** `origin/mike` before PR #642; found by the HV-15 variant hunt of 509-2 (PR #625). Moduo MOD-561.
**Fix commit:** [`a1623827b`](https://github.com/GrochowskiMichal/Moduo/commit/a1623827b19c1f909ffb1e44343c9e5a39d5bc97) (PR #642). The bulk status part queues behind it (`statusMustWait` → `enqueue`, with its position); a drop waits its turn (`sendStatusInTurn`), since its Undo needs the server's row.

**Sites fixed:**
- `apps/app/src/features/tasks/commands/bulk-write.ts`
- `apps/app/src/features/tasks/commands/task.ts`

**Regression tests** (fail with the fix reverted):
- `apps/app/src/features/tasks/commands/bulk-write.509-2.variant.test.ts` · "a bulk 'To do' on a task whose check-off is still flushing stays To do"  
  `bun run --cwd apps/app test src/features/tasks/commands/bulk-write.509-2.variant.test.ts`
- `apps/app/src/features/tasks/commands/bulk-write.509-2.variant.test.ts` · "a board drop into To do on a task whose check-off is still flushing stays To do"  
  `bun run --cwd apps/app test src/features/tasks/commands/bulk-write.509-2.variant.test.ts`

**What a variant looks like:** Every `opSetStatus` caller outside the store: does it go through `statusMustWait` / `sendingStatus`?
