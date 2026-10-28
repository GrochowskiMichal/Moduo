-- NS-8 · Writes check once (specs/notes-schema-hardening.md AC9, Assumption 8;
-- supabase/migrations/20261030170000_notes_writes_check_once.sql).
-- notes_op_apply_updates inserts a batch in one statement, and the checks on
-- note_updates run once per statement: edit is checked once per distinct note
-- (not once per row), viewers are queued once per note, compaction deletes
-- check once. A replay of updates the server already has writes nothing to
-- `notes`, so Recents doesn't move.
--
-- Cast: O owns W. E is a member with an edit share on N, V a viewer with a
-- view share, C a member whose role can't edit notes (an edit share all the
-- same). KE is O's key with Notes: Edit. H is O's note nobody else can open.

-- Count function calls in this transaction (pg_stat_get_xact_function_calls).
SET LOCAL track_functions = 'pl';

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'C']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('C'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
UPDATE public.workspace_members SET overrides = '{"notes.edit": false}'::jsonb
  WHERE workspace_id = test.id('W') AND user_id = test.id('C');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KE'), test.id('W'), 'Writer', 'mdo_ns8e', md5('db-test-ns8-ke'), '{"notes": "edit"}', test.id('O'));

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text, position) VALUES
  (test.id('N'), test.id('W'), test.id('O'), 'Q4 plan', 'body', 'body', 'a'),
  (test.id('H'), test.id('W'), test.id('O'), 'Salaries', 'secret', 'secret', 'b');
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('N'), test.id('H'));
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('N'), test.id('H'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('N'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'note', test.id('N'), 'member', test.id('V'), 'view', test.id('O')),
       (test.id('W'), 'note', test.id('N'), 'member', test.id('C'), 'edit', test.id('O'));

-- Access checks made so far in this transaction (both can_access overloads).
CREATE FUNCTION test.checks() RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(pg_stat_get_xact_function_calls('public.can_access(text,uuid,text,uuid)'::regprocedure), 0)
       + coalesce(pg_stat_get_xact_function_calls('public.can_access(text,uuid,text)'::regprocedure), 0)
$$;
-- A batch of p_n updates numbered from p_from.
CREATE FUNCTION test.batch(p_from int, p_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('clientSeq', s, 'updateB64', 'AQ==') ORDER BY s)
  FROM generate_series(p_from, p_from + p_n - 1) s
$$;
-- apply_updates as p_who, answering its jsonb result (or the error).
CREATE FUNCTION test.apply(p_who text, p_client text, p_updates jsonb,
                           p_body_text text DEFAULT NULL, p_body_md text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  v := test.value_as(p_who, format(
    $q$SELECT public.notes_op_apply_updates(%L, %L, %L, %L::jsonb, %L, %L)::text$q$,
    test.id('W'), test.id('N'), p_client, p_updates, p_body_text, p_body_md));
  IF v LIKE 'ERROR %' THEN
    RETURN jsonb_build_object('error', v);
  END IF;
  RETURN v::jsonb;
END;
$$;
CREATE FUNCTION test.commit_point() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET CONSTRAINTS public.notes_live_send_pending IMMEDIATE;
  SET CONSTRAINTS public.notes_live_send_pending DEFERRED;
END;
$$;
CREATE FUNCTION test.told(p_who text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM realtime.messages
  WHERE topic = 'notes-live:' || test.id(p_who)::text AND event = 'changed'
    AND payload ->> 'noteId' = test.id('N')::text
$$;

-- ── The triggers on note_updates are per statement ─────────────────────────

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid = 'public.note_updates'::regclass AND NOT t.tgisinternal
    AND (t.tgtype & 1) = 1                -- FOR EACH ROW
    AND (t.tgtype & (4 | 8)) <> 0),       -- on INSERT or DELETE
  'triggers: nothing on note_updates fires per inserted or deleted row');
SELECT test.ok(EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid = 'public.note_updates'::regclass AND NOT t.tgisinternal
    AND (t.tgtype & 1) = 0 AND (t.tgtype & 4) <> 0 AND t.tgnewtable IS NOT NULL),
  'triggers: an AFTER INSERT statement trigger reads the inserted rows');
