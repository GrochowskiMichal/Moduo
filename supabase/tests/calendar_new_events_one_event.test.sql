-- New events go to (CALR-20b, specs/calendar-rethink.md Assumptions "New events
-- go to ... one event, never two"). An event Moduo creates on Google is kept as
-- the one mirror row for Google's reply, keyed on (source_account_id,
-- external_event_id); a later sync updates that row, never adds a second. The
-- mirror stores Google's iCalUID so the app can show a meeting reached through
-- two logins once. A removed, undone or reconnected account, and an event a
-- sync removed and Google sends again, revive the old row by its key instead
-- of inserting a twin.
--
--   calendar_op_mirror_events(ws, account, events, deleted)  each event may carry iCalUID
--
-- Cast: O owns workspace W (and W2) with the Google calendar Work (A,
-- google:robin@example.com:primary) and one of a second login (B,
-- google:robin@side.example:primary). K is a member of W.

SELECT test.person(n) FROM unnest(ARRAY['O', 'K']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Hale & Co'),
  (test.id('W2'), test.id('O'), 'Side');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label, status) VALUES
  (test.id('A'), test.id('W'), test.id('O'), 'google', 'google:robin@example.com:primary', 'Work', 'ok'),
  (test.id('B'), test.id('W'), test.id('O'), 'google', 'google:robin@side.example:primary', 'Side', 'ok');

-- One Google event as the mirror takes it, on the account named by its live id.
CREATE FUNCTION pg_temp.mirror(p_ws text, p_account uuid, p_event jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
    md5('db-test:' || p_ws)::uuid, p_account,
    jsonb_build_array(jsonb_build_object(
      'startsAt', '2026-11-05T10:00:00Z', 'endsAt', '2026-11-05T11:00:00Z') || p_event))
$$;
CREATE FUNCTION pg_temp.drop_ext(p_account uuid, p_ext text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.calendar_op_mirror_events(%L, %L, '[]'::jsonb, ARRAY[%L])$q$,
    md5('db-test:W')::uuid, p_account, p_ext)
