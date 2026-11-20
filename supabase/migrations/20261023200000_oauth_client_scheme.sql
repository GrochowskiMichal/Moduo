-- MCPO-4 follow-up (specs/mcp-oauth.md): a connection keeps the scheme its
-- sign-in returns to, not only the host, so Settings can't show an app that
-- returns to `someapp://claude.ai/cb` (a local program) as plain "claude.ai".
-- The consent screen already reads the scheme (20261023180000); this stores it
-- with the connection. Rows made before this have no scheme and read as
-- unchecked. workspace_api_keys_connect_oauth is the 20261023120000 body plus
-- the scheme; its signature and grants are unchanged.

ALTER TABLE public.workspace_api_keys
  ADD COLUMN IF NOT EXISTS oauth_client_scheme text;

COMMENT ON COLUMN public.workspace_api_keys.oauth_client_scheme IS
  'MCPO-4: the scheme (https, or an app''s own) of the address the approved sign-in returns to; with oauth_client_domain it says where the app gets the person''s approval. NULL for keys and for connections made before it was stored.';

ALTER TABLE public.workspace_api_keys
  DROP CONSTRAINT IF EXISTS workspace_api_keys_scheme_connections_only;
ALTER TABLE public.workspace_api_keys
  ADD CONSTRAINT workspace_api_keys_scheme_connections_only
  CHECK (oauth_client_scheme IS NULL OR oauth_client_id IS NOT NULL);

GRANT SELECT (oauth_client_scheme) ON public.workspace_api_keys TO authenticated;

