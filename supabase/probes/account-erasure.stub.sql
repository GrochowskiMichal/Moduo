-- Stub of production for supabase/probes/account-erasure.probe.sql (PRIV-2a).
-- The repo can't bootstrap a database (supabase/AGENTS.md), so this recreates
-- only what 20261008013000_account_erase_workspace_data.sql touches, as
-- production has it on 2026-10-08 (project wtoonrvuqumihpkbvwvs, read from the
-- catalog): columns the probe uses, foreign-key delete rules, unique indexes,
-- the exact bodies of can_access and its helpers, and every trigger that fires
-- on an update or delete of these tables, or on an insert into buckets (the
-- only insert the migration makes besides chat managers). Insert-time sharing
-- triggers are left out: the probe sets every grant explicitly.
-- Helpers the probe never exercises for real are stubbed and marked so.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Like Supabase: every new function in public is executable by these roles
-- directly (not through PUBLIC), so a migration must revoke them by name.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  stripe_customer_id text
);
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  deleted_at timestamptz
);
CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  perms text[] NOT NULL DEFAULT '{}',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE TABLE public.workspace_share_defaults (workspace_id uuid PRIMARY KEY, buckets text);
CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);

CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  parent_id uuid REFERENCES public.notes (id) ON DELETE SET NULL,
  deleted_at timestamptz,
  share_mode text NOT NULL DEFAULT 'custom',
  share_scope text NOT NULL DEFAULT 'private',
  share_permission text NOT NULL DEFAULT 'edit',
  workspace_shared boolean NOT NULL DEFAULT false,
  publish_token text,
  published_at timestamptz
);
CREATE TABLE public.note_updates (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  note_id uuid NOT NULL REFERENCES public.notes (id) ON DELETE CASCADE,
  update_b64 text NOT NULL DEFAULT ''
);
-- note_shares_note_id_fkey exists on production, but no migration records its
-- delete rule; the stub takes the strictest one.
CREATE TABLE public.note_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.notes (id),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE
);
CREATE TABLE public.exposed_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id text NOT NULL,
  title text NOT NULL DEFAULT ''
);

CREATE TABLE public.buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  position text NOT NULL DEFAULT 'a0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX buckets_one_system_per_owner_idx
  ON public.buckets (workspace_id, owner_id) WHERE is_system AND deleted_at IS NULL;
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid,
  bucket_id uuid NOT NULL REFERENCES public.buckets (id) ON DELETE RESTRICT,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo',
  parent_id uuid REFERENCES public.tasks (id) ON DELETE SET NULL,
  deleted_at timestamptz
);
CREATE TABLE public.task_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  blocker_task_id uuid NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  blocked_task_id uuid NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE
);
CREATE TABLE public.task_time_blocks (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,
  blocks jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid,
  name text NOT NULL DEFAULT '',
  deleted_at timestamptz
);
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid,
  name text NOT NULL DEFAULT '',
  company_id uuid REFERENCES public.companies (id) ON DELETE SET NULL,
  deleted_at timestamptz
);
CREATE TABLE public.contact_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  name text NOT NULL DEFAULT '',
  deleted_at timestamptz
);
CREATE TABLE public.contact_group_members (
  group_id uuid NOT NULL REFERENCES public.contact_groups (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, contact_id)
);
CREATE TABLE public.contact_private_notes (
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL DEFAULT '',
  PRIMARY KEY (contact_id, user_id)
);

CREATE TABLE public.calendar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid,
  deleted_at timestamptz
);
CREATE TABLE public.calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'moduo',
  account_id uuid REFERENCES public.calendar_accounts (id) ON DELETE CASCADE,
  deleted_at timestamptz
);
CREATE TABLE public.calendar_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  name text NOT NULL DEFAULT ''
);
CREATE TABLE public.calendar_set_items (
  set_id uuid NOT NULL REFERENCES public.calendar_sets (id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES public.calendars (id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, calendar_id)
);
CREATE TABLE public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  calendar_ref uuid REFERENCES public.calendars (id) ON DELETE SET NULL,
  source_account_id uuid REFERENCES public.calendar_accounts (id) ON DELETE SET NULL,
  deleted_at timestamptz
);

