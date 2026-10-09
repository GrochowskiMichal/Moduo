# Manual test checklist — PRIV-2b: wire the erasure into delete-account, wipe our Stripe copy, in-app copy

> Generated 2026-10-08 · branch `t/maciej/priv-2b-wire-delete-account` (stacked on PRIV-2a, GrochowskiMichal/Moduo#251) · spec [specs/privacy-account-erasure.md](../../specs/privacy-account-erasure.md) block 2 · **Live-verified:** partly. `/auth?deleted=1` was checked in a local build: the notice shows above the sign-in card, and a plain `/auth` shows none. Nothing is on production yet; §1 needs the designer's OK. **Verified locally:**
> - **Unit tests:**
>   - `account-erasure`: step order; delete mode; a dry run before anything irreversible; the customers the Stripe step deleted handed to the wipe; failures and retries; refusing a preview answer; a warning without a Stripe copy.
>   - `delete-account`: the exact Danger zone sentence and notice; sign-out only after landing on the sign-in page.
>   - `auth-page`: the notice only for a deletion this tab marked, shown once; no bounce while still signed in.
>   - `use-unknown-route-redirect`: with the real router, the Danger zone reaches `/auth?deleted=1`. This test fails without the guard fix.
> - **SQL probe for AC7**, where every deliberate break of the wipe makes it fail:
>   - the wipe itself, and a preview that changes nothing;
>   - a stub for a customer our copy doesn't have yet, and none under a guessed account;
>   - cards detached before the deletion;
>   - late webhooks, someone else's customer, and retries.
> - **Gates:** `bun run typecheck`, `lint:tw`, `lint:css` and every test pass. Biome finds nothing in the changed files.
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
- [x] **Do:** `bunx rstest run supabase/functions/_shared/account-erasure.test.ts src/routes/pages/auth-page.test.tsx src/features/settings/delete-account.test.ts src/components/app/use-unknown-route-redirect.test.tsx` → **Expect:** all pass.

## 1. Production (designer's OK first; in this order)
- [x] **Do:** make sure PRIV-2a's follow-up `20261008040000_account_erasure_private_shortcut.sql` is applied. delete-account now dry-runs `account_erase_workspace_data` on every deletion, so it should be fast. Then apply `20261008050000_account_scrub_stripe_mirror.sql` the same way: one transaction with its `supabase_migrations.schema_migrations` row (version `20261008050000`, name `account_scrub_stripe_mirror`). → **Expect:** no error; both rows are there. **2026-10-08:** both applied, in that order, rows present.
- [~] **Do:** check `account_scrub_stripe_mirror(uuid, boolean, text[])`. **2026-10-08:** security definer, service role only, and a preview for an unknown user answers `stripe_mirror: true` with zero counts; the preview of a real account is still open.
  - `prosecdef` is true. `has_function_privilege` is false for anon and authenticated, and true for service_role.
  - Preview an account that has a Stripe customer: `select public.account_scrub_stripe_mirror('<user id>');`
  - → **Expect:** `"preview": true` with that account's customer and card counts; nothing changes.
- [x] **Do:** deploy `delete-account` (verify_jwt off, as before; v17, since PRIV-3 shipped v16). Probe it without signing in. → **Expect:** POST without a token answers 401, GET answers 405. **2026-10-08:** v17 live; 401 and 405.
- [ ] **AC17, designer, Stripe dashboard:** delete the two customers whose accounts are already gone (`cus_UVK1VVxLZNlTGj`, `cus_VO9nnGZB29QU0H`): Customers → the customer → Delete. Delete at Stripe first: wiping our copy before would let the deletion's own webhook write the profile back.
- [ ] **Do (after the Stripe delete):**
  - Find the old user ids: `select id, _raw_data -> 'metadata' ->> 'supabase_user_id' from stripe.customers where id in ('cus_UVK1VVxLZNlTGj', 'cus_VO9nnGZB29QU0H');`
  - Wipe each: `select public.account_scrub_stripe_mirror('<old user id>', false, array['<its customer id>']);`
  - → **Expect:** `customers_wiped: 1` each. Both rows' `email`, `name` and `address` read NULL, and `deleted` is true.

## 2. In the app, after §1 (a throwaway account; designer)
- [ ] **Do:** Settings → Account → Danger zone. → **Expect:** "Permanently delete your account and your personal data. This also cancels your Moduo plan. Things you shared with others stay with them, without your name. This can't be undone."
- [ ] **Do:** with a throwaway account, put a private note and a note shared with a teammate in that teammate's workspace. Then delete the account. → **Expect:**
  - You land on the sign-in page with "Your account and your data were deleted." Reloading the page makes it go away.
  - The teammate still sees the shared note, now owned by them or the workspace owner, and no longer sees the private note.
  - Any Stripe customer of the throwaway account is deleted at Stripe and reads `deleted = true`, `email` NULL in `stripe.customers`.
