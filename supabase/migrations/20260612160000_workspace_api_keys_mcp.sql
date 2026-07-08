-- Scoped API keys for the Moduo MCP connector (improvement-plan Session 9;
-- docs/moduo-mcp-connector.md, docs/moduo-module-contract.md Pillars 2 & 4).
--
-- Model:
--   - `workspace_api_keys`: workspace-scoped keys. The secret (`moduo_sk_…`)
--     is returned exactly once from workspace_api_keys_create(); only its
--     sha256 hash is stored. Scopes reuse the per-module none/view/edit
--     ladder (admin is never grantable to a key); view is the default.
--   - The connector (edge function `moduo-mcp`) verifies the presented
--     secret against the hash, then calls reads/ops as `service_role` with
--     an `x-moduo-key-id` header. module_api_key_id() trusts that header
--     ONLY under a service_role JWT — an authenticated client sending the
--     same header is ignored (auth.uid() wins), and anon can't execute ops
--     at all. The secret itself never reaches Postgres.
--   - module_activity_log() gains the api_key actor branch reserved by
--     Session 8 (actor_type 'api_key', actor_id = key id, actor_label =
--     key name snapshot); tasks_module_permission() resolves a key's
--     tasks scope so the existing tasks_op_* guards work unchanged.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── the keys table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- First chars of the secret ("moduo_sk_ab12cd") — display only.
  key_prefix   text NOT NULL,
  -- sha256 hex of the full secret. The secret is never stored.
  key_hash     text NOT NULL UNIQUE,
  -- module → 'none' | 'view' | 'edit' (admin is never key-grantable).
  scopes       jsonb NOT NULL DEFAULT '{"tasks": "view"}'::jsonb,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS workspace_api_keys_workspace_idx
  ON public.workspace_api_keys (workspace_id, created_at DESC);

