-- MCPO-3 · Connections: an app's OAuth sign-in as a workspace API key row
-- (supabase/migrations/20261023120000_oauth_connections.sql). specs/mcp-oauth.md
-- AC4, AC5, AC7, AC9, AC10; Assumptions #1, #5, #11.
--
-- Cast: O owns workspace W, E is a member of W with API keys allowed, F a
-- member without them. X owns W2, where E is a member with API keys too.
-- C is "Claude" (redirects to claude.ai), D is "Claude Desktop" (two
-- redirects), G an app with no name, H "Helper". SB is a shared project in W.

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
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001');
INSERT INTO auth.oauth_clients
  (id, registration_type, redirect_uris, grant_types, client_name, client_type, token_endpoint_auth_method)
VALUES
  (test.id('C'), 'dynamic', 'https://claude.ai/api/mcp/auth_callback', 'authorization_code,refresh_token',
   'Claude', 'public', 'none'),
  (test.id('D'), 'dynamic', 'http://localhost:33418/callback,https://example.com/cb',
   'authorization_code,refresh_token', 'Claude Desktop', 'public', 'none'),
  (test.id('G'), 'dynamic', 'https://Agent.Example.org:8443/cb', 'authorization_code,refresh_token',
   NULL, 'public', 'none'),
  (test.id('H'), 'dynamic', 'https://h.example.net/cb', 'authorization_code,refresh_token',
   'Helper', 'public', 'none'),
  -- Calls itself Claude and returns to "claude.ai", but through its own scheme:
  -- the code goes to a local program.
  (test.id('S'), 'dynamic', 'someapp://claude.ai/cb', 'authorization_code,refresh_token',
   'Claude', 'public', 'none');

-- A pending sign-in the person is looking at (Supabase Auth binds it to them
-- when the consent page reads it), returning to `p_redirect` (default: the
-- app's first registered redirect).
CREATE FUNCTION test.sign_in(p_who text, p_client text, p_redirect text DEFAULT NULL,
                             p_status text DEFAULT 'pending', p_expires interval DEFAULT interval '3 minutes')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'auth-' || gen_random_uuid();
BEGIN
  INSERT INTO auth.oauth_authorizations
    (id, authorization_id, client_id, user_id, redirect_uri, scope, status, created_at, expires_at)
  SELECT gen_random_uuid(), v_id, c.id, test.id(p_who),
         coalesce(p_redirect, split_part(c.redirect_uris, ',', 1)), 'openid',
         p_status::auth.oauth_authorization_status, now() - interval '1 hour', now() + p_expires
  FROM auth.oauth_clients c WHERE c.id = test.id(p_client);
  RETURN v_id;
END;
$$;
-- Approve a sign-in as a person (the consent screen's Approve).
CREATE FUNCTION test.approve(p_who text, p_ws text, p_authorization text, p_scopes jsonb,
                             p_days integer DEFAULT 90, p_private boolean DEFAULT false) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT * FROM public.workspace_api_keys_connect_oauth(%L, %L, %L::jsonb, %s, %L)$q$,
    test.id(p_ws), p_authorization, p_scopes, coalesce(p_days::text, 'NULL'), p_private))
$$;
-- A fresh sign-in by the person for the app, approved.
CREATE FUNCTION test.connect(p_who text, p_ws text, p_client text, p_scopes jsonb,
                             p_days integer DEFAULT 90, p_private boolean DEFAULT false) RETURNS text
LANGUAGE sql AS $$
  SELECT test.approve(p_who, p_ws, test.sign_in(coalesce(p_who, 'E'), p_client), p_scopes, p_days, p_private)
$$;
-- The person's live connection to an app (what moduo-mcp loads for sub + client_id).
CREATE FUNCTION test.live(p_who text, p_client text) RETURNS public.workspace_api_keys LANGUAGE sql AS $$
  SELECT * FROM public.workspace_api_keys
  WHERE created_by = test.id(p_who) AND oauth_client_id = test.id(p_client) AND revoked_at IS NULL
$$;
-- A statement as the connector calls for a connection (service_role + its key id).
CREATE FUNCTION test.as_connection(p_key uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
  v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  PERFORM set_config('request.headers', json_build_object('x-moduo-key-id', p_key)::text, true);
  SET LOCAL ROLE service_role;
  EXECUTE p_sql;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
  RETURN v_state || ' ' || v_msg;
END;
$$;
CREATE FUNCTION test.bell(p_who text, p_ws text) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT count(*)::text FROM public.notifications_list(%L, 200) WHERE op = 'api_keys.connected'$q$,
    test.id(p_ws)))::integer
