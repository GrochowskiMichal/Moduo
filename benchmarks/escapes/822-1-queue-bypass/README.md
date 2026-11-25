# Task writes go live past the capture, drop or check-off still waiting for the same task

**Mechanism:** `queue-bypass` (variant of seed 509-2).

**Escaped in:** `origin/mike`; found by HV-15 nightly variant hunts 2026-10-29 → 2026-11-21 (draft PRs #755, #790, #802, #809, #811, #815, #817).
**Fix commit:** [`5116bc4d9`](https://github.com/GrochowskiMichal/Moduo/commit/5116bc4d9cb7ce74febb341a477abd0a44a4793c) (PR #822). A reference card's Reopen goes through the Tasks store (`sendStatus`) instead of a bare `opSetStatus`; every task command checks `stillSaving` (a `tmp-` id or a create still in the outbox while online) and says "Still saving"; a subtask under a queued parent queues behind it; a task's drops go out in order (`chainTaskOp`); `StatusTurns` holds a status write queued while an older drop waits its turn.

**Sites fixed:**
- `apps/app/src/features/spine/references/complete-task.ts`
- `apps/app/src/features/tasks/commands/shared.ts`
- `apps/app/src/features/tasks/commands/task.ts`
- `apps/app/src/features/tasks/commands/bulk.ts`
- `apps/app/src/features/tasks/commands/bulk-write.ts`
- `apps/app/src/features/tasks/commands/queue.ts`
- `apps/app/src/features/tasks/commands/tags.ts`
- `apps/app/src/features/tasks/commands/activity.ts`
- `apps/app/src/lib/sync/status-turns.ts`
- `apps/app/src/lib/sync/store.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/features/spine/references/complete-task.reopen.test.ts` · "ticking then unticking before the server answers leaves the task To do"  
  `bun run --cwd apps/app test src/features/spine/references/complete-task.reopen.test.ts`
- `apps/app/src/features/tasks/commands/task.509-2.test.ts` · "renaming a task whose capture is still flushing never reaches the server ahead of it"  
  `bun run --cwd apps/app test src/features/tasks/commands/task.509-2.test.ts`
- `apps/app/src/features/tasks/commands/task-reorder.509-2.test.ts` · "a reorder made while the card's drop into In progress waits its turn keeps its new place"  
  `bun run --cwd apps/app test src/features/tasks/commands/task-reorder.509-2.test.ts`

**What a variant looks like:** A command that writes one task live: does it check the outbox and the task's other writes still on their way, or only for a `tmp-` id?
