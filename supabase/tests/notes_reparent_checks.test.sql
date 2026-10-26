-- MOD-553 · Moving a note checks the new parent, and following a parent
-- inside a published page needs ws.publish and Full on the note; trashing a
-- note takes it off the web (supabase/migrations/20261024131500_notes_reparent_checks.sql).
--
-- Cast: O owns workspace W. E is a member (the member role can publish). X is
-- a member whose exception blocks ws.publish. PUB is O's published page; E
-- and X can edit it. PRIV is O's private note. NE is E's own note, NX is X's
-- own note, NXE is O's note X can only edit; all three follow their parent
-- (share_mode 'inherit'). CX is X's own note under PUB with its own sharing.
-- Under PUB, sections S1 and S2 and page D (in S1) follow it, so they are on
-- the web already; ARCH follows it too but is archived.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('X'), 'member');
UPDATE public.workspace_members SET overrides = '{"ws.publish": false}'::jsonb
  WHERE workspace_id = test.id('W') AND user_id = test.id('X');

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md) VALUES
  (test.id('PUB'), test.id('W'), test.id('O'), 'Changelog', 'public'),
  (test.id('PUB2'), test.id('W'), test.id('O'), 'Press kit', 'public'),
  (test.id('PRIV'), test.id('W'), test.id('O'), 'Salaries', 'secret'),
  (test.id('NE'), test.id('W'), test.id('E'), 'Release notes', 'draft'),
  (test.id('NX'), test.id('W'), test.id('X'), 'Customer list', 'private'),
  (test.id('NXE'), test.id('W'), test.id('O'), 'Board prep', 'private');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('CX'), test.id('W'), test.id('X'), 'Internal FAQ', 'private', test.id('PUB'));
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('S1'), test.id('W'), test.id('O'), 'Q3', 'public', test.id('PUB')),
  (test.id('S2'), test.id('W'), test.id('O'), 'Q4', 'public', test.id('PUB')),
  (test.id('ARCH'), test.id('W'), test.id('O'), 'Old releases', 'public', test.id('PUB'));
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('D'), test.id('W'), test.id('O'), 'v1.2', 'public', test.id('S1'));
UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false
  WHERE id IN (test.id('S1'), test.id('S2'), test.id('ARCH'), test.id('D'));
UPDATE public.notes SET is_archived = true WHERE id = test.id('ARCH');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('S1'), test.id('S2'), test.id('ARCH'), test.id('D'));
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('PUB'), test.id('PUB2'), test.id('PRIV'), test.id('CX'));
UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false
  WHERE id IN (test.id('NE'), test.id('NX'), test.id('NXE'));
