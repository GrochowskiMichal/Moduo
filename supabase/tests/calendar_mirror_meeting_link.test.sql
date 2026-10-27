-- The mirror's meeting link stays put across syncs (CALR-6 validator finding):
-- a Google event with a Meet link and a Zoom URL in its location used to swap
-- links on every sync, because the trigger can't tell a re-sent link from an
-- unchanged one. calendar_op_mirror_events now splits the location itself
-- (supabase/migrations/20261027230000_calendar_event_data_v2.sql).
--
-- Cast: O owns W and its Google account A.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'W');
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('O'), 'google', 'o@example.com', 'o@example.com');
DO $$
DECLARE i int; v text; vals text[] := '{}';
BEGIN
  FOR i IN 1..3 LOOP
    PERFORM test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
      test.id('W'), test.id('A'), jsonb_build_array(jsonb_build_object('externalEventId','g1','title','Flap',
        'startsAt','2026-11-05T10:00:00Z','endsAt','2026-11-05T11:00:00Z',
        'location','Room 4 https://zoom.us/j/111','conferenceUrl','https://meet.google.com/aaa-bbbb-ccc'))));
    SELECT conference_url || '|' || coalesce(location,'∅') INTO v FROM public.calendar_events WHERE workspace_id = test.id('W') AND title = 'Flap';
    vals := vals || v;
  END LOOP;
  PERFORM test.ok(vals[1] = 'https://meet.google.com/aaa-bbbb-ccc|Room 4' AND vals[2] = vals[1] AND vals[3] = vals[1],
    'Meet link + Zoom URL in location: stable across syncs', array_to_string(vals, ' / '));
  PERFORM test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
      test.id('W'), test.id('A'), jsonb_build_array(jsonb_build_object('externalEventId','g2','title','ZoomOnly',
        'startsAt','2026-11-05T10:00:00Z','endsAt','2026-11-05T11:00:00Z','location','https://zoom.us/j/7'))));
  PERFORM test.ok((SELECT conference_url = 'https://zoom.us/j/7' AND location IS NULL FROM public.calendar_events WHERE workspace_id = test.id('W') AND title = 'ZoomOnly'),
    'a Zoom URL as the only link still becomes the link');
END $$;
