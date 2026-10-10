-- Probe for supabase/migrations/20261010120000_tighten_write_checks.sql.
--
-- Runs on the local stack (docs/local-dev.md): `bun run local:reset` loads the
-- prod schema snapshot and applies the repo's newer migrations. The whole run
-- is one transaction that ends in ROLLBACK, so it leaves nothing behind:
--
--   psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -q -f supabase/probes/write-checks.probe.sql
--
-- Every check prints PASS or FAIL and the run goes on; it ends with
-- "PASS: all" or an error listing each failed check.
--
-- Cast: O owns workspace W. E and F are members who work on tasks, V is a
-- viewer. E also owns workspace WE, with a project EB in it. R and X are
-- members whose leaving tests the hand-over paths (member removal, account
-- erasure).
--
-- Writes run two ways: probe.as_user runs SQL as the signed-in user through
-- the `authenticated` role, so RLS applies (the app's direct table writes);
-- probe.as_op sets the same user as the actor but skips RLS, the way a
-- SECURITY DEFINER op writes. probe.try does either and then undoes whatever
-- the statement did, so a write that should be refused is judged by its
-- result alone and can't change the state later checks rely on.

BEGIN;
SET LOCAL client_min_messages = notice;
SELECT set_config('request.jwt.claims', '{}', true);

CREATE SCHEMA probe;
CREATE TABLE probe.result (n serial PRIMARY KEY, ok boolean NOT NULL, label text NOT NULL);

CREATE FUNCTION probe.id(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('write-checks:' || p_name)::uuid
$$;

CREATE FUNCTION probe.ok(p_cond boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO probe.result (ok, label) VALUES (coalesce(p_cond, false), p_label);
  IF p_cond IS TRUE THEN
    RAISE NOTICE 'PASS: %', p_label;
  ELSE
    RAISE NOTICE 'FAIL: % %', p_label, coalesce(' [' || p_detail || ']', '');
  END IF;
END;
$$;

-- 'ok <rows>' or '<sqlstate> <message>'. Effects of a statement that fails are
-- rolled back with it.
CREATE FUNCTION probe.run(p_who text, p_sql text, p_rls boolean) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_rows bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    -- No one (NULL): a system write, like delete-account's service role.
    PERFORM set_config('request.jwt.claims', CASE WHEN p_who IS NULL THEN '{}'
      ELSE json_build_object('sub', probe.id(p_who), 'role', 'authenticated')::text END, true);
    IF p_rls THEN
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    RETURN 'ok ' || v_rows;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN v_state || ' ' || v_msg;
  END;
END;
$$;

CREATE FUNCTION probe.as_user(p_who text, p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT probe.run(p_who, p_sql, true)
$$;
CREATE FUNCTION probe.as_op(p_who text, p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT probe.run(p_who, p_sql, false)
$$;

-- Runs like as_user (or as_op when p_rls is false), then rolls the statement
-- back. Returns what it returned.
CREATE FUNCTION probe.try(p_who text, p_sql text, p_rls boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  BEGIN
    v := probe.run(p_who, p_sql, p_rls);
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = v;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    v := SQLERRM;
  END;
  RETURN v;
END;
$$;

-- Refused by a rule (42501). A missing EXECUTE grant also raises 42501, but
-- that's a broken rule, not a refusal, so it doesn't count.
CREATE FUNCTION probe.denied(p_result text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_result LIKE '42501%' AND p_result NOT LIKE '%permission denied for%'
$$;

-- A write that didn't happen: refused by a rule, or filtered out by RLS.
CREATE FUNCTION probe.refused(p_result text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT probe.denied(p_result) OR p_result = 'ok 0'
$$;

-- How many rows a read returns to the signed-in user.
CREATE FUNCTION probe.count_as(p_who text, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe.id(p_who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') s' INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
END;
$$;

CREATE FUNCTION probe.grant_of(p_task text, p_who text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(g) FROM public.resource_grants g
  WHERE g.resource_type = 'task' AND g.resource_id = probe.id(p_task)
    AND g.subject_type = 'member' AND g.subject_id = probe.id(p_who)
$$;

-- ── World (system writes: no signed-in user) ────────────────────────────────

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', probe.id(n), 'authenticated', 'authenticated',
       'write-checks-' || lower(n) || '@example.com', jsonb_build_object('display_name', n), now(), now()
FROM unnest(ARRAY['O', 'E', 'F', 'V', 'R', 'X']) AS n;

INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (probe.id('W'), probe.id('O'), 'Team'),
  (probe.id('WE'), probe.id('E'), 'E''s own');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (probe.id('W'), probe.id('E'), 'member'),
  (probe.id('W'), probe.id('F'), 'member'),
  (probe.id('W'), probe.id('V'), 'viewer'),
  (probe.id('W'), probe.id('R'), 'member'),
  (probe.id('W'), probe.id('X'), 'member');

-- Projects. SB, AB, NB and XB are shared with the workspace (the default Can
-- edit); NB has no owner. IO is O's Inbox, PB is O's private project, RB is
-- R's private project.
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (probe.id('SB'), probe.id('W'), probe.id('O'), 'Shared', false),
  (probe.id('AB'), probe.id('W'), probe.id('O'), 'To archive', false),
  (probe.id('NB'), probe.id('W'), NULL, 'No owner', false),
  (probe.id('XB'), probe.id('W'), probe.id('X'), 'X shared', false),
  (probe.id('IO'), probe.id('W'), probe.id('O'), 'Inbox', true),
  (probe.id('PB'), probe.id('W'), probe.id('O'), 'O private', false),
  (probe.id('RB'), probe.id('W'), probe.id('R'), 'R private', false),
  (probe.id('VB'), probe.id('W'), probe.id('O'), 'View only', false),
  (probe.id('EB'), probe.id('WE'), probe.id('E'), 'E''s own project', false);
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (probe.id('PB'), probe.id('RB'));
UPDATE public.resource_grants SET level = 'view'
WHERE resource_type = 'bucket' AND resource_id = probe.id('VB') AND subject_type = 'workspace';

INSERT INTO public.tasks (id, workspace_id, bucket_id, title) VALUES
  (probe.id('T1'), probe.id('W'), probe.id('SB'), 'T1'),
  (probe.id('T2'), probe.id('W'), probe.id('SB'), 'T2'),
  (probe.id('T3'), probe.id('W'), probe.id('SB'), 'T3'),
  (probe.id('TP'), probe.id('W'), probe.id('IO'), 'TP'),
  (probe.id('TP2'), probe.id('W'), probe.id('IO'), 'TP2'),
  (probe.id('TA'), probe.id('W'), probe.id('PB'), 'TA'),
  (probe.id('TB'), probe.id('W'), probe.id('PB'), 'TB'),
  (probe.id('TC'), probe.id('W'), probe.id('PB'), 'TC'),
  (probe.id('TD'), probe.id('W'), probe.id('PB'), 'TD'),
  (probe.id('TE'), probe.id('W'), probe.id('PB'), 'TE'),
  (probe.id('TV'), probe.id('W'), probe.id('VB'), 'TV'),
  (probe.id('T4'), probe.id('W'), probe.id('SB'), 'T4'),
  (probe.id('T5'), probe.id('W'), probe.id('SB'), 'T5'),
  (probe.id('TH'), probe.id('W'), probe.id('IO'), 'TH');

INSERT INTO public.tags (id, workspace_id, owner_id, name) VALUES
  (probe.id('G1'), probe.id('W'), probe.id('O'), 'g1'),
  (probe.id('GD'), probe.id('W'), probe.id('O'), 'gd');
INSERT INTO public.tag_links (id, workspace_id, tag_id, entity_type, entity_id) VALUES
  (probe.id('L1'), probe.id('W'), probe.id('G1'), 'task', probe.id('T1')),
  (probe.id('LP'), probe.id('W'), probe.id('G1'), 'task', probe.id('TP')),
  (probe.id('LD1'), probe.id('W'), probe.id('GD'), 'task', probe.id('T1')),
  (probe.id('LDP'), probe.id('W'), probe.id('GD'), 'task', probe.id('TP'));

INSERT INTO public.task_relations (id, workspace_id, blocker_task_id, blocked_task_id) VALUES
  (probe.id('RV'), probe.id('W'), probe.id('T1'), probe.id('T2')),
  (probe.id('RP'), probe.id('W'), probe.id('TP'), probe.id('TP2')),
  (probe.id('RM'), probe.id('W'), probe.id('T1'), probe.id('TP')),
  (probe.id('RVW'), probe.id('W'), probe.id('T1'), probe.id('TV')),
  (probe.id('RWV'), probe.id('W'), probe.id('TV'), probe.id('T3')),
  -- T4 → TH → T5, through a task only O can see.
  (probe.id('RH1'), probe.id('W'), probe.id('T4'), probe.id('TH')),
  (probe.id('RH2'), probe.id('W'), probe.id('TH'), probe.id('T5'));

-- E's own rows in W, one per table perm_enforce_write guards.
INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES
  (probe.id('NE'), probe.id('W'), probe.id('E'), 'E note');
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64) VALUES
  (probe.id('W'), probe.id('NE'), 'write-checks', 1, '');
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES
  (probe.id('CE'), probe.id('W'), probe.id('E'), 'E contact');
INSERT INTO public.companies (id, workspace_id, owner_id, name) VALUES
  (probe.id('COE'), probe.id('W'), probe.id('E'), 'E company');
INSERT INTO public.calendar_events (id, workspace_id, owner_id, title, start_time, end_time) VALUES
  (probe.id('EVE'), probe.id('W'), probe.id('E'), 'E event', now(), now() + interval '1 hour');
INSERT INTO public.chat_channels (id, workspace_id, kind, name, created_by) VALUES
  (probe.id('CH'), probe.id('W'), 'channel', 'write-checks', probe.id('O'));
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body) VALUES
  (probe.id('ME'), probe.id('W'), probe.id('CH'), probe.id('E'), 'hello');
INSERT INTO public.task_queue (id, workspace_id, user_id, task_id, position) VALUES
  (probe.id('QE'), probe.id('W'), probe.id('E'), probe.id('T1'), 'a0');
INSERT INTO public.task_time_blocks (workspace_id, blocks) VALUES (probe.id('W'), '{}')
ON CONFLICT (workspace_id) DO NOTHING;

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.resource_grants WHERE resource_type = 'bucket'
                 AND resource_id = probe.id('SB') AND subject_type = 'workspace' AND level = 'edit'),
    'world: SB is shared with the workspace';
  ASSERT public.can_access('bucket', probe.id('SB'), 'edit', probe.id('E')), 'world: E can edit SB';
  ASSERT NOT public.can_access('bucket', probe.id('IO'), 'view', probe.id('E')), 'world: IO is O''s alone';
  ASSERT NOT public.can_access('task', probe.id('TP'), 'view', probe.id('E')), 'world: E can''t see TP';
  ASSERT NOT public.can_access('task', probe.id('TA'), 'view', probe.id('E')), 'world: E can''t see TA';
  ASSERT NOT public.perm_user_has(probe.id('W'), probe.id('V'), 'tasks.edit'), 'world: V is a viewer';
  ASSERT public.can_access('task', probe.id('TV'), 'view', probe.id('E'))
     AND NOT public.can_access('task', probe.id('TV'), 'edit', probe.id('E')), 'world: E can only view TV';
END;
$$;

-- ── Projects: owner, workspace and Inbox status are fixed ───────────────────

DO $$
DECLARE
  r text;
  b public.buckets;
BEGIN
  -- What the app does.
  r := probe.as_user('E', format(
    'UPDATE public.buckets SET name = %L, position = %L WHERE id = %L', 'Renamed', 'b5', probe.id('SB')));
  SELECT * INTO b FROM public.buckets WHERE id = probe.id('SB');
  PERFORM probe.ok(r = 'ok 1' AND b.name = 'Renamed' AND b.position = 'b5',
    'an editor can rename and reorder a shared project', r);

  -- What a build from before this change sends: the whole row, owner included.
  r := probe.as_user('E', format(
    'INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) '
    'VALUES (%L, %L, %L, %L, false, %L) ON CONFLICT (id) DO UPDATE SET '
    'workspace_id = EXCLUDED.workspace_id, owner_id = EXCLUDED.owner_id, name = EXCLUDED.name, '
    'is_system = EXCLUDED.is_system, position = EXCLUDED.position',
    probe.id('SB'), probe.id('W'), probe.id('O'), 'Upserted', 'b6'));
  SELECT * INTO b FROM public.buckets WHERE id = probe.id('SB');
  PERFORM probe.ok(r = 'ok 1' AND b.name = 'Upserted' AND b.owner_id = probe.id('O'),
    'a whole-row save that keeps the owner still works', r);

  -- Owner, Inbox flag and workspace.
  r := probe.try('E', format('UPDATE public.buckets SET owner_id = %L WHERE id = %L', probe.id('E'), probe.id('SB')));
  PERFORM probe.ok(r LIKE '42501 A project''s owner%', 'an editor can''t change a project''s owner', r);
  r := probe.try('E', format('UPDATE public.buckets SET owner_id = %L WHERE id = %L; SELECT public.share_op_make_private(%L, %L)',
    probe.id('E'), probe.id('SB'), 'bucket', probe.id('SB')));
  PERFORM probe.ok(probe.denied(r), 'an editor can''t make a shared project their own and then private', r);
  r := probe.try('E', format('UPDATE public.buckets SET is_system = true, owner_id = NULL WHERE id = %L', probe.id('SB')));
  PERFORM probe.ok(r LIKE '42501 A project''s owner%', 'an editor can''t turn a project into an Inbox without an owner', r);
  r := probe.try('E', format('UPDATE public.buckets SET is_system = true, owner_id = %L WHERE id = %L',
    probe.id('E'), probe.id('SB')));
  PERFORM probe.ok(r LIKE '42501 A project''s owner%', 'an editor can''t turn a project into their own Inbox', r);
  -- (Its owner already has an Inbox, so the one-Inbox index refuses this too.)
  r := probe.try('E', format('UPDATE public.buckets SET is_system = true WHERE id = %L', probe.id('SB')));
  PERFORM probe.ok(r NOT LIKE 'ok%', 'an editor can''t flag a project as an Inbox', r);
  r := probe.try('E', format('UPDATE public.buckets SET workspace_id = %L WHERE id = %L', probe.id('WE'), probe.id('SB')));
  PERFORM probe.ok(r LIKE '42501 A project''s owner%', 'an editor can''t move a project to another workspace', r);
  r := probe.try('O', format('UPDATE public.buckets SET owner_id = %L WHERE id = %L', probe.id('F'), probe.id('SB')));
  PERFORM probe.ok(r LIKE '42501 A project''s owner%', 'a project''s owner can''t hand it over with a direct write either', r);

  -- A project without an owner.
  r := probe.as_user('E', format('UPDATE public.buckets SET name = %L WHERE id = %L', 'NB renamed', probe.id('NB')));
  PERFORM probe.ok(r = 'ok 1' AND (SELECT name FROM public.buckets WHERE id = probe.id('NB')) = 'NB renamed',
    'an editor can rename a project that has no owner', r);
  r := probe.try('E', format('UPDATE public.buckets SET owner_id = %L WHERE id = %L', probe.id('E'), probe.id('NB')));
  PERFORM probe.ok(r LIKE '42501 A project''s owner%', 'an editor can''t claim a project that has no owner', r);
  r := probe.try('E', format('UPDATE public.buckets SET is_system = true WHERE id = %L', probe.id('NB')));
  PERFORM probe.ok(r LIKE '42501 A project''s owner%', 'an editor can''t flag an ownerless project as an Inbox', r);

  -- Archive (soft delete) and restore: Full, as before.
  r := probe.try('E', format('UPDATE public.buckets SET deleted_at = now() WHERE id = %L', probe.id('AB')));
  PERFORM probe.ok(probe.denied(r), 'archiving a project still needs Full (an editor can''t)', r);
  r := probe.as_user('O', format('UPDATE public.buckets SET deleted_at = now() WHERE id = %L', probe.id('AB')));
  PERFORM probe.ok(r = 'ok 1' AND (SELECT deleted_at FROM public.buckets WHERE id = probe.id('AB')) IS NOT NULL,
    'the owner can archive a project', r);
  r := probe.as_user('O', format('UPDATE public.buckets SET deleted_at = NULL WHERE id = %L', probe.id('AB')));
  PERFORM probe.ok(r = 'ok 1' AND (SELECT deleted_at FROM public.buckets WHERE id = probe.id('AB')) IS NULL,
    'the owner can restore it', r);
  r := probe.as_user('O', format('UPDATE public.buckets SET name = %L, position = %L WHERE id = %L', 'Inbox 2', 'a1', probe.id('IO')));
  PERFORM probe.ok(r = 'ok 1', 'the owner can rename and reorder their Inbox', r);
END;
$$;

-- ── Nothing moves between workspaces ────────────────────────────────────────

DO $$
DECLARE
  r text;
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('buckets', 'name = name || ''.''', 'id', 'SB'),
      ('tasks', 'title = title || ''.''', 'id', 'T1'),
      ('notes', 'title = title || ''.''', 'id', 'NE'),
      ('note_updates', 'client_seq = client_seq + 1', 'note_id', 'NE'),
      ('contacts', 'name = name || ''.''', 'id', 'CE'),
      ('companies', 'name = name || ''.''', 'id', 'COE'),
      ('calendar_events', 'title = title || ''.''', 'id', 'EVE'),
      ('chat_messages', 'body = body || ''.''', 'id', 'ME'),
      ('task_queue', 'position = ''a1''', 'id', 'QE'),
      ('task_time_blocks', 'blocks = ''{"1": "x"}''::jsonb', 'workspace_id', 'W'),
      ('task_relations', NULL, 'id', 'RV')
    ) AS v(tbl, edit, key, name)
  LOOP
    IF t.edit IS NOT NULL THEN
      r := probe.as_op('E', format('UPDATE public.%I SET %s WHERE %I = %L', t.tbl, t.edit, t.key, probe.id(t.name)));
      PERFORM probe.ok(r = 'ok 1', format('%s: an edit in place still works', t.tbl), r);
    END IF;
    r := probe.try('E', format('UPDATE public.%I SET workspace_id = %L WHERE %I = %L',
      t.tbl, probe.id('WE'), t.key, probe.id(t.name)), false);
    PERFORM probe.ok(r LIKE '42501 Items can''t move%' OR r LIKE '42501 A project''s owner%',
      format('%s: a row can''t move to another workspace', t.tbl), r);
  END LOOP;

  r := probe.try('E', format('UPDATE public.calendar_events SET workspace_id = NULL WHERE id = %L', probe.id('EVE')), false);
  PERFORM probe.ok(r LIKE '42501 Items can''t move%', 'calendar_events: an event can''t leave its workspace', r);

  -- A task goes only into a project of its own workspace.
  r := probe.try('E', format('UPDATE public.tasks SET bucket_id = %L WHERE id = %L', probe.id('EB'), probe.id('T1')));
  PERFORM probe.ok(r LIKE '42501 That project is in another workspace%', 'a task can''t move into a project in another workspace', r);
  r := probe.try('E', format('INSERT INTO public.tasks (workspace_id, bucket_id, title) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('EB'), 'elsewhere'));
  PERFORM probe.ok(r LIKE '42501 That project is in another workspace%', 'a task can''t be made in a project of another workspace', r);
  r := probe.as_user('E', format('UPDATE public.tasks SET bucket_id = %L WHERE id = %L', probe.id('NB'), probe.id('T3')));
  r := r || ' / ' || probe.as_user('E', format('UPDATE public.tasks SET bucket_id = %L WHERE id = %L', probe.id('SB'), probe.id('T3')));
  PERFORM probe.ok(r = 'ok 1 / ok 1' AND (SELECT bucket_id FROM public.tasks WHERE id = probe.id('T3')) = probe.id('SB'),
    'a task still moves between projects of its workspace', r);
END;
$$;

-- ── Tags ────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r text;
  g public.tags;
BEGIN
  -- Viewers read tags but don't write them.
  PERFORM probe.ok(probe.count_as('V', format('SELECT 1 FROM public.tags WHERE workspace_id = %L', probe.id('W'))) >= 2,
    'a viewer sees the workspace''s tags');
  r := probe.try('V', format('INSERT INTO public.tags (workspace_id, owner_id, name) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('V'), 'by viewer'));
  PERFORM probe.ok(probe.refused(r), 'a viewer can''t create a tag', r);
  r := probe.try('V', format('UPDATE public.tags SET name = %L WHERE id = %L', 'renamed by viewer', probe.id('G1')));
  PERFORM probe.ok(probe.refused(r), 'a viewer can''t rename a tag', r);
  r := probe.try('V', format('UPDATE public.tags SET owner_id = %L WHERE id = %L', probe.id('V'), probe.id('G1')));
  PERFORM probe.ok(probe.refused(r), 'a viewer can''t take over a tag', r);
  r := probe.try('V', format('UPDATE public.tags SET deleted_at = now() WHERE id = %L', probe.id('G1')));
  PERFORM probe.ok(probe.refused(r), 'a viewer can''t delete a tag', r);
  r := probe.try('V', format('DELETE FROM public.tags WHERE id = %L', probe.id('G1')));
  PERFORM probe.ok(probe.refused(r), 'a viewer can''t erase a tag', r);
  r := probe.try('V', format(
    'INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id) VALUES (%L, %L, %L, %L)',
    probe.id('W'), probe.id('G1'), 'task', probe.id('T2')));
  PERFORM probe.ok(probe.refused(r), 'a viewer can''t tag a task', r);
  r := probe.try('V', format('DELETE FROM public.tag_links WHERE id = %L', probe.id('L1')));
  PERFORM probe.ok(probe.refused(r), 'a viewer can''t untag a task', r);
  PERFORM probe.ok(probe.count_as('V', format('SELECT 1 FROM public.tag_links WHERE id = %L', probe.id('L1'))) = 1,
    'a viewer sees the tags on a task they can see');

  -- Links on items you can't see stay out of reach.
  PERFORM probe.ok(probe.count_as('E', format('SELECT 1 FROM public.tag_links WHERE id = %L', probe.id('LP'))) = 0,
    'a member doesn''t see the tags on a task they can''t see');
  r := probe.try('E', format('DELETE FROM public.tag_links WHERE id = %L', probe.id('LP')));
  PERFORM probe.ok(probe.refused(r), 'a member can''t untag a task they can''t see', r);
  r := probe.try('E', format(
    'INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id) VALUES (%L, %L, %L, %L)',
    probe.id('W'), probe.id('G1'), 'task', probe.id('TP2')));
  PERFORM probe.ok(probe.refused(r), 'a member can''t tag a task they can''t see', r);
  r := probe.try('E', format(
    'INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id) VALUES (%L, %L, %L, %L)',
    probe.id('W'), probe.id('G1'), 'bucket', probe.id('EB')));
  PERFORM probe.ok(probe.refused(r), 'a tag can''t go on an item of another workspace', r);

  -- What the app does, as an editor.
  r := probe.as_user('E', format('INSERT INTO public.tags (id, workspace_id, owner_id, name) VALUES (%L, %L, %L, %L)',
    probe.id('G2'), probe.id('W'), probe.id('E'), 'g2'));
  PERFORM probe.ok(r = 'ok 1', 'an editor can create a tag', r);
  r := probe.try('E', format('INSERT INTO public.tags (workspace_id, owner_id, name) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('O'), 'for someone else'));
  PERFORM probe.ok(probe.refused(r), 'a new tag is the creator''s own', r);
  r := probe.as_user('E', format('UPDATE public.tags SET name = %L, color = %L WHERE id = %L', 'g1 renamed', 'blue', probe.id('G1')));
  SELECT * INTO g FROM public.tags WHERE id = probe.id('G1');
  PERFORM probe.ok(r = 'ok 1' AND g.name = 'g1 renamed' AND g.color = 'blue', 'an editor can rename and recolor a tag', r);
  r := probe.as_user('E', format(
    'INSERT INTO public.tags (id, workspace_id, owner_id, name, color) VALUES (%L, %L, %L, %L, %L) '
    'ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, owner_id = EXCLUDED.owner_id, '
    'name = EXCLUDED.name, color = EXCLUDED.color',
    probe.id('G1'), probe.id('W'), probe.id('O'), 'g1 upserted', 'red'));
  PERFORM probe.ok(r = 'ok 1' AND (SELECT name FROM public.tags WHERE id = probe.id('G1')) = 'g1 upserted',
    'a whole-row save of someone else''s tag that keeps the owner still works', r);
  r := probe.try('E', format('UPDATE public.tags SET owner_id = %L WHERE id = %L', probe.id('E'), probe.id('G1')));
  PERFORM probe.ok(r LIKE '42501 A tag''s owner%', 'an editor can''t take over a tag', r);
  r := probe.try('E', format('UPDATE public.tags SET workspace_id = %L WHERE id = %L', probe.id('WE'), probe.id('G2')));
  PERFORM probe.ok(r LIKE '42501 A tag''s owner%', 'a tag can''t move to another workspace', r);

  r := probe.as_user('E', format(
    'INSERT INTO public.tag_links (id, workspace_id, tag_id, entity_type, entity_id) VALUES (%L, %L, %L, %L, %L)',
    probe.id('L2'), probe.id('W'), probe.id('G2'), 'task', probe.id('T2')));
  PERFORM probe.ok(r = 'ok 1', 'an editor can tag a task', r);
  r := probe.as_user('E', format('DELETE FROM public.tag_links WHERE workspace_id = %L AND tag_id = %L AND entity_type = %L AND entity_id = %L',
    probe.id('W'), probe.id('G2'), 'task', probe.id('T2')));
  PERFORM probe.ok(r = 'ok 1', 'an editor can untag a task', r);
  r := probe.try('E', format('UPDATE public.tag_links SET entity_id = %L WHERE id = %L', probe.id('T3'), probe.id('L1')));
  PERFORM probe.ok(probe.refused(r), 'a tag link isn''t rewritten in place', r);
  r := probe.try('E', format('DELETE FROM public.tags WHERE id = %L', probe.id('G2')));
  PERFORM probe.ok(probe.refused(r), 'tags are never erased from the app', r);

  -- Deleting a tag (what the app's delete does): it comes off everything,
  -- including items the person deleting it can't see.
  r := probe.as_user('E', format('DELETE FROM public.tag_links WHERE tag_id = %L', probe.id('GD')));
  r := r || ' / ' || probe.as_user('E', format('UPDATE public.tags SET deleted_at = now() WHERE id = %L', probe.id('GD')));
  PERFORM probe.ok((SELECT deleted_at FROM public.tags WHERE id = probe.id('GD')) IS NOT NULL,
    'an editor can delete a tag', r);
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.tag_links WHERE tag_id = probe.id('GD')),
    'a deleted tag comes off everything it was on');
END;
$$;

-- ── Dependencies ────────────────────────────────────────────────────────────

DO $$
DECLARE
  r text;
BEGIN
  PERFORM probe.ok(probe.count_as('E', format('SELECT 1 FROM public.task_relations WHERE id = %L', probe.id('RV'))) = 1,
    'a member sees a dependency between two tasks they can see');
  PERFORM probe.ok(probe.count_as('E', format('SELECT 1 FROM public.task_relations WHERE id IN (%L, %L, %L, %L)',
    probe.id('RP'), probe.id('RM'), probe.id('RH1'), probe.id('RH2'))) = 0,
    'a member doesn''t see a dependency on a task they can''t see');
  r := probe.try('E', format('DELETE FROM public.task_relations WHERE id = %L', probe.id('RP')));
  PERFORM probe.ok(probe.refused(r), 'a member can''t remove a dependency between tasks they can''t see', r);
  r := probe.try('E', format('UPDATE public.task_relations SET blocked_task_id = %L WHERE id = %L',
    probe.id('T3'), probe.id('RV')));
  PERFORM probe.ok(probe.refused(r), 'a dependency isn''t rewritten in place', r);
  r := probe.try('E', format(
    'INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('TP2'), probe.id('T3')));
  PERFORM probe.ok(r NOT LIKE 'ok%', 'a member can''t make a task wait on one they can''t see', r);
  r := probe.try('E', format(
    'INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('T3'), probe.id('TP2')));
  PERFORM probe.ok(r NOT LIKE 'ok%', 'a member can''t make a task they can''t see wait on another', r);
  r := probe.try('E', format(
    'INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('T2'), probe.id('TV')));
  PERFORM probe.ok(probe.refused(r), 'a member can''t make a task they can only view wait on another', r);
  r := probe.as_user('E', format(
    'INSERT INTO public.task_relations (id, workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L, %L)',
    probe.id('RVN'), probe.id('W'), probe.id('TV'), probe.id('T2')));
  PERFORM probe.ok(r = 'ok 1', 'a member can make a task they edit wait on one they can only view', r);
  PERFORM probe.ok(probe.count_as('E', format('SELECT 1 FROM public.task_relations WHERE id IN (%L, %L)',
    probe.id('RVW'), probe.id('RWV'))) = 2, 'a member sees dependencies on a task they can only view');
  r := probe.try('E', format('DELETE FROM public.task_relations WHERE id = %L', probe.id('RVW')));
  PERFORM probe.ok(probe.refused(r), 'removing a dependency needs Edit on the waiting task', r);
  r := probe.as_user('E', format('DELETE FROM public.task_relations WHERE id = %L', probe.id('RWV')));
  PERFORM probe.ok(r = 'ok 1', 'a member can remove what a task they edit waits on', r);
  r := probe.try('V', format(
    'INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('T3'), probe.id('T2')));
  PERFORM probe.ok(r NOT LIKE 'ok%', 'a viewer can''t add a dependency', r);

  -- T4 → TH → T5 runs through a task E can't see; T5 → T4 would close a loop.
  r := probe.try('E', format(
    'INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L)',
    probe.id('W'), probe.id('T5'), probe.id('T4')));
  PERFORM probe.ok(r LIKE '%cycle%', 'a dependency that closes a loop is refused, also through a task the member can''t see', r);

  r := probe.as_user('E', format(
    'INSERT INTO public.task_relations (id, workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L, %L)',
    probe.id('RN'), probe.id('W'), probe.id('T3'), probe.id('T2')));
  PERFORM probe.ok(r = 'ok 1', 'an editor can add a dependency', r);
  PERFORM probe.ok(EXISTS (SELECT 1 FROM public.entity_links WHERE workspace_id = probe.id('W') AND relation_kind = 'blocks'
                           AND source_id = probe.id('T3') AND target_id = probe.id('T2') AND deleted_at IS NULL),
    'the new dependency shows as a link');
  r := probe.as_user('E', format('DELETE FROM public.task_relations WHERE workspace_id = %L AND id = %L',
    probe.id('W'), probe.id('RN')));
  PERFORM probe.ok(r = 'ok 1', 'an editor can remove a dependency', r);
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.entity_links WHERE workspace_id = probe.id('W') AND relation_kind = 'blocks'
                               AND source_id = probe.id('T3') AND target_id = probe.id('T2') AND deleted_at IS NULL),
    'the removed dependency''s link goes too');
END;
$$;

-- ── Assignment grants ───────────────────────────────────────────────────────

DO $$
DECLARE
  r text;
BEGIN
  -- TA is in O's private project: assigning it is what lets someone in.
  r := probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TA'), probe.id('E')));
  PERFORM probe.ok(r = 'ok 1' AND public.can_access('task', probe.id('TA'), 'edit', probe.id('E')),
    'assigning a private task lets the assignee work on it', r);
  PERFORM probe.ok(probe.grant_of('TA', 'E') ->> 'origin' = 'assign', 'that access is marked as the assignment''s',
    probe.grant_of('TA', 'E')::text);

  r := probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TA'), probe.id('F')));
  PERFORM probe.ok(r = 'ok 1' AND public.can_access('task', probe.id('TA'), 'edit', probe.id('F')),
    'reassigning gives the new assignee access', r);
  PERFORM probe.ok(NOT public.can_access('task', probe.id('TA'), 'view', probe.id('E')),
    'reassigning takes the access the assignment gave away from the previous assignee',
    probe.grant_of('TA', 'E')::text);

  -- Unassigning the way the app writes it (a direct update).
  r := probe.as_user('O', format('UPDATE public.tasks SET assignee_id = NULL WHERE id = %L', probe.id('TA')));
  PERFORM probe.ok(r = 'ok 1' AND NOT public.can_access('task', probe.id('TA'), 'view', probe.id('F')),
    'unassigning takes it away too', coalesce(r || ' ' || probe.grant_of('TA', 'F')::text, r));

  -- A share made by hand stays.
  r := probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, %L)',
    'task', probe.id('TB'), 'member', probe.id('E'), 'edit'));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TB'), probe.id('E')));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TB'), probe.id('F')));
  PERFORM probe.ok(public.can_access('task', probe.id('TB'), 'edit', probe.id('E')),
    'a task shared by hand stays shared after the assignee changes', r);

  -- Assignment never lowers a share.
  r := probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, %L)',
    'task', probe.id('TC'), 'member', probe.id('E'), 'full'));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TC'), probe.id('E')));
  PERFORM probe.ok(probe.grant_of('TC', 'E') ->> 'level' = 'full', 'assigning someone with Full keeps Full', r);

  -- A View share made by hand: assigning raises it to Edit, and it goes back
  -- to View when the assignment ends (unassigned, or given to someone else).
  r := probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, %L)',
    'task', probe.id('TD'), 'member', probe.id('E'), 'view'));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TD'), probe.id('E')));
  PERFORM probe.ok(public.can_access('task', probe.id('TD'), 'edit', probe.id('E'))
    AND probe.grant_of('TD', 'E') ->> 'manual_level' = 'view',
    'assigning someone a task shared with them to view lets them edit it', coalesce(r || ' ' || probe.grant_of('TD', 'E')::text, r));
  r := probe.as_user('O', format('UPDATE public.tasks SET assignee_id = NULL WHERE id = %L', probe.id('TD')));
  PERFORM probe.ok(r = 'ok 1' AND public.can_access('task', probe.id('TD'), 'view', probe.id('E'))
    AND NOT public.can_access('task', probe.id('TD'), 'edit', probe.id('E'))
    AND probe.grant_of('TD', 'E') ->> 'origin' = 'manual',
    'unassigning puts a hand share back to View', coalesce(r || ' ' || probe.grant_of('TD', 'E')::text, r));
  r := probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TD'), probe.id('E')));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TD'), probe.id('F')));
  PERFORM probe.ok(public.can_access('task', probe.id('TD'), 'view', probe.id('E'))
    AND NOT public.can_access('task', probe.id('TD'), 'edit', probe.id('E')),
    'reassigning puts a hand share back to View too', coalesce(r || ' ' || probe.grant_of('TD', 'E')::text, r));

  -- A View share set by hand on the current assignee keeps their Edit while
  -- they're assigned and applies once they aren't.
  r := probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TD'), probe.id('E')));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, %L)',
    'task', probe.id('TD'), 'member', probe.id('E'), 'view'));
  PERFORM probe.ok(public.can_access('task', probe.id('TD'), 'edit', probe.id('E')),
    'sharing a task to view with its assignee keeps their Edit while assigned', coalesce(r || ' ' || probe.grant_of('TD', 'E')::text, r));
  r := probe.as_user('O', format('UPDATE public.tasks SET assignee_id = NULL WHERE id = %L', probe.id('TD')));
  PERFORM probe.ok(public.can_access('task', probe.id('TD'), 'view', probe.id('E'))
    AND NOT public.can_access('task', probe.id('TD'), 'edit', probe.id('E')),
    'and leaves them View once unassigned', coalesce(r || ' ' || probe.grant_of('TD', 'E')::text, r));

  -- Lowering a share set by hand (Full, above) while its holder is assigned
  -- the task: they keep Edit until the assignment ends, then have View.
  r := probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, %L)',
    'task', probe.id('TC'), 'member', probe.id('E'), 'view'));
  PERFORM probe.ok(public.can_access('task', probe.id('TC'), 'edit', probe.id('E')),
    'lowering a hand share on the assignee keeps their Edit while assigned', coalesce(r || ' ' || probe.grant_of('TC', 'E')::text, r));
  r := probe.as_user('O', format('UPDATE public.tasks SET assignee_id = NULL WHERE id = %L', probe.id('TC')));
  PERFORM probe.ok(public.can_access('task', probe.id('TC'), 'view', probe.id('E'))
    AND NOT public.can_access('task', probe.id('TC'), 'edit', probe.id('E')),
    'and it applies once they''re unassigned', coalesce(r || ' ' || probe.grant_of('TC', 'E')::text, r));

  -- Taking a hand share away from the assignee: same, then nothing.
  r := probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, %L)',
    'task', probe.id('TE'), 'member', probe.id('E'), 'view'));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TE'), probe.id('E')));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, NULL)',
    'task', probe.id('TE'), 'member', probe.id('E')));
  PERFORM probe.ok(public.can_access('task', probe.id('TE'), 'edit', probe.id('E')),
    'removing a hand share from the assignee keeps their Edit while assigned', coalesce(r || ' ' || probe.grant_of('TE', 'E')::text, r));
  r := probe.as_user('O', format('UPDATE public.tasks SET assignee_id = NULL WHERE id = %L', probe.id('TE')));
  PERFORM probe.ok(NOT public.can_access('task', probe.id('TE'), 'view', probe.id('E')),
    'and they lose the task once unassigned', coalesce(r || ' ' || probe.grant_of('TE', 'E')::text, r));

  -- An assignment grant turned into a hand share by the owner stays.
  r := probe.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', probe.id('W'), probe.id('TA'), probe.id('E')));
  r := r || ' / ' || probe.as_user('O', format('SELECT public.share_op_set(%L, %L, %L, %L, %L)',
    'task', probe.id('TA'), 'member', probe.id('E'), 'edit'));
  r := r || ' / ' || probe.as_user('O', format('UPDATE public.tasks SET assignee_id = NULL WHERE id = %L', probe.id('TA')));
  PERFORM probe.ok(public.can_access('task', probe.id('TA'), 'edit', probe.id('E')),
    'sharing by hand after assigning keeps the share past unassigning', r);
