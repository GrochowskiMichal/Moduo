# A Notes op or edit that lands after the engine stopped is dropped; Duplicate and the legacy import read too early

**Mechanism:** `late-write-to-disposed-store` (variant of seed 569).

**Escaped in:** `origin/mike`; found by HV-15 nightly variant hunts 2026-10-28 → 2026-11-21 (draft PRs #694, #756, #773, #805, #821) and the fix session.
**Fix commit:** [`c5a5b111f`](https://github.com/GrochowskiMichal/Moduo/commit/c5a5b111f3cd4879ce082f9ed9cbd2a79d7425a9) (PR #822). `enqueueMetaOp` / `enqueueDocUpdate` keep a late op or edit for its person unless the account was erased (`ownerErased`); the person's running engine replays it in order (`MetaOpChain`), dropping one a newer op of the same fact already superseded; Duplicate waits on the chain and the source's unsent edits (`runAfterQueued`); a failed legacy doc read defers that note and its sub-pages instead of importing it empty.

**Sites fixed:**
- `apps/app/src/features/notes/sync/idb.ts`
- `apps/app/src/features/notes/sync/meta-chain.ts`
- `apps/app/src/features/notes/sync/engine-v2.ts`
- `apps/app/src/features/notes/sync/people.ts`
- `apps/app/src/features/notes/sync/redb-import.ts`
- `apps/app/src/features/notes/hooks/use-notes-module.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/features/notes/sync/engine-v2.569.test.ts` · "the rename waits on the device for the person, as a check-off does"  
  `bun run --cwd apps/app test src/features/notes/sync/engine-v2.569.test.ts`
- `apps/app/src/features/notes/hooks/use-notes-module.645-1.test.ts` · "a note renamed offline, then duplicated once back online, is copied with its new title"  
  `bun run --cwd apps/app test src/features/notes/hooks/use-notes-module.645-1.test.ts`
- `apps/app/src/features/notes/sync/redb-import.644-1.test.ts` · "never imports a note without its body because its doc read failed"  
  `bun run --cwd apps/app test src/features/notes/sync/redb-import.644-1.test.ts`

**What a variant looks like:** A write path gated on "is the owner live?": what happens to a write that arrives just after sign-out, and to a copy made while the source still has unsent changes?