SELECT test.ok(EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgrelid = 'public.note_updates'::regclass AND NOT t.tgisinternal
    AND (t.tgtype & 1) = 0 AND (t.tgtype & 8) <> 0 AND t.tgoldtable IS NOT NULL),
  'triggers: an AFTER DELETE statement trigger reads the deleted rows');

-- ── A 500-row batch: inserted in one go, checked once, viewers told once ───

-- V and E have the note open.
SELECT test.value_as('V', format($q$SELECT public.notes_live_here(%L, 's1')::text$q$, test.id('N')));
SELECT test.value_as('E', format($q$SELECT public.notes_live_here(%L, 's1')::text$q$, test.id('N')));
SELECT test.commit_point();

CREATE TABLE test.m (k text PRIMARY KEY, v jsonb, checks bigint);

INSERT INTO test.m (k, checks) VALUES ('before-one', test.checks());
INSERT INTO test.m (k, v) VALUES ('one', test.apply('E', 'tab-one', test.batch(1, 1)));
INSERT INTO test.m (k, checks) VALUES ('after-one', test.checks());
SELECT test.commit_point();

INSERT INTO test.m (k, checks) VALUES ('before-500', test.checks());
INSERT INTO test.m (k, v) VALUES ('500', test.apply('E', 'tab-e', test.batch(1, 500)));
INSERT INTO test.m (k, checks) VALUES ('after-500', test.checks());

DO $$
DECLARE
  r jsonb := (SELECT v FROM test.m WHERE k = '500');
  one_checks bigint := (SELECT checks FROM test.m WHERE k = 'after-one') - (SELECT checks FROM test.m WHERE k = 'before-one');
  big_checks bigint := (SELECT checks FROM test.m WHERE k = 'after-500') - (SELECT checks FROM test.m WHERE k = 'before-500');
BEGIN
  PERFORM test.ok((r ->> 'inserted')::int = 500 AND (r ->> 'duplicates')::int = 0,
    '500: every update is inserted', r::text);
  PERFORM test.ok((SELECT count(*) FROM public.note_updates WHERE note_id = test.id('N') AND client_id = 'tab-e') = 500,
    '500: 500 rows are stored');
  PERFORM test.ok((r ->> 'max_update_id')::bigint = (SELECT max(id) FROM public.note_updates WHERE note_id = test.id('N')),
    '500: max_update_id is the newest stored update', r::text);
  PERFORM test.ok((SELECT array_agg(client_seq ORDER BY id) FROM public.note_updates
                   WHERE note_id = test.id('N') AND client_id = 'tab-e')
                  = (SELECT array_agg(s ORDER BY s) FROM generate_series(1, 500) s),
    '500: rows are stored in the order sent');
  PERFORM test.ok(big_checks = one_checks AND big_checks BETWEEN 1 AND 6,
    '500: access is checked as often as for one update, once per note',
    format('one update: %s checks, 500 updates: %s checks', one_checks, big_checks));
  PERFORM test.ok((SELECT count(*) FROM public.note_live_pending WHERE note_id = test.id('N')) = 1,
    '500: the note is queued for its viewers once');
END $$;

SELECT test.ok((SELECT edited_by FROM public.notes WHERE id = test.id('N')) = test.id('E'),
  '500: the note is marked edited by E');

-- Commit: V hears "changed" once for the whole batch.
INSERT INTO test.m (k, v) VALUES ('told-before', to_jsonb(test.told('V')));
SELECT test.commit_point();
SELECT test.ok(test.told('V') - (SELECT v::text::int FROM test.m WHERE k = 'told-before') = 1,
  '500: V is told once that the note changed');

-- ── An all-duplicate replay writes nothing to notes ────────────────────────

UPDATE public.notes SET updated_at = '2020-01-01T00:00:00Z', edited_at = '2020-01-01T00:00:00Z',
                        edited_by = test.id('O')
  WHERE id = test.id('N');

