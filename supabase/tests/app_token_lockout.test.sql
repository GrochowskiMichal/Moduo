-- An app's OAuth token reaches nothing but the connector (MCPO-1,
-- supabase/migrations/20261022230000_app_token_lockout.sql; specs/mcp-oauth.md AC1).
-- The live end-to-end check, with a real OAuth flow, is scripts/oauth-lockout-probe.ts.
--
-- Also 20261023000000_auth_no_password_changes.sql: no password is set through
-- Supabase Auth, so an app's token can't turn into a full session.
--
-- Cast: O owns workspace W, which has the tag G. "O's app" is a token for O
-- that also carries client_id, the way the OAuth server issues it.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Lockout');
INSERT INTO public.tags (id, workspace_id, owner_id, name) VALUES (test.id('G'), test.id('W'), test.id('O'), 'probe');

-- A statement run as O's app: O's claims plus client_id, through RLS.
CREATE FUNCTION test.as_app(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', test.id('O'), 'role', p_role, 'client_id', 'c0ffee00-0000-4000-8000-000000000001')::text, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN 'ERROR ' || SQLSTATE || ' ' || SQLERRM;
END;
$$;

DO $$
DECLARE
  v text;
  missing text;
BEGIN
  -- The claim reader.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM test.ok(public.request_app_client_id() IS NULL, 'no claims at all reads as no app');
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  PERFORM test.ok(public.request_app_client_id() IS NULL, 'the service role is no app');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test.id('O'), 'role', 'authenticated')::text, true);
  PERFORM test.ok(public.request_app_client_id() IS NULL, 'a person''s own session is no app');
  PERFORM set_config('request.jwt.claims', '{"sub": "x", "client_id": ""}', true);
  PERFORM test.ok(public.request_app_client_id() IS NULL, 'an empty client_id is no app');
  PERFORM set_config('request.jwt.claims', '{"sub": "x", "client_id": "abc"}', true);
  PERFORM test.ok(public.request_app_client_id() = 'abc', 'a token with client_id is an app');
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- The Data API's pre-request.
  PERFORM test.ok(
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator'
            AND 'pgrst.db_pre_request=public.refuse_app_tokens' = ANY (rolconfig)),
    'PostgREST runs refuse_app_tokens before every Data API request');
  v := test.as_app('authenticated', 'SELECT public.refuse_app_tokens()::text');
  PERFORM test.ok(v LIKE 'ERROR PGRST %' AND v LIKE '%app_token%', 'the pre-request refuses an app''s token', v);
  v := test.value_as('O', 'SELECT ''passed'' FROM (SELECT public.refuse_app_tokens()) s');
  PERFORM test.ok(v = 'passed', 'the pre-request lets the person''s own session through', v);

  -- Every table Storage and Realtime read through has the restrictive policy.
  SELECT string_agg(t::text, ', ') INTO missing
  FROM (
    SELECT format('%I.%I', schemaname, tablename)::regclass AS t
    FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    UNION SELECT to_regclass('storage.objects')
    UNION SELECT to_regclass('realtime.messages')
  ) s
  WHERE t IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = s.t AND p.polname = 'app_tokens_refused' AND NOT p.polpermissive)
    ;
  PERFORM test.ok(missing IS NULL,
    'storage.objects, realtime.messages and every published table refuse app tokens', missing);

  SELECT string_agg(c.oid::regclass::text, ', ') INTO missing
  FROM pg_class c
  WHERE c.oid IN (
    SELECT format('%I.%I', schemaname, tablename)::regclass FROM pg_publication_tables WHERE pubname = 'supabase_realtime')
    AND NOT c.relrowsecurity;
  PERFORM test.ok(missing IS NULL, 'every published table has row security on, so the policy applies', missing);

  -- What the policy does: the person still sees the tag, the app sees nothing and writes nothing.
  v := test.value_as('O', format($q$SELECT count(*)::text FROM public.tags WHERE id = %L$q$, test.id('G')));
  PERFORM test.ok(v = '1', 'the person reads their workspace''s tag', v);
  v := test.as_app('authenticated', format($q$SELECT count(*)::text FROM public.tags WHERE id = %L$q$, test.id('G')));
  PERFORM test.ok(v = '0', 'the app (as authenticated) reads nothing', v);
  v := test.as_app('anon', format($q$SELECT count(*)::text FROM public.tags WHERE id = %L$q$, test.id('G')));
  PERFORM test.ok(v = '0' OR v LIKE 'ERROR 42501%', 'the app (as anon) reads nothing', v);
  v := test.try('O', format(
    $q$INSERT INTO public.tags (workspace_id, owner_id, name) VALUES (%L, %L, 'from-person')$q$,
    test.id('W'), test.id('O')));
  PERFORM test.ok(v = 'ok 1', 'the person can add a tag (the control for the next check)', v);
  v := test.as_app('authenticated', format(
    $q$WITH i AS (INSERT INTO public.tags (workspace_id, owner_id, name) VALUES (%L, %L, 'from-app') RETURNING 1)
       SELECT count(*)::text FROM i$q$, test.id('W'), test.id('O')));
  PERFORM test.ok(v LIKE 'ERROR 42501%', 'the app can''t write the same row', v);

  -- Storage: O's own avatar, which O's profile policy lets O read.
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars') THEN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('avatars', 'profiles/' || test.id('O') || '/lockout.png', test.id('O'));
    v := test.value_as('O', $q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%/lockout.png'$q$);
    PERFORM test.ok(v = '1', 'the person reads their own avatar object', v);
    v := test.as_app('authenticated', $q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%/lockout.png'$q$);
    PERFORM test.ok(v = '0', 'the app reads no Storage objects, not even the person''s avatar', v);
  ELSE
    PERFORM test.ok(false, 'the avatars bucket exists for the Storage check');
  END IF;

  -- Realtime private channels: a row the person could read.
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    INSERT INTO realtime.messages (topic, extension, payload, event, private)
    VALUES ('lockout-probe', 'broadcast', '{}'::jsonb, 'probe', true);
    v := test.as_app('authenticated', $q$SELECT count(*)::text FROM realtime.messages WHERE topic = 'lockout-probe'$q$);
    PERFORM test.ok(v = '0', 'the app reads no Realtime messages', v);
    v := test.as_app('authenticated',
      $q$WITH i AS (INSERT INTO realtime.messages (topic, extension, payload, event, private)
         VALUES ('lockout-probe', 'broadcast', '{}'::jsonb, 'probe', true) RETURNING 1) SELECT count(*)::text FROM i$q$);
    PERFORM test.ok(v LIKE 'ERROR 42501%', 'the app can''t send on a private Realtime channel', v);
  END IF;
END;
$$;

DO $$
DECLARE
  v text;
  o uuid := test.id('O');
BEGIN
  -- Passwords: Auth (supabase_auth_admin) can't set one, an operator's SQL can.
  BEGIN
    SET LOCAL ROLE supabase_auth_admin;
    UPDATE auth.users SET encrypted_password = md5('auth' || o::text) WHERE id = o;
    RESET ROLE;
    v := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM test.ok(v LIKE '42501 Moduo has no passwords%', 'Supabase Auth can''t set a password (an app''s token can''t turn into a session)', v);
  BEGIN
    SET LOCAL ROLE supabase_auth_admin;
    UPDATE auth.users SET encrypted_password = '' WHERE id = o;
    UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"probe": true}' WHERE id = o;
    RESET ROLE;
    v := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM test.ok(v = 'ok', 'Auth can still clear a password and update everything else', v);
  UPDATE auth.users SET encrypted_password = md5('operator' || o::text) WHERE id = o;
  PERFORM test.ok((SELECT encrypted_password FROM auth.users WHERE id = o) = md5('operator' || o::text),
    'an operator''s SQL (seed.sql) can still set one');
END;
$$;
