-- MOD-576 · The host an OAuth sign-in returns to, read the way a browser does
-- or not at all (supabase/migrations/20261024160000_oauth_redirect_host_userinfo.sql).
--
-- Cast: E owns W. C is the real Claude (returns to claude.ai). A registered a
-- redirect whose userinfo hides evil.com behind claude.ai, B one whose
-- backslash does the same, and M both a plain claude.ai redirect and a
-- deceptive one.

SELECT test.person('E');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('E'), 'Moduo Labs');
INSERT INTO auth.oauth_clients
  (id, registration_type, redirect_uris, grant_types, client_name, client_type, token_endpoint_auth_method)
VALUES
  (test.id('C'), 'dynamic', 'https://claude.ai/api/mcp/auth_callback', 'authorization_code,refresh_token',
   'Claude', 'public', 'none'),
  (test.id('A'), 'dynamic', 'https://x@claude.ai:@evil.com/cb', 'authorization_code,refresh_token',
   'Claude', 'public', 'none'),
  (test.id('B'), 'dynamic', 'https://evil.com\.claude.ai/cb', 'authorization_code,refresh_token',
   'Claude', 'public', 'none'),
  (test.id('M'), 'dynamic', 'https://claude.ai/cb,https://x@claude.ai:@evil.com/cb',
   'authorization_code,refresh_token', 'Claude', 'public', 'none');

CREATE FUNCTION test.sign_in(p_who text, p_client text, p_redirect text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'auth-' || gen_random_uuid();
BEGIN
  INSERT INTO auth.oauth_authorizations
    (id, authorization_id, client_id, user_id, redirect_uri, scope, status, created_at, expires_at)
  SELECT gen_random_uuid(), v_id, c.id, test.id(p_who),
         coalesce(p_redirect, split_part(c.redirect_uris, ',', 1)), 'openid',
         'pending'::auth.oauth_authorization_status, now() - interval '1 minute', now() + interval '3 minutes'
  FROM auth.oauth_clients c WHERE c.id = test.id(p_client);
  RETURN v_id;
END;
$$;
CREATE FUNCTION test.request(p_who text, p_authorization text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT public.workspace_api_keys_oauth_request(%L)::text$q$, p_authorization))::jsonb
$$;
CREATE FUNCTION test.connect(p_who text, p_client text, p_redirect text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT * FROM public.workspace_api_keys_connect_oauth(%L, %L, '{"tasks": "view"}'::jsonb, 90, false)$q$,
    test.id('W'), test.sign_in(p_who, p_client, p_redirect)))
$$;
CREATE FUNCTION test.domain_of(p_client text) RETURNS text LANGUAGE sql AS $$
  SELECT oauth_client_domain FROM public.workspace_api_keys
  WHERE oauth_client_id = test.id(p_client) AND revoked_at IS NULL
$$;

-- ── the reading itself ───────────────────────────────────────────────────────
SELECT test.ok(
  (SELECT bool_and(public.workspace_api_keys__oauth_redirect_host(u) IS NOT DISTINCT FROM want)
   FROM (VALUES
     ('https://claude.ai/api/mcp/auth_callback', 'claude.ai'),
     ('https://Claude.AI:443/cb', 'claude.ai'),
     ('  https://chatgpt.com/x  ', 'chatgpt.com'),
     ('http://localhost:33418/callback', 'localhost'),
     ('https://[::1]:8080/cb', '[::1]'),
     ('cursor://anysphere.cursor-retrieval/oauth', 'anysphere.cursor-retrieval'),
     ('https://claude.ai?next=x@y', 'claude.ai'),
     ('https://claude.ai#@evil.com', 'claude.ai')
   ) AS t(u, want)),
  'plain hosts read as before: lower case, port and path dropped');
