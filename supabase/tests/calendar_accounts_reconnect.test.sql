-- Calendar accounts (CALR-20, specs/calendar-rethink.md AC35, AC37). An account
-- whose Google access was revoked is `reauth` (a status of its own, with the
-- reason in last_error) until a reconnect clears it; a sync failure ('error')
-- never hides it. Each calendar carries whether Google lets you write it
-- (read_only) and whether it counts as busy for new booking links
-- (busy_default). Remove is a soft delete with a restore op for Undo.
--
--   calendar_op_account_upsert(..., p_read_only, p_busy_default)  NULL keeps what is stored
--   calendar_op_account_set(ws, account, p_busy_default)           → the account
--   calendar_op_account_restore(ws, account)                       → the account (Remove's Undo)
--   calendar_op__google_reauth(owner, email, reauth, error)        → rows changed (service role only)
--
-- Cast: O owns workspace W (and W2) with Google calendars for robin@example.com:
-- Family (AF, two events, one of them removed by an earlier sync) and Work (AW);
-- and a calendar of another login, robin@example.community (AX). K is a member
-- of W with a Google calendar of the same address (AK).

SELECT test.person(n) FROM unnest(ARRAY['O', 'K']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Hale & Co'),
  (test.id('W2'), test.id('O'), 'Side');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label, status) VALUES
  (test.id('AF'), test.id('W'), test.id('O'), 'google', 'google:robin@example.com:family', 'Family', 'ok'),
  (test.id('AW'), test.id('W'), test.id('O'), 'google', 'google:robin@example.com:primary', 'Work', 'error'),
  (test.id('A2'), test.id('W2'), test.id('O'), 'google', 'google:robin@example.com', 'robin@example.com', 'ok'),
  (test.id('AX'), test.id('W'), test.id('O'), 'google', 'google:robin@example.community:primary', 'Other', 'ok'),
  (test.id('AK'), test.id('W'), test.id('K'), 'google', 'google:robin@example.com:primary', 'Kai', 'ok');

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid,
    '[{"externalEventId": "f1", "title": "Swim", "startsAt": "2026-11-05T10:00:00Z", "endsAt": "2026-11-05T11:00:00Z"},
      {"externalEventId": "f2", "title": "Dentist", "startsAt": "2026-11-06T10:00:00Z", "endsAt": "2026-11-06T11:00:00Z"}]'));
  PERFORM test.ok(r = 'ok 1', 'fixture: Family mirrors two events', r);
END;
$$;
-- An earlier sync removed Dentist (a day ago): Undo of a later Remove must not bring it back.
UPDATE public.calendar_events SET deleted_at = now() - interval '1 day'
 WHERE source_account_id = test.id('AF') AND external_event_id = 'f2';
UPDATE public.entities SET deleted_at = now() - interval '1 day'
 WHERE entity_type = 'event'
   AND entity_id = (SELECT id FROM public.calendar_events WHERE source_account_id = test.id('AF') AND external_event_id = 'f2');

CREATE FUNCTION pg_temp.acct(p_name text) RETURNS public.calendar_accounts LANGUAGE sql AS $$
  SELECT * FROM public.calendar_accounts WHERE id = md5('db-test:' || p_name)::uuid
$$;
CREATE FUNCTION pg_temp.ev(p_ext text) RETURNS public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events
   WHERE source_account_id = md5('db-test:AF')::uuid AND external_event_id = p_ext
$$;
CREATE FUNCTION pg_temp.ev_entity_live(p_ext text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.entities en
                  WHERE en.entity_type = 'event' AND en.entity_id = (pg_temp.ev(p_ext)).id
                    AND en.deleted_at IS NULL)
$$;
CREATE FUNCTION pg_temp.upsert(p_external text, p_extra text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.calendar_op_account_upsert(p_workspace_id => %L, p_provider => 'google',
    p_external_id => %L, p_display_label => 'x' %s)$q$, md5('db-test:W')::uuid, p_external, p_extra)
