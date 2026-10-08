# Manual test checklist — retire `founders-apply`

> Generated 2026-10-07 · branches `t/maciej/retire-founders-apply` and `t/maciej/founders-apply-undeployed` · **Live-verified:** yes. The grant change was applied and checked in the catalog, and the function was deleted with the Supabase CLI and probed afterwards.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Undeploy `founders-apply`
- [x] **Do:** `supabase functions delete founders-apply --project-ref wtoonrvuqumihpkbvwvs` → **Expect:** "Deleted Edge Function."; it's gone from `supabase functions list` _(done 2026-10-07)_
- [x] **Do:** `curl -i https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/founders-apply` → **Expect:** `404 {"code":"NOT_FOUND",...}` from the gateway. Before the delete it returned `405 Method not allowed` from the function _(terminal; checked 2026-10-07: 404)_
- [x] **Do:** `supabase secrets list --project-ref wtoonrvuqumihpkbvwvs` → **Expect:** no `FOUNDERS_NOTIFY_EMAIL`. It isn't set, so there was nothing to remove _(checked 2026-10-07)_

## Still in place
- [x] **Do:** `curl -i https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/issue-founder-coupon` (no key) → **Expect:** `403 Forbidden`. Kept on purpose, admin-only _(terminal; checked 2026-10-07: 403)_

## Migrations / data
- [x] **Do:** in the catalog, `has_table_privilege('anon' | 'authenticated', 'public.founders_interest', 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE')` → **Expect:** all false; `service_role` all true; RLS still on; 0 rows _(prod, checked 2026-10-07 after applying `20261007000830`)_

## Known gaps / not-yet-testable
- Callers were checked only in the last 24 h of logs before the delete (only our own GET probes). If an old `moduo_landing` deployment still posts to it now and then, that form now gets a 404 instead of the 500 it always got.
- `issue-founder-coupon` was kept. Before anyone issues a code, add the email and code it stores (in `founders_interest` and the Stripe coupon metadata) to the privacy policy.
- `STRIPE_COUPON_FOUNDERS` is still set in prod, though no function reads it. Remove it only with Maciej's OK.
