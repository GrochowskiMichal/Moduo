-- Preview as (CALR-16, specs/calendar-rethink.md AC29, §Sharing "Preview
-- as"). "Your week as Kai sees it" is the real masked read run for Kai, never
-- an imitation: calendar_events_visible(ws, from, to, p_as) and
-- calendar_busy_blocks(ws, from, to, p_as) return exactly what p_as would get
-- from their own read, cut to the caller's own events on the caller's own
-- calendars. calendar_preview_levels(ws, p_as) says p_as's level on each of
-- the caller's calendars. A preview never shows the caller more than they
-- already own: nobody else's events, nothing for an API key, nothing for
-- someone outside the workspace.
--
-- Cast: O owns workspace W. O's calendars: Work (CW) with K at All details and
-- B at Busy only; Family (CF) Busy only for everyone; Holidays (CH) not
-- shared. On Work: "Board review" (public, with a place), "Therapy" (private),
-- a weekly private "1:1 with Priya". On Projects (CE), which E can edit and
-- K can view: E's "Vendor call" and E's private "E's interview". K owns a calendar (CK) shared with O at
-- All details. OUT is a person outside W. KO is O's API key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'K', 'B', 'E', 'N', 'OUT']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('N'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom'),
  (test.id('CF'), test.id('W'), test.id('O'), 'Family', 'custom'),
  (test.id('CH'), test.id('W'), test.id('O'), 'Holidays', 'custom'),
  (test.id('CE'), test.id('W'), test.id('O'), 'Projects', 'custom'),
  (test.id('CK'), test.id('W'), test.id('K'), 'Kai work', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), test.id('CF'), test.id('CH'), test.id('CE'), test.id('CK'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('K'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('B'), 'freebusy', test.id('O')),
       (test.id('W'), 'calendar', test.id('CE'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'calendar', test.id('CE'), 'member', test.id('K'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CF'), 'workspace', NULL, 'freebusy', test.id('O')),
       (test.id('W'), 'calendar', test.id('CK'), 'member', test.id('O'), 'view', test.id('K'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KO'), test.id('W'), 'O agent', 'mdo_ko', md5('db-test-ko'), '{"calendar": "view"}'::jsonb, test.id('O'));

CREATE FUNCTION pg_temp.make(p_who text, p_title text, p_start text, p_end text, p_cal text,
  p_rrule text DEFAULT NULL, p_private boolean DEFAULT false) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => %L, p_starts_at => %L, p_ends_at => %L, p_rrule => %L, p_calendar_id => %L,
    p_is_private => %L, p_location => %L)$q$,
    md5('db-test:W')::uuid, p_title, p_start, p_end, p_rrule, md5('db-test:' || p_cal)::uuid, p_private,
    'Room ' || p_title))
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.make('O', 'Board review', '2026-11-04 10:00+00', '2026-11-04 11:00+00', 'CW') = 'ok 1', 'O: Board review on Work');
  PERFORM test.ok(pg_temp.make('O', 'Therapy', '2026-11-03 17:00+00', '2026-11-03 18:00+00', 'CW', NULL, true) = 'ok 1', 'Therapy, private');
  PERFORM test.ok(pg_temp.make('O', '1:1 with Priya', '2026-10-06 09:00+00', '2026-10-06 09:30+00', 'CW', 'FREQ=WEEKLY', true) = 'ok 1', 'a private weekly 1:1');
  PERFORM test.ok(pg_temp.make('O', 'School run', '2026-11-03 08:00+00', '2026-11-03 08:30+00', 'CF') = 'ok 1', 'School run on Family');
  PERFORM test.ok(pg_temp.make('O', 'Ski trip', '2026-11-05 08:00+00', '2026-11-05 09:00+00', 'CH') = 'ok 1', 'Ski trip on Holidays');
  PERFORM test.ok(pg_temp.make('E', 'Vendor call', '2026-11-05 13:00+00', '2026-11-05 13:30+00', 'CE') = 'ok 1', 'E''s call on O''s Projects');
  PERFORM test.ok(pg_temp.make('E', 'E''s interview', '2026-11-06 13:00+00', '2026-11-06 14:00+00', 'CE', NULL, true) = 'ok 1', 'E''s private interview on O''s Projects');
  PERFORM test.ok(pg_temp.make('K', 'Kai planning', '2026-11-04 15:00+00', '2026-11-04 16:00+00', 'CK') = 'ok 1', 'K''s own event on K''s calendar');
END;
$$;

-- One row of a masked read as text: what a viewer would see of it.
CREATE FUNCTION pg_temp.rows(p_who text, p_as text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format(
    $q$SELECT string_agg(e.id || '|' || e.title || '|' || coalesce(e.location, '-') || '|' || e.start_time || '|'
         || coalesce(e.recurrence_rule, '-') || '|' || e.is_private || '|' || e.attendees::text, ',' ORDER BY e.start_time, e.id)
       FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00'%s) e
       WHERE e.workspace_id = %L AND e.owner_id = %L AND e.calendar_ref IN (%L, %L, %L)$q$,
    md5('db-test:W')::uuid,
    CASE WHEN p_as IS NULL THEN '' ELSE format(', p_as => %L', md5('db-test:' || p_as)::uuid) END,
    md5('db-test:W')::uuid, md5('db-test:O')::uuid,
    md5('db-test:CW')::uuid, md5('db-test:CF')::uuid, md5('db-test:CH')::uuid)), '')
$$;
CREATE FUNCTION pg_temp.titles(p_who text, p_as text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format(
    $q$SELECT string_agg(e.title, ',' ORDER BY e.start_time, e.title)
       FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L) e$q$,
    md5('db-test:W')::uuid, md5('db-test:' || p_as)::uuid)), '')