$$;
-- The owner's live calendar for an external id (the reconnect makes a new row).
CREATE FUNCTION pg_temp.live_account(p_owner text, p_ws text, p_external text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendar_accounts
   WHERE owner_id = md5('db-test:' || p_owner)::uuid AND workspace_id = md5('db-test:' || p_ws)::uuid
     AND provider = 'google' AND external_id = p_external AND deleted_at IS NULL
$$;
-- Every row for a Google event id in W, live or not: one event is one row.
CREATE FUNCTION pg_temp.rows_for(p_ext text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.calendar_events
   WHERE workspace_id = md5('db-test:W')::uuid AND external_event_id = p_ext
$$;
CREATE FUNCTION pg_temp.live_for(p_ext text) RETURNS public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events
   WHERE workspace_id = md5('db-test:W')::uuid AND external_event_id = p_ext AND deleted_at IS NULL
$$;
CREATE FUNCTION pg_temp.entity_live(p_id uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.entities
                  WHERE entity_type = 'event' AND entity_id = p_id AND deleted_at IS NULL)
$$;

-- ── Create on a Google target, then sync ────────────────────────────────────
DO $$
DECLARE
  r text;
  v_id uuid;
BEGIN
  -- The create stores Google's reply to the push…
  r := test.as_user('O', pg_temp.mirror('W', test.id('A'),
    '{"externalEventId": "g1", "iCalUID": "g1@google.com", "title": "Board"}'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.rows_for('g1') = 1, 'the create keeps one row for Google''s reply', r);
  v_id := (pg_temp.live_for('g1')).id;
  -- …and the next sync sends the same event back.
  r := test.as_user('O', pg_temp.mirror('W', test.id('A'),
    '{"externalEventId": "g1", "iCalUID": "g1@google.com", "title": "Board", "description": "Agenda"}'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.rows_for('g1') = 1 AND (pg_temp.live_for('g1')).id = v_id
              AND (pg_temp.live_for('g1')).description = 'Agenda',
    'create on a Google target then sync: exactly one row, updated in place', r);
END;
$$;

-- ── A sync arriving before the create's reply ───────────────────────────────
DO $$
DECLARE
  r text;
  v_id uuid;
BEGIN
  r := test.as_user('O', pg_temp.mirror('W', test.id('A'),
    '{"externalEventId": "g2", "iCalUID": "g2@google.com", "title": "Lunch"}'));
  v_id := (pg_temp.live_for('g2')).id;
  r := test.as_user('O', pg_temp.mirror('W', test.id('A'),
    '{"externalEventId": "g2", "iCalUID": "g2@google.com", "title": "Lunch with Priya"}'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.rows_for('g2') = 1 AND (pg_temp.live_for('g2')).id = v_id
              AND (pg_temp.live_for('g2')).title = 'Lunch with Priya',
    'a sync before the create''s reply: still one row', r);
END;
$$;

-- ── Google's iCalUID is stored ──────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok((pg_temp.live_for('g1')).ical_uid = 'g1@google.com', 'the mirror stores Google''s iCalUID');

  -- The same meeting reached through the second login: its own row, the same iCalUID.
  r := test.as_user('O', pg_temp.mirror('W', test.id('B'),
    '{"externalEventId": "h1", "iCalUID": "g1@google.com", "title": "Board"}'));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT count(*) FROM public.calendar_events
                    WHERE workspace_id = test.id('W') AND ical_uid = 'g1@google.com' AND deleted_at IS NULL) = 2,
    'two logins seeing one meeting keep a row each, both carrying its iCalUID (the app shows one)', r);

  r := test.as_user('O', pg_temp.mirror('W', test.id('A'), '{"externalEventId": "g1", "title": "Board"}'));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.live_for('g1')).ical_uid = 'g1@google.com',
    'an event sent without iCalUID keeps the stored one', r);
END;
$$;

-- ── A teammate never reads a private event's iCalUID ────────────────────────
-- The iCalUID would tell a teammate which private rows are the same meeting:
-- the masked read nulls it with the rest of the details.
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (SELECT id FROM public.calendars WHERE account_id = test.id('A'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'calendar', c.id, 'member', test.id('K'), 'view', test.id('O')
  FROM public.calendars c WHERE c.account_id = test.id('A') AND c.deleted_at IS NULL;
DO $$
DECLARE
  r text;
  v_sql text := format($q$SELECT coalesce(ical_uid, 'null') FROM public.calendar_events_visible(%L,
    '2026-11-02 00:00+00', '2026-11-09 00:00+00') WHERE start_time = '2026-11-06 08:00+00'$q$, test.id('W'));
BEGIN
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.calendars WHERE account_id = test.id('A') AND deleted_at IS NULL),
    'fixture: Work has its calendar row, shared with K');
  r := test.as_user('O', pg_temp.mirror('W', test.id('A'),
    '{"externalEventId": "p1", "iCalUID": "p1@google.com", "title": "Therapy", "isPrivate": true,
      "startsAt": "2026-11-06T08:00:00Z", "endsAt": "2026-11-06T09:00:00Z"}'));
  PERFORM test.ok(r = 'ok 1', 'fixture: a private Google event with an iCalUID', r);
  PERFORM test.ok(test.value_as('O', v_sql) = 'p1@google.com', 'its owner reads its iCalUID');
  r := test.value_as('K', v_sql);
  PERFORM test.ok(r = 'null', 'a teammate who sees the calendar gets it as Busy with no iCalUID', r);
  r := test.value_as('K', format($q$SELECT title FROM public.calendar_events_visible(%L,
    '2026-11-02 00:00+00', '2026-11-09 00:00+00') WHERE start_time = '2026-11-06 08:00+00'$q$, test.id('W')));
  PERFORM test.ok(r = 'Busy', 'fixture: the teammate''s row is the masked one', r);
END;
$$;

-- ── A sync removes an event, then Google sends it again ─────────────────────
DO $$
DECLARE
  r text;
  v_id uuid;
BEGIN
  v_id := (pg_temp.live_for('g2')).id;
  r := test.as_user('O', pg_temp.drop_ext(test.id('A'), 'g2'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.live_for('g2') IS NULL, 'fixture: a sync removes Lunch', r);
  r := test.as_user('O', pg_temp.mirror('W', test.id('A'),
    '{"externalEventId": "g2", "iCalUID": "g2@google.com", "title": "Lunch with Priya"}'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.rows_for('g2') = 1 AND (pg_temp.live_for('g2')).id = v_id,
    'an event Google sends again revives its row instead of a twin', r);
  PERFORM test.ok(pg_temp.entity_live(v_id), 'and its registry entry is live again');
END;
$$;

-- ── Remove, Undo, then sync ─────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v_id uuid;
BEGIN
  v_id := (pg_temp.live_for('g1')).id;
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_remove(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:A')::uuid));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.live_for('g1') IS NULL, 'fixture: Remove takes Work and its events', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_restore(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:A')::uuid));
  r := test.as_user('O', pg_temp.mirror('W', test.id('A'),
    '{"externalEventId": "g1", "iCalUID": "g1@google.com", "title": "Board"}'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.rows_for('g1') = 1 AND (pg_temp.live_for('g1')).id = v_id,
    'remove, Undo, then sync: one row', r);
END;
$$;

-- ── Remove, reconnect, then sync ────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v_g1 uuid;
  v_g2 uuid;
  v_new uuid;
BEGIN
  v_g1 := (pg_temp.live_for('g1')).id;
  v_g2 := (pg_temp.live_for('g2')).id;
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_remove(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:A')::uuid));
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_upsert(p_workspace_id => %L,
    p_provider => 'google', p_external_id => 'google:robin@example.com:primary', p_display_label => 'Work')$q$,
    md5('db-test:W')::uuid));
  v_new := pg_temp.live_account('O', 'W', 'google:robin@example.com:primary');
  PERFORM test.ok(r = 'ok 1' AND v_new IS NOT NULL, 'fixture: Work is connected again', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
    md5('db-test:W')::uuid, v_new,
    '[{"externalEventId": "g1", "iCalUID": "g1@google.com", "title": "Board", "startsAt": "2026-11-05T10:00:00Z", "endsAt": "2026-11-05T11:00:00Z"},
      {"externalEventId": "g2", "iCalUID": "g2@google.com", "title": "Lunch with Priya", "startsAt": "2026-11-05T12:00:00Z", "endsAt": "2026-11-05T13:00:00Z"}]'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.rows_for('g1') = 1 AND pg_temp.rows_for('g2') = 1,
    'remove, reconnect, then sync: one row per event, no twin', r);
  PERFORM test.ok((pg_temp.live_for('g1')).id = v_g1 AND (pg_temp.live_for('g2')).id = v_g2
              AND (pg_temp.live_for('g1')).source_account_id = v_new,
    'the old rows come back on the reconnected calendar, so links and bookings keep pointing at them');
  PERFORM test.ok(pg_temp.entity_live(v_g1), 'with their registry entries');
  PERFORM test.ok((pg_temp.live_for('g1')).calendar_ref =
                    (SELECT id FROM public.calendars WHERE account_id = v_new AND deleted_at IS NULL)
              AND (pg_temp.live_for('g1')).calendar_ref IS NOT NULL,
    'and on the reconnected calendar''s row, so its sharing follows that calendar');

  -- A second round trip still makes no twin.
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_remove(%L, %L)$q$,
    md5('db-test:W')::uuid, v_new));
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_upsert(p_workspace_id => %L,
    p_provider => 'google', p_external_id => 'google:robin@example.com:primary', p_display_label => 'Work')$q$,
    md5('db-test:W')::uuid));
  v_new := pg_temp.live_account('O', 'W', 'google:robin@example.com:primary');
  r := test.as_user('O', pg_temp.mirror('W', v_new,
    '{"externalEventId": "g1", "iCalUID": "g1@google.com", "title": "Board"}'));
  PERFORM test.ok(r = 'ok 1' AND pg_temp.rows_for('g1') = 1 AND (pg_temp.live_for('g1')).id = v_g1,
    'a second remove and reconnect: still one row', r);
