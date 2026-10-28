-- NS-4 · Trash empties itself (specs/notes-schema-hardening.md, AC5,
-- Assumption 4, PQ2, PQ3; supabase/migrations/20261030130000_notes_purge_expired.sql).
-- notes__purge_expired is the nightly sweep the purge-deleted Edge Function
-- runs as the service role, with no actor: notes in the trash for more than 30
-- days go in every workspace, their links and registry entries are tombstoned,
-- live sub-notes that followed them keep their access (NS-3's path), and
-- live-viewer rows older than 10 minutes are swept. Past 30 days nothing comes
-- back out of the trash, whichever path tries.
--
-- Cast: O owns W1 and W2. T is a member of W2 who sees BP only through a grant,
-- and so sees its sub-note BC only through it.

SELECT test.person(n) FROM unnest(ARRAY['O', 'T']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W1'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('O'), 'Side project');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W2'), test.id('T'), 'member');

-- A note row, in the trash for p_days days when given; its parent must exist.
CREATE FUNCTION pg_temp.note(p_ws text, p_name text, p_parent text, p_mode text, p_days int)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id)
  VALUES (test.id(p_name), test.id(p_ws), test.id('O'), p_name, p_name,
          CASE WHEN p_parent IS NOT NULL THEN test.id(p_parent) END);
  UPDATE public.notes SET share_mode = p_mode, workspace_shared = false WHERE id = test.id(p_name);
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id(p_name);
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label)
  VALUES (test.id(p_ws), 'note', test.id(p_name), p_name)
  ON CONFLICT DO NOTHING;
  IF p_days IS NOT NULL THEN
    UPDATE public.notes SET deleted_at = now() - make_interval(days => p_days)
    WHERE id = test.id(p_name);
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.link(p_ws text, p_from text, p_to text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.entity_links (id, workspace_id, source_type, source_id, target_type, target_id, created_by)
  VALUES (test.id('link:' || p_from || p_to), test.id(p_ws), 'note', test.id(p_from), 'note', test.id(p_to), test.id('O'));
$$;

CREATE FUNCTION pg_temp.gone(p_note text) RETURNS boolean LANGUAGE sql AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.notes WHERE id = test.id(p_note));
$$;

CREATE FUNCTION pg_temp.link_tombstoned(p_from text, p_to text) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce((SELECT deleted_at IS NOT NULL FROM public.entity_links
                   WHERE id = test.id('link:' || p_from || p_to)), false);
$$;

CREATE FUNCTION pg_temp.registry_tombstoned(p_ws text, p_note text) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce((SELECT deleted_at IS NOT NULL FROM public.entities
                   WHERE workspace_id = test.id(p_ws) AND entity_type = 'note'
                     AND entity_id = test.id(p_note)), false);
$$;

CREATE FUNCTION pg_temp.sees(p_who text, p_note text) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce(public.can_access('note', test.id(p_note), 'view', test.id(p_who)), false);
$$;

-- The nightly call: the service role, no JWT subject, no API key, so no actor.
CREATE FUNCTION pg_temp.purge(p_limit int) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  PERFORM set_config('request.headers', '{}', true);
  SET LOCAL ROLE service_role;
  BEGIN
    r := public.notes__purge_expired(p_limit);
  EXCEPTION WHEN OTHERS THEN
    r := jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN r;
END;
$$;

-- ── Fixture ─────────────────────────────────────────────────────────────────
-- W1: A31 is 31 days in the trash and linked from the live note L; K29 is 29
-- days in and linked from L too. YP is 10 days in the trash; its sub-note YC
-- went in 31 days ago. R31 and R29 are for the restore checks.
SELECT pg_temp.note('W1', 'L', NULL, 'custom', NULL);
SELECT pg_temp.note('W1', 'A31', NULL, 'custom', 31);
SELECT pg_temp.note('W1', 'K29', NULL, 'custom', 29);
SELECT pg_temp.note('W1', 'YP', NULL, 'custom', NULL);
SELECT pg_temp.note('W1', 'YC', 'YP', 'inherit', 31);
UPDATE public.notes SET deleted_at = now() - interval '10 days' WHERE id = test.id('YP');
SELECT pg_temp.note('W1', 'R31', NULL, 'custom', 31);
SELECT pg_temp.note('W1', 'R29', NULL, 'custom', 29);
SELECT pg_temp.link('W1', 'L', 'A31');
SELECT pg_temp.link('W1', 'L', 'K29');

-- W2: B31 is 31 days in the trash, linking to the live note M. BP is 31 days in
-- the trash and shared with T; its live sub-note BC follows it.
SELECT pg_temp.note('W2', 'M', NULL, 'custom', NULL);
SELECT pg_temp.note('W2', 'B31', NULL, 'custom', 31);
SELECT pg_temp.note('W2', 'BP', NULL, 'custom', NULL);
SELECT pg_temp.note('W2', 'BC', 'BP', 'inherit', NULL);
UPDATE public.notes SET deleted_at = now() - interval '31 days' WHERE id = test.id('BP');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W2'), 'note', test.id('BP'), 'member', test.id('T'), 'view', test.id('O'));
SELECT pg_temp.link('W2', 'B31', 'M');

