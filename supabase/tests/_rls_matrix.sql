-- Helpers for the RLS access matrix (HV-16, rls_matrix.md). Every generated
-- rls_matrix_*.test.sql starts with `\ir _rls_matrix.sql`, inside _setup.sql's
-- transaction, so all of it rolls back.
--
--   test.mx(persona, sql, rls_alone)
--                               runs one statement as a persona of rls_matrix.md
--                               (or 'sys': the owner's claims without RLS), then
--                               undoes it; 'ok <rows>' or '<sqlstate> <message>'.
--                               rls_alone sets share.bypass, which the write
--                               triggers stand aside for, so RLS alone decides.
--   test.mx_cell(table, op, persona, allowed, sql, rls_alone)
--                               records one matrix cell: allowed means the
--                               statement reached at least one row

CREATE FUNCTION test.mx_claims(p_persona text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_persona
    WHEN 'anon' THEN '{"role": "anon"}'
    WHEN 'app' THEN json_build_object('sub', test.id('owner'), 'role', 'authenticated', 'client_id', 'hv16-app')::text
    WHEN 'sys' THEN json_build_object('sub', test.id('owner'), 'role', 'authenticated')::text
    ELSE json_build_object('sub', test.id(p_persona), 'role', 'authenticated')::text
  END
$$;

CREATE FUNCTION test.mx(p_persona text, p_sql text, p_rls_alone boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_rows bigint;
  v_state text;
  v_msg text;
  v_out text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', test.mx_claims(p_persona), true);
    PERFORM set_config('share.bypass', CASE WHEN p_rls_alone THEN '1' ELSE '' END, true);
    IF p_persona = 'anon' THEN
      SET LOCAL ROLE anon;
    ELSIF p_persona <> 'sys' THEN
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    -- Undo whatever the statement did: the next cell starts from the world.
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ok ' || v_rows;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    v_out := CASE WHEN v_state = 'P0099' THEN v_msg ELSE v_state || ' ' || v_msg END;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('share.bypass', '', true);
  RETURN v_out;
END;
$$;

CREATE FUNCTION test.mx_cell(p_table text, p_op text, p_persona text, p_allowed boolean, p_sql text,
                             p_rls_alone boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r text := test.mx(p_persona, p_sql, p_rls_alone);
BEGIN
  PERFORM test.ok((r ~ '^ok [1-9]') = p_allowed,
    format('%s · %s · %s', p_table, p_op,
      CASE WHEN p_persona = 'sys' THEN 'reaches its row as owner without RLS'
           WHEN p_allowed THEN p_persona || ' reaches it'
           ELSE p_persona || ' is refused' END),
    r);
END;
$$;

\ir _rls_world.sql
