-- OPS-2 — grants hardening, from the prod-schema ↔ migration-file reconciliation.
--
-- The reconciliation found 15 SECURITY DEFINER functions in `public` that the
-- `anon` role can EXECUTE. Root cause for most of them: the module migrations
-- revoke `FROM PUBLIC` and `FROM authenticated` but never `FROM anon`, and
-- Supabase's default privileges grant EXECUTE on public functions to `anon`
-- independently of PUBLIC. Revoking PUBLIC therefore does NOT revoke anon —
-- the CT-5 grant loop gets this right (`REVOKE ... FROM anon` explicitly), the
-- per-module ones in email/contacts/calendar do not.
--
-- This migration closes the two groups where revoking is provably safe. It
-- deliberately leaves a third group alone — see the note at the bottom.
--
-- Depends on: 20260628140000 (contacts_v2), 20260702130000 (calendar_module),
-- 20260704170000 (email_module).

-- ── group 1: internal op guards ──────────────────────────────────────────────
-- The `*_op__guard*` helpers are internal: SECURITY DEFINER, invoked only from
-- other SECURITY DEFINER ops (which run as the function OWNER, so their calls are
-- unaffected by caller grants). `authenticated` was already revoked by the module
-- migrations, proving no client path calls them; `anon` was simply forgotten.
--
-- Verified before writing this: no RLS policy references any `_op__guard` helper,
-- so revoking cannot turn an anon row-filter into a permission error.
--
-- Not currently a data leak — a rolled-back anon probe on 2026-07-29 showed
-- `email_op__guard_ref` raising "You don't have edit access to Email in this
-- workspace." rather than returning a row. But that is one `IF ... RAISE` inside a
-- SECURITY DEFINER function standing between an anonymous caller and an
-- `email_refs` row, which is exactly the posture gotchas §Supabase warns about
-- (an internal guard MASKING an over-broad grant). Defense in depth.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'calendar_op__guard(uuid)',
    'calendar_op__guard_event(uuid, uuid, boolean)',
    'contacts_op__guard(uuid)',
    'contacts_op__guard_contact(uuid, uuid)',
    'email_op__guard(uuid)',
    'email_op__guard_ref(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END;
$$;

-- ── group 2: the legacy accept_workspace_invite ──────────────────────────────
-- Unauthenticated write path. `accept_workspace_invite(p_invite_id uuid)` is
-- SECURITY DEFINER, owned by postgres, and was EXECUTE-able by `anon`. It never
-- reads auth.uid(): it looks the invite up by id, resolves the invitee by EMAIL
-- against auth.users, and INSERTs into workspace_members with the invite's role
-- and permissions. It also ignores invite status and expiry.
--
-- Demonstrated end-to-end in a rolled-back transaction on 2026-07-29: with the
-- caller UNAUTHENTICATED ('{"role":"anon"}', no sub) and the invite explicitly in
-- status='revoked', workspace_members for the target pair went 0 -> 1 and the
-- granted role was 'admin'. Prod held 7 non-revoked invites at the time — live
-- targets. Invite ids are v4 UUIDs, so this needed a leaked/forwarded id rather
-- than guessing, but ids travel in invite emails and nothing expired them.
--
-- It predates the migration files (no repo file creates it) and DF-24 replaced the
-- flow with the token-based `/join?invite=<token>` + `runtime.workspace.joinInvite`.
-- Nothing in src/ or supabase/functions/ calls it — the only occurrence is the
-- generated `src/types/supabase.ts`. So it is revoked from BOTH client roles here
-- rather than repaired. Dropping it outright is the follow-up once a release has
-- confirmed nothing regressed.
REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM authenticated;

-- ── group 3: DELIBERATELY NOT REVOKED — RLS policy helpers ───────────────────
-- `tasks_module_can_access_workspace(uuid)`, `profile_plan_tier_text(uuid)` and
-- `workspaces_owned_count_for_user(uuid)` are also anon-EXECUTE-able, and an anon
-- probe confirmed the latter two return real values ('pro', 1) for a supplied user
-- uuid — a genuine, if minor, unauthenticated information disclosure.
--
-- They are NOT revoked here because 22 RLS policies call them (every
-- `*_workspace_read` / `*_workspace_access` policy, plus the three billing-gate
-- policies), and all 22 are defined for role `public` — which includes `anon`.
-- Revoking EXECUTE would make an anonymous query against those tables raise
-- "permission denied for function" instead of returning zero rows, converting a
-- clean empty result into a hard error on unauthenticated surfaces.
--
-- The real fix is to scope those policies to `TO authenticated` first, then revoke.
-- That is a behavioural change to 22 policies and needs its own block — recorded in
-- docs/gotchas.md and the OPS-2 inventory rather than smuggled in here.