-- Live viewers of L: one stale (11 minutes), one fresh (5 minutes).
INSERT INTO public.note_live_viewers (note_id, user_id, session_id, seen_at) VALUES
  (test.id('L'), test.id('O'), 'db-test-stale', now() - interval '11 minutes'),
  (test.id('L'), test.id('O'), 'db-test-fresh', now() - interval '5 minutes');

DO $$
BEGIN
  PERFORM test.ok(pg_temp.sees('T', 'BC'), 'before: T sees BC through BP''s grant');
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(
    NOT has_function_privilege('anon', 'public.notes__purge_expired(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.notes__purge_expired(integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notes__purge_expired(integer)', 'EXECUTE'),
    'grants: only the service role runs the sweep');
END;
$$;

-- ── No restore past 30 days (PQ3) ───────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_op('O', format('SELECT public.notes_op_restore(%L, %L)', test.id('W1'), test.id('R31')));
  PERFORM test.ok(r LIKE '%This note was deleted more than 30 days ago%',
    'restore: the op refuses a note trashed 31 days ago', r);

  r := test.try('O', format('SELECT public.notes_op_restore(%L, %L)', test.id('W1'), test.id('R29')));
  PERFORM test.ok(r LIKE 'ok%', 'restore: the op still restores a note trashed 29 days ago', r);

  BEGIN
    UPDATE public.notes SET deleted_at = NULL WHERE id = test.id('R31');
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN
    r := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM test.ok(r LIKE '%This note was deleted more than 30 days ago%',
    'restore: a direct write without an actor is refused too', r);
  PERFORM test.ok((SELECT deleted_at IS NOT NULL FROM public.notes WHERE id = test.id('R31')),
    'restore: R31 is still in the trash');

  BEGIN
    UPDATE public.notes SET title = 'renamed' WHERE id = test.id('R31');
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN
    r := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM test.ok(r = 'ok', 'restore: other writes to an old trashed note are untouched', r);
END;
$$;

-- ── The sweep ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  r jsonb;
BEGIN
  r := pg_temp.purge(1);
  PERFORM test.ok(r ? 'notes' AND (r->>'notes')::int <= 1,
    'limit: one call takes at most p_limit notes', r::text);
END;
$$;

DO $$
DECLARE
  r jsonb;
BEGIN
  r := pg_temp.purge(500);
  PERFORM test.ok(r ? 'notes' AND r ? 'viewers' AND NOT r ? 'error',
    'sweep: runs with no actor and answers its counts', r::text);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.gone('A31') AND pg_temp.gone('R31'),
    'W1: notes 31 days in the trash are purged');
  PERFORM test.ok(pg_temp.gone('B31') AND pg_temp.gone('BP'),
    'W2: notes 31 days in the trash are purged in a second workspace');
  PERFORM test.ok(NOT pg_temp.gone('K29')
              AND (SELECT deleted_at IS NOT NULL FROM public.notes WHERE id = test.id('K29')),
    'kept: a note 29 days in the trash stays in the trash');
  PERFORM test.ok(NOT pg_temp.registry_tombstoned('W1', 'K29') AND NOT pg_temp.link_tombstoned('L', 'K29'),
    'kept: its link and registry entry are untouched');

  PERFORM test.ok(pg_temp.link_tombstoned('L', 'A31') AND pg_temp.link_tombstoned('B31', 'M'),
    'links: links to and from purged notes are tombstoned in both workspaces');
  PERFORM test.ok(pg_temp.registry_tombstoned('W1', 'A31') AND pg_temp.registry_tombstoned('W2', 'B31')
              AND pg_temp.registry_tombstoned('W2', 'BP'),
    'registry: purged notes'' entries are tombstoned');
  PERFORM test.ok(NOT pg_temp.registry_tombstoned('W1', 'L') AND NOT pg_temp.registry_tombstoned('W2', 'M'),
    'registry: the live notes on the other end stay');

  PERFORM test.ok(pg_temp.gone('YC'), 'subtree: an expired sub-note goes');
  PERFORM test.ok(NOT pg_temp.gone('YP')
              AND (SELECT deleted_at IS NOT NULL FROM public.notes WHERE id = test.id('YP')),
    'subtree: its parent, 10 days in the trash, stays in the trash');

  PERFORM test.ok(NOT pg_temp.gone('BC')
              AND (SELECT parent_id IS NULL AND share_mode = 'custom' AND deleted_at IS NULL
                     FROM public.notes WHERE id = test.id('BC')),
    'survivor: the live sub-note of a purged page is top-level and custom');
  PERFORM test.ok(pg_temp.sees('T', 'BC'), 'survivor: T still sees it');

  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.note_live_viewers
                              WHERE note_id = test.id('L') AND session_id = 'db-test-stale'),
    'viewers: a row last seen 11 minutes ago is swept');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.note_live_viewers
                          WHERE note_id = test.id('L') AND session_id = 'db-test-fresh'),
    'viewers: a row seen 5 minutes ago stays');
END;
$$;

-- ── Dry run ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r jsonb;
BEGIN
  UPDATE public.notes SET deleted_at = now() - interval '40 days' WHERE id = test.id('K29');
  r := public.purge__preview();
  PERFORM test.ok(r ? 'notes' AND (r->>'notes')::int >= 1,
    'preview: purge__preview counts expired notes', r::text);
  PERFORM test.ok(NOT pg_temp.gone('K29'), 'preview: and changes nothing');
END;
$$;
