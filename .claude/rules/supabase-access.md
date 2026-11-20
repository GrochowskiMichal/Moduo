---
paths: ["supabase/migrations/**", "supabase/tests/**"]
incident: "Definer functions and service-role reads leaked rows RLS would have hidden, and helpers kept client EXECUTE after REVOKE FROM PUBLIC (OPS-2, MOD-570/571, DB-SEC-1; HV-14a compiled these gotchas)"
expires: 2027-01-31
---

# Access: grants, RLS, definer functions, Realtime auth

## Grants
- `REVOKE … FROM PUBLIC` alone leaves `anon` able to execute (Supabase grants it directly). A new or re-created function states `REVOKE ALL … FROM PUBLIC, anon` and its grants in the same file.
- Internal SECURITY DEFINER helpers (double-underscore names, called only by other definer functions) get `REVOKE ALL … FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE … TO service_role`; assert `has_function_privilege` for both client roles. Exceptions keep client EXECUTE: policy helpers, app RPCs, and functions a CHECK, policy or trigger expression calls (they run with the writer's privileges; keep them pure, reading only their arguments).
- Before revoking EXECUTE on a helper, find the policies that call it (`pg_policies.qual like '%fn%'`) and scope them `TO authenticated` first, or anon's empty result becomes "permission denied for function".
- Pair every policy change with its table grants re-asserted in the same migration (`REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT <verbs> TO authenticated`), tested with `has_table_privilege`.
- A SECURITY INVOKER trigger or policy that calls a service-only helper (`perm_actor_id`) fails on prod with 42501: make the trigger SECURITY DEFINER.

## Definer functions and RLS
- When you tighten a table's policy, grep `supabase/functions/` for every `.from("<table>")` and `rpc` returning its rows, and every definer function reading it: each bypasses RLS and needs its own filter.
- In a definer read, filter rows with the canonical per-item check (`perm_can_see_entity(ws, type, id)` for registry rows, `can_access(type, id, level)` for a module's own rows), never a list of "private types". An op that copies, logs, previews or returns a row needs its own `can_access` too.
- A `WHERE … auth.uid()` in a definer op guards only its own statement: gate follow-up writes on it (`IF NOT FOUND THEN RETURN;`) or re-check.
- A read RPC the MCP connector calls gates on `<module>_module_permission(ws)` and `perm_actor_id()`, never `auth.uid()` alone (NULL under an API key, so it answers empty). Add a `test.as_key` case to `supabase/tests/mcp_tools.test.sql`.
- An `_as` body run for an API key's creator can't call a helper that reads `auth.uid()`: give that helper a person-parameter twin (`chat__chain_root_as`).
- A function an RLS policy calls is callable by `authenticated` directly: read the viewer from `auth.uid()` inside and answer only the caller's question, never take the person as an argument. A policy never calls `chat_is_workspace_member(ws, auth.uid())`, `share_direct_rank` or `perm_ceiling_rank` directly (`access_check.test.sql` fails): wrap it in a caller-only helper like `chat_emoji__readable`.
- A subquery in a policy runs under the reader's RLS ("no rows you can see"): put it in a definer helper that checks `can_access` for `perm_actor_id()` (`areas__visible`).
- Keep per-row read rules free of nested definer + `SET search_path` hops (~100 µs a row; `can_access` ~0.2 ms): write the rule out and guard the copy with a parity test (`chat_foundation.test.sql`). Text search over an RLS table is a definer function that filters text first and checks access per match (`tasks_search`).
- A share check that reads the row being inserted fails the INSERT's WITH CHECK: pass bucket inserts on `owner_id = auth.uid()` and task inserts on the parent bucket.
- A per-row access check that walks to a parent breaks once the parent is gone: delete children (and `note_updates`) yourself first, one depth level per statement, after `SELECT … FOR UPDATE` in id order.
- A path that changes `notes.created_by` or sharing on someone's behalf sets `share.bypass` first, saving and restoring the caller's value (the lint test checks it). Any column a `share.bypass` op later trusts needs a guard trigger refusing client writes (`tasks__trash_columns_guard`).
- A write guard on an author column checks `coalesce(NEW.author_id, public.perm_actor_id())`: app and agent rows have no author.
- A row that names a person (`user_id`) needs a rule for who may name whom, in the op and every trigger writing it; service-role readers (cron, senders) re-check that person's access at send time.
- Access granted through a pointer column (a contact's `company_id`) is checked on every writer of that column, answering the same for missing, deleted, elsewhere and private (`contacts_op__guard_company`).
- An idempotent create keyed by a client-minted id answers a resend only for a row the caller owns, and refuses an existing id otherwise (`templates__bundle`).
- Storage policies read `public.attachments` through its RLS: a pending row stays visible to its uploader in `attachments_select`. A signed upload URL checks INSERT once and writes outside RLS for ~2 h, so a rule for every Storage write is a trigger on `storage.objects` (`attachments_guard_object`); never `DROP TRIGGER` there. Count unverified upload sizes at `greatest(declared, stored)`.

## Realtime
- `postgres_changes` applies RLS to INSERT/UPDATE but sends a DELETE's old primary key to every subscriber: on a table with sensitive ids, soft-delete or key rows opaquely. An update reaches only those who can read the row afterwards, so an op that removes readers stamps `chat_members.access_at`.
- A private topic family is authorized by policies on `realtime.messages` (`realtime.topic()`), checked once at join and blind to payload. When access must end at once, send from a definer op that checks access and calls `realtime.send(payload, event, topic, true)` on per-person topics with no INSERT policy. `realtime.send` swallows failures and adds an `id` key: count rows in tests and compare with `@>`.
