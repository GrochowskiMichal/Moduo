-- NS-1: close the open surface on Notes (specs/notes-schema-hardening.md,
-- Assumption 1; AC1 and AC2; tested by supabase/tests/notes_grants.test.sql).
--
-- Every Notes write goes through a SECURITY DEFINER notes_op_*, and no client
-- writes a Notes table directly, so the client write grants prod still carries
-- (GRANT ALL to anon and authenticated, from the original schema) are only
-- attack surface. After this file:
--   - anon holds nothing on notes, note_updates, note_shares, exposed_notes;
--   - authenticated keeps SELECT on notes and note_updates (the app reads them
--     until NS-7) and on note_favorites (untouched), and nothing else. Nothing
--     reads note_shares from a client; it and exposed_notes go in NS-9, with
--     the erasure re-cut that still deletes from them;
--   - exposed_notes loses its public read (MOD-594 dropped its writes);
--   - notes_module_permission is service-only: its SQL callers
--     (notes_op__guard, notes_op_set_favorite, notes__search) are definers;
--   - the prod-only leftovers with no caller are dropped: two private helpers
--     anon could execute, and three indexes ((workspace_id, deleted_at) covers
--     their prefix; the pinned one rewrote on every updated_at).
-- exposed_notes and the private helpers exist only on prod-built databases,
-- hence the guards. Re-runnable.

-- REVOKE ALL, then GRANT back, so no verb is left behind (Postgres 17's
-- MAINTAIN was, under a verb list).
REVOKE ALL ON TABLE public.notes, public.note_updates, public.note_shares, public.note_favorites
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notes, public.note_updates, public.note_favorites TO authenticated;
-- The log's id sequence: a client setval could rewind it and make every
-- insert collide. The definer ops call nextval as the owner.
REVOKE ALL ON SEQUENCE public.note_updates_id_seq FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.exposed_notes') IS NOT NULL THEN
    DROP POLICY IF EXISTS exposed_notes_public_read ON public.exposed_notes;
    REVOKE ALL ON TABLE public.exposed_notes FROM PUBLIC, anon, authenticated;
  END IF;
  -- Policy helper on note_shares (dropped with it in NS-9): no anon EXECUTE.
  IF to_regprocedure('private.user_owns_note(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION private.user_owns_note(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION private.user_owns_note(uuid) TO authenticated, service_role;
  END IF;
END;
$do$;

REVOKE ALL ON FUNCTION public.notes_module_permission(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes_module_permission(uuid) TO service_role;

DROP FUNCTION IF EXISTS private.user_can_read_note(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS private.user_can_edit_note(uuid, uuid, uuid, text, text);

DROP INDEX IF EXISTS public.notes_workspace_pinned_idx;
DROP INDEX IF EXISTS public.notes_workspace_share_scope_idx;
DROP INDEX IF EXISTS public.idx_notes_workspace_id;