END;
$$;

-- ── Revival stays inside its owner and workspace ────────────────────────────
DO $$
DECLARE
  r text;
  v_mine uuid;
  v_kai uuid;
BEGIN
  INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label, status) VALUES
    (test.id('S'), test.id('W'), test.id('O'), 'google', 'google:team@example.com:primary', 'Team', 'ok');
  r := test.as_user('O', pg_temp.mirror('W', test.id('S'), '{"externalEventId": "s1", "title": "Standup"}'));
  v_mine := (pg_temp.live_for('s1')).id;
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_remove(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:S')::uuid));

  -- K connects a calendar with the same Google id: O's removed row is not K's to revive.
  r := test.as_user('K', format($q$SELECT public.calendar_op_account_upsert(p_workspace_id => %L,
    p_provider => 'google', p_external_id => 'google:team@example.com:primary', p_display_label => 'Team')$q$,
    md5('db-test:W')::uuid));
  v_kai := pg_temp.live_account('K', 'W', 'google:team@example.com:primary');
  r := test.as_user('K', pg_temp.mirror('W', v_kai, '{"externalEventId": "s1", "title": "Standup"}'));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.live_for('s1')).id <> v_mine
              AND (pg_temp.live_for('s1')).owner_id = test.id('K')
              AND (SELECT deleted_at IS NOT NULL AND owner_id = test.id('O')
                     FROM public.calendar_events WHERE id = v_mine),
    'a teammate''s calendar with the same Google id never revives your removed event', r);

  -- O connects the same calendar in another workspace: W's removed row stays in W.
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_upsert(p_workspace_id => %L,
    p_provider => 'google', p_external_id => 'google:team@example.com:primary', p_display_label => 'Team')$q$,
    md5('db-test:W2')::uuid));
  r := test.as_user('O', pg_temp.mirror('W2', pg_temp.live_account('O', 'W2', 'google:team@example.com:primary'),
    '{"externalEventId": "s1", "title": "Standup"}'));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT workspace_id = test.id('W') AND deleted_at IS NOT NULL
                     FROM public.calendar_events WHERE id = v_mine)
              AND (SELECT count(*) FROM public.calendar_events
                    WHERE workspace_id = test.id('W2') AND external_event_id = 's1') = 1,
    'another workspace never revives this one''s removed event', r);
END;
$$;
