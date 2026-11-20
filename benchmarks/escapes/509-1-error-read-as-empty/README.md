# A failed cloud read is treated as "no row"

**Mechanism:** `error-as-empty`. A read that fails (network, 5xx, RLS hiccup) returns the same value as a read that found nothing, so the caller takes the "nothing there yet" branch: it seeds defaults and pushes them over the account's real data.

**Escaped in:** `origin/mike` before PR #509; found by the manual audit of 2026-10-20.
**Fix commit:** [`9a4590545`](https://github.com/GrochowskiMichal/Moduo/commit/9a45905456d59aab9ea8535b25c284bcd2c901ff) (PR #509). `getCloudPrefs` returns a tagged `{kind: row | none | error}`; on `error` reconcile applies nothing, pushes nothing and leaves the domain unread, and `useDomainSync` retries with backoff.

**Sites fixed:**
- `apps/app/src/lib/prefs-sync.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/lib/prefs-sync.test.ts` · "a failed cloud read applies and pushes nothing (it is not 'no row')"  
  `bun run --cwd apps/app test src/lib/prefs-sync.test.ts`

**What a variant looks like:** Any `catch` that returns `null`, `[]`, `{}` or a default; any `?? []` / `|| {}` on a fetch result; `data ?? null` that drops `error` from a Supabase `{data, error}`; then a later write that trusts the empty value.
