-- NS-2 · A tree never crosses workspaces (specs/notes-schema-hardening.md,
-- AC3, Assumption 2, PQ6; supabase/migrations/20261030110000_notes_same_workspace.sql).
-- A note's parent, its log rows and its favorites live in the note's own
-- workspace: composite keys on (workspace_id, …) refuse anything else, and
-- notes_op_import refuses a parent outside the workspace with a readable
-- error, failing the whole batch.
--
-- Cast: O owns W and W2, so O can write in both. E is a member of W only, U a
-- member of W2 only. P is W's custom page, shared with E; C follows it
-- (share_mode 'inherit'). Q is a W2 page shared with all of W2.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'U']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('O'), 'Side project');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W2'), test.id('U'), 'member');

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'Roadmap', 'w'),
  (test.id('Q'), test.id('W2'), test.id('O'), 'Side notes', 'w2');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('C'), test.id('W'), test.id('O'), 'Q4 plan', 'w', test.id('P'));
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false WHERE id = test.id('P');
UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false WHERE id = test.id('C');
UPDATE public.notes SET share_mode = 'custom', workspace_shared = true WHERE id = test.id('Q');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('P'), test.id('C'), test.id('Q'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('P'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W2'), 'note', test.id('Q'), 'workspace', NULL, 'edit', test.id('O'));

CREATE FUNCTION test.note_exists(p_name text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.notes WHERE id = test.id(p_name))
$$;
CREATE FUNCTION test.raw(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT test.run(NULL, p_sql, false)
$$;
CREATE FUNCTION test.import_sql(p_ws text, p_rows jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.notes_op_import(%L, %L::jsonb)', test.id(p_ws), p_rows)
$$;

DO $$
DECLARE
  r text;
BEGIN
  -- Controls: the chain inside W works as before.
  PERFORM test.ok(public.can_access('note', test.id('C'), 'view', test.id('E')),
    'control: E opens C through its parent P');
  PERFORM test.ok(NOT public.can_access('note', test.id('C'), 'view', test.id('U')),
    'control: U (W2 only) can''t open C');

  -- PQ6: an import whose parent is in another workspace fails as a whole.
  r := test.as_user('O', test.import_sql('W', jsonb_build_array(
    jsonb_build_object('id', test.id('I_OK'), 'title', 'Fine'),
    jsonb_build_object('id', test.id('I_X'), 'title', 'Smuggled', 'parentId', test.id('Q')))));
  PERFORM test.ok(r LIKE '22023%' AND r LIKE '%A note''s parent isn''t in this workspace%'
      AND r LIKE '%' || test.id('Q')::text || '%',
    'an import with a parent from another workspace raises 22023 naming the parent', r);
  PERFORM test.ok(NOT test.note_exists('I_OK') AND NOT test.note_exists('I_X'),
    'and nothing in that batch is imported');

  -- A parent that exists nowhere is not in this workspace either.
  r := test.as_user('O', test.import_sql('W', jsonb_build_array(
    jsonb_build_object('id', test.id('I_G'), 'title', 'Ghost child', 'parentId', test.id('NOWHERE')))));
  PERFORM test.ok(r LIKE '22023%' AND r LIKE '%A note''s parent isn''t in this workspace%'
      AND NOT test.note_exists('I_G'),
    'an import with a parent that exists nowhere raises the same error', r);

  -- A batch row whose id already belongs to W2 is skipped, so it can't be a parent here.
  r := test.as_user('O', test.import_sql('W', jsonb_build_array(
    jsonb_build_object('id', test.id('Q'), 'title', 'Clash'),
    jsonb_build_object('id', test.id('I_Q'), 'title', 'Under the clash', 'parentId', test.id('Q')))));
  PERFORM test.ok(r LIKE '22023%' AND NOT test.note_exists('I_Q'),
    'a batch id that is another workspace''s note doesn''t count as a parent in the batch', r);

  -- Parents in this workspace, or earlier in this batch, still work.
  r := test.as_user('O', test.import_sql('W', jsonb_build_array(
    jsonb_build_object('id', test.id('I_P'), 'title', 'Imported page'),
    jsonb_build_object('id', test.id('I_C'), 'title', 'Its child', 'parentId', test.id('I_P')),
    jsonb_build_object('id', test.id('I_W'), 'title', 'Under P', 'parentId', test.id('P')))));
  PERFORM test.ok(r = 'ok 1'
      AND (SELECT parent_id FROM public.notes WHERE id = test.id('I_C')) = test.id('I_P')
      AND (SELECT parent_id FROM public.notes WHERE id = test.id('I_W')) = test.id('P'),
    'parents in the batch and in the workspace import as before', r);

  -- AC3: the keys refuse a cross-workspace parent, log row or favorite even
  -- past every trigger (test.raw: the table owner, with no actor), so no op can.
  r := test.raw(format('UPDATE public.notes SET parent_id = %L WHERE id = %L',
    test.id('Q'), test.id('C')));
  PERFORM test.ok(r LIKE '23503%'
      AND (SELECT parent_id FROM public.notes WHERE id = test.id('C')) = test.id('P'),
    'a raw cross-workspace parent is refused by its key', r);
  r := test.raw(format(
    'INSERT INTO public.notes (id, workspace_id, created_by, title, parent_id) VALUES (%L, %L, %L, %L, %L)',
    test.id('N_X'), test.id('W2'), test.id('O'), 'Stray', test.id('P')));
  PERFORM test.ok(r LIKE '23503%' AND NOT test.note_exists('N_X'),
    'so is a new note in W2 under a W parent', r);
  r := test.raw(format(
    'INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64) VALUES (%L, %L, %L, 1, %L)',
    test.id('W2'), test.id('C'), test.id('CLIENT'), ''));
  PERFORM test.ok(r LIKE '23503%',
    'a log row filed under another workspace than its note is refused', r);
  r := test.raw(format(
    'INSERT INTO public.note_favorites (workspace_id, user_id, note_id) VALUES (%L, %L, %L)',
    test.id('W2'), test.id('O'), test.id('C')));
  PERFORM test.ok(r LIKE '23503%',
    'a favorite filed under another workspace than its note is refused', r);

  -- Assumption 2: can_access is unchanged, and its ceiling (the topmost
  -- ancestor's workspace) now always equals the note's own workspace.
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM public.notes c JOIN public.notes p ON p.id = c.parent_id
      WHERE p.workspace_id <> c.workspace_id),
    'no note anywhere has a parent in another workspace');
  PERFORM test.ok(NOT public.can_access('note', test.id('C'), 'view', test.id('U')),
    'so U (W2 only) still can''t reach W''s inherit note C');
END;
$$;

-- The keys' delete rules: removing a parent detaches its child in place,
-- removing a note takes its log rows and favorites with it.
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_op('O', format(
    'INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64) VALUES (%L, %L, %L, 1, %L)',
    test.id('W'), test.id('C'), test.id('CLIENT'), ''));
  PERFORM test.ok(r = 'ok 1', 'a log row in the note''s own workspace is accepted', r);
  r := test.as_op('O', format(
    'INSERT INTO public.note_favorites (workspace_id, user_id, note_id) VALUES (%L, %L, %L)',
    test.id('W'), test.id('O'), test.id('C')));
  PERFORM test.ok(r = 'ok 1', 'a favorite in the note''s own workspace is accepted', r);

  DELETE FROM public.notes WHERE id = test.id('I_P');
  PERFORM test.ok((SELECT parent_id IS NULL AND workspace_id = test.id('W')
      FROM public.notes WHERE id = test.id('I_C')),
    'deleting a parent sets only the child''s parent_id to NULL');

  DELETE FROM public.notes WHERE id = test.id('C');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.note_updates WHERE note_id = test.id('C'))
      AND NOT EXISTS (SELECT 1 FROM public.note_favorites WHERE note_id = test.id('C')),
    'deleting a note deletes its log rows and favorites');
END;
$$;
