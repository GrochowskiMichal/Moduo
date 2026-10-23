# Sign-out wipes writes that never synced

**Mechanism:** `teardown-drops-pending`. A teardown path (SIGNED_OUT, another person signing in, cache reset) clears the device copy wholesale, including the outbox of writes captured offline, so they are lost silently.

**Escaped in:** `origin/mike` before PR #509; found by the manual audit of 2026-10-20.
**Fix commit:** [`9a4590545`](https://github.com/GrochowskiMichal/Moduo/commit/9a45905456d59aab9ea8535b25c284bcd2c901ff) (PR #509). Sign-out and a different sign-in cut each copy down to its outbox (still keyed by the person) and drop all rows; the outbox goes out when that person signs back in. Account deletion still wipes everything; Log out warns about unsynced changes.

**Sites fixed:**
- `apps/app/src/providers/auth-provider.tsx`
- `apps/app/src/lib/sync/store.ts`
- `apps/app/src/lib/sync/cache.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/lib/sync/store.test.ts` · "sign-out keeps what waits to sync (rows go) and sends it when that person signs back in"  
  `bun run --cwd apps/app test src/lib/sync/store.test.ts`

**What a variant looks like:** Every `clear()`, `wipe*`, `reset*`, `localStorage.removeItem`, IndexedDB delete and redb `wipe_all` reached from sign-out, user switch or workspace change: does any of them hold writes that have not reached the server?
