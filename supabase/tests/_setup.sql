-- Shared harness for supabase/tests/*.test.sql, run by `bun run db:test`
-- (scripts/db-test.ts): this file, then one test file, then _finish.sql, in
-- one psql session against the local stack (docs/local-dev.md). Everything
-- runs in one transaction that ends in ROLLBACK, so a test leaves nothing
-- behind. Copied from supabase/probes/write-checks.probe.sql.
--
--   test.id(name)          a stable uuid per name (users, workspaces, rows)
--   test.ok(cond, label)   records PASS / FAIL; _finish.sql fails the run on any FAIL
--   test.as_user(who, sql) runs SQL as the signed-in user, through RLS (the
--                          app's direct table writes and its RPC calls)
--   test.as_op(who, sql)   the same user as the actor, without RLS
--   test.as_key(key, sql)  a workspace API key, the way the MCP connector calls
--                          (service_role + x-moduo-key-id)
--   test.try(who, sql)     as_user, then undoes whatever the statement did
-- Each returns 'ok <rows>' or '<sqlstate> <message>'.
--
-- Traps:
--   One transaction, so every now() is the same: stamp created_at / started_at
--   yourself to order rows (chat_chains.test.sql's test.post), and write many
--   messages straight in (chat_op_send's sending limit counts them).
--   As authenticated or service_role (as_user, value_as, as_key) the test
--   schema can't be read: build ids and request.* claims before switching
--   role, map returned ids to names after.
--   A check in the same statement as a volatile call reads the snapshot from
--   before it ran: call the function first, then test.ok what it wrote.
--   test.try is for refusals (it rolls back): a write a later check needs goes
--   through test.as_user.

BEGIN;
SET LOCAL client_min_messages = notice;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.headers', '{}', true);

CREATE SCHEMA test;
CREATE TABLE test.result (n serial PRIMARY KEY, ok boolean NOT NULL, label text NOT NULL);

CREATE FUNCTION test.id(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('db-test:' || p_name)::uuid
$$;

CREATE FUNCTION test.ok(p_cond boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test.result (ok, label) VALUES (coalesce(p_cond, false), p_label);
  IF p_cond IS TRUE THEN
    RAISE NOTICE 'PASS: %', p_label;
  ELSE
    RAISE NOTICE 'FAIL: % %', p_label, coalesce(' [' || p_detail || ']', '');
  END IF;
END;
$$;

CREATE FUNCTION test.run(p_who text, p_sql text, p_rls boolean, p_key text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_rows bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    IF p_key IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
      PERFORM set_config('request.headers', json_build_object('x-moduo-key-id', test.id(p_key))::text, true);
      SET LOCAL ROLE service_role;
    ELSE
      PERFORM set_config('request.jwt.claims', CASE WHEN p_who IS NULL THEN '{}'
        ELSE json_build_object('sub', test.id(p_who), 'role', 'authenticated')::text END, true);
      IF p_rls THEN
        SET LOCAL ROLE authenticated;
      END IF;
    END IF;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM set_config('request.headers', '{}', true);
    RETURN 'ok ' || v_rows;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM set_config('request.headers', '{}', true);
    RETURN v_state || ' ' || v_msg;
  END;
END;
$$;

CREATE FUNCTION test.as_user(p_who text, p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT test.run(p_who, p_sql, true)
$$;
CREATE FUNCTION test.as_op(p_who text, p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT test.run(p_who, p_sql, false)
$$;
CREATE FUNCTION test.as_key(p_key text, p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT test.run(NULL, p_sql, false, p_key)
$$;

CREATE FUNCTION test.try(p_who text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  BEGIN
    v := test.run(p_who, p_sql, true);
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = v;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    v := SQLERRM;
  END;
  RETURN v;
END;
$$;

-- A value a statement returns, read as the signed-in user (through RLS).
CREATE FUNCTION test.value_as(p_who text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test.id(p_who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN 'ERROR ' || SQLERRM;
END;
$$;

-- People: auth users (the auth trigger makes their profiles).
CREATE FUNCTION test.person(p_name text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', test.id(p_name), 'authenticated', 'authenticated',
          'db-test-' || lower(p_name) || '@example.com', jsonb_build_object('display_name', p_name), now(), now());
  INSERT INTO public.profiles (id, display_name) VALUES (test.id(p_name), p_name)
  ON CONFLICT (id) DO NOTHING;
  RETURN test.id(p_name);
END;
$$;

-- A note with its content (NS-11). The content lives in note_bodies, so a
-- fixture that sets doc_state, doc_version, body_text or body_md inserts
-- through this view: the notes columns it names go to notes (defaults for the
-- rest), the content to the note's note_bodies row. INSERT only, no ON CONFLICT.
DO $do$
BEGIN
  IF to_regclass('public.note_bodies') IS NULL THEN
    RETURN;
  END IF;
  CREATE VIEW test.notes_in AS
    SELECT n.*, b.doc_state, b.doc_version, b.body_text, b.body_md
      FROM public.notes n LEFT JOIN public.note_bodies b ON b.note_id = n.id;
  CREATE FUNCTION test.notes_in_insert() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    v jsonb := jsonb_strip_nulls(to_jsonb(NEW)) - ARRAY['doc_state', 'doc_version', 'body_text', 'body_md'];
    v_cols text;
    v_id uuid;
  BEGIN
    SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(v) AS k;
    EXECUTE format('INSERT INTO public.notes (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::public.notes, $1) RETURNING id',
                   v_cols) INTO v_id USING v;
    UPDATE public.note_bodies SET
      doc_state = NEW.doc_state,
      doc_version = coalesce(NEW.doc_version, doc_version),
      body_text = coalesce(NEW.body_text, body_text),
      body_md = coalesce(NEW.body_md, body_md)
     WHERE note_id = v_id;
    RETURN NEW;
  END;
  $$;
  CREATE TRIGGER notes_in_insert INSTEAD OF INSERT ON test.notes_in
    FOR EACH ROW EXECUTE FUNCTION test.notes_in_insert();
END;
$do$;