$$;
CREATE FUNCTION pg_temp.blocks(p_who text, p_as text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format(
    $q$SELECT string_agg(b.calendar_id || '|' || b.owner_id || '|' || b.start_time || '|' || b.end_time || '|' || b.kind,
         ',' ORDER BY b.start_time, b.calendar_id)
       FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00'%s) b
       WHERE b.owner_id = %L AND b.calendar_id IN (%L, %L, %L)$q$,
    md5('db-test:W')::uuid,
    CASE WHEN p_as IS NULL THEN '' ELSE format(', p_as => %L', md5('db-test:' || p_as)::uuid) END,
    md5('db-test:O')::uuid,
    md5('db-test:CW')::uuid, md5('db-test:CF')::uuid, md5('db-test:CH')::uuid)), '')
$$;

-- The preview is exactly what they get.
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(pg_temp.rows('K', NULL) <> '', 'K''s own read has O''s Work events');
  PERFORM test.ok(pg_temp.rows('O', 'K') = pg_temp.rows('K', NULL),
    'O previewing as K gets, row for row, what K''s own masked read returns of O''s events on O''s calendars',
    pg_temp.rows('O', 'K') || ' vs ' || pg_temp.rows('K', NULL));
  PERFORM test.ok(pg_temp.blocks('O', 'K') = pg_temp.blocks('K', NULL) AND pg_temp.blocks('K', NULL) <> '',
    'and the busy blocks K gets of them (Family)', pg_temp.blocks('O', 'K'));
  PERFORM test.ok(pg_temp.rows('O', 'B') = pg_temp.rows('B', NULL) AND pg_temp.blocks('O', 'B') = pg_temp.blocks('B', NULL),
    'as B (Busy only): the same rows and blocks B gets', pg_temp.blocks('O', 'B'));
  PERFORM test.ok(pg_temp.rows('O', 'N') = pg_temp.rows('N', NULL) AND pg_temp.blocks('O', 'N') = pg_temp.blocks('N', NULL),
    'as N (Everyone else): the same', pg_temp.blocks('O', 'N'));

  r := pg_temp.titles('O', 'K');
  PERFORM test.ok(r = 'Busy,Busy,Board review',
    'as K: Therapy and this week''s 1:1 are "Busy", Board review whole; Family is blocks, Holidays absent', r);
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L)
      WHERE title = 'Busy' AND (location IS NOT NULL OR description IS NOT NULL OR attendees <> '[]'::jsonb)$q$, test.id('W'), test.id('K'))) = '0',
    'the private rows in the preview carry no place, notes or people, as K gets them');
  r := pg_temp.titles('O', 'B');
  PERFORM test.ok(r = '', 'as B there are no titles at all', r);
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L)$q$, test.id('W'), test.id('B'))) = '4',
    'as B: four blocks (Board review, Therapy, the 1:1 on Work; School run on Family)');
END;
$$;

-- Never more than the caller already owns.
DO $$
DECLARE
  r text;