END;
$$;

-- ── Hand-overs that change a project's owner on purpose ─────────────────────

DO $$
DECLARE
  r text;
BEGIN
  -- Removing R: their private project goes to O's archive.
  r := probe.as_user('O', format('SELECT public.workspace_op_remove_member(%L)',
    (SELECT id FROM public.workspace_members WHERE workspace_id = probe.id('W') AND user_id = probe.id('R'))));
  PERFORM probe.ok(r = 'ok 1' AND (SELECT owner_id FROM public.buckets WHERE id = probe.id('RB')) = probe.id('O'),
    'removing a member still hands their private project to the owner', r);

  -- Erasing X's account (delete-account runs it without a signed-in user).
  r := probe.run(NULL, format('SELECT public.account_erase_workspace_data(%L, false)', probe.id('X')), false);
  PERFORM probe.ok(r = 'ok 1' AND (SELECT owner_id FROM public.buckets WHERE id = probe.id('XB')) IS DISTINCT FROM probe.id('X'),
    'account erasure still hands a shared project to someone else', r);
END;
$$;

-- ── Result ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_failed text;
  v_total int;
BEGIN
  SELECT string_agg('  ' || label, E'\n' ORDER BY n) INTO v_failed FROM probe.result WHERE NOT ok;
  SELECT count(*) INTO v_total FROM probe.result;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (% of % checks):%', (SELECT count(*) FROM probe.result WHERE NOT ok), v_total,
      E'\n' || v_failed;
  END IF;
  RAISE NOTICE 'PASS: all (% checks)', v_total;
END;
$$;

ROLLBACK;