CREATE TABLE public.email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  address text NOT NULL DEFAULT '',
  deleted_at timestamptz
);
CREATE TABLE public.email_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  account_id uuid REFERENCES public.email_accounts (id) ON DELETE SET NULL,
  subject text NOT NULL DEFAULT '',
  deleted_at timestamptz
);

CREATE TABLE public.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('channel', 'dm')),
  name text,
  is_private boolean NOT NULL DEFAULT false,
  dm_key text,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  managers_only boolean NOT NULL DEFAULT false
);
CREATE TABLE public.chat_members (
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE public.chat_channel_managers (
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  body text NOT NULL DEFAULT '',
  deleted_at timestamptz
);

CREATE TABLE public.resource_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('member', 'workspace', 'public_link')),
  subject_id uuid,
  level text NOT NULL CHECK (level IN ('freebusy', 'view', 'edit', 'full')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  subject_key uuid GENERATED ALWAYS AS (coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  UNIQUE (resource_type, resource_id, subject_type, subject_key)
);

CREATE TABLE public.entities (
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  label text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, entity_type, entity_id)
);
CREATE TABLE public.entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  relation_kind text NOT NULL DEFAULT 'references',
  created_by uuid NOT NULL,
  deleted_at timestamptz,
  pair_key text,
  FOREIGN KEY (workspace_id, source_type, source_id)
    REFERENCES public.entities (workspace_id, entity_type, entity_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, target_type, target_id)
    REFERENCES public.entities (workspace_id, entity_type, entity_id) ON DELETE CASCADE
);
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  body text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  FOREIGN KEY (workspace_id, entity_type, entity_id)
    REFERENCES public.entities (workspace_id, entity_type, entity_id) ON DELETE CASCADE
);
CREATE TABLE public.tag_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL
);
CREATE TABLE public.link_suggestion_declines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  pair_key text NOT NULL,
  declined_by uuid
);
CREATE TABLE public.module_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  module text NOT NULL DEFAULT 'x',
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  op text NOT NULL DEFAULT 'x',
  actor_type text NOT NULL DEFAULT 'user',
  actor_id uuid,
  actor_label text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.notification_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  activity_id uuid NOT NULL REFERENCES public.module_activity (id) ON DELETE CASCADE
);
CREATE TABLE public.workspace_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  created_by uuid
);
CREATE TABLE public.slot_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id text NOT NULL DEFAULT '',
  contact_id uuid,
  calendar_event_id uuid
);

-- ── Access functions (production bodies) ─────────────────────────────────────

