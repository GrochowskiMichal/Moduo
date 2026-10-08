# Manual test checklist — zod-enum-wave2

> Generated 2026-08-17 · updated 2026-08-30 · branch `t/mike/zod-enum-wave2` · **Live-verified:** ZE-11 deploy done — Postgres CHECKs re-probed; eight functions redeployed with Zod parsers (`verify_jwt=false`). Authenticated checkout/MCP write probes still need your account / a workspace API key.

## Contracts / vocabularies
- [ ] **Do:** Open Settings → billing on a Pro account → **Expect:** the UI still shows Pro _(web)_
- [ ] **Do:** Open billing on a Founder account → **Expect:** the UI still shows Founder (canonical `founder`, not `founders`) _(web)_
- [ ] **Do:** Change appearance theme/font and reload → **Expect:** prefs round-trip; a garbage `moduo.appearance` JSON falls back to defaults without a white screen _(web)_

## Runtime lists
- [ ] **Do:** Open Tasks, Contacts, Calendar, Notes in a normal workspace → **Expect:** existing rows still load; no empty-module regression _(web)_
- [ ] **Do:** Create a task, then complete it → **Expect:** status change still succeeds (mutation path still talks to the same RPCs) _(web)_

## Public / join
- [ ] **Do:** Visit `/join` with no `?invite=` → **Expect:** no privileged join call; sign-in / empty-token copy _(web)_
- [ ] **Do:** Visit `/p/<garbage>` → **Expect:** not-found, not an app crash _(web)_

## Imports / forms
- [ ] **Do:** Open New contact with a blank name → **Expect:** Add stays disabled; valid name still creates _(web)_
- [ ] **Do:** CSV import preview with a nameless row → **Expect:** still classified as error, not submitted _(web)_

## Migrations / data
- [x] **Do:** Confirm prod constraints `workspace_members_role_contract` and `email_accounts_provider_contract` exist → **Expect:** present (re-probed 2026-08-30 with the rest of `*_contract`) _(hosted)_

## Edge Functions
- [x] **Do:** POST `founders-apply` with `email: "not-an-email"` → **Expect:** 400 `{ error: "A valid email is required" }` _(hosted, 2026-08-30)_
- [x] **Do:** GET `notes-public` with no/garbage token → **Expect:** 404 `{ error: "not_found" }` _(hosted, 2026-08-30)_
- [x] **Do:** GET `notes-public` with a live publish token → **Expect:** 200 `{ rootId, notes }` _(hosted, 2026-08-30)_
- [x] **Do:** POST checkout / portal / MCP / coupon / manage-integration without the right credential → **Expect:** each function's own 401/403, not a gateway crash _(hosted, 2026-08-30)_
- [ ] **Do:** After signing in, POST checkout with `plan: 1` → **Expect:** 400 `Invalid request`, no Stripe session _(hosted)_
- [ ] **Do:** Call `moduo-mcp` `tasks_set_status` with `status: "nope"` using a real workspace API key → **Expect:** isError text, no DB write _(hosted)_

## Known gaps / not-yet-testable
- Authenticated checkout 400 and MCP invalid-enum write still need your signed-in account / a workspace API key. I did not create keys or submit a real founders email.
- `createClient<Database>` was not applied — generated types remain compile-time only; runtime trust is Zod at mappers.
- Authenticated invalid-enum write probes against live RPCs were not re-run this session (CHECKs already reject them in Postgres).
- Desktop CalDAV discover parse is unit-untested against a live server.

---
*Convention defined in AGENTS.md session wrap-up.*
