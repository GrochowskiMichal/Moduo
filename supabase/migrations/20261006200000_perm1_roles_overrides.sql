-- PERM-1 (specs/permissions.md): roles + personal exceptions, enforced in Postgres.
--
-- Model
--   * workspace_roles — per-workspace roles. Three system roles (Admin, Member,
--     Viewer; `system_key`) are seeded for every workspace; owners/admins can add
--     custom roles. A role is a set of permission keys (`permissions text[]`):
--       <module>.<action>  module ∈ notes|tasks|calendar|contacts|chat,
--                          action ∈ view|create|edit|delete
--       ws.<power>         invite|manage_members|manage_roles|publish|api_keys
--     `read_only` roles (Viewer, and custom roles built on it) are a ceiling:
--     only *.view keys survive, whatever the role or an exception says.
--   * workspace_members.role_id + overrides (jsonb {key: true|false}) — a person
--     has one role plus personal exceptions; personal beats role.
--   * workspace_members.perms — the resolved effective set, maintained by
--     triggers (on the member row and on its role), so every check is one array
--     lookup. The workspace OWNER is never resolved: owners can do everything.
--   * workspace_members.role (text) stays as the coarse tier (owner|admin|member|
--     viewer) other code (chat admin, legacy desktop builds) still reads.
--
-- Enforcement
--   * Reads: module read policies require <module>.view.
--   * Writes: one BEFORE trigger per module table checks <module>.create / edit /
--     delete for the acting person (auth.uid() or the API key's creator). Soft
--     delete and restore (deleted_at changes) count as delete. Calls with no actor
--     (service role without a key: booking page, cron) are system work and pass.
--     Because the check sits on the table, it covers intent ops, legacy
--     client-direct writes and MCP keys alike.
--   * Workspace powers gate invites, member management, roles, publishing and
--     API keys. Nobody can grant (by role or exception) a permission they don't
--     hold themselves; only the owner manages people who can manage members or
--     roles; nobody changes their own access.
--
-- Backwards compatibility: the legacy permissions_notes/permissions_tasks columns
-- are converted into exceptions once and then ignored (calendar + contacts rode
-- the tasks lane, so they inherit its exceptions). Old clients that still call
-- workspace_op_set_member_role / insert invites with a role text keep working —
-- the text is mapped to the matching system role.

-- ── vocabulary ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.perm_all_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT m || '.' || a
    FROM unnest(ARRAY['notes','tasks','calendar','contacts','chat']) WITH ORDINALITY AS mm(m, mo)
    CROSS JOIN unnest(ARRAY['view','create','edit','delete']) WITH ORDINALITY AS aa(a, ao)
    ORDER BY mo, ao
  ) || ARRAY['ws.invite','ws.manage_members','ws.manage_roles','ws.publish','ws.api_keys']
$$;

CREATE OR REPLACE FUNCTION public.perm_system_role_permissions(p_system_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_system_key
    WHEN 'admin'  THEN public.perm_all_keys()
    -- Member keeps today's behavior: full module access, can publish, no
    -- management powers.
    WHEN 'member' THEN ARRAY(SELECT k FROM unnest(public.perm_all_keys()) k WHERE k NOT LIKE 'ws.%')
                       || ARRAY['ws.publish']
    WHEN 'viewer' THEN ARRAY(SELECT k FROM unnest(public.perm_all_keys()) k WHERE k LIKE '%.view')
    ELSE '{}'::text[]
  END
$$;

-- Role + exceptions → effective keys (sorted in vocabulary order).
CREATE OR REPLACE FUNCTION public.perm_resolve(
  p_role_permissions text[],
  p_read_only boolean,
  p_overrides jsonb
)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT k FROM unnest(coalesce(p_role_permissions, '{}'::text[])) k
    WHERE NOT (coalesce(p_overrides, '{}'::jsonb) ? k AND jsonb_typeof(p_overrides -> k) = 'boolean'
               AND (p_overrides ->> k)::boolean = false)
    UNION
    SELECT key FROM jsonb_each(coalesce(p_overrides, '{}'::jsonb))
    WHERE jsonb_typeof(value) = 'boolean' AND value::text = 'true'
  ),
  valid AS (
    SELECT k FROM base WHERE k = ANY (public.perm_all_keys())
      AND (NOT coalesce(p_read_only, false) OR k LIKE '%.view')
  ),
  -- create/edit/delete need view on the same module.
  consistent AS (
    SELECT k FROM valid v
    WHERE k LIKE 'ws.%' OR k LIKE '%.view'
       OR EXISTS (SELECT 1 FROM valid w WHERE w.k = split_part(v.k, '.', 1) || '.view')
  )
  SELECT ARRAY(
    SELECT k FROM consistent c
    ORDER BY array_position(public.perm_all_keys(), c.k)
  )
$$;

-- ── tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  system_key   text CHECK (system_key IN ('admin', 'member', 'viewer')),
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  description  text NOT NULL DEFAULT '' CHECK (char_length(description) <= 200),
  permissions  text[] NOT NULL DEFAULT '{}',
  read_only    boolean NOT NULL DEFAULT false,
  position     int NOT NULL DEFAULT 100,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, system_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_roles_name_key
  ON public.workspace_roles (workspace_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS workspace_roles_workspace_idx
  ON public.workspace_roles (workspace_id, position);

ALTER TABLE public.workspace_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_roles FROM PUBLIC, anon;
GRANT SELECT ON public.workspace_roles TO authenticated;
GRANT ALL ON public.workspace_roles TO service_role;

DROP POLICY IF EXISTS workspace_roles_member_read ON public.workspace_roles;
CREATE POLICY workspace_roles_member_read ON public.workspace_roles
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id));

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS role_id   uuid REFERENCES public.workspace_roles (id),
  ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS perms     text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.workspace_invites
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.workspace_roles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workspace_members_role_idx ON public.workspace_members (role_id);

