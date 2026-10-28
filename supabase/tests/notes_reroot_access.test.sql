-- NS-3 · Deleting a parent keeps access (specs/notes-schema-hardening.md, AC4,
-- Assumption 3, PQ1; supabase/migrations/20261030120000_notes_reroot_access.sql).
-- A sub-note that follows its parent's sharing ('inherit') is re-rooted when
-- its parent is hard-deleted, by any path: account erasure, purge from the
-- trash (including its parent-cycle branch) and a plain DELETE. It ends up
-- top-level, set to custom sharing, and visible to exactly the people who
-- could see it before. The deleted row's creator gets nothing from it.
--
-- Cast: O owns W. X (the account being erased), B, T, D and U are members.
-- B writes the sub-notes; T sees them only through a parent's grant (or a
-- direct one); D writes the parents for purge and direct delete; U sees
-- nothing and must still see nothing after.

SELECT test.person(n) FROM unnest(ARRAY['O', 'X', 'B', 'T', 'D', 'U']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('O'), 'Side project');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['X', 'B', 'T', 'D', 'U']) AS n;

-- A note row; its parent (if any) must already exist.
CREATE FUNCTION pg_temp.note(p_name text, p_creator text, p_parent text, p_mode text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id)
  VALUES (test.id(p_name), test.id('W'), test.id(p_creator), p_name, p_name,
          CASE WHEN p_parent IS NOT NULL THEN test.id(p_parent) END);
  UPDATE public.notes SET share_mode = p_mode, workspace_shared = false WHERE id = test.id(p_name);
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id(p_name);
END;
$$;

CREATE FUNCTION pg_temp.grant_to(p_note text, p_who text, p_level text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'note', test.id(p_note), 'member', test.id(p_who), p_level, test.id('O'));
$$;

CREATE FUNCTION pg_temp.sees(p_who text, p_note text, p_level text DEFAULT 'view') RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce(public.can_access('note', test.id(p_note), p_level, test.id(p_who)), false);
$$;

-- Top-level, custom, still in place.
CREATE FUNCTION pg_temp.rerooted(p_note text) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce((SELECT parent_id IS NULL AND share_mode = 'custom'
                     FROM public.notes WHERE id = test.id(p_note)), false);
$$;

CREATE FUNCTION pg_temp.granted(p_note text, p_who text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.resource_grants
                 WHERE resource_type = 'note' AND resource_id = test.id(p_note)
                   AND subject_type = 'member' AND subject_id = test.id(p_who));
$$;

CREATE FUNCTION pg_temp.gone(p_note text) RETURNS boolean LANGUAGE sql AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.notes WHERE id = test.id(p_note));
$$;

-- ── Erasure ─────────────────────────────────────────────────────────────────
-- XP is X's private page, XQ X's private sub-page under it: only X can see
-- either, so erasure deletes both in one statement. BQ (B's, under XQ) and BP
-- (B's, under XP) follow them; T has a direct grant on BQ.
SELECT pg_temp.note('XP', 'X', NULL, 'custom');
SELECT pg_temp.note('XQ', 'X', 'XP', 'inherit');
SELECT pg_temp.note('BQ', 'B', 'XQ', 'inherit');
SELECT pg_temp.note('BP', 'B', 'XP', 'inherit');
SELECT pg_temp.grant_to('BQ', 'T', 'view');

DO $$
BEGIN
  PERFORM test.ok(pg_temp.sees('X', 'BQ') AND pg_temp.sees('X', 'BP')
              AND pg_temp.sees('B', 'BQ') AND pg_temp.sees('B', 'BP') AND pg_temp.sees('T', 'BQ')
              AND NOT pg_temp.sees('U', 'BQ') AND NOT pg_temp.sees('T', 'BP'),
    'erasure, before: X sees both sub-notes through its pages, B wrote them, T has BQ, U has neither');
END;
$$;

DO $$
DECLARE
  r text;
BEGIN
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('X')), false);
  PERFORM test.ok(r = 'ok 1', 'erasure runs: X''s two nested pages go in one statement', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.gone('XP') AND pg_temp.gone('XQ'), 'erasure deleted X''s private pages');
  PERFORM test.ok(pg_temp.rerooted('BQ') AND pg_temp.rerooted('BP'),
    'erasure: the sub-notes are top-level and custom');
  PERFORM test.ok(pg_temp.sees('B', 'BQ') AND pg_temp.sees('B', 'BP') AND pg_temp.sees('T', 'BQ'),
    'erasure: everyone who saw a sub-note still sees it');
  PERFORM test.ok(NOT pg_temp.sees('U', 'BQ') AND NOT pg_temp.sees('U', 'BP') AND NOT pg_temp.sees('T', 'BP'),
    'erasure: nobody gained a sub-note they couldn''t see');
  PERFORM test.ok(NOT pg_temp.granted('BQ', 'X') AND NOT pg_temp.granted('BP', 'X')
              AND NOT pg_temp.sees('X', 'BQ') AND NOT pg_temp.sees('X', 'BP'),
    'erasure: the erased person got no grant');
