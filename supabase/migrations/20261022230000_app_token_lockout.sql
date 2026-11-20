-- MCPO-1 (specs/mcp-oauth.md): an app's OAuth token reaches nothing but the
-- Moduo connector.
--
-- Supabase Auth's OAuth 2.1 server hands apps (Claude, ChatGPT, …) an ordinary
-- user access token with one extra claim, client_id. Without this migration
-- that token would open the whole Data API, Storage and Realtime as the person,
-- past the per-module access they approved on the consent screen. The
-- connector (moduo-mcp) verifies the token itself and exchanges it for the
-- connection's key (MCPO-3), so nothing else needs to accept it:
--
--   1. public.request_app_client_id(): the client_id of the request's token,
--      or NULL for a person's own session and for every server credential.
--   2. A PostgREST pre-request function refuses every Data API request
--      (tables, views, RPC, GraphQL) made with an app token: 403.
--   3. Pre-request covers only the Data API, so Storage and Realtime get a
--      RESTRICTIVE policy on the tables they read through: storage.objects,
--      realtime.messages and every table in the supabase_realtime
--      publication (postgres-changes runs each subscriber's RLS). A restrictive
--      policy can only take rows away, so a person's own session and the
--      service role are untouched.
--
-- Edge Functions that accept a person's token refuse app tokens in code
-- (supabase/functions/_shared/app-token.ts). A table added to the
-- publication later needs the same policy: supabase/tests/app_token_lockout
-- fails until it has one.

CREATE OR REPLACE FUNCTION public.request_app_client_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '')
$$;

COMMENT ON FUNCTION public.request_app_client_id() IS
  'The OAuth client_id of the request''s token (an app''s token from the OAuth server), NULL for a person''s own session or a server credential. MCPO-1.';

REVOKE ALL ON FUNCTION public.request_app_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_app_client_id() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refuse_app_tokens()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF public.request_app_client_id() IS NOT NULL THEN
    RAISE SQLSTATE 'PGRST' USING
      message = json_build_object(
        'code', 'app_token',
        'message', 'This token belongs to an app. Apps reach Moduo only through its MCP connector.',
        'details', NULL,
        'hint', NULL)::text,
      detail = json_build_object('status', 403, 'headers', json_build_object())::text;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.refuse_app_tokens() IS
  'PostgREST pre-request (pgrst.db_pre_request): refuses Data API requests made with an app''s OAuth token. MCPO-1.';

REVOKE ALL ON FUNCTION public.refuse_app_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refuse_app_tokens() TO anon, authenticated, service_role;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.refuse_app_tokens';
NOTIFY pgrst, 'reload config';

DO $$
DECLARE
  t regclass;
BEGIN
  FOR t IN
    SELECT format('%I.%I', schemaname, tablename)::regclass
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    UNION
    SELECT to_regclass('storage.objects')
    UNION
    SELECT to_regclass('realtime.messages')
  LOOP
    CONTINUE WHEN t IS NULL;
    EXECUTE format('DROP POLICY IF EXISTS app_tokens_refused ON %s', t);
    EXECUTE format(
      'CREATE POLICY app_tokens_refused ON %s AS RESTRICTIVE FOR ALL TO anon, authenticated '
      'USING ((SELECT public.request_app_client_id()) IS NULL) '
      'WITH CHECK ((SELECT public.request_app_client_id()) IS NULL)', t);
  END LOOP;
END;
$$;
