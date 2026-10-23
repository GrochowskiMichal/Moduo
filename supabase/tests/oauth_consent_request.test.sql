-- MCPO-4 · What the consent screen reads for an app's sign-in
-- (supabase/migrations/20261023180000_oauth_consent_request.sql).
-- specs/mcp-oauth.md AC5, AC7, AC9.
--
-- Cast: O owns W, E is a member of W with API keys allowed, F a member
-- without them. X owns W2 (E a member there with API keys too). C is
-- "Claude" (returns to claude.ai), G an app with no name.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member'),
  (test.id('W2'), test.id('E'), 'member');
UPDATE public.workspace_members SET overrides = '{"ws.api_keys": true}'
WHERE user_id = test.id('E');
INSERT INTO auth.oauth_clients
  (id, registration_type, redirect_uris, grant_types, client_name, client_type, token_endpoint_auth_method)
VALUES
  (test.id('C'), 'dynamic', 'https://Claude.ai/api/mcp/auth_callback', 'authorization_code,refresh_token',
   'Claude', 'public', 'none'),
  (test.id('G'), 'dynamic', 'http://localhost:33418/callback', 'authorization_code,refresh_token',
   '  ', 'public', 'none');

CREATE FUNCTION test.sign_in(p_who text, p_client text, p_status text DEFAULT 'pending',
                             p_expires interval DEFAULT interval '3 minutes')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'auth-' || gen_random_uuid();
BEGIN
  INSERT INTO auth.oauth_authorizations
    (id, authorization_id, client_id, user_id, redirect_uri, scope, status, created_at, expires_at)
  SELECT gen_random_uuid(), v_id, c.id, test.id(p_who), split_part(c.redirect_uris, ',', 1), 'openid',
         p_status::auth.oauth_authorization_status, now() - interval '1 minute', now() + p_expires
  FROM auth.oauth_clients c WHERE c.id = test.id(p_client);
  RETURN v_id;
END;
$$;
-- The consent screen's read, as a person, for a sign-in.
CREATE FUNCTION test.request(p_who text, p_authorization text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT public.workspace_api_keys_oauth_request(%L)::text$q$, p_authorization))::jsonb
$$;
CREATE FUNCTION test.request_error(p_who text, p_authorization text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.workspace_api_keys_oauth_request(%L)$q$, p_authorization))
$$;

-- ── a first sign-in ──────────────────────────────────────────────────────────
CREATE TEMP TABLE first_sign_in AS SELECT test.sign_in('E', 'C') AS id;
SELECT test.ok(
  (SELECT r ->> 'app_name' = 'Claude' AND r ->> 'client_domain' = 'claude.ai'
          AND r ->> 'client_id' = test.id('C')::text AND r -> 'connection' = 'null'::jsonb
          AND r -> 'full_workspace_ids' = '[]'::jsonb
   FROM test.request('E', (SELECT id FROM first_sign_in)) r),
  'a first sign-in reads the app, its domain, and no connection');
SELECT test.ok(
  (test.request('E', test.sign_in('E', 'G'))) -> 'app_name' = 'null'::jsonb
  AND (test.request('E', test.sign_in('E', 'G'))) ->> 'client_domain' = 'localhost',
  'an app without a name reads null, with the domain it returns to');

-- ── only the person's own live sign-in ───────────────────────────────────────
SELECT test.ok(test.request_error('F', (SELECT id FROM first_sign_in)) LIKE 'P0002 This sign-in link has expired.%',
  'someone else''s sign-in reads as expired');
SELECT test.ok(test.request_error('E', test.sign_in('E', 'C', 'pending', interval '-1 second')) LIKE 'P0002 %',
  'an expired sign-in is refused');
SELECT test.ok(test.request_error('E', test.sign_in('E', 'C', 'denied')) LIKE 'P0002 %',
  'a denied sign-in is refused');
SELECT test.ok(test.request_error('E', 'auth-nothing') LIKE 'P0002 %', 'an unknown sign-in is refused');
SELECT test.ok((test.request('E', test.sign_in('E', 'C', 'approved'))) ->> 'app_name' = 'Claude',
  'an approved sign-in (Auth approves a returning app itself) still reads');
SELECT test.ok(NOT has_function_privilege('anon', 'public.workspace_api_keys_oauth_request(text)', 'EXECUTE')
               AND has_function_privilege('authenticated', 'public.workspace_api_keys_oauth_request(text)', 'EXECUTE'),
  'the read is for signed-in people only');

-- ── a reconnect reads the current connection ─────────────────────────────────
SELECT test.ok(test.as_user('E', format(
  $q$SELECT * FROM public.workspace_api_keys_connect_oauth(%L, %L, '{"tasks": "edit", "notes": "view"}'::jsonb, NULL, false)$q$,
  test.id('W'), (SELECT id FROM first_sign_in))) = 'ok 1', 'E connects Claude to W');
SELECT test.ok(
  (SELECT r -> 'connection' ->> 'workspace_id' = test.id('W')::text
          AND r -> 'connection' -> 'scopes' = '{"tasks": "edit", "notes": "view"}'::jsonb
          AND r -> 'connection' -> 'expires_at' = 'null'::jsonb
          AND r -> 'connection' ->> 'include_private_chat' = 'false'
          AND r -> 'connection' ->> 'name' = 'Claude'
   FROM test.request('E', test.sign_in('E', 'C', 'approved')) r),
  'a reconnect reads the connection''s workspace and access (the pre-fill)');
SELECT test.ok((test.request('O', test.sign_in('O', 'C'))) -> 'connection' = 'null'::jsonb,
  'another person''s sign-in for the same app reads no connection');

-- ── the 20 cap ───────────────────────────────────────────────────────────────
INSERT INTO public.workspace_api_keys (workspace_id, name, key_prefix, key_hash, created_by)
SELECT test.id('W'), 'Key ' || g, 'moduo_sk_' || g, md5('k' || g), test.id('O') FROM generate_series(1, 19) g;
SELECT test.ok((test.request('E', test.sign_in('E', 'C'))) -> 'full_workspace_ids' = '[]'::jsonb,
  'at 19 keys plus E''s own connection, W isn''t full for E (the connection doesn''t count against itself)');
SELECT test.ok((test.request('O', test.sign_in('O', 'C'))) -> 'full_workspace_ids' = jsonb_build_array(test.id('W')),
  'at 20 keys and connections, W is full for a new connection');
INSERT INTO public.workspace_api_keys (workspace_id, name, key_prefix, key_hash, created_by, created_at, expires_at)
SELECT test.id('W2'), 'Old ' || g, 'moduo_sk_o' || g, md5('o' || g), test.id('X'), now() - interval '2 days', now() - interval '1 day'
FROM generate_series(1, 20) g;
SELECT test.ok(NOT ((test.request('E', test.sign_in('E', 'C'))) -> 'full_workspace_ids' ? test.id('W2')::text),
  'expired keys don''t count toward the cap');
SELECT test.ok((test.request('F', test.sign_in('F', 'C'))) -> 'full_workspace_ids' = '[]'::jsonb,
  'a workspace where the person can''t manage keys is never listed');
