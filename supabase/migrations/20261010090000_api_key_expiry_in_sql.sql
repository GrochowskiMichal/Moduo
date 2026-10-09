-- API-KEY-EXP-1 follow-up (review finding): expiry held only in the moduo-mcp
-- connector, while revocation is also checked in every SQL resolver. Add the
-- same predicate to the three resolvers that read workspace_api_keys, so a
-- service-role caller that forwards x-moduo-key-id without the connector (a
-- probe, a future function) can't act as an expired key. Also refuse editing
-- an expired key's access through the RPC, as the Settings screen already does.
-- Same signatures as before, so CREATE OR REPLACE keeps each function's grants.

CREATE OR REPLACE FUNCTION public.module_api_key_creator()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT k.created_by
  FROM public.workspace_api_keys k
  WHERE k.id = public.module_api_key_id() AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now())
$function$;

CREATE OR REPLACE FUNCTION public.module_api_key_effective_scopes(p_key_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  k        public.workspace_api_keys;
  v_out    jsonb := '{}'::jsonb;
  v_scope  record;
  v_member text;
BEGIN
  SELECT * INTO k FROM public.workspace_api_keys
    WHERE id = p_key_id AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now());
  IF k.id IS NULL THEN
    RETURN v_out;
  END IF;
  FOR v_scope IN SELECT key, lower(coalesce(value, 'none')) AS value FROM jsonb_each_text(coalesce(k.scopes, '{}'::jsonb)) LOOP
    v_member := public.module_member_permission(k.workspace_id, k.created_by, public.perm_scope_lane(v_scope.key));
    v_out := v_out || jsonb_build_object(v_scope.key,
      CASE
        WHEN v_scope.value NOT IN ('view', 'edit') THEN 'none'
        WHEN public.perm_rank(v_member) >= public.perm_rank(v_scope.value) THEN v_scope.value
        WHEN v_member = 'view' THEN 'view'
        ELSE 'none'
      END);
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.module_api_key_scope(p_workspace_id uuid, p_scope_key text, p_lane text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key_scope text;
  v_creator   uuid;
  v_member    text;
BEGIN
  SELECT CASE lower(coalesce(k.scopes ->> p_scope_key, 'none'))
           WHEN 'edit' THEN 'edit'
           WHEN 'view' THEN 'view'
           ELSE 'none'
         END,
         k.created_by
    INTO v_key_scope, v_creator
    FROM public.workspace_api_keys k
   WHERE k.id = public.module_api_key_id()
     AND k.workspace_id = p_workspace_id
     AND k.revoked_at IS NULL
     AND (k.expires_at IS NULL OR k.expires_at > now());

  IF v_key_scope IS NULL OR v_creator IS NULL THEN
    RETURN 'none';
  END IF;

  v_member := public.module_member_permission(p_workspace_id, v_creator, p_lane);
  IF public.perm_rank(v_member) < public.perm_rank(v_key_scope) THEN
    RETURN CASE WHEN v_member = 'view' THEN 'view' ELSE 'none' END;
  END IF;
  RETURN v_key_scope;
END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_api_keys_set_scopes(p_key_id uuid, p_scopes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  k public.workspace_api_keys;
  v_scopes jsonb;
BEGIN
  SELECT * INTO k FROM public.workspace_api_keys WHERE id = p_key_id FOR UPDATE;
  IF k.id IS NULL THEN
    RAISE EXCEPTION 'API key not found.';
  END IF;
  IF NOT public.workspace_api_keys_can_manage(k.workspace_id) THEN
    RAISE EXCEPTION 'Your role doesn''t include API keys in this workspace.';
  END IF;
  IF k.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This key was revoked — create a new one instead.';
  END IF;
  IF k.expires_at IS NOT NULL AND k.expires_at <= now() THEN
    RAISE EXCEPTION 'This key has expired — create a new one instead.';
  END IF;
  -- coalesce: a key with no recorded creator can only be lowered, and says so.
  PERFORM public.workspace_api_keys__check_scopes(
    k.workspace_id, k.created_by, k.scopes, p_scopes,
    coalesce(auth.uid() = k.created_by, false));

  UPDATE public.workspace_api_keys
    SET scopes = workspace_api_keys.scopes || p_scopes
    WHERE workspace_api_keys.id = k.id
    RETURNING workspace_api_keys.scopes INTO v_scopes;
  RETURN v_scopes;
END;
$function$;
