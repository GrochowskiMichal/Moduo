-- MCPO-4 · What the consent screen shows for an app's sign-in
-- (specs/mcp-oauth.md AC5, AC7, AC9; docs/decisions/mcp.md).
--
-- The consent page (/oauth/consent) reads the sign-in with Supabase Auth's
-- getAuthorizationDetails first; that binds it to the person. For an app the
-- person approved before, Auth then answers only a redirect, with no app name
-- (gotcha in docs/gotchas/supabase.md), so the page can't name the app or show
-- what it holds from Auth alone. This read answers, for the person's own live
-- sign-in (the same checks as workspace_api_keys_connect_oauth):
--   - the app's name, and the scheme and domain the sign-in returns to (the
--     scheme too: an app may register `someapp://claude.ai/cb`, whose host
--     alone would read as claude.ai while the code goes to a local program),
--   - the person's live connection to that app, if any (the reconnect
--     pre-fill, and the "moves from A to B" line), whatever their role there,
--   - the workspaces where the person manages keys that are at the 20 cap
--     (keys and connections; the person's own connection there doesn't count
--     against itself, as in connect).
-- It reads only, writes nothing, and answers nothing about other people.

CREATE OR REPLACE FUNCTION public.workspace_api_keys_oauth_request(p_authorization_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_client_id uuid;
  v_redirect text;
  v_client_name text;
  v_domain text;
  v_scheme text;
  v_conn public.workspace_api_keys;
  v_full jsonb;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to connect an app.' USING ERRCODE = '42501';
  END IF;
  SELECT a.client_id, a.redirect_uri, c.client_name INTO v_client_id, v_redirect, v_client_name
    FROM auth.oauth_authorizations a
    JOIN auth.oauth_clients c ON c.id = a.client_id AND c.deleted_at IS NULL
    WHERE a.authorization_id = p_authorization_id
      AND a.user_id = v_me
      AND a.status IN ('pending', 'approved')
      AND a.expires_at > now();
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'This sign-in link has expired. Go back to the app and connect again.'
      USING ERRCODE = 'P0002';
  END IF;

  v_scheme := lower(substring(btrim(v_redirect) FROM '^([a-zA-Z][a-zA-Z0-9+.-]*):'));
  -- The same host connect stores as oauth_client_domain.
  v_domain := nullif(lower(substring(btrim(v_redirect)
                                     FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?(\[[^]]*\]|[^:/?#]+)')), '');

  SELECT * INTO v_conn FROM public.workspace_api_keys k
    WHERE k.created_by = v_me AND k.oauth_client_id = v_client_id AND k.revoked_at IS NULL;

  SELECT coalesce(jsonb_agg(w.id ORDER BY w.id), '[]'::jsonb) INTO v_full
    FROM public.workspaces w
    WHERE w.deleted_at IS NULL
      AND (w.owner_id = v_me OR EXISTS (
            SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.user_id = v_me))
      AND public.workspace_api_keys_can_manage(w.id)
      AND (SELECT count(*) FROM public.workspace_api_keys k
           WHERE k.workspace_id = w.id AND k.revoked_at IS NULL
             AND (k.expires_at IS NULL OR k.expires_at > now())
             AND k.id IS DISTINCT FROM v_conn.id) >= 20;

  RETURN jsonb_build_object(
    'client_id', v_client_id,
    'app_name', left(nullif(btrim(coalesce(v_client_name, '')), ''), 80),
    'client_domain', v_domain,
    'client_scheme', v_scheme,
    'connection', CASE WHEN v_conn.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conn.id,
      'workspace_id', v_conn.workspace_id,
      'name', v_conn.name,
      'scopes', v_conn.scopes,
      'expires_at', v_conn.expires_at,
      'include_private_chat', v_conn.include_private_chat
    ) END,
    'full_workspace_ids', v_full
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_oauth_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_oauth_request(text) TO authenticated;