CREATE OR REPLACE FUNCTION public.workspace_api_keys_connect_oauth(
  p_workspace_id uuid,
  p_authorization_id text,
  p_scopes jsonb DEFAULT '{"tasks": "view"}'::jsonb,
  p_expires_in_days integer DEFAULT 90,
  p_include_private_chat boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  name text,
  scopes jsonb,
  expires_at timestamptz,
  include_private_chat boolean,
  created boolean,
  moved_from uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_client_id uuid;
  v_redirect text;
  v_client_name text;
  v_domain text;
  v_scheme text;
  v_name text;
  v_expires timestamptz;
  v_old public.workspace_api_keys;
  v_row public.workspace_api_keys;
  v_moved uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to connect an app.' USING ERRCODE = '42501';
  END IF;
  -- The sign-in being approved: this person's (Supabase Auth ties it to them
  -- when the consent page reads it) and not expired or denied. It may already
  -- read approved: when the person consented to the app before, Supabase Auth
  -- approves a new sign-in the moment the consent page reads it, and the page
  -- holds the redirect back until Approve here. The app, and the domain
  -- the person is sent back to, come from it, never from the browser: an app can
  -- register several redirects, and only the one in this sign-in is where the
  -- person's approval goes.
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
  IF NOT public.workspace_api_keys_can_manage(p_workspace_id) THEN
    RAISE EXCEPTION 'Your role doesn''t include API keys here. Ask the workspace owner.'
      USING ERRCODE = '42501';
  END IF;
  IF p_expires_in_days IS NOT NULL AND (p_expires_in_days < 1 OR p_expires_in_days > 730) THEN
    RAISE EXCEPTION 'A connection can last 1–730 days, or never expire.' USING ERRCODE = '22023';
  END IF;
  IF p_include_private_chat IS NULL THEN
    RAISE EXCEPTION 'Say whether to include private channels.' USING ERRCODE = '22023';
  END IF;
  -- The person gives the app at most their own access (as for a key they create).
  PERFORM public.workspace_api_keys__check_scopes(p_workspace_id, v_me, '{}'::jsonb, p_scopes, true);

  -- Approve clicked twice, or in two tabs: one connection. The workspace lock
  -- keeps two connects from both passing the cap.
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace_api_keys_connect_oauth:' || v_me || ':' || v_client_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace_api_keys_cap:' || p_workspace_id, 0));

  SELECT * INTO v_old FROM public.workspace_api_keys k
    WHERE k.created_by = v_me AND k.oauth_client_id = v_client_id AND k.revoked_at IS NULL
    FOR UPDATE;

  -- The 20 cap counts keys and connections alike; the connection being
  -- updated in place doesn't count against itself.
  IF (SELECT count(*) FROM public.workspace_api_keys k
      WHERE k.workspace_id = p_workspace_id AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > now())
        AND k.id IS DISTINCT FROM CASE WHEN v_old.workspace_id = p_workspace_id THEN v_old.id END) >= 20 THEN
    RAISE EXCEPTION 'This workspace has 20 keys and connections. Disconnect or revoke one in Settings → API keys first.'
      USING ERRCODE = '54000';
  END IF;

  v_domain := nullif(lower(substring(btrim(v_redirect)
                                     FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?(\[[^]]*\]|[^:/?#]+)')), '');
  -- The scheme too: `someapp://claude.ai/cb` returns to a local program, not claude.ai.
  v_scheme := nullif(lower(substring(btrim(v_redirect) FROM '^([a-zA-Z][a-zA-Z0-9+.-]*):')), '');
  v_expires := CASE WHEN p_expires_in_days IS NULL THEN NULL
                    ELSE now() + make_interval(days => p_expires_in_days) END;

  IF v_old.id IS NOT NULL AND v_old.workspace_id = p_workspace_id THEN
    -- A reconnect: the same row, with the access just approved. Its name
    -- stays (the person may have renamed it).
    UPDATE public.workspace_api_keys k
      SET scopes = p_scopes,
          expires_at = v_expires,
          include_private_chat = p_include_private_chat,
          oauth_client_domain = v_domain,
          oauth_client_scheme = v_scheme
      WHERE k.id = v_old.id
      RETURNING * INTO v_row;
    RETURN QUERY SELECT v_row.id, v_row.workspace_id, v_row.name, v_row.scopes, v_row.expires_at,
                        v_row.include_private_chat, false, NULL::uuid;
    RETURN;
  END IF;

  IF v_old.id IS NOT NULL THEN
    -- Moving to another workspace ends the connection in the first one.
    UPDATE public.workspace_api_keys k SET revoked_at = now() WHERE k.id = v_old.id;
    v_moved := v_old.workspace_id;
    v_name := v_old.name;
  ELSE
    v_name := left(nullif(btrim(coalesce(v_client_name, '')), ''), 80);
    v_name := coalesce(v_name, coalesce(v_domain, 'An app'));
  END IF;

  INSERT INTO public.workspace_api_keys
    (workspace_id, name, scopes, created_by, expires_at, include_private_chat,
     oauth_client_id, oauth_client_domain, oauth_client_scheme)
  VALUES (p_workspace_id, v_name, p_scopes, v_me, v_expires, p_include_private_chat,
          v_client_id, v_domain, v_scheme)
  RETURNING * INTO v_row;

  -- The person's own bell, nobody else's: "Claude connected to Moduo · View:
  -- Tasks". module_activity rows reach only the people their payload names
  -- (spine_activity_targets_me) and are read only by the key's person
  -- (perm_can_see_entity's api_key branch below); no notice_deliveries row, so
  -- no push.
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (
    p_workspace_id, 'api_keys', 'api_key', v_row.id, 'api_keys.connected', 'api_key', v_row.id, v_row.name,
    jsonb_build_object(
      'notify_user_ids', jsonb_build_array(v_me::text),
      'app_name', v_row.name,
      'client_domain', v_domain,
      'client_scheme', v_scheme,
      'scopes', v_row.scopes,
      'include_private_chat', v_row.include_private_chat,
      'expires_at', v_row.expires_at,
      'moved_from', v_moved
    )
  );

  RETURN QUERY SELECT v_row.id, v_row.workspace_id, v_row.name, v_row.scopes, v_row.expires_at,
                      v_row.include_private_chat, true, v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_connect_oauth(uuid, text, jsonb, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_connect_oauth(uuid, text, jsonb, integer, boolean) TO authenticated;
