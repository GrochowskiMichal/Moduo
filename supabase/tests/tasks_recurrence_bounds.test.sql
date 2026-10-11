-- TV-D8 · Repeat rules stay bounded
-- (20261010160000_tasks_ops_registry_handles.sql: tasks__recurrence_problem and
-- the tasks_recurrence_bounded CHECK; 20261010161000_tasks_recurrence_server.sql:
-- the engine's horizon and step cap, the roll-over's batch and time budget).
--
-- Out-of-bounds rules are refused by the ops and by the CHECK on raw writes;
-- rules the engine can't place return within a fixed amount of work; a rule
-- that fails never stops a status change or the roll-over.
--
-- Cast: O owns workspace W, E is a member who works on tasks.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Bounds');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('E'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false);

-- Milliseconds a statement takes.
CREATE FUNCTION test.ms(p_sql text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
BEGIN
  EXECUTE p_sql;
  RETURN extract(epoch FROM clock_timestamp() - v_start) * 1000;
END;
$$;

DO $$
DECLARE
  r text;
  v_rule text;
  v_ms numeric;
  v_rec jsonb;
  v_n bigint;
BEGIN
  -- ── Refused at the door: the ops and the CHECK ───────────────────────────
  FOREACH v_rule IN ARRAY ARRAY[
    'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;INTERVAL=-3', 'FREQ=DAILY;INTERVAL=5000',
    'FREQ=DAILY;COUNT=1000000', 'FREQ=WEEKLY;UNTIL=99991231T000000Z',
    'FREQ=DAILY;' || repeat('BYDAY=MO;', 80)] LOOP
    r := test.try('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
      jsonb_build_object('title', 'x', 'bucket_id', test.id('SB'),
        'recurrence', jsonb_build_object('rrule', v_rule, 'dtstart', '2026-10-01T07:00:00.000Z'))));
    PERFORM test.ok(r LIKE '22023%can''t be saved%', format('the op refuses %s', left(v_rule, 40)), r);
    r := test.try('E', format($q$INSERT INTO public.tasks (workspace_id, bucket_id, title, recurrence) VALUES (%L, %L, 'x', %L::jsonb)$q$,
      test.id('W'), test.id('SB'), jsonb_build_object('rrule', v_rule)));
    PERFORM test.ok(r LIKE '23514%tasks_recurrence_bounded%', format('an old build''s raw write of %s is refused', left(v_rule, 40)), r);
  END LOOP;
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'x', 'bucket_id', test.id('SB'),
      'recurrence', jsonb_build_object('rrule', 'FREQ=DAILY', 'dtstart', '0001-01-01T00:00:00Z'))));
  PERFORM test.ok(r LIKE '22023%between 1900 and 2200%', 'a start in year 1 is refused', r);
  -- An edit is checked the same way.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T1'), 'title', 'Daily', 'bucket_id', test.id('SB'),
      'recurrence', jsonb_build_object('rrule', 'FREQ=DAILY', 'dtstart', '2026-10-01T07:00:00.000Z'))));
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('recurrence', jsonb_build_object('rrule', 'FREQ=DAILY;COUNT=99999'))));
  PERFORM test.ok(r LIKE '22023%COUNT must be 1 to 1000%', 'an edit to an out-of-bounds rule is refused', r);
  -- What the app writes still saves.
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('recurrence', jsonb_build_object('rrule', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL=20271231T000000Z',
      'dtstart', '2026-10-01T07:00:00.000Z', 'nextOccurrence', NULL))));
  PERFORM test.ok(r = 'ok 1', 'a rule the app writes is accepted', r);
  -- A rule the engine doesn't evaluate (hourly, from an import) is kept.
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('recurrence', jsonb_build_object('rrule', 'FREQ=HOURLY;INTERVAL=4'))));
  PERFORM test.ok(r = 'ok 1', 'an unsupported but bounded rule is kept (the engine leaves it to the app)', r);

  -- ── Rules that slip past the door still cost a bounded amount ─────────────
  -- Straight into the engine, as if stored before the CHECK existed.
  FOREACH v_rec IN ARRAY ARRAY[
    '{"rrule": "FREQ=DAILY;INTERVAL=0", "dtstart": "2026-01-01T00:00:00Z"}',
    '{"rrule": "FREQ=DAILY;COUNT=999999", "dtstart": "1900-01-01T00:00:00Z"}',
    '{"rrule": "FREQ=DAILY", "dtstart": "0001-01-01T00:00:00Z"}',
    -- Valid but never happening: February 30th.
    '{"rrule": "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "dtstart": "1900-01-01T00:00:00Z"}',
    '{"rrule": "FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30", "dtstart": "1900-01-01T00:00:00Z"}',
    '{"rrule": "FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=31;BYDAY=MO,TU,WE,TH,FR,SA,SU", "dtstart": "1900-01-01T00:00:00Z"}',
    '{"rrule": "FREQ=DAILY;COUNT=1000;BYMONTH=2;BYMONTHDAY=30", "dtstart": "1900-01-01T00:00:00Z"}'
  ]::jsonb[] LOOP
    v_ms := test.ms(format($q$SELECT public.tasks__rrule_next(%L::jsonb, '2026-10-10T00:00:00Z', NULL),
                                  public.tasks__rrule_prev(%L::jsonb, '2026-10-10T00:00:00Z', NULL),
                                  public.tasks__rrule_next(%L::jsonb, '9999-01-01T00:00:00Z', NULL)$q$,
                           v_rec, v_rec, v_rec));
    PERFORM test.ok(v_ms < 1500, format('the engine gives up quickly on %s', v_rec ->> 'rrule'), v_ms::text || ' ms');
  END LOOP;
  PERFORM test.ok(public.tasks__rrule_next('{"rrule": "FREQ=DAILY;INTERVAL=0"}'::jsonb, now(), now()) IS NULL
              AND public.tasks__rrule_next('{"rrule": "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30"}'::jsonb, now(), now()) IS NULL,
    'a rule out of bounds, or one that never happens, has no next occurrence');
  -- A task scheduled in year 9999 completes without a long walk or an error.
  INSERT INTO public.tasks (id, workspace_id, bucket_id, title, scheduled_at, recurrence, assignee_id)
  VALUES (test.id('TF'), test.id('W'), test.id('SB'), 'Far', '9999-01-01T00:00:00Z',
          '{"rrule": "FREQ=DAILY", "dtstart": "2026-10-01T07:00:00.000Z"}', test.id('E'));
  v_ms := test.ms(format($q$SELECT test.as_user('E', %L)$q$,
    format($i$SELECT public.tasks_op_set_status(%L, %L, 'done', NULL, NULL)$i$, test.id('W'), test.id('TF'))));
  PERFORM test.ok(v_ms < 1500 AND (SELECT status FROM public.tasks WHERE id = test.id('TF')) = 'done',
    'completing a repeat scheduled in year 9999 is quick and still completes', v_ms::text || ' ms');

  -- ── The roll-over works in bounded batches ────────────────────────────────
  -- 40 open repeats a week behind (each needs a move to today's occurrence).
  INSERT INTO public.tasks (workspace_id, bucket_id, title, scheduled_at, recurrence)
  SELECT test.id('W'), test.id('SB'), 'Batch ' || i, now() - interval '7 days',
         jsonb_build_object('rrule', 'FREQ=DAILY', 'dtstart', public.tasks__iso(now() - interval '30 days'))
  FROM generate_series(1, 40) i;
  SELECT count(*) INTO v_n FROM public.tasks__roll_over(test.id('W'), now(), 10);
  PERFORM test.ok(v_n BETWEEN 1 AND 10, 'one run handles at most its batch size', v_n::text);
  PERFORM test.ok((SELECT count(*) FROM public.tasks__roll_over(test.id('W'), now(), 1000, interval '0 seconds')) <= 1,
    'and stops when its time budget is spent');
  SELECT count(*) INTO v_n FROM public.tasks__roll_over(test.id('W'), now(), 1000);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks
                              WHERE workspace_id = test.id('W') AND title LIKE 'Batch %'
                                AND scheduled_at < now() - interval '2 days'),
    'the next runs finish the rest', v_n::text || ' moved; left: ' || (SELECT count(*) FROM public.tasks
      WHERE workspace_id = test.id('W') AND title LIKE 'Batch %' AND scheduled_at < now() - interval '2 days')::text);
  PERFORM test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasks-roll-over'
                            AND command LIKE '%statement_timeout%' AND command LIKE '%2000%'),
    'the 15-minute job runs a bounded batch under a statement timeout');
END;
$$;