BEGIN
  r := pg_temp.titles('O', 'E');
  PERFORM test.ok(position('Vendor call' IN r) = 0 AND position('interview' IN r) = 0,
    'previewing as E never shows E''s own events, not even E''s private interview on O''s calendar', r);
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L) WHERE owner_id <> %L$q$,
      test.id('W'), test.id('K'), test.id('O'))) = '0'
              AND test.value_as('O', format($q$SELECT count(*) FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L) WHERE owner_id <> %L$q$,
      test.id('W'), test.id('K'), test.id('O'))) = '0',
    'a preview holds only the caller''s own events: K''s planning on K''s calendar stays out');
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L) WHERE calendar_ref NOT IN (%L, %L, %L, %L)$q$,
      test.id('W'), test.id('K'), test.id('CW'), test.id('CF'), test.id('CH'), test.id('CE'))) = '0',
    'and only from the caller''s own calendars');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L)$q$,
      test.id('W'), test.id('O'))) = test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') WHERE owner_id = %L AND calendar_ref = %L$q$,
      test.id('W'), test.id('K'), test.id('CK'))),
    'K previewing as O sees only K''s own week as O gets it, never O''s week through O''s eyes');
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L) WHERE title IN ('Vendor call', 'E''s interview', 'Busy') AND calendar_ref = %L$q$,
      test.id('W'), test.id('K'), test.id('CE'))) = '0',
    'E''s events on O''s Projects stay out of every preview, though K can see them: they are E''s, not O''s');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L) WHERE title IN ('Therapy', '1:1 with Priya', 'Ski trip', 'School run')$q$,
      test.id('W'), test.id('O'))) = '0',
    'so no private title of O''s ever reaches K by previewing as O');
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L)$q$,
      test.id('W'), test.id('OUT'))) = '0'
              AND test.value_as('O', format($q$SELECT count(*) FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L)$q$,
      test.id('W'), test.id('OUT'))) = '0',
    'someone outside the workspace previews as nothing');
  r := test.as_key('KO', format($q$SELECT 1 FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L)$q$, test.id('W'), test.id('K')));
  PERFORM test.ok(r = 'ok 0', 'an API key can''t preview as anyone (masked read)', r);
  r := test.as_key('KO', format($q$SELECT 1 FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00', p_as => %L)$q$, test.id('W'), test.id('B')));
  PERFORM test.ok(r = 'ok 0', 'nor through busy blocks', r);
  r := test.as_key('KO', format($q$SELECT 1 FROM public.calendar_preview_levels(%L, %L)$q$, test.id('W'), test.id('K')));
  PERFORM test.ok(r = 'ok 0', 'nor read anyone''s levels', r);
  r := test.as_key('KO', format($q$SELECT 1 FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') WHERE title = 'Therapy'$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 1', 'while the key''s own read (no p_as) is unchanged', r);
  PERFORM test.ok(pg_temp.rows('O', 'O') = pg_temp.rows('O', NULL),
    'previewing as yourself is your own read of your own calendars');
END;
$$;

-- The levels the banner names.
CREATE FUNCTION pg_temp.levels(p_who text, p_as text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format(
    $q$SELECT string_agg(c.name || ':' || l.level, ',' ORDER BY c.name)
       FROM public.calendar_preview_levels(%L, %L) l JOIN public.calendars c ON c.id = l.calendar_id$q$,
    md5('db-test:W')::uuid, md5('db-test:' || p_as)::uuid)), '')
$$;

DO $$
DECLARE
  r text;
BEGIN
  r := pg_temp.levels('O', 'K');
  PERFORM test.ok(r LIKE '%Family:freebusy%' AND r LIKE '%Holidays:none%' AND r LIKE '%Work:view%',
    'K: Work All details, Family Busy only, Holidays nothing', r);
  r := pg_temp.levels('O', 'B');
  PERFORM test.ok(r LIKE '%Family:freebusy%' AND r LIKE '%Holidays:none%' AND r LIKE '%Work:freebusy%', 'B: Busy only on Work and Family', r);
  r := pg_temp.levels('O', 'E');
  PERFORM test.ok(r LIKE '%Projects:view%' AND r LIKE '%Work:none%', 'E (can edit Projects) reads as All details there, and has nothing on Work', r);
  PERFORM test.ok(position('Kai work' IN pg_temp.levels('O', 'K')) = 0, 'only the caller''s own calendars are listed');
  PERFORM test.ok(pg_temp.levels('O', 'OUT') NOT LIKE '%view%' AND pg_temp.levels('O', 'OUT') NOT LIKE '%freebusy%',
    'someone outside the workspace has no level anywhere', pg_temp.levels('O', 'OUT'));
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar_preview_levels(uuid, uuid)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.calendar_preview_levels(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.calendar_events_visible(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.calendar_events_visible(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
              AND has_function_privilege('service_role', 'public.calendar_events_visible(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE'),
    'grants: signed-in people and the connector, never anon');
  PERFORM test.ok(to_regprocedure('public.calendar_events_visible(uuid, timestamptz, timestamptz)') IS NULL,
    'the masked read has one signature (no overloads): three-argument calls reach it');
END;
$$;