INSERT INTO test.m (k, v) VALUES ('replay', test.apply('E', 'tab-e', test.batch(1, 500), 'body', 'body'));
SELECT test.ok(((SELECT v FROM test.m WHERE k = 'replay') ->> 'inserted')::int = 0
               AND ((SELECT v FROM test.m WHERE k = 'replay') ->> 'duplicates')::int = 500,
  'replay: all 500 are duplicates', (SELECT v::text FROM test.m WHERE k = 'replay'));
SELECT test.ok((SELECT updated_at FROM public.notes WHERE id = test.id('N')) = '2020-01-01T00:00:00Z',
  'replay: updated_at is left alone (Recents does not move)');
SELECT test.ok((SELECT edited_at = '2020-01-01T00:00:00Z' AND edited_by = test.id('O')
                FROM public.notes WHERE id = test.id('N')),
  'replay: edited_at and edited_by are left alone');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.note_live_pending WHERE note_id = test.id('N')),
  'replay: nobody is told anything');
SELECT test.ok(((SELECT v FROM test.m WHERE k = 'replay') ->> 'max_update_id')::bigint
               = (SELECT max(id) FROM public.note_updates WHERE note_id = test.id('N')),
  'replay: max_update_id still answers');

-- An empty call with no body writes nothing either.
SELECT test.apply('E', 'tab-e', '[]'::jsonb);
SELECT test.ok((SELECT updated_at FROM public.notes WHERE id = test.id('N')) = '2020-01-01T00:00:00Z',
  'empty: an empty batch leaves updated_at alone');

-- A body that really changed is still saved, even with no new updates.
SELECT test.apply('E', 'tab-e', test.batch(1, 3), 'new body', 'new body');
SELECT test.ok((SELECT updated_at = now() AND body_text = 'new body' AND body_md = 'new body'
                FROM public.notes WHERE id = test.id('N')),
  'body: a changed body is saved and bumps updated_at');
SELECT test.ok((SELECT edited_at = '2020-01-01T00:00:00Z' FROM public.notes WHERE id = test.id('N')),
  'body: a body change alone does not mark the note edited');

-- A mixed batch counts duplicates, including one repeated inside the batch.
INSERT INTO test.m (k, v) VALUES ('mixed', test.apply('E', 'tab-e',
  '[{"clientSeq": 500, "updateB64": "AQ=="}, {"clientSeq": 501, "updateB64": "AQ=="},
    {"clientSeq": 501, "updateB64": "AQ=="}, {"clientSeq": 502, "updateB64": "AQ=="}]'::jsonb));
SELECT test.ok(((SELECT v FROM test.m WHERE k = 'mixed') ->> 'inserted')::int = 2
               AND ((SELECT v FROM test.m WHERE k = 'mixed') ->> 'duplicates')::int = 2,
  'mixed: 2 inserted, 2 duplicates (one stored, one repeated in the batch)',
  (SELECT v::text FROM test.m WHERE k = 'mixed'));

-- A malformed update is still refused.
SELECT test.ok((test.apply('E', 'tab-e', '[{"clientSeq": 900}]'::jsonb) ->> 'error') LIKE '%clientSeq and updateB64%',
  'shape: an update without updateB64 is refused');

-- ── A key write still leaves one activity row ──────────────────────────────

SELECT test.as_key('KE', format(
  $q$SELECT public.notes_op_apply_updates(%L, %L, 'mcp', %L::jsonb)$q$,
  test.id('W'), test.id('N'), test.batch(1, 20)));
SELECT test.ok((SELECT count(*) FROM public.module_activity
                WHERE entity_id = test.id('N') AND op = 'notes.agent_edit') = 1,
  'key: a key write with 20 updates leaves one notes.agent_edit row');
SELECT test.ok((SELECT count(*) FROM public.note_updates
                WHERE note_id = test.id('N') AND client_id = 'mcp' AND origin = 'api_key'
                  AND actor_key_id = test.id('KE') AND user_id IS NULL) = 20,
  'key: the rows are attributed to the key');
SELECT test.as_key('KE', format(
  $q$SELECT public.notes_op_apply_updates(%L, %L, 'mcp', %L::jsonb)$q$,
  test.id('W'), test.id('N'), test.batch(1, 20)));
SELECT test.ok((SELECT count(*) FROM public.module_activity
                WHERE entity_id = test.id('N') AND op = 'notes.agent_edit') = 1,
  'key: a replayed key write adds no activity row');

-- ── Direct writes by someone without edit still fail ───────────────────────

CREATE FUNCTION test.insert_sql(p_note text, p_client text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
                   VALUES (%L, %L, %L, 1, 'AQ==')$q$, test.id('W'), test.id(p_note), p_client)
$$;

SELECT test.ok(test.as_op('V', test.insert_sql('N', 'v-direct')) LIKE '42501%',
  'direct: V (view share) can''t insert an update', test.as_op('V', test.insert_sql('N', 'v-direct')));
SELECT test.ok(test.as_op('C', test.insert_sql('N', 'c-direct')) LIKE '42501%Your role can''t edit notes%',
  'direct: C (role without notes.edit) can''t insert an update', test.as_op('C', test.insert_sql('N', 'c-direct')));
SELECT test.ok(test.as_op('E', format(
  $q$INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
     VALUES (%L, %L, 'e-two', 1, 'AQ=='), (%L, %L, 'e-two', 1, 'AQ==')$q$,
  test.id('W'), test.id('N'), test.id('W'), test.id('H'))) LIKE '42501%',
  'direct: one statement over two notes is refused when one of them isn''t editable');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.note_updates WHERE client_id IN ('v-direct', 'c-direct', 'e-two')),
  'direct: nothing refused was stored');