CREATE FUNCTION public.module_api_key_creator() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULL::uuid  -- stub: no API-key context in the probe
$$;
CREATE FUNCTION public.perm_actor_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(auth.uid(), public.module_api_key_creator())
$$;
CREATE FUNCTION public.grant_level_rank(p_level text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level
    WHEN 'freebusy' THEN 1 WHEN 'view' THEN 2 WHEN 'edit' THEN 3 WHEN 'full' THEN 4
    ELSE 0 END
$$;
CREATE FUNCTION public.perm_is_owner(p_workspace_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id AND w.owner_id = p_user_id AND w.deleted_at IS NULL)
$$;
CREATE FUNCTION public.perm_user_has(p_workspace_id uuid, p_user_id uuid, p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_user_id IS NOT NULL AND (
    public.perm_is_owner(p_workspace_id, p_user_id)
    OR EXISTS (SELECT 1 FROM public.workspace_members m
               WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id
                 AND p_key = ANY (m.perms)))
$$;
CREATE FUNCTION public.perm_ceiling_rank(p_workspace_id uuid, p_user_id uuid, p_module text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 0
    WHEN NOT public.perm_user_has(p_workspace_id, p_user_id, p_module || '.view') THEN 0
    WHEN public.perm_user_has(p_workspace_id, p_user_id, p_module || '.delete') THEN 4
    WHEN public.perm_user_has(p_workspace_id, p_user_id, p_module || '.edit') THEN 3
    ELSE 2
  END
$$;
CREATE FUNCTION public.share_direct_rank(p_type text, p_id uuid, p_user uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(max(public.grant_level_rank(g.level)), 0)
  FROM public.resource_grants g
  WHERE g.resource_type = p_type AND g.resource_id = p_id
    AND (
      (g.subject_type = 'member' AND g.subject_id = p_user)
      OR g.subject_type = 'workspace'
    )
$$;

CREATE FUNCTION public.can_access(p_type text, p_id uuid, p_min text, p_user uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := coalesce(p_user, public.perm_actor_id());
  v_need int := public.grant_level_rank(p_min);
  v_rank int := 0;
  v_ws uuid;
  v_module text;
  v_id uuid;
  v_parent uuid;
  v_mode text;
  v_creator uuid;
  v_system boolean;
  v_bucket uuid;
  v_cal uuid;
  v_guard int := 0;
BEGIN
  IF v_user IS NULL OR p_id IS NULL OR v_need = 0 THEN
    RETURN false;
  END IF;

  IF p_type = 'note' THEN
    v_id := p_id;
    LOOP
      v_guard := v_guard + 1;
      EXIT WHEN v_guard > 100;
      SELECT workspace_id, parent_id, coalesce(share_mode, 'custom'), created_by
        INTO v_ws, v_parent, v_mode, v_creator
      FROM public.notes WHERE id = v_id;
      EXIT WHEN NOT FOUND;
      IF v_creator = v_user THEN v_rank := greatest(v_rank, 4); END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('note', v_id, v_user));
      EXIT WHEN v_mode IS DISTINCT FROM 'inherit' OR v_parent IS NULL;
      v_id := v_parent;
    END LOOP;
    v_module := 'notes';

  ELSIF p_type = 'bucket' THEN
    SELECT workspace_id, owner_id, is_system INTO v_ws, v_creator, v_system
    FROM public.buckets WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_system THEN
      v_rank := CASE WHEN v_creator = v_user THEN 4 ELSE 0 END;
    ELSE
      IF v_creator = v_user THEN v_rank := 4; END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('bucket', p_id, v_user));
    END IF;
    v_module := 'tasks';

  ELSIF p_type = 'task' THEN
    SELECT workspace_id, bucket_id INTO v_ws, v_bucket FROM public.tasks WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    v_rank := public.share_direct_rank('task', p_id, v_user);
    IF v_bucket IS NOT NULL THEN
      IF public.can_access('bucket', v_bucket, 'full', v_user) THEN v_rank := greatest(v_rank, 4);
      ELSIF public.can_access('bucket', v_bucket, 'edit', v_user) THEN v_rank := greatest(v_rank, 3);
      ELSIF public.can_access('bucket', v_bucket, 'view', v_user) THEN v_rank := greatest(v_rank, 2);
      END IF;
    END IF;
    v_module := 'tasks';

  ELSIF p_type = 'calendar' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator FROM public.calendars WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('calendar', p_id, v_user));
    v_module := 'calendar';

  ELSIF p_type = 'contact_group' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contact_groups WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact_group', p_id, v_user));
    v_module := 'contacts';

  ELSIF p_type = 'contact' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contacts WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact', p_id, v_user));
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'edit', v_user)
    ) THEN
      v_rank := greatest(v_rank, 3);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'company' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.companies WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    IF EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.company_id = p_id AND c.deleted_at IS NULL
        AND public.can_access('contact', c.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'event' THEN
    SELECT workspace_id, owner_id, calendar_ref INTO v_ws, v_creator, v_cal
    FROM public.calendar_events WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN
      v_rank := 4;
      v_module := 'calendar';
    ELSIF v_cal IS NOT NULL THEN
      RETURN public.can_access('calendar', v_cal, p_min, v_user);
    ELSE
      RETURN false;
    END IF;

  ELSE
    RETURN false;
  END IF;

  IF v_ws IS NULL THEN RETURN false; END IF;
  RETURN least(v_rank, public.perm_ceiling_rank(v_ws, v_user, v_module)) >= v_need;
END;
$function$;

-- Stubs for helpers the probe doesn't exercise for real.
CREATE FUNCTION public.chat_has_cap(p_workspace_id uuid, p_user uuid, p_cap text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.spine_pair_key(a_type text, a_id uuid, b_type text, b_id uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN (a_type || ':' || a_id::text) COLLATE "C"
       <= (b_type || ':' || b_id::text) COLLATE "C"
    THEN (a_type || ':' || a_id::text) || '|' || (b_type || ':' || b_id::text)
    ELSE (b_type || ':' || b_id::text) || '|' || (a_type || ':' || a_id::text)
  END;
$$;
-- The user branch of production's body (it copies the actor's display name).
CREATE FUNCTION public.module_activity_log(
  p_workspace_id uuid, p_module text, p_entity_type text, p_entity_id uuid, p_op text, p_payload jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (p_workspace_id, p_module, p_entity_type, p_entity_id, p_op, 'user', auth.uid(),
          (SELECT p.display_name FROM public.profiles p WHERE p.id = auth.uid()),
          coalesce(p_payload, '{}'::jsonb));
$$;
CREATE FUNCTION public.share_member_count(p_workspace_id uuid) RETURNS integer
LANGUAGE sql STABLE AS $$ SELECT count(*)::int FROM public.workspace_members WHERE workspace_id = p_workspace_id $$;
CREATE FUNCTION public.share_grant_workspace(p_workspace_id uuid, p_type text, p_id uuid, p_level text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_level IS NULL OR p_level = 'private' THEN RETURN; END IF;
  IF public.share_member_count(p_workspace_id) < 2 THEN RETURN; END IF;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
  VALUES (p_workspace_id, p_type, p_id, 'workspace', p_level, public.perm_actor_id())
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET level = EXCLUDED.level;
END;
$$;

-- ── Trigger functions (production bodies) ────────────────────────────────────

CREATE FUNCTION public.perm_enforce_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_module text := TG_ARGV[0];
  v_fixed  text := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1] ELSE NULL END;
  v_ws     uuid;
  v_actor  uuid;
  v_action text;
  v_verb   text;
  v_need   text;
  v_item   text;
BEGIN
  v_ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_actor := public.perm_actor_id();
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF v_actor IS NULL OR v_ws IS NULL THEN
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
  IF TG_TABLE_NAME = 'calendar_events' THEN
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_account_id ELSE NEW.source_account_id END) IS NOT NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'chat_channels' THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_channels c
                   WHERE c.workspace_id = v_ws AND c.id IS DISTINCT FROM coalesce(NEW.id, OLD.id)) THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND v_fixed IS NULL AND TG_TABLE_NAME <> 'chat_channels' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := 'delete';
    ELSIF TG_TABLE_NAME = 'chat_messages' THEN
      IF NEW.body IS NOT DISTINCT FROM OLD.body THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  IF NOT public.perm_is_owner(v_ws, v_actor)
     AND NOT public.perm_user_has(v_ws, v_actor, v_module || '.' || v_action) THEN
    v_verb := CASE v_action WHEN 'create' THEN 'add' ELSE v_action END;
    RAISE EXCEPTION 'Your role can''t % % in this workspace.', v_verb,
      CASE v_module WHEN 'tasks' THEN 'tasks' WHEN 'notes' THEN 'notes' WHEN 'calendar' THEN 'events'
                    WHEN 'contacts' THEN 'contacts' WHEN 'chat' THEN 'messages' ELSE v_module END
      USING ERRCODE = '42501';
  END IF;
  v_need := CASE WHEN v_action = 'delete' THEN 'full' ELSE 'edit' END;
  v_item := 'edit';
  IF TG_TABLE_NAME = 'notes' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.publish_token IS NULL AND NEW.publish_token IS NOT NULL
         AND NOT public.perm_user_has(v_ws, v_actor, 'ws.publish') THEN
        RAISE EXCEPTION 'Your role can''t publish to the web in this workspace.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.parent_id IS NOT NULL AND NOT public.can_access('note', NEW.parent_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.can_access('note', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'note_updates' THEN
    IF NOT public.can_access('note', coalesce(NEW.note_id, OLD.note_id), 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'buckets' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('bucket', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT public.can_access('task', OLD.id, v_item, v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
         AND NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.owner_id IS NOT NULL
       AND NOT public.perm_user_has(v_ws, NEW.owner_id, 'tasks.edit') THEN
      RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('contact', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this contact.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'companies' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('company', OLD.id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this company.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'calendar_events' THEN
    IF TG_OP <> 'INSERT' THEN
      IF OLD.owner_id IS DISTINCT FROM v_actor
         AND (OLD.calendar_ref IS NULL OR NOT public.can_access('calendar', OLD.calendar_ref, v_item, v_actor)) THEN
        RAISE EXCEPTION 'You don''t have access to this event.' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'chat_messages' THEN
    IF v_action = 'delete' AND TG_OP <> 'INSERT' THEN
      IF OLD.author_id IS DISTINCT FROM v_actor
         AND NOT public.chat_has_cap(v_ws, v_actor, 'delete_others') THEN
        RAISE EXCEPTION 'Your role can''t delete other people''s messages.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$function$;

CREATE FUNCTION public.notes_share_fields_owner_only()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
    AND auth.uid() IS NOT NULL
    AND OLD.created_by IS DISTINCT FROM auth.uid()
    AND (
      OLD.share_scope IS DISTINCT FROM NEW.share_scope
      OR OLD.share_permission IS DISTINCT FROM NEW.share_permission
      OR OLD.created_by IS DISTINCT FROM NEW.created_by
      OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    )
  THEN
    RAISE EXCEPTION 'only the note owner can change sharing or ownership';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.share_task_assign()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN RETURN NEW; END IF;
  IF public.can_access('bucket', NEW.bucket_id, 'edit', NEW.owner_id) THEN RETURN NEW; END IF;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (NEW.workspace_id, 'task', NEW.id, 'member', NEW.owner_id, 'edit', public.perm_actor_id())
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET level = 'edit';
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.tasks_notify_spine()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM auth.uid())
     OR (TG_OP = 'UPDATE' AND NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id
         AND NEW.owner_id IS DISTINCT FROM auth.uid()) THEN
    BEGIN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.assigned',
        jsonb_build_object('mentioned_user_ids', jsonb_build_array(NEW.owner_id::text), 'title', NEW.title));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks_notify_spine: assigned notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.share_bucket_after()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_level text;
BEGIN
  IF NEW.is_system THEN RETURN NEW; END IF;
  SELECT buckets INTO v_level FROM public.workspace_share_defaults WHERE workspace_id = NEW.workspace_id;
  PERFORM public.share_grant_workspace(NEW.workspace_id, 'bucket', NEW.id, coalesce(v_level, 'edit'));
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.share_sync_note_flag()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_type text := CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_type ELSE NEW.resource_type END;
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_id ELSE NEW.resource_id END;
BEGIN
  IF v_type = 'note' THEN
    UPDATE public.notes SET workspace_shared = EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = v_id AND g.subject_type = 'workspace'
    ) WHERE id = v_id;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$function$;

CREATE FUNCTION public.tasks_enforce_one_level_subtasks()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks p
    WHERE p.id = NEW.parent_id AND p.workspace_id = NEW.workspace_id AND p.parent_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Subtasks are one level: the parent must be a top-level task in the same workspace';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tasks c WHERE c.parent_id = NEW.id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Subtasks are one level: a task with subtasks cannot become a subtask';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.tasks_relations_mirror_to_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.entity_links
      SET deleted_at = now()
      WHERE workspace_id = OLD.workspace_id
        AND relation_kind = 'blocks'
        AND deleted_at IS NULL
        AND pair_key = public.spine_pair_key('task', OLD.blocker_task_id, 'task', OLD.blocked_task_id);
    RETURN OLD;
  END IF;
  RETURN NULL;  -- the INSERT mirror isn't exercised by the probe
END;
$$;

-- share_member_removed as production has it today; the migration replaces it.
CREATE FUNCTION public.share_member_removed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_name text;
BEGIN
  SELECT owner_id INTO v_owner FROM public.workspaces WHERE id = OLD.workspace_id AND deleted_at IS NULL;
  IF v_owner IS NULL OR v_owner = OLD.user_id THEN RETURN OLD; END IF;
  PERFORM set_config('share.bypass', '1', true);
  SELECT coalesce(nullif(btrim(display_name), ''), 'Member') INTO v_name
  FROM public.profiles WHERE id = OLD.user_id;
  v_name := coalesce(v_name, 'Member');
  UPDATE public.notes SET
    created_by = v_owner,
    title = 'From ' || v_name || ' (archived) ' || title
  WHERE workspace_id = OLD.workspace_id AND created_by = OLD.user_id AND deleted_at IS NULL
    AND share_mode = 'custom'
    AND NOT EXISTS (SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = notes.id AND g.subject_type = 'workspace');
  UPDATE public.buckets SET
    owner_id = v_owner,
    name = 'From ' || v_name || ' (archived) ' || name
  WHERE workspace_id = OLD.workspace_id AND owner_id = OLD.user_id AND deleted_at IS NULL
    AND is_system = false
    AND NOT EXISTS (SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'bucket' AND g.resource_id = buckets.id AND g.subject_type = 'workspace');
  DELETE FROM public.resource_grants
  WHERE subject_type = 'member' AND subject_id = OLD.user_id AND workspace_id = OLD.workspace_id;
  RETURN OLD;
END;
$function$;

-- ── Rows production already has, for the migration's one-time fix ───────────
-- Workspace W0: its owner has no member row, M0 is a member, G0 was removed
-- before the migration and still has a task assigned (a frozen task).
INSERT INTO auth.users (id, email) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'w0-owner@example.com'),
  ('f0000000-0000-4000-8000-000000000002', 'w0-member@example.com'),
  ('f0000000-0000-4000-8000-000000000003', 'w0-gone@example.com');
INSERT INTO public.profiles (id, display_name) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'W0 owner'),
  ('f0000000-0000-4000-8000-000000000002', 'W0 member'),
  ('f0000000-0000-4000-8000-000000000003', 'W0 removed');
INSERT INTO public.workspaces (id, name, owner_id) VALUES
  ('f0000000-0000-4000-8000-000000000000', 'W0', 'f0000000-0000-4000-8000-000000000001');
INSERT INTO public.workspace_members (workspace_id, user_id, perms) VALUES
  ('f0000000-0000-4000-8000-000000000000', 'f0000000-0000-4000-8000-000000000002', ARRAY['tasks.view', 'tasks.edit']);
INSERT INTO public.buckets (id, workspace_id, owner_id, name) VALUES
  ('f0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000000',
   'f0000000-0000-4000-8000-000000000001', 'W0 bucket');
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title) VALUES
  ('f0000000-0000-4000-8000-000000000020', 'f0000000-0000-4000-8000-000000000000',
   'f0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000003', 'frozen: assigned to G0'),
  ('f0000000-0000-4000-8000-000000000021', 'f0000000-0000-4000-8000-000000000000',
   'f0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000002', 'assigned to M0'),
  ('f0000000-0000-4000-8000-000000000022', 'f0000000-0000-4000-8000-000000000000',
   'f0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000001', 'assigned to the owner');