$$;
CREATE FUNCTION pg_temp.reauth(p_owner text, p_email text, p_on boolean, p_error text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v int;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.calendar_op__google_reauth(md5('db-test:' || p_owner)::uuid, p_email, p_on, p_error);
  RESET ROLE;
  RETURN 'ok ' || v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERROR ' || SQLERRM;
END;
$$;

-- ── the columns and the status ───────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'calendar_accounts'
        AND ((column_name = 'last_error' AND data_type = 'text' AND is_nullable = 'YES')
          OR (column_name = 'read_only' AND data_type = 'boolean' AND is_nullable = 'NO')
          OR (column_name = 'busy_default' AND data_type = 'boolean' AND is_nullable = 'NO'))) = 3,
    'calendar_accounts has last_error, read_only and busy_default');
  PERFORM test.ok(NOT (pg_temp.acct('AF')).read_only AND (pg_temp.acct('AF')).busy_default,
    'an existing calendar is writable and counts as busy');
END;
$$;

DO $$
DECLARE
  r text;
BEGIN
  BEGIN
    UPDATE public.calendar_accounts SET status = 'reauth' WHERE id = test.id('AX');
    r := 'ok';
  EXCEPTION WHEN check_violation THEN
    r := 'check_violation';
  END;
  PERFORM test.ok(r = 'ok' AND (pg_temp.acct('AX')).status = 'reauth', 'reauth is a calendar account status', r);
  UPDATE public.calendar_accounts SET status = 'ok' WHERE id = test.id('AX');
  BEGIN
    UPDATE public.calendar_accounts SET status = 'revoked' WHERE id = test.id('AX');
    r := 'ok';
  EXCEPTION WHEN check_violation THEN
    r := 'check_violation';
  END;
  PERFORM test.ok(r = 'check_violation', 'an unknown status is still refused', r);
END;
$$;

-- ── reauth: marked by login, cleared by a reconnect ──────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', $q$SELECT public.calendar_op__google_reauth(auth.uid(), 'robin@example.com', true, 'x')$q$);
  PERFORM test.ok(r <> 'ok 1' AND (pg_temp.acct('AF')).status = 'ok',
    'a signed-in person can''t mark reauth themselves', r);

  r := pg_temp.reauth('O', 'Robin@Example.com', true, 'invalid_grant');
  PERFORM test.ok(r = 'ok 3', 'marking reauth reports the rows it changed', r);
  PERFORM test.ok((pg_temp.acct('AF')).status = 'reauth' AND (pg_temp.acct('AW')).status = 'reauth'
              AND (pg_temp.acct('A2')).status = 'reauth'
              AND (pg_temp.acct('AF')).last_error = 'invalid_grant',
    'every live calendar of that login, in every workspace, needs reconnecting, with the reason');
  PERFORM test.ok((pg_temp.acct('AX')).status = 'ok' AND (pg_temp.acct('AK')).status = 'ok',
    'another login and another person''s calendar of the same address are untouched');
  PERFORM test.ok((SELECT count(*) FROM public.calendar_events
                    WHERE source_account_id = test.id('AF') AND deleted_at IS NULL) = 1,
    'reauth keeps the account''s events');

  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:family', ', p_status => ''error'''));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.acct('AF')).status = 'reauth',
    'a failed sync (error) never hides reauth', r);

  UPDATE public.calendar_accounts SET status = 'error' WHERE id = test.id('AW');
  r := pg_temp.reauth('O', 'robin@example.com', false, NULL);
  PERFORM test.ok(r = 'ok 2', 'clearing reports the rows it changed', r);
  PERFORM test.ok((pg_temp.acct('AF')).status = 'ok' AND (pg_temp.acct('AF')).last_error IS NULL
              AND (pg_temp.acct('A2')).status = 'ok' AND (pg_temp.acct('AW')).status = 'error',
    'a reconnect clears reauth and its reason, and leaves a sync error alone');

  r := pg_temp.reauth('O', 'robin@example.com', true, 'invalid_grant');
  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:family', ', p_status => ''ok'''));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.acct('AF')).status = 'ok',
    'a good sync (ok) clears reauth', r);
  r := pg_temp.reauth('O', 'robin@example.com', false, NULL);
  UPDATE public.calendar_accounts SET status = 'ok' WHERE id = test.id('AW');
END;
$$;