SELECT test.ok(test.as_op('E', test.insert_sql('N', 'e-direct')) = 'ok 1',
  'direct: E (edit share) can insert an update');
SELECT test.ok(test.as_op('V', format($q$DELETE FROM public.note_updates WHERE note_id = %L$q$, test.id('N'))) LIKE '42501%',
  'direct: V can''t delete updates');
SELECT test.ok(test.as_op('V', format($q$UPDATE public.note_updates SET update_b64 = 'Ag==' WHERE note_id = %L$q$, test.id('N'))) LIKE '42501%',
  'direct: V can''t change updates');
SELECT test.ok(test.try('E', test.insert_sql('N', 'e-rls')) LIKE '42501%',
  'direct: a signed-in client can''t insert through the API at all');
SELECT set_config('share.bypass', '1', true);
INSERT INTO test.m (k, v) VALUES ('bypass', to_jsonb(test.as_op('V', test.insert_sql('H', 'bypass'))));
SELECT set_config('share.bypass', '', true);
SELECT test.ok((SELECT v #>> '{}' FROM test.m WHERE k = 'bypass') = 'ok 1',
  'direct: share.bypass is still honoured (duplicate, member removal)',
  (SELECT v #>> '{}' FROM test.m WHERE k = 'bypass'));
SELECT test.ok(test.as_op(NULL, test.insert_sql('H', 'system')) = 'ok 1',
  'direct: system work without an actor is not checked');

-- ── Compaction checks once ─────────────────────────────────────────────────

INSERT INTO test.m (k, checks) VALUES ('before-snap', test.checks());
INSERT INTO test.m (k, v) VALUES ('snap', test.value_as('E', format(
  $q$SELECT public.notes_op_save_snapshot(%L, %L, 'AQ==', %s)::text$q$,
  test.id('W'), test.id('N'), (SELECT max(id) FROM public.note_updates WHERE note_id = test.id('N'))))::jsonb);
INSERT INTO test.m (k, checks) VALUES ('after-snap', test.checks());
SELECT test.ok(((SELECT v FROM test.m WHERE k = 'snap') ->> 'folded')::int > 500,
  'compaction: every update is folded', (SELECT v::text FROM test.m WHERE k = 'snap'));
SELECT test.ok((SELECT checks FROM test.m WHERE k = 'after-snap') - (SELECT checks FROM test.m WHERE k = 'before-snap')
               BETWEEN 1 AND 6,
  'compaction: deleting 500+ updates checks access once per note',
  format('%s checks', (SELECT checks FROM test.m WHERE k = 'after-snap') - (SELECT checks FROM test.m WHERE k = 'before-snap')));
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.note_updates WHERE note_id = test.id('N')),
  'compaction: the folded log is gone');
