-- NS-10 · Compact what nobody opens (specs/notes-schema-hardening.md AC11,
-- Assumption 10; supabase/migrations/20261030190000_notes_compact.sql).
-- The nightly purge folds the Yjs log of notes nobody opens:
--   notes__compact_candidates  notes with more than 200 log rows, none written
--                              in the last 10 minutes, not in the trash, with
--                              nobody in note_live_viewers;
--   notes__compact_source      a note's snapshot, version and log;
--   notes__compact             the fold, under notes_op_save_snapshot's CAS:
--                              a stale version (or a viewer) changes nothing,
--                              and the bodies are never written.
-- All three are the service role's alone. The merge itself is
-- supabase/functions/_shared/notes-compact.test.ts's.
--
-- Cast: O owns W. Notes: BIG (201 quiet rows), VIEWED (201 quiet rows, open
-- in a tab), EVEN (exactly 200 rows), FRESH (201 rows, the last one just
-- written), TRASHED (201 quiet rows, in the trash).

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');

CREATE FUNCTION pg_temp.note(p_name text, p_rows int, p_fresh boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, body_md, doc_state)
  VALUES (test.id(p_name), test.id('W'), test.id('O'), p_name, 'text of ' || p_name,
          '# ' || p_name, 'SNAP-0');
  INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64, created_at)
  SELECT test.id('W'), test.id(p_name), 'agent', i, 'row' || i,
         CASE WHEN p_fresh AND i = p_rows THEN now() ELSE now() - interval '20 minutes' END
  FROM generate_series(1, p_rows) AS i;
END;
$$;

SELECT pg_temp.note('BIG', 201);
SELECT pg_temp.note('VIEWED', 201);
SELECT pg_temp.note('EVEN', 200);
SELECT pg_temp.note('FRESH', 201, true);
SELECT pg_temp.note('TRASHED', 201);
UPDATE public.notes SET deleted_at = now() - interval '1 day' WHERE id = test.id('TRASHED');
INSERT INTO public.note_live_viewers (note_id, user_id, session_id, seen_at)
VALUES (test.id('VIEWED'), test.id('O'), 'tab-1', now() - interval '5 minutes');

