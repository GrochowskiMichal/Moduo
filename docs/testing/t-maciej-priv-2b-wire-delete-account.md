# Manual test checklist — PRIV-2b: wire the erasure into delete-account, wipe our Stripe copy, in-app copy

> Generated 2026-10-08 · branch `t/maciej/priv-2b-wire-delete-account` (stacked on PRIV-2a, GrochowskiMichal/Moduo#251) · spec [specs/privacy-account-erasure.md](../../specs/privacy-account-erasure.md) block 2 · **Live-verified:** partly. `/auth?deleted=1` was checked in a local build: the notice shows above the sign-in card, and a plain `/auth` shows none. Nothing is on production yet; §1 needs the designer's OK. **Verified locally:**
> - Unit tests: `account-erasure` (step order, delete mode, a dry run before anything irreversible, failures and retries, refusing a preview answer), `delete-account` (the exact Danger zone sentence and notice; sign-out only after landing on the sign-in page) and `auth-page` (the notice with and without the flag; no bounce while still signed in).
> - The SQL probe for AC7. Each of 7 deliberate breaks of the wipe makes it fail.
> - `bun run typecheck`, `lint:tw`, `lint:css` and every test pass. Biome finds nothing in the changed files.
> Run top to bottom and tick as you go. Each item is a step → what you should see → where.

## 0. Local (any time, no production)
- [x] **Do:** run the SQL probe on a throwaway Postgres 17:
  ```bash
  createdb -h /tmp -p 54329 -U postgres erasure_probe
  psql -h /tmp -p 54329 -U postgres -d erasure_probe -v ON_ERROR_STOP=1 -q \
    -f supabase/probes/account-erasure.stub.sql \
    -f supabase/migrations/20261008013000_account_erase_workspace_data.sql \
    -f supabase/migrations/20261008040000_account_erasure_private_shortcut.sql \
    -f supabase/migrations/20261008050000_account_scrub_stripe_mirror.sql \
    -f supabase/probes/account-erasure.probe.sql
  ```
  → **Expect:** two `PASS AC7` lines after PRIV-2a's, then `PASS: all`. **2026-10-08:** all pass.
- [x] **Do:** `bunx rstest run supabase/functions/_shared/account-erasure.test.ts src/routes/pages/auth-page.test.tsx src/features/settings/delete-account.test.ts` → **Expect:** all pass (54 on 2026-10-08).

## 1. Production (designer's OK first; in this order)
- [ ] **Do:** apply `20261008050000_account_scrub_stripe_mirror.sql` in one transaction with its `supabase_migrations.schema_migrations` row (version `20261008050000`, name `account_scrub_stripe_mirror`). PRIV-2a's `account_erase_workspace_data` is already there. → **Expect:** no error; the row is there.
- [ ] **Do:** check the function: `prosecdef` true; `has_function_privilege` false for anon and authenticated, true for service_role. Then preview an account that has a Stripe customer: `select public.account_scrub_stripe_mirror('<user id>');` → **Expect:** `"preview": true` with that account's customer count; nothing changes.
- [ ] **Do:** deploy `delete-account` (verify_jwt off, as before). Probe it without signing in. → **Expect:** POST without a token answers 401, GET answers 405. The deployed code dry-runs both SQL functions before PostHog or Stripe. Without the PostHog secrets, the PostHog step only warns (PRIV-3).
- [ ] **AC17, designer, Stripe dashboard:** delete the two customers whose accounts are already gone (`cus_UVK1VVxLZNlTGj`, `cus_VO9nnGZB29QU0H`: Customers → the customer → Delete). Delete at Stripe first: wiping our copy before would let the deletion's own webhook write the profile back.
- [ ] **Do (after the Stripe delete):** find the old user ids: `select id, _raw_data -> 'metadata' ->> 'supabase_user_id' from stripe.customers where id in ('cus_UVK1VVxLZNlTGj', 'cus_VO9nnGZB29QU0H');`. Then wipe each: `select public.account_scrub_stripe_mirror('<old user id>', false);` → **Expect:** `customers_wiped: 1` each. Both rows' `email`, `name` and `address` read NULL and `deleted` is true.

## 2. In the app, after §1 (a throwaway account; designer)
- [ ] **Do:** Settings → Account → Danger zone. → **Expect:** "Permanently delete your account and your personal data. This also cancels your Moduo plan. Things you shared with others stay with them, without your name. This can't be undone."
- [ ] **Do:** with a throwaway account, put a private note and a note shared with a teammate in that teammate's workspace. Then delete the account. → **Expect:**
  - You land on the sign-in page with "Your account and your data were deleted."
  - The teammate still sees the shared note, now owned by them or the workspace owner, and no longer sees the private note.
  - Any Stripe customer of the throwaway account is deleted at Stripe and reads `deleted = true`, `email` NULL in `stripe.customers`.
