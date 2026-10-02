# Manual test checklist — Supabase API-key migration

> Generated 2026-08-14 · branch `t/mike/supabase-api-key-migration` · **Live-verified:** partial — all 13 functions are deployed with `verify_jwt=false`; unauthenticated handler responses were verified, while authenticated billing/MCP flows still need a real account/key pass.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Key configuration
- [ ] **Do:** Create the default `sb_secret_...` key in Supabase Settings → API Keys → **Expect:** the project exposes the new secret key while legacy keys remain active _(dashboard)_
- [ ] **Do:** Deploy one strict canary function and invoke it → **Expect:** `SUPABASE_SECRET_KEYS.default` resolves and the function does not return a configuration error _(Supabase)_
- [ ] **Do:** Build web and desktop with `PUBLIC_SUPABASE_PUBLISHABLE_KEY` → **Expect:** login, session refresh, REST reads, and realtime initialize without a legacy-key variable _(web / desktop)_

## Authentication and billing
- [ ] **Do:** Sign in with a pending `price_id` → **Expect:** the checkout redirect contains an encoded `access_token` and reaches checkout after the remaining function deploy _(web)_
- [ ] **Do:** Complete onboarding after selecting a paid plan → **Expect:** the same checkout redirect path succeeds _(web / desktop)_
- [ ] **Do:** Call `start-trial`, `create-portal-session`, `sync-subscription`, and `delete-account` with a valid user JWT → **Expect:** in-code `auth.getUser` authorization succeeds after `verify_jwt=false` deployment _(web / desktop)_
- [ ] **Do:** Call those functions without a user JWT → **Expect:** each returns 401 from its own handler, not a successful operation _(web / desktop)_

## Webhooks and public endpoints
- [ ] **Do:** Send a valid Stripe-signed event to `stripe-webhook` and `trial-extension` → **Expect:** the event is accepted and processed _(Stripe / Supabase)_
- [ ] **Do:** Send a request without `stripe-signature` → **Expect:** each webhook returns its handler-level 400 _(Supabase)_
- [ ] **Do:** Submit the founders form and an OPTIONS preflight → **Expect:** the form validates/records and preflight returns 200 without a Supabase bearer key _(web / Supabase)_
- [ ] **Do:** Open a published note by token → **Expect:** the public note loads without a Supabase Authorization bearer key _(web)_

## Agent and admin access
- [ ] **Do:** Call `moduo-mcp` with a valid `moduo_sk_...` key → **Expect:** workspace-scoped tools work and mutations retain `x-moduo-key-id` attribution _(MCP)_
- [ ] **Do:** Call `issue-founder-coupon` with the default secret in `apikey` → **Expect:** the request is authorized; the same secret in `Authorization: Bearer` is rejected _(admin)_

## Legacy-key removal
- [ ] **Do:** Smoke-test login, checkout, trial, public notes, MCP, web, and desktop with only new keys active → **Expect:** all listed flows pass _(web / desktop / Supabase)_
- [ ] **Do:** Deactivate legacy anon and service-role keys only after the smoke test → **Expect:** no client, function, or external dashboard reports a legacy-key failure _(Supabase)_

## Known gaps / not-yet-testable
- Authenticated billing and MCP success paths still need a real hosted test account and workspace API key.
- The external team dashboard caller for `issue-founder-coupon` must be updated to send `apikey` before using the admin flow.
- `WORKSPACE_INVITE_WEBHOOK_SECRET` must be configured before `send-workspace-invite` can process events; until then it fails closed with 503.