SELECT test.ok(
  (SELECT bool_and(public.workspace_api_keys__oauth_redirect_host(u) IS NULL)
   FROM unnest(ARRAY[
     'https://x@claude.ai:@evil.com/cb',
     'https://claude.ai@evil.com/cb',
     'https://user:pw@claude.ai/cb',
     'https://evil.com\.claude.ai/cb',
     'https://claude%2eai/cb',
     'https://claude.ai:abc/cb',
     'https:/\evil.com',
     'https://clau de.ai/cb',
     'https://openaİ.com/cb',
     'https://anthropİc.com/cb',
     'https://claudé.ai/cb',
     'not a url',
     NULL
   ]) AS u),
  'an authority with userinfo, a backslash, an escape, a space, non-ASCII or a bad port has no host');
SELECT test.ok(
  NOT has_function_privilege('authenticated', 'public.workspace_api_keys__oauth_redirect_host(text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.workspace_api_keys__recheck_oauth_domains()', 'execute')
  AND NOT has_function_privilege('anon', 'public.workspace_api_keys__recheck_oauth_domains()', 'execute'),
  'the helpers are internal');

-- ── the consent screen's read ────────────────────────────────────────────────
SELECT test.ok(
  (SELECT r ->> 'client_domain' = 'claude.ai' AND r ->> 'client_scheme' = 'https'
   FROM test.request('E', test.sign_in('E', 'C')) r),
  'the real Claude still reads claude.ai');
SELECT test.ok(
  (SELECT r -> 'client_domain' = 'null'::jsonb AND r ->> 'client_scheme' = 'https'
   FROM test.request('E', test.sign_in('E', 'A')) r),
  'a redirect hiding evil.com behind userinfo reads no domain, not claude.ai');
SELECT test.ok(
  (SELECT r -> 'client_domain' = 'null'::jsonb FROM test.request('E', test.sign_in('E', 'B')) r),
  'a backslash redirect reads no domain');

-- ── connect stores what the screen showed ────────────────────────────────────
SELECT test.ok(test.connect('E', 'C') LIKE 'ok%', 'Claude connects');
SELECT test.ok(test.domain_of('C') = 'claude.ai', 'and keeps claude.ai');
SELECT test.ok(test.connect('E', 'A') LIKE 'ok%', 'the deceptive app connects');
SELECT test.ok(test.domain_of('A') IS NULL, 'but stores no domain');
SELECT test.ok(
  (SELECT r -> 'others' = '[]'::jsonb FROM test.request('E', test.sign_in('E', 'C')) r),
  'and is never offered as "the same app" as Claude');

-- ── stored rows are rechecked ────────────────────────────────────────────────
-- Rows as the old reading left them: claude.ai for the deceptive apps.
SELECT test.ok(test.connect('E', 'M', 'https://claude.ai/cb') LIKE 'ok%', 'the mixed app connects');
SELECT test.ok(test.domain_of('M') = 'claude.ai', 'on its plain redirect, claude.ai');
UPDATE public.workspace_api_keys SET oauth_client_domain = 'claude.ai'
WHERE oauth_client_id IN (test.id('A'), test.id('M'));
INSERT INTO public.workspace_api_keys (workspace_id, name, created_by, oauth_client_id, oauth_client_domain,
                                       oauth_client_scheme)
VALUES (test.id('W'), 'Gone', test.id('E'), test.id('X'), 'claude.ai', 'https');
SELECT test.ok(public.workspace_api_keys__recheck_oauth_domains() = 3, 'the recheck clears three rows');
SELECT test.ok(test.domain_of('C') = 'claude.ai', 'the real Claude keeps claude.ai');
SELECT test.ok(test.domain_of('A') IS NULL, 'the userinfo app loses it');
SELECT test.ok(test.domain_of('M') IS NULL, 'an app that also registered a deceptive redirect loses it');
SELECT test.ok(test.domain_of('X') IS NULL, 'a connection whose app is gone loses it');
SELECT test.ok(public.workspace_api_keys__recheck_oauth_domains() = 0, 'a second recheck changes nothing');
