# Manual test checklist — t/mike/api-key-expiry (KEY-EXP-1)

> Generated 2026-10-09 · branch `t/mike/api-key-expiry` · **Live-verified:** partial. On prod, via SQL and HTTP: the column, constraint and grants; create with/without expiry and the 1–730 range (rolled back); an expired key gets 401 and a valid one 200 from the redeployed `moduo-mcp`. The Settings screen was verified by its component tests, not clicked through in the app.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Settings → API keys
- [ ] **Do:** open Settings → API keys → New key → **Expect:** an "Expires after" picker with Never / 30 days / 90 days / 1 year, set to 90 days _(web / desktop)_
- [ ] **Do:** create a key with the default → **Expect:** the new row shows "Expires <date ~90 days ahead>"; the picker is back on 90 days for the next key _(both)_
- [ ] **Do:** create a key with "Never" → **Expect:** its row shows no expiry line _(both)_
- [ ] **Do:** look at an old key (made before this change) → **Expect:** no expiry line; "Never used in N days" or "Unused for N days" with a revoke hint if it's 60+ days idle _(both)_

## Expired and expiring keys
- [ ] **Do:** in the Supabase SQL editor set a test key's `expires_at` to 3 days ahead (`update workspace_api_keys set expires_at = now() + interval '3 days' where id = '<id>'`) → **Expect:** the row says "Expires in 3 days" in the warning colour _(both)_
- [ ] **Do:** set its `expires_at` to a past time that's after its `created_at` → **Expect:** "Expired <date>. It no longer connects. Revoke it to clear it."; the "Edit access" button is greyed out; Revoke still works _(both)_
- [ ] **Do:** call the connector with that expired key (an MCP client, or `curl -X POST <endpoint> -H "Authorization: Bearer <key>" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`) → **Expect:** HTTP 401 "Missing, invalid, revoked or expired API key" _(connector)_

## Edge cases
- [ ] **Do:** Settings → Integrations with a workspace whose only key is expired → **Expect:** it does not count as an active key / connected _(both)_
- [ ] **Do:** create 20 live keys, expire one → **Expect:** a new key can be created again (expired keys don't count toward the 20) _(web)_
- [ ] **Do:** call `workspace_api_keys_create` with `p_expires_in_days` 0 or 731 → **Expect:** "A key can last 1–730 days, or never expire." _(SQL)_
- [ ] **Do:** call `workspace_api_keys_set_scopes` on an expired key → **Expect:** "This key has expired — create a new one instead." _(SQL)_

## Migrations / data
- [ ] **Do:** `select column_name from information_schema.columns where table_name='workspace_api_keys' and column_name='expires_at'` → **Expect:** one row; existing keys have it null _(prod)_
- [ ] **Do:** `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname='workspace_api_keys_create'` → **Expect:** one row, with `p_expires_in_days integer` _(prod)_

## Known gaps / not-yet-testable
- The Settings screen has not been clicked through in the running app, only covered by component tests.
- Two probe keys named `probe-expired` and `probe-valid` (prefixes `moduo_sk_probe0` / `moduo_sk_probe1`) were left on prod: deleting them was declined. Delete them: `delete from workspace_api_keys where name in ('probe-expired','probe-valid');`. Nobody holds their secrets, and `probe-valid` expires on its own on 2026-10-10.
- Prod's migration history lists only the second migration; the first was pasted into the SQL editor.
- `/code-review ultra` wasn't run (cloud-only here); a local max-effort review and the Claude Security scan stood in for it.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
