-- Levels per person and per calendar (CALR-15, specs/calendar-rethink.md AC27,
-- §Sharing). Sharing a calendar is per calendar grants (resource_grants):
-- "All details" is view, "Busy only" is freebusy, "Nothing" is no grant; a
-- person's grant and Everyone else (the workspace grant) combine to the higher.
-- All details reads the event through the masked read
-- (calendar_events_visible); Busy only reads its times as busy blocks. Changes
-- apply at once and notify nobody.
--
-- Cast: O owns workspace W and three calendars: Work (CW) follows each
-- person's level (Kai: All details, Priya: Busy only, Everyone else: Busy
-- only), Family (CF) is "Busy only, for everyone", Holidays (CH) is not shared.
-- X is a member with no level of their own.

SELECT test.person(n) FROM unnest(ARRAY['O', 'Kai', 'Priya', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('Kai'), 'member'),
  (test.id('W'), test.id('Priya'), 'member'),
  (test.id('W'), test.id('X'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom'),
  (test.id('CF'), test.id('W'), test.id('O'), 'Family', 'custom'),
  (test.id('CH'), test.id('W'), test.id('O'), 'Holidays', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), test.id('CF'), test.id('CH'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('Kai'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('Priya'), 'freebusy', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'workspace', NULL, 'freebusy', test.id('O')),
       (test.id('W'), 'calendar', test.id('CF'), 'workspace', NULL, 'freebusy', test.id('O'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Investor prep', p_starts_at => '2026-11-03 10:00+00', p_ends_at => '2026-11-03 11:00+00',
    p_calendar_id => %L)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'an event on Work', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'School run', p_starts_at => '2026-11-03 08:00+00', p_ends_at => '2026-11-03 09:00+00',
    p_calendar_id => %L)$q$, test.id('W'), test.id('CF')));
  PERFORM test.ok(r = 'ok 1', 'one on Family', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Ski trip', p_starts_at => '2026-11-03 12:00+00', p_ends_at => '2026-11-03 13:00+00',
    p_calendar_id => %L)$q$, test.id('W'), test.id('CH')));
  PERFORM test.ok(r = 'ok 1', 'one on Holidays', r);
END;
$$;

-- What one person reads of O's week: the titles they get, then the busy blocks.
CREATE FUNCTION pg_temp.titles(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format(
    $q$SELECT string_agg(title, ',' ORDER BY start_time) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') WHERE owner_id = %L$q$,
    md5('db-test:W')::uuid, md5('db-test:O')::uuid)), '')
$$;
CREATE FUNCTION pg_temp.busy(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT count(*) FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') WHERE calendar_id IN (%L, %L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:CW')::uuid, md5('db-test:CF')::uuid, md5('db-test:CH')::uuid))
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.titles('O') = 'School run,Investor prep,Ski trip', 'O reads their own week whole', pg_temp.titles('O'));
  PERFORM test.ok(pg_temp.titles('Kai') = 'Investor prep' AND pg_temp.busy('Kai') = '1',
    'Kai (All details on Work) reads Work''s event, and Family only as busy', pg_temp.titles('Kai') || ' / ' || pg_temp.busy('Kai'));
  PERFORM test.ok(pg_temp.titles('Priya') = '' AND pg_temp.busy('Priya') = '2',
    'Priya (Busy only) reads no titles, and Work and Family as busy', pg_temp.titles('Priya') || ' / ' || pg_temp.busy('Priya'));
  PERFORM test.ok(pg_temp.titles('X') = '' AND pg_temp.busy('X') = '2',
    'X gets Everyone else''s default, Busy only', pg_temp.titles('X') || ' / ' || pg_temp.busy('X'));
  PERFORM test.ok(test.value_as('Kai', format($q$SELECT count(*) FROM public.calendar_events WHERE calendar_ref = %L$q$, test.id('CH'))) = '0',
    'Holidays isn''t shared: nobody reads it, not even from the table');
END;
$$;

-- Changes apply at once and notify nobody.
DO $$
DECLARE
  v_notices bigint := (SELECT count(*) FROM public.workspace_notifications WHERE workspace_id = test.id('W'));
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.share_op_set('calendar', %L, 'member', %L, 'freebusy')$q$, test.id('CW'), test.id('Kai')));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.titles('Kai') = '' AND pg_temp.busy('Kai') = '2',
    'Kai moved to Busy only reads Work as busy straight away', r);

  r := test.as_user('O', format($q$SELECT public.share_op_set('calendar', %L, 'workspace', NULL, NULL)$q$, test.id('CW')));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.busy('X') = '1' AND pg_temp.busy('Priya') = '2',
    'Everyone else set to Nothing on Work: X keeps only Family as busy, Priya keeps her own level', r);

  r := test.as_user('O', format($q$SELECT public.share_op_set('calendar', %L, 'workspace', NULL, 'view')$q$, test.id('CW')));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.titles('X') = 'Investor prep' AND pg_temp.titles('Priya') = 'Investor prep',
    'Everyone else at All details on Work: every member reads it (a person''s level never lowers it)', r);
  PERFORM test.ok(pg_temp.titles('X') NOT LIKE '%School run%' AND pg_temp.titles('X') NOT LIKE '%Ski trip%',
    'and Family and Holidays keep their own rules');

  PERFORM test.ok((SELECT count(*) FROM public.workspace_notifications WHERE workspace_id = test.id('W')) = v_notices,
    'none of these changes notified anyone');

  r := test.try('Kai', format($q$SELECT public.share_op_set('calendar', %L, 'member', %L, 'view')$q$, test.id('CW'), test.id('Kai')));
  PERFORM test.ok(r LIKE '42501%', 'only the calendar''s owner changes who sees it', r);
END;
$$;
