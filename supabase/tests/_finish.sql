-- Ends every supabase/tests/*.test.sql run (see _setup.sql): fails on any FAIL,
-- then rolls everything back.

DO $$
DECLARE
  v_failed text;
  v_total int;
BEGIN
  SELECT string_agg('  ' || label, E'\n' ORDER BY n) INTO v_failed FROM test.result WHERE NOT ok;
  SELECT count(*) INTO v_total FROM test.result;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'No checks ran.';
  END IF;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (% of % checks):%', (SELECT count(*) FROM test.result WHERE NOT ok), v_total,
      E'\n' || v_failed;
  END IF;
  RAISE NOTICE 'PASS: all (% checks)', v_total;
END;
$$;

ROLLBACK;
