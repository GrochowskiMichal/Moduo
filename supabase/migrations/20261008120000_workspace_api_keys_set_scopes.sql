-- Per-module None / View / Edit scopes on API keys, inside the permission model
-- (t/maciej/api-key-module-scopes; docs/moduo-mcp-connector.md §Scoped API
-- keys; docs/decisions/permissions.md 2026-10-08).
--
-- History. A first workspace_api_keys_set_scopes was applied to prod on
-- 2026-10-01 (version 20261001233514) from the unmerged branch
-- t/maciej/api-key-scopes, as 20261002120000_workspace_api_keys_set_scopes.sql.
-- That stamp collides with 20261002120000_waitlist_updates_opt_in.sql, so the
-- file never landed. This one replaces it, written for PERM-0/PERM-1:
--
-- 1. The scope map is a closed vocabulary. Keys: tasks | notes | calendar |
--    email | contacts | chat | links. Levels: none | view | edit (admin is
--    never key-grantable). Mirrors MCP_KEY_MODULES / MCP_KEY_SCOPES in
--    supabase/functions/_shared/contracts/vocabularies.ts; a CHECK on
--    workspace_api_keys.scopes holds it for every writer.
-- 2. A key is never given more than its creator holds. create and set_scopes
--    refuse a level above module_api_key_cap(): what the creator can do on
--    that module today, the same cap module_api_key_scope /
--    module_api_key_effective_scopes apply on every call. Calls stay capped
--    live too, so a key reads lower if its creator's role shrinks later.
-- 3. A key acts as its creator (PERM-0), so only the creator can widen it.
--    Anyone who manages keys (ws.api_keys) can narrow or revoke any key.
-- 4. Errors stop saying "owners and admins": custom roles can hold
--    ws.api_keys too.
--
-- set_scopes MERGES (`scopes || p_scopes`): a module missing from p_scopes
-- keeps its level, so an older client can't wipe one it doesn't know about.
-- Send 'none' to take a module away. Revoked keys are immutable.
--
-- Until this applies, prod keeps the 2026-10-01 set_scopes (owner/admin
-- check, no cap). That is not an escalation: the connector caps every call by
-- the creator's access whatever the stored map says.