-- The nightly call: the service role, no JWT subject, no API key, so no actor.
CREATE FUNCTION pg_temp.service(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  PERFORM set_config('request.headers', '{}', true);
  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := 'error ' || SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.picked(p_name text) RETURNS boolean LANGUAGE sql AS $$
  SELECT test.id(p_name) = ANY (
    pg_temp.service('SELECT public.notes__compact_candidates(100000)::text')::uuid[])
$$;

DO $$
DECLARE
  v text;
  n public.notes;
  v_upto bigint := (SELECT max(id) - 1 FROM public.note_updates WHERE note_id = test.id('BIG'));
  v_last bigint := (SELECT max(id) FROM public.note_updates WHERE note_id = test.id('BIG'));
  v_updated timestamptz := (SELECT updated_at FROM public.notes WHERE id = test.id('BIG'));
BEGIN
  -- ── Grants ────────────────────────────────────────────────────────────────
  PERFORM test.ok(
    NOT has_function_privilege('authenticated', 'public.notes__compact(uuid, text, bigint, bigint)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.notes__compact(uuid, text, bigint, bigint)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notes__compact(uuid, text, bigint, bigint)', 'EXECUTE'),
    'grants: only the service role folds');
  PERFORM test.ok(
    NOT has_function_privilege('authenticated', 'public.notes__compact_candidates(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.notes__compact_source(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.notes__compact_source(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notes__compact_candidates(integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notes__compact_source(uuid)', 'EXECUTE'),
    'grants: only the service role picks and loads');

  -- ── The pick ──────────────────────────────────────────────────────────────
  PERFORM test.ok(pg_temp.picked('BIG'), 'pick: a quiet note over 200 rows nobody has open');
  PERFORM test.ok(NOT pg_temp.picked('VIEWED'), 'pick: a note in note_live_viewers is skipped');
  PERFORM test.ok(NOT pg_temp.picked('EVEN'), 'pick: 200 rows is not more than 200');
  PERFORM test.ok(NOT pg_temp.picked('FRESH'), 'pick: a note written in the last 10 minutes waits');
  PERFORM test.ok(NOT pg_temp.picked('TRASHED'), 'pick: a note in the trash is the purge''s');
  v := pg_temp.service('SELECT cardinality(public.notes__compact_candidates(1))::text');
  PERFORM test.ok(v = '1', 'pick: at most p_limit notes', v);

  -- ── The source ────────────────────────────────────────────────────────────
  v := pg_temp.service(format('SELECT public.notes__compact_source(%L)::text', test.id('BIG')));
  PERFORM test.ok(
    v::jsonb ->> 'doc_state' = 'SNAP-0' AND (v::jsonb ->> 'doc_version')::int = 0
    AND jsonb_array_length(v::jsonb -> 'updates') = 201
    AND (v::jsonb -> 'updates' -> 0 ->> 'update_b64') = 'row1'
    AND (v::jsonb -> 'updates' -> 200 ->> 'id')::bigint = v_last,
    'source: snapshot, version and the whole log in order', left(v, 200));

  -- ── The CAS ───────────────────────────────────────────────────────────────
  v := pg_temp.service(format('SELECT public.notes__compact(%L, %L, %s, %s)::text',
    test.id('BIG'), 'SNAP-STALE', v_upto, 7));
  PERFORM test.ok((v::jsonb ->> 'refused') = 'true' AND (v::jsonb ->> 'doc_version') = '0',
    'CAS: a stale version is refused and reports the current one', v);
  SELECT * INTO n FROM public.notes WHERE id = test.id('BIG');
  PERFORM test.ok(n.doc_state = 'SNAP-0' AND n.doc_version = 0
    AND (SELECT count(*) FROM public.note_updates WHERE note_id = test.id('BIG')) = 201,
    'CAS: a refused fold changes nothing');

  v := pg_temp.service(format('SELECT public.notes__compact(%L, %L, %s, %s)::text',
    test.id('VIEWED'), 'SNAP-V', v_upto, 0));
  PERFORM test.ok((v::jsonb ->> 'refused') = 'true'
    AND (SELECT count(*) FROM public.note_updates WHERE note_id = test.id('VIEWED')) = 201
    AND (SELECT doc_state FROM public.notes WHERE id = test.id('VIEWED')) = 'SNAP-0',
    'a note someone opened after the pick is refused', v);

  v := pg_temp.service(format('SELECT public.notes__compact(%L, %L, %s, NULL)::text',
    test.id('BIG'), 'SNAP-X', v_upto));
  PERFORM test.ok(v LIKE 'error%' AND (SELECT doc_state FROM public.notes WHERE id = test.id('BIG')) = 'SNAP-0',
    'CAS: a fold without an expected version is an error', v);

  -- ── The fold ──────────────────────────────────────────────────────────────
  v := pg_temp.service(format('SELECT public.notes__compact(%L, %L, %s, %s)::text',
    test.id('BIG'), 'SNAP-1', v_upto, 0));
  PERFORM test.ok((v::jsonb ->> 'refused') = 'false' AND (v::jsonb ->> 'folded') = '200'
    AND (v::jsonb ->> 'doc_version') = '1',
    'fold: at the current version it folds the rows up to p_upto_id', v);
  SELECT * INTO n FROM public.notes WHERE id = test.id('BIG');
  PERFORM test.ok(n.doc_state = 'SNAP-1' AND n.doc_version = 1,
    'fold: the merged snapshot is stored and the version moves', n.doc_state || ' v' || n.doc_version);
  PERFORM test.ok(
    (SELECT array_agg(id) FROM public.note_updates WHERE note_id = test.id('BIG')) = ARRAY[v_last],
    'fold: a row written after the load stays in the log');
  PERFORM test.ok(n.body_text = 'text of BIG' AND n.body_md = '# BIG',
    'fold: the bodies are untouched', n.body_text || ' / ' || n.body_md);
  PERFORM test.ok(n.updated_at = v_updated,
    'fold: the note is not marked edited (its content did not change)');
END;
$$;