$$;

-- ── The table: a secret or an app, never both ────────────────────────────────
SELECT test.ok(
  test.as_op('O', format($q$INSERT INTO public.workspace_api_keys (workspace_id, name, key_prefix, key_hash, created_by, oauth_client_id)
    VALUES (%L, 'Both', 'moduo_sk_x', md5('both'), %L, %L)$q$, test.id('W'), test.id('O'), test.id('C'))) LIKE '23514 %',
  'a row with a secret and an app is refused');
SELECT test.ok(
  test.as_op('O', format($q$INSERT INTO public.workspace_api_keys (workspace_id, name, created_by)
    VALUES (%L, 'Neither', %L)$q$, test.id('W'), test.id('O'))) LIKE '23514 %',
  'a row with neither a secret nor an app is refused');
SELECT test.ok(
  test.as_op('O', format($q$INSERT INTO public.workspace_api_keys (workspace_id, name, oauth_client_id)
    VALUES (%L, 'Nobody''s', %L)$q$, test.id('W'), test.id('C'))) LIKE '23514 %',
  'a connection without its person is refused');

-- ── connect is one per app and person ────────────────────────────────────────
SELECT test.ok(test.connect('E', 'W', 'C', '{"tasks": "view"}') = 'ok 1', 'E connects Claude to W');
SELECT test.ok((test.live('E', 'C')).workspace_id = test.id('W')
               AND (test.live('E', 'C')).name = 'Claude'
               AND (test.live('E', 'C')).oauth_client_domain = 'claude.ai'
               AND (test.live('E', 'C')).key_hash IS NULL
               AND (test.live('E', 'C')).key_prefix IS NULL
               AND (test.live('E', 'C')).scopes = '{"tasks": "view"}'::jsonb
               AND (test.live('E', 'C')).expires_at BETWEEN now() + interval '89 days' AND now() + interval '91 days',
  'the connection is a key row named by the app, with its redirect domain, no secret, the access chosen, 90 days');

CREATE TEMP TABLE first_conn AS SELECT (test.live('E', 'C')).id AS id;
GRANT SELECT ON first_conn TO authenticated, service_role;

SELECT test.ok(test.connect('E', 'W', 'C', '{"tasks": "edit", "notes": "view"}', NULL, true) = 'ok 1',
  'E reconnects Claude with more access, no expiry and private chat');
SELECT test.ok((SELECT count(*) FROM public.workspace_api_keys
                WHERE created_by = test.id('E') AND oauth_client_id = test.id('C')) = 1
               AND (test.live('E', 'C')).id = (SELECT id FROM first_conn)
               AND (test.live('E', 'C')).scopes = '{"tasks": "edit", "notes": "view"}'::jsonb
               AND (test.live('E', 'C')).expires_at IS NULL
               AND (test.live('E', 'C')).include_private_chat,
  'reconnecting updates the same row (no duplicate): access, expiry and private chat replaced');

UPDATE public.workspace_api_keys SET name = 'My Claude' WHERE id = (SELECT id FROM first_conn);
SELECT test.connect('E', 'W', 'C', '{"tasks": "view"}');
SELECT test.ok((test.live('E', 'C')).name = 'My Claude', 'a reconnect keeps the name the person gave it');

-- An expired connection is renewed in place by a reconnect.
UPDATE public.workspace_api_keys SET created_at = now() - interval '40 days', expires_at = now() - interval '1 day'
WHERE id = (SELECT id FROM first_conn);
SELECT test.ok(test.connect('E', 'W', 'C', '{"tasks": "view"}', 30) = 'ok 1'
               AND (test.live('E', 'C')).id = (SELECT id FROM first_conn)
               AND (test.live('E', 'C')).expires_at > now() + interval '29 days',
  'reconnecting an expired connection renews the same row');

SELECT test.ok(test.connect('E', 'W', 'D', '{"tasks": "view"}') = 'ok 1', 'E connects Claude Desktop to W');
SELECT test.ok((SELECT count(*) FROM public.workspace_api_keys
                    WHERE created_by = test.id('E') AND oauth_client_id IS NOT NULL AND revoked_at IS NULL) = 2
               AND (test.live('E', 'D')).oauth_client_domain = 'localhost',
  'a second app is a second connection, named and placed by its first redirect');
