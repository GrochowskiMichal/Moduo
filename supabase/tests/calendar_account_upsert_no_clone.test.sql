-- A failed sync never creates a calendar account. The sync loop reports a
-- failure with calendar_op_account_upsert(p_status => 'error'), and the op
-- finds the row by the CALLER's id: when the caller had no live row it used to
-- insert one. On 2026-10-06 that cloned one member's Google calendars into a
-- teammate's account (their client still held the list from before the
-- owner-only read policy), and it brings back an account removed while a sync
-- was running. Now an 'error' upsert only updates a live row of the caller.
--
-- Cast: O owns workspace W with a Google calendar (AO); K is a member of W with
-- none; O also has a calendar removed a moment ago (AR).

SELECT test.person(n) FROM unnest(ARRAY['O', 'K']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label, status, deleted_at) VALUES
  (test.id('AO'), test.id('W'), test.id('O'), 'google', 'google:robin@example.com:family', 'Family', 'ok', NULL),
  (test.id('AR'), test.id('W'), test.id('O'), 'google', 'google:robin@example.com:work', 'Work', 'ok', now());

CREATE FUNCTION pg_temp.upsert(p_external text, p_status text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.calendar_op_account_upsert(p_workspace_id => %L, p_provider => 'google',
    p_external_id => %L, p_display_label => 'x', p_status => %L,
    p_last_sync_at => '2026-10-06T11:56:00Z')$q$, md5('db-test:W')::uuid, p_external, p_status)
$$;
CREATE FUNCTION pg_temp.live(p_owner text, p_external text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.calendar_accounts
   WHERE workspace_id = md5('db-test:W')::uuid AND owner_id = md5('db-test:' || p_owner)::uuid
     AND external_id = p_external AND deleted_at IS NULL
$$;

DO $$
BEGIN
  PERFORM test.as_user('K', pg_temp.upsert('google:robin@example.com:family', 'error'));
  PERFORM test.ok(pg_temp.live('K', 'google:robin@example.com:family') = 0,
    'a failed sync of a teammate''s calendar creates no account for the caller');

  PERFORM test.as_user('O', pg_temp.upsert('google:robin@example.com:work', 'error'));
  PERFORM test.ok(pg_temp.live('O', 'google:robin@example.com:work') = 0,
    'a failed sync of a removed calendar does not bring it back');

  PERFORM test.as_user('O', pg_temp.upsert('google:robin@example.com:family', 'error'));
  PERFORM test.ok(
    (SELECT status FROM public.calendar_accounts WHERE id = test.id('AO')) = 'error'
      AND pg_temp.live('O', 'google:robin@example.com:family') = 1,
    'a failed sync of a live calendar still marks it error');

  PERFORM test.as_user('K', pg_temp.upsert('google:kai@example.com:primary', 'ok'));
  PERFORM test.ok(pg_temp.live('K', 'google:kai@example.com:primary') = 1,
    'connecting a calendar still creates its account');
END;
$$;