UPDATE public.notes SET publish_token = 'db-test-pub', published_at = now() WHERE id = test.id('PUB');
UPDATE public.notes SET publish_token = 'db-test-pub2', published_at = now() WHERE id = test.id('PUB2');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('PUB'), test.id('PUB2'), test.id('PRIV'), test.id('NE'), test.id('NX'),
                      test.id('NXE'), test.id('CX'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('PUB'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'note', test.id('PUB'), 'member', test.id('X'), 'edit', test.id('O')),
       (test.id('W'), 'note', test.id('NXE'), 'member', test.id('X'), 'edit', test.id('O'));

CREATE FUNCTION test.parent_of(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT parent_id FROM public.notes WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.on_web(p_name text) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce(public.notes_public_subtree('db-test-pub') -> 'notes', '[]'::jsonb)
         @> jsonb_build_array(jsonb_build_object('id', test.id(p_name)))
$$;

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(NOT public.can_access('note', test.id('PRIV'), 'view', test.id('E')),
    'control: E can''t open the private note');

  -- The finding: a note moved under a note you can't open.
  r := test.as_user('E', format($q$SELECT public.notes_op_move(%L, %L, %L, 'a')$q$,
    test.id('W'), test.id('NE'), test.id('PRIV')));
  PERFORM test.ok(r LIKE '42501%' AND test.parent_of('NE') IS NULL,
    'moving a note under a note you can''t edit is refused', r);
  r := test.as_user('E', format('UPDATE public.notes SET parent_id = %L WHERE id = %L',
    test.id('PRIV'), test.id('NE')));
  PERFORM test.ok((r LIKE '42501%' OR r = 'ok 0') AND test.parent_of('NE') IS NULL,
    'so is the same move as a raw UPDATE', r);

  -- Into a published page: X can edit PUB but can't publish.
  r := test.as_user('X', format($q$SELECT public.notes_op_move(%L, %L, %L, 'b')$q$,
    test.id('W'), test.id('NX'), test.id('PUB')));
  PERFORM test.ok(r LIKE '42501%' AND test.parent_of('NX') IS NULL AND NOT test.on_web('NX'),
    'a member who can''t publish can''t put a note on the web by moving it under a published page', r);
  -- Switching a note already under the page to follow it is the same thing.
  r := test.as_user('X', format('SELECT public.share_op_follow_parent(%L)', test.id('CX')));
  PERFORM test.ok(r LIKE '42501%' AND NOT test.on_web('CX'),
    'nor by making a sub-note of the page follow it', r);
  -- An archived step inside the page still counts: unarchiving needs only Edit.
  r := test.as_user('X', format($q$SELECT public.notes_op_move(%L, %L, %L, 'b2')$q$,
    test.id('W'), test.id('NX'), test.id('ARCH')));
  PERFORM test.ok(r LIKE '42501%' AND test.parent_of('NX') IS NULL,
    'nor by moving it under an archived page inside the published one', r);
  -- Reorganising what is on the web already needs only Edit.
  r := test.as_user('X', format($q$SELECT public.notes_op_move(%L, %L, %L, 'b3')$q$,
    test.id('W'), test.id('D'), test.id('S2')));
  PERFORM test.ok(r = 'ok 1' AND test.parent_of('D') = test.id('S2') AND test.on_web('D'),
    'moving a page within the published page needs only Edit (it was public already)', r);

  -- With ws.publish but only Edit on the note (changing its audience needs Full).
  UPDATE public.workspace_members SET overrides = '{}'::jsonb
    WHERE workspace_id = test.id('W') AND user_id = test.id('X');
  r := test.as_user('X', format($q$SELECT public.notes_op_move(%L, %L, %L, 'c')$q$,
    test.id('W'), test.id('NXE'), test.id('PUB')));
  PERFORM test.ok(r LIKE '42501%' AND test.parent_of('NXE') IS NULL AND NOT test.on_web('NXE'),
    'publishing someone else''s note by moving it needs Full on it', r);

  -- Allowed: E can publish, owns NE and can edit PUB.
  r := test.as_user('E', format($q$SELECT public.notes_op_move(%L, %L, %L, 'd')$q$,
    test.id('W'), test.id('NE'), test.id('PUB')));
  PERFORM test.ok(r = 'ok 1' AND test.parent_of('NE') = test.id('PUB') AND test.on_web('NE'),
    'someone who may publish moves their own note under the published page', r);
  r := test.as_user('E', format($q$SELECT public.notes_op_move(%L, %L, NULL, 'e')$q$,
    test.id('W'), test.id('NE')));
  PERFORM test.ok(r = 'ok 1' AND test.parent_of('NE') IS NULL AND NOT test.on_web('NE'),
    'moving it back to the top level is always allowed', r);
  r := test.as_user('X', format($q$SELECT public.notes_op_move(%L, %L, %L, 'f')$q$,
    test.id('W'), test.id('NXE'), test.id('NX')));
  PERFORM test.ok(r = 'ok 1' AND test.parent_of('NXE') = test.id('NX'),
    'moving under a note you can edit that isn''t published needs nothing more', r);

  -- Trashing takes a published page off the web; a restore keeps it off.
  r := test.as_user('O', format('SELECT public.notes_op_trash(%L, %L)', test.id('W'), test.id('PUB2')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT publish_token IS NULL AND published_at IS NULL
                                  FROM public.notes WHERE id = test.id('PUB2')),
    'trashing a published note clears its public link', r);
  r := test.as_user('O', format('SELECT public.notes_op_restore(%L, %L)', test.id('W'), test.id('PUB2')));
  PERFORM test.ok(r = 'ok 1' AND public.notes_public_subtree('db-test-pub2') IS NULL,
    'and restoring it doesn''t put it back on the web', r);

  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.notes__in_published_tree(uuid, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.notes__in_published_tree(uuid, boolean)', 'EXECUTE'),
    'the published-tree helper is internal');
END;
$$;