-- An app may register several redirects; the domain is where this sign-in returns.
SELECT test.ok(test.approve('O', 'W', test.sign_in('O', 'D', 'https://example.com/cb'), '{"tasks": "view"}') = 'ok 1'
               AND (test.live('O', 'D')).oauth_client_domain = 'example.com',
  'the domain is the one this sign-in returns to, not the app''s first registered redirect');
SELECT test.ok(test.connect('O', 'W', 'G', '{"tasks": "view"}') = 'ok 1'
               AND (test.live('O', 'G')).name = 'agent.example.org'
               AND (test.live('O', 'G')).oauth_client_domain = 'agent.example.org',
  'an app with no name is named by its domain (lowercased, no port)');
-- The scheme is kept with the domain (20261023200000), so Settings can tell
-- https://claude.ai from an app's own someapp://claude.ai.
SELECT test.ok((test.live('E', 'C')).oauth_client_scheme = 'https'
               AND (test.live('E', 'D')).oauth_client_scheme = 'http',
  'a connection keeps the scheme its sign-in returns to');
SELECT test.ok(test.connect('O', 'W', 'S', '{"tasks": "view"}') = 'ok 1'
               AND (test.live('O', 'S')).oauth_client_domain = 'claude.ai'
               AND (test.live('O', 'S')).oauth_client_scheme = 'someapp',
  'an app returning to someapp://claude.ai is stored with its own scheme, not as plain claude.ai');
UPDATE public.workspace_api_keys SET revoked_at = now() WHERE id = (test.live('O', 'S')).id;  -- out of the counts below
SELECT test.ok(
  test.as_op('O', format($q$INSERT INTO public.workspace_api_keys (workspace_id, name, key_prefix, key_hash, created_by, oauth_client_scheme)
    VALUES (%L, 'Key with a scheme', 'moduo_sk_y', md5('scheme'), %L, 'https')$q$, test.id('W'), test.id('O'))) LIKE '23514 %',
  'only a connection carries a scheme');
SELECT test.ok(test.connect('O', 'W', 'C', '{"tasks": "view"}') = 'ok 1'
               AND (test.live('O', 'C')).id <> (test.live('E', 'C')).id,
  'the same app connected by two people is two connections');

-- Moving workspaces: the old row ends, a new one starts in W2 with the name kept.
SELECT test.ok(test.connect('E', 'W2', 'C', '{"tasks": "view"}') = 'ok 1', 'E moves Claude to W2');
SELECT test.ok((test.live('E', 'C')).workspace_id = test.id('W2')
               AND (test.live('E', 'C')).name = 'My Claude'
               AND (SELECT revoked_at IS NOT NULL FROM public.workspace_api_keys WHERE id = (SELECT id FROM first_conn)),
  'moving revokes the connection in W and starts it in W2');
SELECT test.ok(public.module_api_key_effective_scopes((SELECT id FROM first_conn)) = '{}'::jsonb,
  'the moved-away row resolves to no access');

-- Caps and refusals.
UPDATE public.workspace_members
SET overrides = '{"ws.api_keys": true, "tasks.create": false, "tasks.edit": false, "tasks.delete": false}'
WHERE workspace_id = test.id('W2') AND user_id = test.id('E');
SELECT test.ok(test.connect('E', 'W2', 'C', '{"tasks": "edit"}') LIKE '42501 You can''t let this key edit Tasks: you can only view Tasks yourself.%',
  'access is capped to the person''s own (Tasks: View → no Edit)');
SELECT test.ok((test.live('E', 'C')).scopes = '{"tasks": "view"}'::jsonb, 'a refused connect changes nothing');
SELECT test.ok(test.connect('F', 'W', 'C', '{"tasks": "view"}') LIKE '42501 Your role doesn''t include API keys here.%',
  'a role without ws.api_keys is refused');
SELECT test.ok(test.approve('E', 'W', 'auth-nonexistent', '{"tasks": "view"}') LIKE 'P0002 This sign-in link has expired.%',
  'an unknown sign-in is refused');
SELECT test.ok(test.approve('E', 'W', test.sign_in('O', 'C'), '{"tasks": "view"}') LIKE 'P0002 %',
  'someone else''s sign-in is refused');