-- ── Triggers (as listed on production) ───────────────────────────────────────

CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('notes');
CREATE TRIGGER notes_share_fields_owner_only BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes_share_fields_owner_only();
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.note_updates
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('notes', 'edit');
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('tasks');
CREATE TRIGGER share_bucket_after AFTER INSERT ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.share_bucket_after();
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('tasks');
CREATE TRIGGER share_task_assign AFTER INSERT OR UPDATE OF owner_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.share_task_assign();
CREATE TRIGGER tasks_notify_spine AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_notify_spine();
CREATE TRIGGER tasks_one_level_subtasks BEFORE INSERT OR UPDATE OF parent_id ON public.tasks
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL) EXECUTE FUNCTION public.tasks_enforce_one_level_subtasks();
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.task_relations
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('tasks', 'edit');
CREATE TRIGGER tasks_relations_mirror_to_links AFTER INSERT OR DELETE ON public.task_relations
  FOR EACH ROW EXECUTE FUNCTION public.tasks_relations_mirror_to_links();
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.task_time_blocks
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('tasks', 'edit');
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('contacts');
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('contacts');
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('calendar');
CREATE TRIGGER perm_enforce_write BEFORE INSERT ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('chat');
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('chat');
CREATE TRIGGER share_sync_note_flag AFTER INSERT OR UPDATE OR DELETE ON public.resource_grants
  FOR EACH ROW EXECUTE FUNCTION public.share_sync_note_flag();
CREATE TRIGGER share_member_removed AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.share_member_removed();
