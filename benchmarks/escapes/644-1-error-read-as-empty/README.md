# Four more failed reads treated as "nothing there" (variants of 509-1)

**Mechanism:** `error-as-empty`, the same as [509-1](../509-1-error-read-as-empty/README.md). Each site dropped the `error` of a Supabase read and acted on the empty answer: filing a task in the Inbox, re-saving through the create path, seeding a default dashboard that outranked the real one, re-adding a removed Google calendar. A fifth site dropped the `error` of the `profiles` write behind a rename and reported success.

**Escaped in:** `origin/mike`; found by the HV-15 variant hunt (PR #625) and the HV-12 ast-grep pack (PR #624), 2026-10-23.
**Fix commit:** [`40468404e`](https://github.com/GrochowskiMichal/Moduo/commit/40468404ed931bcd279621d74210215273fdd5ea) (PR #644). Failed reads throw (`DbError`); the outbox retries the task writes, the calendar callers skip the pass and retry on the next load, and the dashboard shows the default as an unstamped placeholder that is never cached or pushed.

**Sites fixed:**
- `apps/app/src/lib/runtime.web.tasks.ts` (`liveBucketOrInbox`, MOD-560; the `upsertTask` existence read)
- `apps/app/src/features/dashboard/data/layout-repo.ts` (`load`, MOD-558)
- `apps/app/src/features/calendar/google-web.ts` (`tombstonedGoogleIds`, MOD-559)
- `apps/app/src/lib/runtime.web.auth.ts` (`updateDisplayName`)

**Regression tests** (fail with the fix reverted):
- `apps/app/src/lib/runtime.web.tasks.509-1.variant.test.ts` (both tests)
- `apps/app/src/features/dashboard/data/layout-repo.509-1.variant.test.ts`
- `apps/app/src/features/calendar/google-web.509-1.variant.test.ts`
- `apps/app/src/lib/runtime.web.auth.test.ts` · "reports a failed profiles write as a failed rename"

**What a variant looks like:** see 509-1. The ast-grep rule `supabase-error-swallowed` flags new ones; its baseline lists the rest.
