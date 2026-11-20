# A failed notes DB open reads as "nothing unsynced" to the Reset guard

**Mechanism:** `error-as-empty`.

**Escaped in:** `origin/mike`; found by HV-12 ast-grep rule sync-catch-returns-empty, 2026-10-23.
**Fix commit:** [`fd2ac715c`](https://github.com/GrochowskiMichal/Moduo/commit/fd2ac715c706763af7e76c11a8d2dcfa7ae0a7e3) (PR #645). `countPendingOutbox` returns `"unknown"` when the database or its stores can't be read (0 only when the device has no IndexedDB); Settings → Advanced blocks Reset on it.

**Sites fixed:**
- `apps/app/src/features/notes/sync/idb.ts`
- `apps/app/src/features/settings/sections/advanced-section.tsx`

**Regression test** (fails with the fix reverted):
- `apps/app/src/features/notes/sync/idb-pending.test.ts` · "is "unknown" when the notes database fails to open, so the reset stays blocked"  
  `bun run --cwd apps/app test src/features/notes/sync/idb-pending.test.ts`

**What a variant looks like:** A guard that reads a count from a store that can fail: does a failure read as 0?
