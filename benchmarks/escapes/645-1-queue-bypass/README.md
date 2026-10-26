# A Notes rename or move goes live past an older queued one

**Mechanism:** `queue-bypass`.

**Escaped in:** `origin/mike`; found by HV-15 variant hunt 2026-10-23 (MOD-563).
**Fix commit:** [`fd2ac715c`](https://github.com/GrochowskiMichal/Moduo/commit/fd2ac715c706763af7e76c11a8d2dcfa7ae0a7e3) (PR #645). `runMetaOp` replays the meta outbox first and, while anything still waits, queues behind it; every op runs on one chain (a newer op checks the queue only after an older live call settles), the replay re-reads until drained, and the list reload waits until the chain is idle.

**Sites fixed:**
- `apps/app/src/features/notes/sync/engine-v2.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/features/notes/sync/engine-v2.509-2.variant.test.ts` · "a rename made after an offline rename of the same note is the title that stays"  
  `bun run --cwd apps/app test src/features/notes/sync/engine-v2.509-2.variant.test.ts`
- `apps/app/src/features/notes/sync/engine-v2.509-2.variant.test.ts` · "while the network stays gone, a newer op queues behind the waiting one without a live try"  
  `bun run --cwd apps/app test src/features/notes/sync/engine-v2.509-2.variant.test.ts`
- `apps/app/src/features/notes/sync/engine-v2.509-2.variant.test.ts` · "a newer op waits for an older one still on its way, even when that one then times out"  
  `bun run --cwd apps/app test src/features/notes/sync/engine-v2.509-2.variant.test.ts`

**What a variant looks like:** A live RPC path next to a device queue for the same kind of op: does it drain or check the queue first?