-- ── checks ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.perm_is_owner(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id AND w.owner_id = p_user_id AND w.deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.perm_effective(p_workspace_id uuid, p_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN '{}'::text[]
    WHEN public.perm_is_owner(p_workspace_id, p_user_id) THEN public.perm_all_keys()
    ELSE coalesce((SELECT m.perms FROM public.workspace_members m
                   WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id LIMIT 1),
                  '{}'::text[])
  END
$$;

CREATE OR REPLACE FUNCTION public.perm_user_has(p_workspace_id uuid, p_user_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND (
    public.perm_is_owner(p_workspace_id, p_user_id)
    OR EXISTS (SELECT 1 FROM public.workspace_members m
               WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id
                 AND p_key = ANY (m.perms)))
$$;

-- The acting person (signed-in user, or an API key's creator).
CREATE OR REPLACE FUNCTION public.perm_has(p_workspace_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.perm_user_has(p_workspace_id, public.perm_actor_id(), p_key)
$$;

-- RLS helper: the signed-in user can view this module.
CREATE OR REPLACE FUNCTION public.perm_can_view(p_workspace_id uuid, p_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.perm_user_has(p_workspace_id, auth.uid(), p_module || '.view')
$$;

-- Can `p_actor` hand out everything in `p_keys`? (Owner: always.)
CREATE OR REPLACE FUNCTION public.perm_can_grant(p_workspace_id uuid, p_actor uuid, p_keys text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.perm_is_owner(p_workspace_id, p_actor)
      OR coalesce(p_keys, '{}'::text[]) <@ public.perm_effective(p_workspace_id, p_actor)
$$;

-- Legacy per-module columns (read|write|none) → exceptions. tasks also covered
-- calendar + contacts. Used by the backfill, the legacy set-role op and invite
-- acceptance so old clients' "read-only notes" etc. keep meaning something.
CREATE OR REPLACE FUNCTION public.perm_legacy_overrides(p_notes text, p_tasks text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(jsonb_object_agg(k, false), '{}'::jsonb)
  FROM (
    SELECT mod || '.' || act AS k
    FROM unnest(ARRAY['notes','tasks','calendar','contacts']) mod
    CROSS JOIN unnest(ARRAY['view','create','edit','delete']) act
    WHERE CASE WHEN mod = 'notes' THEN lower(coalesce(p_notes, 'write'))
               ELSE lower(coalesce(p_tasks, 'write')) END IN ('read', 'view', 'none')
      AND (act <> 'view' OR
           CASE WHEN mod = 'notes' THEN lower(coalesce(p_notes, 'write'))
                ELSE lower(coalesce(p_tasks, 'write')) END = 'none')
  ) x
$$;

-- ── seeding ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.perm_seed_workspace_roles(p_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.workspace_roles (workspace_id, system_key, name, description, permissions, read_only, position)
  VALUES
    (p_workspace_id, 'admin',  'Admin',  'Runs the workspace with the owner.', public.perm_system_role_permissions('admin'),  false, 0),
    (p_workspace_id, 'member', 'Member', 'Does the work. The default for invites.', public.perm_system_role_permissions('member'), false, 1),
    (p_workspace_id, 'viewer', 'Viewer', 'Sees what''s shared. Never edits.', public.perm_system_role_permissions('viewer'), true, 2)
  ON CONFLICT (workspace_id, system_key) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION public.perm_system_role_id(p_workspace_id uuid, p_tier text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := CASE lower(coalesce(p_tier, 'member'))
                  WHEN 'owner' THEN 'admin' WHEN 'admin' THEN 'admin'
                  WHEN 'viewer' THEN 'viewer' ELSE 'member' END;
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.workspace_roles WHERE workspace_id = p_workspace_id AND system_key = v_key;
  IF v_id IS NULL THEN
    PERFORM public.perm_seed_workspace_roles(p_workspace_id);
    SELECT id INTO v_id FROM public.workspace_roles WHERE workspace_id = p_workspace_id AND system_key = v_key;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.perm_role_tier(p_role public.workspace_roles)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_role.system_key IS NOT NULL THEN p_role.system_key
    WHEN p_role.read_only THEN 'viewer'
    ELSE 'member'
  END
$$;

CREATE OR REPLACE FUNCTION public.perm_workspaces_seed_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.perm_seed_workspace_roles(NEW.id);
  RETURN NEW;
END;
$$;

-- Runs before the existing owner-member trigger by name order is irrelevant:
-- perm_system_role_id seeds on demand too.
DROP TRIGGER IF EXISTS perm_workspaces_seed_roles ON public.workspaces;
CREATE TRIGGER perm_workspaces_seed_roles
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.perm_workspaces_seed_roles();

-- ── member resolution trigger ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.perm_members_resolve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.workspace_roles;
  v_is_owner boolean;
  v_role_changed boolean;
BEGIN
  -- Ownership comes only from workspaces.owner_id — never from the role text
  -- (a written 'owner' must not mint an unremovable super-admin).
  v_is_owner := EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.id = NEW.workspace_id AND w.owner_id = NEW.user_id);

  IF TG_OP = 'INSERT' THEN
    v_role_changed := NEW.role_id IS NOT NULL;
  ELSE
    v_role_changed := NEW.role_id IS DISTINCT FROM OLD.role_id;
  END IF;

  -- A tier text written without a role id (legacy clients, transfer ownership,
  -- invite acceptance from an old row) picks the matching system role.
  IF NEW.role_id IS NULL OR (NOT v_role_changed AND TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role) THEN
    NEW.role_id := public.perm_system_role_id(NEW.workspace_id, NEW.role);
  END IF;

  SELECT * INTO r FROM public.workspace_roles WHERE id = NEW.role_id;
  IF r.id IS NULL OR r.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'That role doesn''t belong to this workspace.';
  END IF;

  IF jsonb_typeof(coalesce(NEW.overrides, '{}'::jsonb)) <> 'object' THEN
    NEW.overrides := '{}'::jsonb;
  END IF;

  IF v_is_owner THEN
    NEW.role := 'owner';
  ELSE
    NEW.role := public.perm_role_tier(r);
  END IF;
  NEW.perms := public.perm_resolve(r.permissions, r.read_only, NEW.overrides);
  -- Keep the legacy lanes truthful for clients that still read them (desktop
  -- builds ≤ 1.0.9 gate their nav on these two columns).
  NEW.permissions_notes := CASE
    WHEN NEW.perms && ARRAY['notes.create','notes.edit','notes.delete'] THEN 'write'
    WHEN 'notes.view' = ANY (NEW.perms) THEN 'read' ELSE 'none' END;
  NEW.permissions_tasks := CASE
    WHEN NEW.perms && ARRAY['tasks.create','tasks.edit','tasks.delete'] THEN 'write'
    WHEN 'tasks.view' = ANY (NEW.perms) THEN 'read' ELSE 'none' END;
  IF v_is_owner THEN
    NEW.permissions_notes := 'write';
    NEW.permissions_tasks := 'write';
  END IF;

  -- A direct insert of SOMEONE ELSE's row (the legacy insert policy) can't hand
  -- out more than the inserter holds. Definer ops insert the caller's own row
  -- (accept invite, ownership hand-off) and pass through.
  IF TG_OP = 'INSERT' AND NOT v_is_owner AND auth.uid() IS NOT NULL AND auth.uid() <> NEW.user_id
     AND (NOT public.perm_can_grant(NEW.workspace_id, auth.uid(), NEW.perms)
          OR (NOT public.perm_is_owner(NEW.workspace_id, auth.uid())
              AND NEW.perms && ARRAY['ws.manage_members', 'ws.manage_roles'])) THEN
    RAISE EXCEPTION 'You can''t give someone permissions you don''t have.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ── backfill (before any enforcement exists) ─────────────────────────────────

DO $$
DECLARE w record;
BEGIN
  FOR w IN SELECT id FROM public.workspaces LOOP
    PERFORM public.perm_seed_workspace_roles(w.id);
  END LOOP;
END;
$$;

-- Legacy lanes → exceptions. tasks also covered calendar + contacts.
UPDATE public.workspace_members m
   SET role_id = public.perm_system_role_id(m.workspace_id, m.role),
       overrides = CASE WHEN m.role IN ('owner', 'viewer') THEN '{}'::jsonb
                        ELSE public.perm_legacy_overrides(m.permissions_notes, m.permissions_tasks) END
 WHERE m.role_id IS NULL;

DROP TRIGGER IF EXISTS perm_members_resolve ON public.workspace_members;
CREATE TRIGGER perm_members_resolve
  BEFORE INSERT OR UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.perm_members_resolve();

-- Fire the resolver once for every existing row.
UPDATE public.workspace_members SET overrides = overrides;

ALTER TABLE public.workspace_members ALTER COLUMN role_id SET NOT NULL;

UPDATE public.workspace_invites i
   SET role_id = public.perm_system_role_id(i.workspace_id, i.role)
 WHERE i.role_id IS NULL;

-- Role edits re-resolve everyone holding the role.
CREATE OR REPLACE FUNCTION public.perm_roles_propagate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.permissions IS DISTINCT FROM OLD.permissions OR NEW.read_only IS DISTINCT FROM OLD.read_only THEN
    UPDATE public.workspace_members SET overrides = overrides WHERE role_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS perm_roles_propagate ON public.workspace_roles;
CREATE TRIGGER perm_roles_propagate
  AFTER UPDATE ON public.workspace_roles
  FOR EACH ROW EXECUTE FUNCTION public.perm_roles_propagate();

-- ── module permissions (legacy none/view/edit/admin ladder) ──────────────────
-- Lanes: notes|tasks|calendar|contacts|chat (from the matrix), spine (any
-- module), email (personal mailboxes: legacy column, viewers read-only).

CREATE OR REPLACE FUNCTION public.module_member_permission(
  p_workspace_id uuid,
  p_user_id uuid,
  p_lane text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.workspace_members;
  v_mods text[];
BEGIN
  IF p_user_id IS NULL THEN RETURN 'none'; END IF;
  IF public.perm_is_owner(p_workspace_id, p_user_id) THEN RETURN 'admin'; END IF;
  SELECT * INTO m FROM public.workspace_members
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id LIMIT 1;
  IF m.id IS NULL THEN RETURN 'none'; END IF;

  IF p_lane = 'email' THEN
    IF m.role = 'viewer' THEN RETURN 'view'; END IF;
    RETURN CASE lower(coalesce(m.permissions_email, 'edit'))
      WHEN 'none' THEN 'none' WHEN 'read' THEN 'view' WHEN 'view' THEN 'view' ELSE 'edit' END;
  END IF;

  v_mods := CASE WHEN p_lane = 'spine' THEN ARRAY['notes','tasks','calendar','contacts','chat']
                 ELSE ARRAY[p_lane] END;
  IF EXISTS (SELECT 1 FROM unnest(m.perms) k
             WHERE split_part(k, '.', 1) = ANY (v_mods)
               AND split_part(k, '.', 2) IN ('create', 'edit', 'delete')) THEN
    RETURN 'edit';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(m.perms) k
             WHERE split_part(k, '.', 1) = ANY (v_mods) AND split_part(k, '.', 2) = 'view') THEN
    RETURN 'view';
  END IF;
  RETURN 'none';
END;
$$;

CREATE OR REPLACE FUNCTION public.perm_scope_lane(p_scope_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_scope_key
    WHEN 'links' THEN 'spine'
    WHEN 'notes' THEN 'notes' WHEN 'tasks' THEN 'tasks' WHEN 'calendar' THEN 'calendar'
    WHEN 'contacts' THEN 'contacts' WHEN 'email' THEN 'email' WHEN 'chat' THEN 'chat'
    ELSE 'tasks' END
$$;

CREATE OR REPLACE FUNCTION public.module_api_key_effective_scopes(p_key_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k        public.workspace_api_keys;
  v_out    jsonb := '{}'::jsonb;
  v_scope  record;
  v_member text;
BEGIN
  SELECT * INTO k FROM public.workspace_api_keys WHERE id = p_key_id AND revoked_at IS NULL;
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
$$;

CREATE OR REPLACE FUNCTION public.tasks_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'tasks', 'tasks');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'tasks');
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'calendar', 'calendar');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'calendar');
END;
$$;

CREATE OR REPLACE FUNCTION public.contacts_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'contacts', 'contacts');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'contacts');
END;
$$;

CREATE OR REPLACE FUNCTION public.spine_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'links', 'spine');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'spine');
END;
$$;

-- notes/email bodies are unchanged (lanes 'notes' / 'email'); re-assert anyway
-- so this file alone describes the chain.
CREATE OR REPLACE FUNCTION public.notes_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'notes', 'notes');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'notes');
END;
$$;

-- Chat keys are capped by their creator too (was the raw key scope).
CREATE OR REPLACE FUNCTION public.chat_key_scope(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.module_api_key_scope(p_workspace_id, 'chat', 'chat')
$$;

-- ── write enforcement ────────────────────────────────────────────────────────
-- TG_ARGV[0] = module; TG_ARGV[1] (optional) = fixed action ('edit' for child
-- tables like task_relations, where any change is an edit of the parent).

CREATE OR REPLACE FUNCTION public.perm_enforce_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module text := TG_ARGV[0];
  v_fixed  text := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1] ELSE NULL END;
  v_ws     uuid;
  v_actor  uuid;
  v_action text;
  v_verb   text;
BEGIN
  -- Every guarded table has workspace_id; other columns are read only on the
  -- tables that have them (plpgsql resolves NEW.x lazily, per branch).
  v_ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_actor := public.perm_actor_id();

  -- System work (service role without a key, cron, migrations), and owners.
  IF v_actor IS NULL OR v_ws IS NULL OR public.perm_is_owner(v_ws, v_actor) THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF v_fixed IS NOT NULL THEN
    v_action := v_fixed;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
  ELSE
    v_action := 'edit';
  END IF;

  IF v_module = 'calendar' THEN
    -- Mirrored external events are the owner's own sync, not edits.
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_account_id ELSE NEW.source_account_id END) IS NOT NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  IF v_module = 'chat' AND TG_TABLE_NAME = 'chat_channels' THEN
    -- The first channel of a workspace is chat's own bootstrap (#general),
    -- whoever happens to open chat first.
    IF NOT EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.workspace_id = v_ws) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_fixed IS NULL AND TG_TABLE_NAME <> 'chat_channels' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := 'delete';      -- soft delete and restore
    ELSIF v_module = 'chat' AND NEW.body IS NOT DISTINCT FROM OLD.body THEN
      -- Reactions / thread counters live on the message row; only a body
      -- change is an edit.
      RETURN NEW;
    END IF;
  END IF;

  IF NOT public.perm_user_has(v_ws, v_actor, v_module || '.' || v_action) THEN
    v_verb := CASE v_action WHEN 'create' THEN 'add' ELSE v_action END;
    RAISE EXCEPTION 'Your role can''t % % in this workspace.', v_verb,
      CASE v_module WHEN 'tasks' THEN 'tasks' WHEN 'notes' THEN 'notes' WHEN 'calendar' THEN 'events'
                    WHEN 'contacts' THEN 'contacts' WHEN 'chat' THEN 'messages' ELSE v_module END
      USING ERRCODE = '42501';
  END IF;

  -- Publishing a note to the web is a workspace power.
  IF TG_TABLE_NAME = 'notes' AND TG_OP = 'UPDATE' THEN
    IF OLD.publish_token IS NULL AND NEW.publish_token IS NOT NULL
       AND NOT public.perm_user_has(v_ws, v_actor, 'ws.publish') THEN
      RAISE EXCEPTION 'Your role can''t publish to the web in this workspace.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('notes', 'notes', NULL),
    ('note_updates', 'notes', 'edit'),
    ('tasks', 'tasks', NULL),
    ('buckets', 'tasks', NULL),
    ('task_relations', 'tasks', 'edit'),
    ('task_time_blocks', 'tasks', 'edit'),
    ('calendar_events', 'calendar', NULL),
    ('contacts', 'contacts', NULL),
    ('companies', 'contacts', NULL),
    ('chat_messages', 'chat', NULL),
    ('chat_channels', 'chat', NULL)
  ) AS v(tbl, module, fixed)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS perm_enforce_write ON public.%I', t.tbl);
    IF t.tbl = 'chat_channels' THEN
      -- Channel management keeps chat's own admin rules; creating one is chat.create.
      EXECUTE format('CREATE TRIGGER perm_enforce_write BEFORE INSERT ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write(%L)', t.tbl, t.module);
    ELSIF t.fixed IS NULL THEN
      EXECUTE format('CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write(%L)', t.tbl, t.module);
    ELSE
      EXECUTE format('CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write(%L, %L)', t.tbl, t.module, t.fixed);
    END IF;
  END LOOP;