END;
$$;

-- ── Purge ───────────────────────────────────────────────────────────────────
-- DP is D's page, shared with T at Edit, in the trash; BT (B's) follows it and
-- is live.
SELECT pg_temp.note('DP', 'D', NULL, 'custom');
SELECT pg_temp.note('BT', 'B', 'DP', 'inherit');
SELECT pg_temp.grant_to('DP', 'T', 'edit');
UPDATE public.notes SET deleted_at = now() WHERE id = test.id('DP');

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(pg_temp.sees('T', 'BT', 'edit') AND NOT pg_temp.sees('U', 'BT'),
    'purge, before: T edits BT through DP');
  r := test.as_user('D', format($q$SELECT public.notes_op_purge(%L, %L)$q$, test.id('W'), test.id('DP')));
  PERFORM test.ok(r = 'ok 1', 'purge runs', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.gone('DP') AND pg_temp.rerooted('BT'), 'purge: BT is top-level and custom');
  PERFORM test.ok(pg_temp.sees('T', 'BT', 'edit') AND pg_temp.sees('B', 'BT') AND NOT pg_temp.sees('U', 'BT'),
    'purge: T still edits BT, B still has it, U still doesn''t');
END;
$$;

-- ── Purge, parent-cycle branch ──────────────────────────────────────────────
-- CA and CB are D's, trashed, and each other's parent (both 'inherit'), so
-- purge finds no leaf among them. CB is shared with T; BC (B's, live) follows
-- CA.
SELECT pg_temp.note('CA', 'D', NULL, 'custom');
SELECT pg_temp.note('CB', 'D', 'CA', 'inherit');
SELECT pg_temp.note('BC', 'B', 'CA', 'inherit');
SELECT pg_temp.grant_to('CB', 'T', 'view');
UPDATE public.notes SET parent_id = test.id('CB'), share_mode = 'inherit' WHERE id = test.id('CA');
UPDATE public.notes SET deleted_at = now() WHERE id IN (test.id('CA'), test.id('CB'));

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(pg_temp.sees('T', 'BC') AND NOT pg_temp.sees('U', 'BC'),
    'cycle, before: T sees BC through CA and CB');
  r := test.as_user('D', format($q$SELECT public.notes_op_purge(%L, %L)$q$, test.id('W'), test.id('CA')));
  PERFORM test.ok(r = 'ok 1', 'purge of a trashed parent cycle runs', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.gone('CA') AND pg_temp.gone('CB'), 'cycle: both trashed pages are gone');
  PERFORM test.ok(pg_temp.rerooted('BC'), 'cycle: BC is top-level and custom');
  PERFORM test.ok(pg_temp.sees('T', 'BC') AND pg_temp.sees('B', 'BC') AND NOT pg_temp.sees('U', 'BC'),
    'cycle: T and B still see BC, U still doesn''t');
END;
$$;

-- ── Direct delete ───────────────────────────────────────────────────────────
-- DD is D's page, shared with T at Edit. BD (live) and BX (trashed) are B's and
-- follow it. Two chains go in one statement each: E1 → E2 → BE (rows written
-- parent first) and F1 → F2 → BF (written child first), so the delete meets
-- parent and child in both orders. T sees E1 and F1.
SELECT pg_temp.note('DD', 'D', NULL, 'custom');
SELECT pg_temp.note('BD', 'B', 'DD', 'inherit');
SELECT pg_temp.note('BX', 'B', 'DD', 'inherit');
SELECT pg_temp.grant_to('DD', 'T', 'edit');
UPDATE public.notes SET deleted_at = now() WHERE id = test.id('BX');

SELECT pg_temp.note('E1', 'D', NULL, 'custom');
SELECT pg_temp.note('E2', 'D', 'E1', 'inherit');
SELECT pg_temp.note('BE', 'B', 'E2', 'inherit');
SELECT pg_temp.grant_to('E1', 'T', 'view');

SELECT pg_temp.note('F0', 'D', NULL, 'custom');
SELECT pg_temp.note('BF', 'B', 'F0', 'inherit');
SELECT pg_temp.note('F2', 'D', 'F0', 'custom');
SELECT pg_temp.note('F1', 'D', NULL, 'custom');
UPDATE public.notes SET parent_id = test.id('F2') WHERE id = test.id('BF');
UPDATE public.notes SET parent_id = test.id('F1'), share_mode = 'inherit' WHERE id = test.id('F2');
SELECT pg_temp.grant_to('F1', 'T', 'view');

DO $$
BEGIN
  PERFORM test.ok(pg_temp.sees('T', 'BD', 'edit') AND pg_temp.sees('T', 'BX', 'edit')
              AND pg_temp.sees('D', 'BD', 'full') AND pg_temp.sees('T', 'BE') AND pg_temp.sees('T', 'BF')
              AND NOT pg_temp.sees('U', 'BD') AND NOT pg_temp.sees('U', 'BE') AND NOT pg_temp.sees('U', 'BF'),
    'direct delete, before: T reaches every sub-note through its page, D owns DD');
END;
$$;

DELETE FROM public.notes WHERE id = test.id('DD');
DELETE FROM public.notes WHERE id IN (test.id('E1'), test.id('E2'));
DELETE FROM public.notes WHERE id IN (test.id('F1'), test.id('F2'));

DO $$
BEGIN
  PERFORM test.ok(pg_temp.gone('DD') AND pg_temp.gone('E1') AND pg_temp.gone('E2')
              AND pg_temp.gone('F1') AND pg_temp.gone('F2'),
    'direct delete: the parents are gone, two levels in one statement included');
  PERFORM test.ok(pg_temp.rerooted('BD') AND pg_temp.rerooted('BX') AND pg_temp.rerooted('BE') AND pg_temp.rerooted('BF'),
    'direct delete: every sub-note, live or trashed, is top-level and custom');
  PERFORM test.ok(pg_temp.sees('T', 'BD', 'edit') AND pg_temp.sees('T', 'BX', 'edit')
              AND pg_temp.sees('T', 'BE') AND pg_temp.sees('T', 'BF'),
    'direct delete: T keeps the level it had, through both orders of a two-level delete');
  PERFORM test.ok(NOT pg_temp.sees('U', 'BD') AND NOT pg_temp.sees('U', 'BE') AND NOT pg_temp.sees('U', 'BF'),
    'direct delete: U still sees none of them');
  PERFORM test.ok(NOT pg_temp.granted('BD', 'D') AND NOT pg_temp.granted('BX', 'D')
              AND NOT pg_temp.granted('BE', 'D') AND NOT pg_temp.granted('BF', 'D'),
    'direct delete: the deleted pages'' creator got no grant from it');
END;
$$;

-- ── Workspace deletion still cascades a nested tree ─────────────────────────
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md) VALUES
  (test.id('W2P'), test.id('W2'), test.id('O'), 'Top', 't');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('W2C'), test.id('W2'), test.id('O'), 'Child', 'c', test.id('W2P'));
