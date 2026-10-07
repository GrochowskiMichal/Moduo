# Manual test checklist — retire `founders-apply`

> Generated 2026-10-07 · branch `t/maciej/retire-founders-apply` · **Live-verified:** partial. The prod grant change was applied and checked in the catalog. The undeploy is still to do: there's no Supabase CLI on Maciej's Mac, and the Supabase connector can't delete functions.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Undeploy `founders-apply` (someone with deploy rights)
- [ ] **Do:** Supabase dashboard → Edge Functions → `founders-apply` → Delete (or `supabase functions delete founders-apply --project-ref wtoonrvuqumihpkbvwvs`) → **Expect:** it's gone from the functions list _(Supabase)_
- [ ] **Do:** `curl -i https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/founders-apply` → **Expect:** `404 {"code":"NOT_FOUND",...}` from the gateway. Before the delete it returned `405 Method not allowed` from the function _(terminal)_
- [ ] **Do:** Dashboard → Edge Functions → Secrets → delete `FOUNDERS_NOTIFY_EMAIL` if it's there → **Expect:** gone. No other function reads it _(Supabase)_

## Still in place
- [ ] **Do:** `curl -i https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/issue-founder-coupon` (no key) → **Expect:** `403 Forbidden`. Kept on purpose, admin-only _(terminal)_

## Migrations / data
- [x] **Do:** in the catalog, `has_table_privilege('anon' | 'authenticated', 'public.founders_interest', 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE')` → **Expect:** all false; `service_role` all true; RLS still on; 0 rows _(prod, checked 2026-10-07 after applying `20261007000830`)_

## Known gaps / not-yet-testable
- The undeploy above. Until then the endpoint stays live, but it can't save anything or send email: it writes two columns the table doesn't have.
- Callers were checked only in the last 24 h of logs (none apart from the probe). If an old `moduo_landing` deployment still posts to it now and then, that form gets a 404 instead of a 500 after the delete. It's broken either way.
- `issue-founder-coupon` was kept. Before anyone issues a code, add the email and code it stores (in `founders_interest` and the Stripe coupon metadata) to the privacy policy.