-- ── the vocabulary ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.workspace_api_key_scopes_valid(p_scopes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_scopes) e
      WHERE e.key NOT IN ('tasks','notes','calendar','email','contacts','chat','links')
         OR jsonb_typeof(e.value) <> 'string'
         OR (e.value #>> '{}') NOT IN ('none','view','edit'))
  END
$$;

-- The CHECK runs as whoever writes the row: the key RPCs (as their owner) and
-- the connector's last_used_at stamp (service_role). No client role writes
-- this table directly.
REVOKE ALL ON FUNCTION public.workspace_api_key_scopes_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_api_key_scopes_valid(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.workspace_api_key_scopes_valid(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_api_key_scopes_valid(jsonb) TO service_role;

-- Every stored row already conforms (probed 2026-10-08: four revoked keys,
-- each {"tasks": "view" | "edit"}), so this validates in place.
ALTER TABLE public.workspace_api_keys DROP CONSTRAINT IF EXISTS workspace_api_keys_scopes_check;
ALTER TABLE public.workspace_api_keys
  ADD CONSTRAINT workspace_api_keys_scopes_check CHECK (public.workspace_api_key_scopes_valid(scopes));

-- ── the cap ──────────────────────────────────────────────────────────────────

-- The most a key acting as p_user may hold on one module: what that person can
-- do there, on the none / view / edit ladder (the owner's 'admin' reads as
-- edit). Same lanes as module_api_key_effective_scopes (perm_scope_lane).
CREATE OR REPLACE FUNCTION public.module_api_key_cap(
  p_workspace_id uuid,
  p_user_id uuid,
  p_module text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.module_member_permission(p_workspace_id, p_user_id, public.perm_scope_lane(p_module))
    WHEN 'admin' THEN 'edit'
    WHEN 'edit' THEN 'edit'
    WHEN 'view' THEN 'view'
    ELSE 'none'
  END
$$;

-- Refuses a scope change that breaks the rules above. p_current is the stored
-- map ('{}' for a new key); only levels raised above it are checked against
-- the cap, so narrowing one module never fails over another.
CREATE OR REPLACE FUNCTION public.workspace_api_keys__check_scopes(
  p_workspace_id uuid,
  p_creator uuid,
  p_current jsonb,
  p_next jsonb,
  p_can_widen boolean
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_scope record;
  v_level text;
  v_was text;
  v_cap text;
  v_label text;
BEGIN
  IF p_next IS NULL OR jsonb_typeof(p_next) <> 'object' THEN
    RAISE EXCEPTION 'Scopes must be a module → level object.';
  END IF;
  FOR v_scope IN SELECT key, value FROM jsonb_each(p_next) LOOP
    IF v_scope.key NOT IN ('tasks','notes','calendar','email','contacts','chat','links') THEN
      RAISE EXCEPTION 'Unknown module in key scopes: %.', v_scope.key;
    END IF;
    IF jsonb_typeof(v_scope.value) <> 'string'
       OR (v_scope.value #>> '{}') NOT IN ('none','view','edit') THEN
      RAISE EXCEPTION 'Key scope for % must be none, view or edit.', v_scope.key;
    END IF;
  END LOOP;

  FOR v_scope IN SELECT key, value #>> '{}' AS level FROM jsonb_each(p_next) LOOP
    v_level := v_scope.level;
    v_was := CASE lower(coalesce(p_current ->> v_scope.key, 'none'))
               WHEN 'edit' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END;
    CONTINUE WHEN public.perm_rank(v_level) <= public.perm_rank(v_was);

    IF NOT coalesce(p_can_widen, false) THEN
      RAISE EXCEPTION 'Only the person who created this key can give it more access. You can still lower its access or revoke it.'
        USING ERRCODE = '42501';
    END IF;
    v_cap := public.module_api_key_cap(p_workspace_id, p_creator, v_scope.key);
    IF public.perm_rank(v_level) > public.perm_rank(v_cap) THEN
      v_label := CASE v_scope.key
        WHEN 'tasks' THEN 'Tasks' WHEN 'notes' THEN 'Notes' WHEN 'calendar' THEN 'Calendar'
        WHEN 'email' THEN 'Email' WHEN 'contacts' THEN 'Contacts' WHEN 'chat' THEN 'Chat'
        ELSE 'Links' END;
      IF v_cap = 'none' THEN
        RAISE EXCEPTION 'You can''t give this key access to %: you don''t have it yourself.', v_label
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'You can''t let this key edit %: you can only view % yourself.', v_label, v_label
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
END;
$$;

-- ── create / set scopes / revoke ─────────────────────────────────────────────
-- Same signatures as before, so CREATE OR REPLACE keeps their grants.

CREATE OR REPLACE FUNCTION public.workspace_api_keys_create(
  p_workspace_id uuid,
  p_name text,
  p_scopes jsonb DEFAULT '{"tasks": "view"}'::jsonb
)
RETURNS TABLE (
  id uuid, name text, key_prefix text, scopes jsonb,
  created_at timestamptz, secret text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_secret text;
  v_entry record;
BEGIN
  IF NOT public.workspace_api_keys_can_manage(p_workspace_id) THEN
    RAISE EXCEPTION 'Your role doesn''t include API keys in this workspace.';
  END IF;
  v_name := trim(coalesce(p_name, ''));
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Key name must be 1–80 characters.';
  END IF;
  -- A new key acts as the caller, who may give it up to their own access.
  PERFORM public.workspace_api_keys__check_scopes(p_workspace_id, auth.uid(), '{}'::jsonb, p_scopes, true);
  IF (SELECT count(*) FROM public.workspace_api_keys k
      WHERE k.workspace_id = p_workspace_id AND k.revoked_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'This workspace already has 20 active keys — revoke one first.';
  END IF;

  v_secret := 'moduo_sk_' || encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.workspace_api_keys
    (workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (
    p_workspace_id, v_name, left(v_secret, 15),
    encode(extensions.digest(v_secret, 'sha256'), 'hex'),
    p_scopes, auth.uid()
  )
  RETURNING * INTO v_entry;

  RETURN QUERY SELECT v_entry.id, v_entry.name, v_entry.key_prefix,
                      v_entry.scopes, v_entry.created_at, v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_api_keys_set_scopes(
  p_key_id uuid,
  p_scopes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.workspace_api_keys_revoke(p_key_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace uuid;
BEGIN
  SELECT k.workspace_id INTO v_workspace
    FROM public.workspace_api_keys k WHERE k.id = p_key_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'API key not found.';
  END IF;
  IF NOT public.workspace_api_keys_can_manage(v_workspace) THEN
    RAISE EXCEPTION 'Your role doesn''t include API keys in this workspace.';
  END IF;
  UPDATE public.workspace_api_keys
    SET revoked_at = now()
    WHERE id = p_key_id AND revoked_at IS NULL;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
-- set_scopes keeps prod's grant (it existed); stated again so this file alone
-- describes it. The two helpers are internal: definer functions call them as
-- their owner, so no client role needs them (Supabase grants anon EXECUTE
-- directly, not via PUBLIC; docs/gotchas/supabase.md).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'module_api_key_cap(uuid, uuid, text)',
    'workspace_api_keys__check_scopes(uuid, uuid, jsonb, jsonb, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.workspace_api_keys_set_scopes(uuid, jsonb) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.workspace_api_keys_set_scopes(uuid, jsonb) FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.workspace_api_keys_set_scopes(uuid, jsonb) TO authenticated';
END;
$$;