END;
$$;

-- ── read enforcement ─────────────────────────────────────────────────────────

-- Which module an entity type belongs to (spine rows inherit its View).
CREATE OR REPLACE FUNCTION public.perm_entity_module(p_entity_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_entity_type
    WHEN 'note' THEN 'notes'
    WHEN 'task' THEN 'tasks' WHEN 'bucket' THEN 'tasks' WHEN 'task_project' THEN 'tasks'
    WHEN 'event' THEN 'calendar'
    WHEN 'contact' THEN 'contacts' WHEN 'company' THEN 'contacts'
    ELSE NULL END
$$;

-- The signed-in user can see things of this entity type (types without a
-- module — email threads, links — pass; their own privacy rules still apply).
CREATE OR REPLACE FUNCTION public.perm_can_view_entity(p_workspace_id uuid, p_entity_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.perm_entity_module(p_entity_type) IS NULL
      OR public.perm_user_has(p_workspace_id, auth.uid(), public.perm_entity_module(p_entity_type) || '.view')
$$;

-- entities / module_activity: PERM-0 privacy AND module visibility.
DROP POLICY IF EXISTS entities_workspace_read ON public.entities;
CREATE POLICY entities_workspace_read ON public.entities
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND public.perm_can_view_entity(workspace_id, entity_type)
    AND (
      entity_type NOT IN ('event', 'email_thread')
      OR (entity_type = 'event' AND EXISTS (
            SELECT 1 FROM public.calendar_events e
            WHERE e.id = entities.entity_id AND e.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'email_thread' AND EXISTS (
            SELECT 1 FROM public.email_refs r
            WHERE r.id = entities.entity_id AND r.owner_id = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS module_activity_workspace_read ON public.module_activity;
CREATE POLICY module_activity_workspace_read ON public.module_activity
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND public.perm_can_view_entity(workspace_id, entity_type)
    AND (
      entity_type NOT IN ('event', 'calendar_account', 'email_thread', 'email_account')
      OR (actor_type = 'user' AND actor_id = (SELECT auth.uid()))
      OR (entity_type = 'event' AND EXISTS (
            SELECT 1 FROM public.calendar_events e
            WHERE e.id = module_activity.entity_id AND e.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'calendar_account' AND EXISTS (
            SELECT 1 FROM public.calendar_accounts a
            WHERE a.id = module_activity.entity_id AND a.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'email_thread' AND EXISTS (
            SELECT 1 FROM public.email_refs r
            WHERE r.id = module_activity.entity_id AND r.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'email_account' AND EXISTS (
            SELECT 1 FROM public.email_accounts a
            WHERE a.id = module_activity.entity_id AND a.owner_id = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS comments_workspace_read ON public.comments;
CREATE POLICY comments_workspace_read ON public.comments
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND public.perm_can_view_entity(workspace_id, entity_type)
  );

DROP POLICY IF EXISTS notes_workspace_read ON public.notes;
CREATE POLICY notes_workspace_read ON public.notes
  FOR SELECT TO authenticated USING (public.perm_can_view(workspace_id, 'notes'));

DROP POLICY IF EXISTS note_updates_workspace_read ON public.note_updates;
CREATE POLICY note_updates_workspace_read ON public.note_updates
  FOR SELECT TO authenticated USING (public.perm_can_view(workspace_id, 'notes'));

DROP POLICY IF EXISTS tasks_workspace_access ON public.tasks;
CREATE POLICY tasks_workspace_access ON public.tasks
  FOR ALL TO authenticated USING (public.perm_can_view(workspace_id, 'tasks'))
  WITH CHECK (public.perm_can_view(workspace_id, 'tasks'));

DROP POLICY IF EXISTS buckets_workspace_access ON public.buckets;
CREATE POLICY buckets_workspace_access ON public.buckets
  FOR ALL TO authenticated USING (public.perm_can_view(workspace_id, 'tasks'))
  WITH CHECK (public.perm_can_view(workspace_id, 'tasks'));

DROP POLICY IF EXISTS task_relations_workspace_access ON public.task_relations;
CREATE POLICY task_relations_workspace_access ON public.task_relations
  FOR ALL TO authenticated USING (public.perm_can_view(workspace_id, 'tasks'))
  WITH CHECK (public.perm_can_view(workspace_id, 'tasks'));

DROP POLICY IF EXISTS task_time_blocks_workspace_access ON public.task_time_blocks;
CREATE POLICY task_time_blocks_workspace_access ON public.task_time_blocks
  FOR ALL TO authenticated USING (public.perm_can_view(workspace_id, 'tasks'))
  WITH CHECK (public.perm_can_view(workspace_id, 'tasks'));

DROP POLICY IF EXISTS contacts_workspace_read ON public.contacts;
CREATE POLICY contacts_workspace_read ON public.contacts
  FOR SELECT TO authenticated USING (public.perm_can_view(workspace_id, 'contacts'));

DROP POLICY IF EXISTS companies_workspace_read ON public.companies;
CREATE POLICY companies_workspace_read ON public.companies
  FOR SELECT TO authenticated USING (public.perm_can_view(workspace_id, 'contacts'));

DROP POLICY IF EXISTS contact_field_defs_read ON public.contact_field_defs;
CREATE POLICY contact_field_defs_read ON public.contact_field_defs
  FOR SELECT TO authenticated USING (public.perm_can_view(workspace_id, 'contacts'));

-- Calendar: owner-only (PERM-0) AND the module is visible to them.
DROP POLICY IF EXISTS calendar_events_owner_read ON public.calendar_events;
CREATE POLICY calendar_events_owner_read ON public.calendar_events
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND owner_id = (SELECT auth.uid())
    AND public.perm_can_view(workspace_id, 'calendar')
  );

-- Chat: newest body ← prod (20261006150000 lineage) + chat.view.
CREATE OR REPLACE FUNCTION public.chat_can_read_channel(p_channel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select exists (
    select 1 from public.chat_channels c
     where c.id = p_channel_id
       and public.chat_can_access_workspace(c.workspace_id)
       and public.perm_can_view(c.workspace_id, 'chat')
       and (
         (c.kind = 'channel' and not c.is_private)
         or exists (select 1 from public.chat_members m where m.channel_id = c.id and m.user_id = auth.uid())
       )
  )
$$;

-- ── workspace powers ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_can_manage_workspace_members(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.perm_user_has(p_workspace_id, auth.uid(), 'ws.manage_members')
$$;

CREATE OR REPLACE FUNCTION public.workspace_api_keys_can_manage(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.perm_user_has(p_workspace_id, auth.uid(), 'ws.api_keys')
$$;

-- Member rows are written only by definer ops from now on (role/exceptions
-- must go through the rules below; the owner row comes from the workspaces
-- trigger, members from accept-invite). Self-leave (DELETE own row) stays.
DROP POLICY IF EXISTS workspace_members_update_manager ON public.workspace_members;
DROP POLICY IF EXISTS workspace_members_insert_owner ON public.workspace_members;

-- Self-scoped check for RLS (never takes a user id from the caller).
CREATE OR REPLACE FUNCTION public.perm_i_have(p_workspace_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.perm_user_has(p_workspace_id, auth.uid(), p_key)
$$;

DROP POLICY IF EXISTS workspace_invites_select_admin ON public.workspace_invites;
CREATE POLICY workspace_invites_select_admin ON public.workspace_invites
  FOR SELECT TO authenticated USING (public.perm_i_have(workspace_id, 'ws.invite'));
DROP POLICY IF EXISTS workspace_invites_insert_admin ON public.workspace_invites;
CREATE POLICY workspace_invites_insert_admin ON public.workspace_invites
  FOR INSERT TO authenticated WITH CHECK (public.perm_i_have(workspace_id, 'ws.invite'));
DROP POLICY IF EXISTS workspace_invites_update_admin ON public.workspace_invites;
CREATE POLICY workspace_invites_update_admin ON public.workspace_invites
  FOR UPDATE TO authenticated USING (public.perm_i_have(workspace_id, 'ws.invite'));
DROP POLICY IF EXISTS workspace_invites_delete_admin ON public.workspace_invites;
CREATE POLICY workspace_invites_delete_admin ON public.workspace_invites
  FOR DELETE TO authenticated USING (public.perm_i_have(workspace_id, 'ws.invite'));

-- Can `p_actor` manage the member `p_target_user` at all?
CREATE OR REPLACE FUNCTION public.perm_can_manage_member(p_workspace_id uuid, p_actor uuid, p_target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_actor IS NOT NULL
     AND p_actor IS DISTINCT FROM p_target_user
     AND NOT public.perm_is_owner(p_workspace_id, p_target_user)
     AND (
       public.perm_is_owner(p_workspace_id, p_actor)
       OR (public.perm_user_has(p_workspace_id, p_actor, 'ws.manage_members')
           AND NOT public.perm_user_has(p_workspace_id, p_target_user, 'ws.manage_members')
           AND NOT public.perm_user_has(p_workspace_id, p_target_user, 'ws.manage_roles')
           AND public.perm_effective(p_workspace_id, p_target_user) <@ public.perm_effective(p_workspace_id, p_actor))
     )
$$;

-- Invites: role id ↔ tier text, and the inviter must be able to grant it.
CREATE OR REPLACE FUNCTION public.perm_invites_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.workspace_roles;
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.role_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.role IS DISTINCT FROM OLD.role) THEN
    NEW.role_id := public.perm_system_role_id(NEW.workspace_id, NEW.role);
  END IF;
  SELECT * INTO r FROM public.workspace_roles WHERE id = NEW.role_id;
  IF r.id IS NULL OR r.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'That role doesn''t belong to this workspace.';
  END IF;
  -- Only checked when the role is being set (status-only updates like accept
  -- or revoke don't re-validate).
  IF v_actor IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND NOT public.perm_can_grant(NEW.workspace_id, v_actor, r.permissions) THEN
    RAISE EXCEPTION 'You can''t invite someone as % — it has permissions you don''t have.', r.name
      USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND NOT public.perm_is_owner(NEW.workspace_id, v_actor)
     AND (r.permissions && ARRAY['ws.manage_members', 'ws.manage_roles']) THEN
    RAISE EXCEPTION 'Only the owner can invite someone with member or role management.'
      USING ERRCODE = '42501';
  END IF;
  -- Invites keep the app vocabulary (editor, not member): builds ≤ 1.0.9 read
  -- this column straight into their role badges.
  NEW.role := CASE public.perm_role_tier(r) WHEN 'member' THEN 'editor' ELSE public.perm_role_tier(r) END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS perm_invites_validate ON public.workspace_invites;
CREATE TRIGGER perm_invites_validate
  BEFORE INSERT OR UPDATE ON public.workspace_invites
  FOR EACH ROW EXECUTE FUNCTION public.perm_invites_validate();

-- ── ops ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.perm_validate_overrides(p_overrides jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  e record;
BEGIN
  IF p_overrides IS NULL OR jsonb_typeof(p_overrides) <> 'object' THEN
    RETURN v_out;
  END IF;
  FOR e IN SELECT key, value FROM jsonb_each(p_overrides) LOOP
    IF NOT (e.key = ANY (public.perm_all_keys())) THEN
      RAISE EXCEPTION 'Unknown permission: %', e.key;
    END IF;
    IF jsonb_typeof(e.value) <> 'boolean' THEN
      RAISE EXCEPTION 'Exceptions are allow (true) or block (false).';
    END IF;
    v_out := v_out || jsonb_build_object(e.key, e.value);
  END LOOP;
  RETURN v_out;
END;
$$;

-- Set a member's role and personal exceptions in one step.
CREATE OR REPLACE FUNCTION public.workspace_op_set_member_access(
  p_member_id uuid,
  p_role_id uuid,
  p_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS public.workspace_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  m public.workspace_members;
  r public.workspace_roles;
  v_overrides jsonb := public.perm_validate_overrides(p_overrides);
  v_next text[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO m FROM public.workspace_members WHERE id = p_member_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Member not found.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = m.workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Workspace not found.';
  END IF;
  IF m.user_id = v_actor THEN
    RAISE EXCEPTION 'You can''t change your own access.';
  END IF;
  IF public.perm_is_owner(m.workspace_id, m.user_id) THEN
    RAISE EXCEPTION 'The owner always has full access. Transfer ownership to change it.';
  END IF;
  IF NOT public.perm_can_manage_member(m.workspace_id, v_actor, m.user_id) THEN
    RAISE EXCEPTION 'You can''t manage this person''s access.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.workspace_roles WHERE id = coalesce(p_role_id, m.role_id);
  IF r.id IS NULL OR r.workspace_id <> m.workspace_id THEN
    RAISE EXCEPTION 'That role doesn''t belong to this workspace.';
  END IF;

  v_next := public.perm_resolve(r.permissions, r.read_only, v_overrides);
  IF NOT public.perm_can_grant(m.workspace_id, v_actor, v_next) THEN
    RAISE EXCEPTION 'You can''t give someone permissions you don''t have.' USING ERRCODE = '42501';
  END IF;
  -- Granting management powers stays with the owner.
  IF NOT public.perm_is_owner(m.workspace_id, v_actor)
     AND (v_next && ARRAY['ws.manage_members', 'ws.manage_roles']) THEN
    RAISE EXCEPTION 'Only the owner can give someone member or role management.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspace_members
     SET role_id = r.id, overrides = v_overrides
   WHERE id = m.id
   RETURNING * INTO m;
  RETURN m;
END;
$$;

-- Legacy signature (desktop builds ≤ 1.0.9): role text → system role, keeps
-- the member's exceptions, ignores the old per-module columns.
CREATE OR REPLACE FUNCTION public.workspace_op_set_member_role(
  p_member_id uuid,
  p_role text,
  p_perm_notes text DEFAULT 'write',
  p_perm_tasks text DEFAULT 'write'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.workspace_members;
BEGIN
  IF p_role NOT IN ('admin', 'member', 'viewer') THEN RAISE EXCEPTION 'invalid role %', p_role; END IF;
  SELECT * INTO m FROM public.workspace_members WHERE id = p_member_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'member not found'; END IF;
  -- Old clients manage the notes/tasks lanes: replace exactly those keys with
  -- the lanes they sent; keep every other exception (chat.*, ws.*).
  PERFORM public.workspace_op_set_member_access(
    p_member_id,
    public.perm_system_role_id(m.workspace_id, p_role),
    (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(m.overrides)
      WHERE split_part(key, '.', 1) NOT IN ('notes', 'tasks', 'calendar', 'contacts'))
    || CASE WHEN p_role = 'viewer' THEN '{}'::jsonb
            ELSE public.perm_legacy_overrides(p_perm_notes, p_perm_tasks) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_op_remove_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  m public.workspace_members;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO m FROM public.workspace_members WHERE id = p_member_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'member not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = m.workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace not found';
  END IF;
  IF public.perm_is_owner(m.workspace_id, m.user_id) THEN
    RAISE EXCEPTION 'cannot remove the workspace owner';
  END IF;
  IF m.user_id = v_actor THEN RAISE EXCEPTION 'use leave to remove yourself'; END IF;
  IF NOT public.perm_can_manage_member(m.workspace_id, v_actor, m.user_id) THEN
    RAISE EXCEPTION 'You can''t remove this person.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.workspace_members WHERE id = p_member_id;
END;
$$;

-- Ownership hand-off: unchanged rules; the old owner lands on the Admin role.
CREATE OR REPLACE FUNCTION public.workspace_op_transfer_ownership(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid(); v_workspace_id uuid; v_target_user uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT m.workspace_id, m.user_id INTO v_workspace_id, v_target_user
    FROM public.workspace_members m WHERE m.id = p_member_id;
  IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'member not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace_id AND w.owner_id = v_caller AND w.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'only the workspace owner can transfer ownership'; END IF;
  IF v_target_user = v_caller THEN RAISE EXCEPTION 'you already own this workspace'; END IF;
  UPDATE public.workspaces SET owner_id = v_target_user WHERE id = v_workspace_id;
  UPDATE public.workspace_members SET role = 'owner', overrides = '{}'::jsonb WHERE id = p_member_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id, permissions_notes, permissions_tasks)
  VALUES (v_workspace_id, v_caller, 'admin', public.perm_system_role_id(v_workspace_id, 'admin'), 'write', 'write')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = 'admin', role_id = public.perm_system_role_id(v_workspace_id, 'admin'), overrides = '{}'::jsonb;
END;
$$;

-- Accept: the invite's role id wins; legacy rows map through the tier text.
CREATE OR REPLACE FUNCTION public.workspace_op_accept_invite(p_token text)
RETURNS public.workspace_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_invite public.workspace_invites;
  v_token  text := replace(btrim(coalesce(p_token, '')), ' ', '+');
  v_role_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_token = '' THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  SELECT * INTO v_invite
    FROM public.workspace_invites
   WHERE token = v_token
     AND status = 'pending'
   LIMIT 1;

  IF v_invite.id IS NULL OR v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = v_invite.workspace_id
       AND m.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'You''re already a member of this workspace.';
  END IF;

  v_role_id := coalesce(
    (SELECT r.id FROM public.workspace_roles r
      WHERE r.id = v_invite.role_id AND r.workspace_id = v_invite.workspace_id),
    public.perm_system_role_id(v_invite.workspace_id,
      CASE lower(coalesce(v_invite.role, 'member')) WHEN 'admin' THEN 'admin' WHEN 'viewer' THEN 'viewer' ELSE 'member' END));

  INSERT INTO public.workspace_members
    (workspace_id, user_id, role, role_id, overrides, permissions_notes, permissions_tasks)
  VALUES (
    v_invite.workspace_id, v_caller, 'member', v_role_id,
    -- Invites from old clients carry restricted lanes; new ones send 'write'.
    CASE WHEN (SELECT read_only FROM public.workspace_roles WHERE id = v_role_id) THEN '{}'::jsonb
         ELSE public.perm_legacy_overrides(v_invite.permissions_notes, v_invite.permissions_tasks) END,
    'write', 'write');

  UPDATE public.workspace_invites
     SET status = 'accepted'
   WHERE id = v_invite.id
   RETURNING * INTO v_invite;

  RETURN v_invite;
END;
$$;

-- Create (p_role_id NULL) or update a role.
CREATE OR REPLACE FUNCTION public.workspace_op_role_upsert(
  p_workspace_id uuid,
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permissions text[],
  p_read_only boolean DEFAULT false,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS public.workspace_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_owner boolean;
  r public.workspace_roles;
  v_name text := btrim(coalesce(p_name, ''));
  v_perms text[];
  v_bad text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Workspace not found.';
  END IF;
  v_is_owner := public.perm_is_owner(p_workspace_id, v_actor);
  IF NOT public.perm_user_has(p_workspace_id, v_actor, 'ws.manage_roles') THEN
    RAISE EXCEPTION 'Your role can''t change roles in this workspace.' USING ERRCODE = '42501';
  END IF;

  SELECT k INTO v_bad FROM unnest(coalesce(p_permissions, '{}'::text[])) k
   WHERE NOT (k = ANY (public.perm_all_keys())) LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown permission: %', v_bad; END IF;

  IF p_role_id IS NOT NULL THEN
    SELECT * INTO r FROM public.workspace_roles WHERE id = p_role_id AND workspace_id = p_workspace_id FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Role not found.'; END IF;
    IF p_expected_updated_at IS NOT NULL AND r.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'Someone else just changed this role. Reload to see their version.'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  -- System roles keep their name and their read-only flag.
  IF r.system_key IS NOT NULL THEN
    v_name := r.name;
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'A role name is 1–40 characters.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_roles x
             WHERE x.workspace_id = p_workspace_id AND lower(btrim(x.name)) = lower(v_name)
               AND x.id IS DISTINCT FROM r.id) THEN
    RAISE EXCEPTION 'There''s already a role called %.', v_name;
  END IF;

  v_perms := public.perm_resolve(
    p_permissions,
    CASE WHEN r.system_key IS NOT NULL THEN r.read_only ELSE coalesce(p_read_only, false) END,
    '{}'::jsonb);

  IF NOT v_is_owner THEN
    -- Nobody grants what they don't hold, edits a stronger role, or edits the
    -- role they hold themselves.
    IF NOT public.perm_can_grant(p_workspace_id, v_actor, v_perms) THEN
      RAISE EXCEPTION 'You can''t give a role permissions you don''t have.' USING ERRCODE = '42501';
    END IF;
    IF r.id IS NOT NULL AND NOT public.perm_can_grant(p_workspace_id, v_actor, r.permissions) THEN
      RAISE EXCEPTION 'This role has permissions you don''t have, so only the owner can change it.'
        USING ERRCODE = '42501';
    END IF;
    IF r.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.workspace_members m
                                     WHERE m.workspace_id = p_workspace_id AND m.user_id = v_actor
                                       AND m.role_id = r.id) THEN
      RAISE EXCEPTION 'You can''t change the role you have yourself.' USING ERRCODE = '42501';
    END IF;
    -- Only the owner manages people who can manage: a role that carries (or
    -- whose holders carry) member/role management is the owner's to change.
    IF r.id IS NOT NULL AND (
         r.permissions && ARRAY['ws.manage_members', 'ws.manage_roles']
         OR EXISTS (SELECT 1 FROM public.workspace_members m
                     WHERE m.role_id = r.id AND m.perms && ARRAY['ws.manage_members', 'ws.manage_roles'])) THEN
      RAISE EXCEPTION 'People with this role can manage members or roles, so only the owner can change it.'
        USING ERRCODE = '42501';
    END IF;
    IF v_perms && ARRAY['ws.manage_members', 'ws.manage_roles'] THEN
      RAISE EXCEPTION 'Only the owner can give a role member or role management.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF r.id IS NULL THEN
    IF (SELECT count(*) FROM public.workspace_roles WHERE workspace_id = p_workspace_id AND system_key IS NULL) >= 20 THEN
      RAISE EXCEPTION 'A workspace can have up to 20 custom roles.';
    END IF;
    INSERT INTO public.workspace_roles (workspace_id, name, description, permissions, read_only, position, created_by)
    VALUES (p_workspace_id, v_name, left(coalesce(p_description, ''), 200), v_perms, coalesce(p_read_only, false),
            coalesce((SELECT max(position) + 1 FROM public.workspace_roles WHERE workspace_id = p_workspace_id), 3),
            v_actor)
    RETURNING * INTO r;
  ELSE
    UPDATE public.workspace_roles
       SET name = v_name,
           description = left(coalesce(p_description, ''), 200),
           permissions = v_perms,
           read_only = CASE WHEN system_key IS NOT NULL THEN read_only ELSE coalesce(p_read_only, false) END,
           updated_at = clock_timestamp()
     WHERE id = r.id
     RETURNING * INTO r;
  END IF;
  RETURN r;
END;
$$;

-- Delete a custom role, moving its people and pending invites to another role.
CREATE OR REPLACE FUNCTION public.workspace_op_role_delete(p_role_id uuid, p_reassign_to uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  r public.workspace_roles;
  t public.workspace_roles;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO r FROM public.workspace_roles WHERE id = p_role_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Role not found.'; END IF;
  IF r.system_key IS NOT NULL THEN RAISE EXCEPTION 'Built-in roles can''t be deleted.'; END IF;
  IF NOT public.perm_user_has(r.workspace_id, v_actor, 'ws.manage_roles') THEN
    RAISE EXCEPTION 'Your role can''t change roles in this workspace.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.workspace_roles WHERE id = p_reassign_to;
  IF t.id IS NULL OR t.workspace_id <> r.workspace_id OR t.id = r.id THEN
    RAISE EXCEPTION 'Pick another role for the people who have this one.';
  END IF;
  IF NOT public.perm_is_owner(r.workspace_id, v_actor) THEN
    IF NOT public.perm_can_grant(r.workspace_id, v_actor, r.permissions)
       OR NOT public.perm_can_grant(r.workspace_id, v_actor, t.permissions) THEN
      RAISE EXCEPTION 'Only the owner can do this — one of these roles has permissions you don''t have.'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.role_id = r.id AND m.user_id = v_actor) THEN
      RAISE EXCEPTION 'You can''t delete the role you have yourself.' USING ERRCODE = '42501';
    END IF;
    IF (r.permissions || t.permissions) && ARRAY['ws.manage_members', 'ws.manage_roles']
       OR EXISTS (SELECT 1 FROM public.workspace_members m
                   WHERE m.role_id = r.id AND m.perms && ARRAY['ws.manage_members', 'ws.manage_roles']) THEN
      RAISE EXCEPTION 'Only the owner can move people who manage members or roles.' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.workspace_members SET role_id = t.id WHERE role_id = r.id;
  UPDATE public.workspace_invites SET role_id = t.id WHERE role_id = r.id;
  DELETE FROM public.workspace_roles WHERE id = r.id;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────

DO $$
DECLARE fn text;
BEGIN
  -- Internal helpers: definer callers / RLS only.
  FOREACH fn IN ARRAY ARRAY[
    'perm_all_keys()', 'perm_system_role_permissions(text)', 'perm_resolve(text[], boolean, jsonb)',
    'perm_seed_workspace_roles(uuid)', 'perm_system_role_id(uuid, text)',
    'perm_role_tier(public.workspace_roles)', 'perm_is_owner(uuid, uuid)', 'perm_effective(uuid, uuid)',
    'perm_user_has(uuid, uuid, text)', 'perm_has(uuid, text)', 'perm_can_grant(uuid, uuid, text[])',
    'perm_can_manage_member(uuid, uuid, uuid)', 'perm_validate_overrides(jsonb)', 'perm_scope_lane(text)',
    'perm_workspaces_seed_roles()', 'perm_members_resolve()', 'perm_roles_propagate()',
    'perm_enforce_write()', 'perm_invites_validate()', 'perm_legacy_overrides(text, text)',
    'perm_entity_module(text)'
  ] LOOP
    -- Supabase grants `authenticated` EXECUTE directly (not via PUBLIC), so it
    -- has to be revoked by name (gotchas: REVOKE … FROM PUBLIC).
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- Called directly by RLS policies (as the signed-in role); all self-scoped.
  FOREACH fn IN ARRAY ARRAY['perm_can_view(uuid, text)', 'perm_i_have(uuid, text)',
                            'perm_can_view_entity(uuid, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  -- Client-callable ops.
  FOREACH fn IN ARRAY ARRAY[
    'workspace_op_set_member_access(uuid, uuid, jsonb)',
    'workspace_op_set_member_role(uuid, text, text, text)',
    'workspace_op_remove_member(uuid)',
    'workspace_op_transfer_ownership(uuid)',
    'workspace_op_accept_invite(text)',
    'workspace_op_role_upsert(uuid, uuid, text, text, text[], boolean, timestamptz)',
    'workspace_op_role_delete(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;
