# A write on its way when its store stops is lost when it then fails

**Mechanism:** `disposed-sink`. A live check-off or capture still on its way at sign-out (or a null session) whose request then failed on the network was enqueued into the disposed store's outbox, which nobody persists.

**Escaped in:** `origin/mike` before PR #642; found by the HV-17 outbox property harness (PR #626). Moduo MOD-569.
**Fix commit:** [`a1623827b`](https://github.com/GrochowskiMichal/Moduo/commit/a1623827b19c1f909ffb1e44343c9e5a39d5bc97) (PR #642). `enqueue` on a disposed store hands the entry to the person's running store, else into their device copy, in front of newer entries for its task; account deletion drops it.

**Sites fixed:**
- `apps/app/src/lib/sync/store.ts`
- `apps/app/src/lib/sync/cache.ts`

**Regression tests** (fail with the fix reverted):
- `apps/app/src/lib/sync/store.order.test.ts` · "MOD-569: a check-off on its way at sign-out that then fails is kept for the person, and sent when they're back"  
  `bun run --cwd apps/app test src/lib/sync/store.order.test.ts`
- `apps/app/src/lib/sync/store.order.test.ts` · "MOD-569: one that fails after the person is back joins the new store in front of their newer check-off"  
  `bun run --cwd apps/app test src/lib/sync/store.order.test.ts`

**What a variant looks like:** Any async fallback (catch → queue/save) that can run after its owner was disposed.