-- ── read_only and busy_default ───────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:holidays', ', p_read_only => true'));
  PERFORM test.ok(r = 'ok 1'
      AND (SELECT read_only AND NOT busy_default FROM public.calendar_accounts
            WHERE external_id = 'google:robin@example.com:holidays' AND deleted_at IS NULL),
    'a new read-only calendar doesn''t count as busy unless asked', r);

  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:team', ', p_read_only => true, p_busy_default => true'));
  PERFORM test.ok(r = 'ok 1'
      AND (SELECT read_only AND busy_default FROM public.calendar_accounts
            WHERE external_id = 'google:robin@example.com:team' AND deleted_at IS NULL),
    'busy_default is stored as given', r);

  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:new', ''));
  PERFORM test.ok(r = 'ok 1'
      AND (SELECT NOT read_only AND busy_default FROM public.calendar_accounts
            WHERE external_id = 'google:robin@example.com:new' AND deleted_at IS NULL),
    'a new calendar with neither is writable and busy', r);

  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:holidays', ''));
  PERFORM test.ok(r = 'ok 1'
      AND (SELECT read_only AND NOT busy_default FROM public.calendar_accounts
            WHERE external_id = 'google:robin@example.com:holidays' AND deleted_at IS NULL),
    'leaving them out keeps what is stored', r);

  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:holidays', ', p_read_only => false'));
  PERFORM test.ok(r = 'ok 1'
      AND (SELECT NOT read_only AND NOT busy_default FROM public.calendar_accounts
            WHERE external_id = 'google:robin@example.com:holidays' AND deleted_at IS NULL),
    'a calendar Google now lets you write turns writable; its busy choice stays', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_account_set(%L, %L, p_busy_default => false)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r = 'ok 1' AND NOT (pg_temp.acct('AF')).busy_default, 'the owner turns Counts as busy off', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_set(%L, %L, p_busy_default => NULL)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r = 'ok 1' AND NOT (pg_temp.acct('AF')).busy_default, 'NULL keeps it', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_set(%L, %L, p_busy_default => true)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.acct('AF')).busy_default, 'and back on', r);

  r := test.as_user('K', format($q$SELECT public.calendar_op_account_set(%L, %L, p_busy_default => false)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r <> 'ok 1' AND (pg_temp.acct('AF')).busy_default,
    'a teammate can''t change someone else''s calendar', r);
END;
$$;

-- ── Remove and its Undo ──────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(pg_temp.ev_entity_live('f1'), 'fixture: Swim is in the registry');

  r := test.as_user('O', format($q$SELECT public.calendar_op_account_restore(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r <> 'ok 1', 'a live account has nothing to restore', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_account_remove(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.acct('AF')).deleted_at IS NOT NULL
              AND (pg_temp.ev('f1')).deleted_at IS NOT NULL AND NOT pg_temp.ev_entity_live('f1'),
    'fixture: Remove soft-deletes the account, its events and their registry entries', r);

  r := test.as_user('K', format($q$SELECT public.calendar_op_account_restore(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r <> 'ok 1' AND (pg_temp.acct('AF')).deleted_at IS NOT NULL,
    'a teammate can''t restore someone else''s account', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_account_restore(%L, %L)$q$,
    md5('db-test:W2')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r <> 'ok 1' AND (pg_temp.acct('AF')).deleted_at IS NOT NULL,
    'restore names the account''s own workspace', r);

  r := test.as_user('O', format($q$SELECT (public.calendar_op_account_restore(%L, %L)).display_label$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.acct('AF')).deleted_at IS NULL, 'Undo brings the account back', r);
  PERFORM test.ok((pg_temp.ev('f1')).deleted_at IS NULL AND pg_temp.ev_entity_live('f1'),
    'and the events the Remove took, with their registry entries');
  PERFORM test.ok((pg_temp.ev('f2')).deleted_at IS NOT NULL AND NOT pg_temp.ev_entity_live('f2'),
    'an event an earlier sync removed stays removed');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity
                           WHERE entity_id = test.id('AF') AND op = 'calendar.account_restore'),
    'the restore is in the activity log');

  r := test.as_user('O', format($q$SELECT public.calendar_op_account_remove(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  r := test.as_user('O', pg_temp.upsert('google:robin@example.com:family', ''));
  r := test.as_user('O', format($q$SELECT public.calendar_op_account_restore(%L, %L)$q$,
    md5('db-test:W')::uuid, md5('db-test:AF')::uuid));
  PERFORM test.ok(r <> 'ok 1' AND (pg_temp.acct('AF')).deleted_at IS NOT NULL
              AND (SELECT count(*) FROM public.calendar_accounts
                    WHERE external_id = 'google:robin@example.com:family' AND deleted_at IS NULL) = 1,
    'Undo refuses once the same calendar was connected again', r);
END;
$$;