-- ── who may manage keys: workspace owner or admin member ────────────────────
CREATE OR REPLACE FUNCTION public.workspace_api_keys_can_manage(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id AND w.owner_id = auth.uid() AND w.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      AND lower(coalesce(m.role, '')) IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_can_manage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_api_keys_can_manage(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_can_manage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_can_manage(uuid) TO service_role;

-- ── RLS: managers read; nobody writes directly (RPCs only) ───────────────────
ALTER TABLE public.workspace_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_api_keys_manager_read ON public.workspace_api_keys;
CREATE POLICY workspace_api_keys_manager_read ON public.workspace_api_keys
  FOR SELECT
  USING (public.workspace_api_keys_can_manage(workspace_id));

-- Column-level grant: authenticated clients can never read key_hash.
REVOKE ALL ON public.workspace_api_keys FROM PUBLIC;
REVOKE ALL ON public.workspace_api_keys FROM anon;
REVOKE ALL ON public.workspace_api_keys FROM authenticated;
GRANT SELECT (id, workspace_id, name, key_prefix, scopes, created_by,
              created_at, last_used_at, revoked_at)
  ON public.workspace_api_keys TO authenticated;

-- ── create / revoke RPCs ─────────────────────────────────────────────────────
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
  v_scope record;
BEGIN
  IF NOT public.workspace_api_keys_can_manage(p_workspace_id) THEN
    RAISE EXCEPTION 'Only workspace owners and admins can manage API keys.';
  END IF;
  v_name := trim(coalesce(p_name, ''));
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Key name must be 1–80 characters.';
  END IF;
  IF p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'object' THEN
    RAISE EXCEPTION 'Scopes must be a module → level object.';
  END IF;
  FOR v_scope IN SELECT key, value FROM jsonb_each_text(p_scopes) LOOP
    IF v_scope.value NOT IN ('none', 'view', 'edit') THEN
      RAISE EXCEPTION 'Key scope for % must be none, view or edit.', v_scope.key;
    END IF;
  END LOOP;
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
    RAISE EXCEPTION 'Only workspace owners and admins can manage API keys.';
  END IF;
  UPDATE public.workspace_api_keys
    SET revoked_at = now()
    WHERE id = p_key_id AND revoked_at IS NULL;
END;
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'workspace_api_keys_create(uuid, text, jsonb)',
    'workspace_api_keys_revoke(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;

-- ── api-key actor context ────────────────────────────────────────────────────
-- The key id the connector attached to this request — non-null ONLY when the
-- caller holds a service_role JWT (i.e. is our edge function). The connector
-- verified the secret's hash before attaching the id; clients can send the
-- header but never the role, so it is inert for them.
CREATE OR REPLACE FUNCTION public.module_api_key_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v uuid;
BEGIN
  IF coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '')
     <> 'service_role' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v := nullif(current_setting('request.headers', true)::jsonb ->> 'x-moduo-key-id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.module_api_key_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.module_api_key_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.module_api_key_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.module_api_key_id() TO service_role;

-- ── actor resolution: the api_key branch reserved by Session 8 ───────────────
-- Same signature as 20260612150000; users keep precedence, key calls are
-- attributed to the key (id + name snapshot), and a call with neither actor
-- context fails loudly — no mutation ever logs anonymously.
CREATE OR REPLACE FUNCTION public.module_activity_log(
  p_workspace_id uuid,
  p_module text,
  p_entity_type text,
  p_entity_id uuid,
  p_op text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key uuid;
  v_label text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.module_activity
      (workspace_id, module, entity_type, entity_id, op,
       actor_type, actor_id, actor_label, payload)
    VALUES (
      p_workspace_id, p_module, p_entity_type, p_entity_id, p_op,
      'user', auth.uid(),
      (SELECT p.display_name FROM public.profiles p WHERE p.id = auth.uid()),
      coalesce(p_payload, '{}'::jsonb)
    );
    RETURN;
  END IF;
  v_key := public.module_api_key_id();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'No actor context for activity attribution.';
  END IF;
  SELECT k.name INTO v_label FROM public.workspace_api_keys k WHERE k.id = v_key;
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op,
     actor_type, actor_id, actor_label, payload)
  VALUES (
    p_workspace_id, p_module, p_entity_type, p_entity_id, p_op,
    'api_key', v_key, v_label, coalesce(p_payload, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.module_activity_log(uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.module_activity_log(uuid, text, text, uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.module_activity_log(uuid, text, text, uuid, text, jsonb) FROM authenticated;

-- ── permission mapping: keys ride the same none/view/edit ladder ─────────────
-- Users resolve exactly as in 20260612150000; an api-key call resolves to the
-- key's tasks scope (live, unrevoked, workspace-matched), so tasks_op__guard's
-- edit+ requirement applies to keys unchanged (contract Pillar 4).
CREATE OR REPLACE FUNCTION public.tasks_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_key uuid;
BEGIN
  v_key := public.module_api_key_id();
  IF v_key IS NOT NULL THEN
    RETURN coalesce((
      SELECT CASE lower(coalesce(k.scopes ->> 'tasks', 'none'))
        WHEN 'edit' THEN 'edit'
        WHEN 'view' THEN 'view'
        ELSE 'none'
      END
      FROM public.workspace_api_keys k
      WHERE k.id = v_key AND k.workspace_id = p_workspace_id
        AND k.revoked_at IS NULL
    ), 'none');
  END IF;
  RETURN (SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = p_workspace_id AND w.owner_id = auth.uid() AND w.deleted_at IS NULL
    ) THEN 'admin'
    ELSE COALESCE((
      SELECT CASE lower(coalesce(m.permissions_tasks, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'                -- unknown → the client's historical default
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END);
END;
$$;

-- (grants on tasks_module_permission carry over from 20260612150000)

-- ── let the connector call the agent-facing ops ──────────────────────────────
-- tasks_op_catch_up is deliberately NOT granted: catch-up is an app-lifecycle
-- batch pass, not an agent intent (docs/moduo-mcp-connector.md).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_commit(uuid, uuid, date)',
    'tasks_op_uncommit(uuid, uuid)',
    'tasks_op_skip_today(uuid, uuid)',
    'tasks_op_set_status(uuid, uuid, text, jsonb, text)',
    'tasks_op_reschedule(uuid, uuid, timestamptz, integer)',
    'tasks_op_unschedule(uuid, uuid)',
    'tasks_op_skip_occurrence(uuid, uuid, timestamptz, jsonb, boolean)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;