SELECT test.ok(test.approve('E', 'W', test.sign_in('E', 'C', NULL, 'pending', interval '-1 second'), '{"tasks": "view"}') LIKE 'P0002 %',
  'an expired sign-in is refused');
SELECT test.ok(test.approve('E', 'W', test.sign_in('E', 'C', NULL, 'denied'), '{"tasks": "view"}') LIKE 'P0002 %',
  'a denied sign-in is refused');
SELECT test.ok(test.approve('E', 'W2', test.sign_in('E', 'C', NULL, 'approved'), '{"tasks": "view"}') = 'ok 1',
  'a sign-in Supabase already approved (the app was consented to before) still connects');
UPDATE auth.oauth_clients SET deleted_at = now() WHERE id = test.id('G');
SELECT test.ok(test.connect('O', 'W', 'G', '{"tasks": "view"}') LIKE 'P0002 %', 'a deleted client is refused');
SELECT test.ok(test.connect('E', 'W', 'C', '{"tasks": "view"}', 0) LIKE '22023 %', 'an expiry outside 1–730 days is refused');
SELECT test.ok(test.connect(NULL, 'W', 'C', '{"tasks": "view"}') LIKE '42501 %', 'signed out is refused');
SELECT test.ok(test.connect('E', 'W', 'C', '{"bogus": "view"}') LIKE 'P0001 Unknown module%', 'an unknown module is refused');

-- The 20 cap counts keys and connections.
INSERT INTO public.workspace_api_keys (workspace_id, name, key_prefix, key_hash, scopes, created_by)
SELECT test.id('W'), 'Key ' || n, 'moduo_sk_' || n, md5('oauth-cap-' || n), '{"tasks": "view"}', test.id('O')
FROM generate_series(1, 20 - (SELECT count(*) FROM public.workspace_api_keys
                              WHERE workspace_id = test.id('W') AND revoked_at IS NULL)::int) AS n;
SELECT test.ok(test.connect('E', 'W', 'C', '{"tasks": "view"}') LIKE '54000 This workspace has 20 keys and connections.%',
  'a new connection at 20 keys and connections is refused with the cap message');
SELECT test.ok(test.connect('O', 'W', 'H', '{"tasks": "view"}') LIKE '54000 %',
  'connections count toward the cap');
SELECT test.ok(test.connect('O', 'W', 'C', '{"tasks": "edit"}') = 'ok 1',
  'updating a connection already in the workspace still works at the cap');
SELECT test.ok(test.as_user('O', format($q$SELECT * FROM public.workspace_api_keys_create(%L, 'One more')$q$, test.id('W')))
               LIKE 'P0001 This workspace already has 20 active keys%',
  'creating a key is refused at the cap that connections count toward');

-- ── connect notifies the person ──────────────────────────────────────────────
SELECT test.ok(test.bell('E', 'W') = 2, 'E''s bell in W: Claude and Claude Desktop connected (reconnects ring nothing)');
SELECT test.ok(test.bell('E', 'W2') = 1, 'E''s bell in W2: the moved connection');
SELECT test.ok(test.bell('O', 'W') = 4 AND test.bell('F', 'W') = 0,
  'O sees only their own four connections; F, who connected nothing, sees none');
SELECT test.ok(test.value_as('F', $q$SELECT count(*)::text FROM public.module_activity WHERE entity_type = 'api_key'$q$) = '0'
               AND test.value_as('E', $q$SELECT count(*)::text FROM public.module_activity WHERE entity_type = 'api_key'$q$) = '3',
  'a connection notice is readable only by its person (F reads none of them, E reads their three)');
SELECT test.ok((SELECT actor_type = 'api_key' AND actor_label = 'Claude Desktop'
                       AND payload ->> 'app_name' = 'Claude Desktop'
                       AND payload -> 'scopes' = '{"tasks": "view"}'::jsonb
                       AND payload ->> 'client_domain' = 'localhost'
                FROM public.module_activity
                WHERE op = 'api_keys.connected' AND entity_id = (test.live('E', 'D')).id),
  'the notice names the app and its access');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries
                           WHERE user_id IN (test.id('E'), test.id('O')) AND workspace_id IN (test.id('W'), test.id('W2'))),
  'the notice is quiet: no push delivery');