UPDATE public.notes SET share_mode = 'inherit' WHERE id = test.id('W2C');

DO $$
DECLARE
  r text;
BEGIN
  r := test.run(NULL, format($q$DELETE FROM public.workspaces WHERE id = %L$q$, test.id('W2')), false);
  PERFORM test.ok(r = 'ok 1' AND pg_temp.gone('W2P') AND pg_temp.gone('W2C'),
    'deleting a workspace still removes its nested notes', r);
END;
$$;

-- ── The rule itself, and the helpers' grants ────────────────────────────────
DO $$
DECLARE
  r text;
  v_helper regprocedure := to_regprocedure('public.notes__keep_access_on_reroot(uuid, uuid, uuid)');
BEGIN
  r := test.run(NULL, format($q$UPDATE public.notes SET parent_id = NULL, share_mode = 'inherit' WHERE id = %L$q$,
    test.id('BD')), false);
  PERFORM test.ok(r LIKE '23514%', 'a top-level note can''t follow a parent: the CHECK refuses it', r);

  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = 'public.notes'::regclass AND tgname = 'notes_freeze_children'
                            AND tgenabled = 'O'),
    'the freeze trigger is on notes');
  PERFORM test.ok(v_helper IS NOT NULL
              AND (SELECT count(*) FROM pg_proc WHERE proname = 'notes__keep_access_on_reroot'
                   AND pronamespace = 'public'::regnamespace) = 1,
    'the helper takes p_skip_creator, and the old two-argument form is gone');
  PERFORM test.ok(v_helper IS NOT NULL
              AND has_function_privilege('service_role', v_helper, 'EXECUTE')
              AND NOT has_function_privilege('authenticated', v_helper, 'EXECUTE')
              AND NOT has_function_privilege('anon', v_helper, 'EXECUTE'),
    'grants: the helper is the service role''s only');
END;
$$;
