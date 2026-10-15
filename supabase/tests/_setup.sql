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