-- ── attribution reads via the app ────────────────────────────────────────────
UPDATE public.workspace_members SET overrides = '{"ws.api_keys": true}'
WHERE workspace_id = test.id('W2') AND user_id = test.id('E');
SELECT test.connect('E', 'W2', 'C', '{"tasks": "edit"}');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position)
VALUES (test.id('SB2'), test.id('W2'), test.id('X'), 'Shared', false, '0001');
SELECT test.ok(test.as_connection((test.live('E', 'C')).id, format(
  $q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W2'),
  jsonb_build_object('id', test.id('T'), 'title', 'From Claude', 'bucket_id', test.id('SB2')))) = 'ok',
  'the connection creates a task, as the connector calls');
SELECT test.ok((SELECT actor_type = 'api_key' AND actor_id = (test.live('E', 'C')).id
                       AND actor_label = 'E · via My Claude'
                FROM public.module_activity
                WHERE entity_id = test.id('T') AND op LIKE 'tasks.%' ORDER BY created_at LIMIT 1),
  'an op through a connection logs api_key with "Person · via <app>"');

-- ── rename ───────────────────────────────────────────────────────────────────
SELECT test.ok(test.as_user('E', format($q$SELECT public.workspace_api_keys_rename(%L, '  Claude (work)  ')$q$,
                 (test.live('E', 'C')).id)) = 'ok 1'
               AND (test.live('E', 'C')).name = 'Claude (work)',
  'a connection is renamed (trimmed)');
SELECT test.ok(test.as_user('E', format($q$SELECT public.workspace_api_keys_rename(%L, '')$q$,
                 (test.live('E', 'C')).id)) LIKE '22023 %', 'an empty name is refused');
SELECT test.ok(test.as_user('O', format($q$SELECT public.workspace_api_keys_rename(%L, 'Renamed')$q$,
                 (test.live('E', 'D')).id)) LIKE '42501 Only the person who created this key can rename it.%',
  'a manager can''t rename someone else''s connection (it''s their trail name)');
SELECT test.ok(test.as_user('F', format($q$SELECT public.workspace_api_keys_rename(%L, 'Mine')$q$,
                 (test.live('O', 'C')).id)) LIKE 'P0002 %', 'without ws.api_keys a key reads as not found');
SELECT test.ok(test.as_user('E', format($q$SELECT public.workspace_api_keys_rename(%L, 'Old')$q$,
                 (SELECT id FROM first_conn))) LIKE 'P0001 This key was revoked%', 'a revoked row can''t be renamed');

-- ── disconnect cuts off ──────────────────────────────────────────────────────
CREATE TEMP TABLE second_conn AS SELECT (test.live('E', 'C')).id AS id;
SELECT test.ok(test.as_user('E', format($q$SELECT public.workspace_api_keys_revoke(%L)$q$, (SELECT id FROM second_conn))) = 'ok 1',
  'E disconnects Claude');
SELECT test.ok((test.live('E', 'C')).id IS NULL, 'no live connection is left for E and Claude, so the connector refuses');
SELECT test.ok(public.module_api_key_effective_scopes((SELECT id FROM second_conn)) = '{}'::jsonb,
  'the disconnected key id resolves to no access');
SELECT test.ok(test.as_connection((SELECT id FROM second_conn), format(
  $q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W2'),
  jsonb_build_object('id', test.id('T2'), 'title', 'Too late', 'bucket_id', test.id('SB2')))) <> 'ok',
  'a call made with the disconnected key id is refused');
SELECT test.ok(test.connect('E', 'W2', 'C', '{"tasks": "view"}') = 'ok 1'
               AND (test.live('E', 'C')).id <> (SELECT id FROM second_conn),
  'signing in again after a disconnect makes a new connection');

-- ── grants ───────────────────────────────────────────────────────────────────
SELECT test.ok(NOT has_function_privilege('anon', 'public.workspace_api_keys_connect_oauth(uuid, text, jsonb, integer, boolean)', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.workspace_api_keys_rename(uuid, text)', 'EXECUTE')
               AND has_function_privilege('authenticated', 'public.workspace_api_keys_connect_oauth(uuid, text, jsonb, integer, boolean)', 'EXECUTE'),
  'connect and rename are for signed-in people only');

-- ── erasure: a deleted key takes its notice ──────────────────────────────────
DELETE FROM public.workspace_api_keys WHERE id = (test.live('E', 'D')).id;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity
                           WHERE entity_type = 'api_key' AND payload ->> 'app_name' = 'Claude Desktop'
                             AND payload -> 'notify_user_ids' ? test.id('E')::text),
  'deleting a connection (as account erasure does) deletes its notice');
