-- NR-1 rehearsal replica: a local Postgres 17 database shaped like PROD for
-- the objects 20261013120000_notes_refresh_organize.sql touches.
--
-- Built 2026-10-13 from PROD's catalog (read-only SELECTs only):
--   * column lists/defaults/NOT NULL from information_schema.columns,
--   * constraints from pg_constraint, triggers from pg_get_triggerdef,
--   * function bodies from pg_get_functiondef (copied verbatim, marked REAL).
-- No prod table rows were read or copied; the seed below is synthetic.
-- Deep or out-of-scope callees are STUBS, controlled by GUCs:
--   request.jwt.claim.sub   auth.uid() (the acting user)
--   replica.notes_perm      module_member_permission() result (default 'edit')
--   replica.owners          comma list of user ids perm_is_owner() is true for
--   replica.denied_perms    comma list of permission keys perm_user_has() denies
--
-- Run:  psql -h 127.0.0.1 -p 54329 -U postgres -d replica -v ON_ERROR_STOP=1 -f replica-setup.sql
-- (after DROP/CREATE DATABASE replica), as the role that will run the migration.

SET client_min_messages = warning;

DO $r$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
DO $r$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
DO $r$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $r$;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase's default privileges (prod pg_default_acl for role postgres, schema
-- public: tables arwdDxtm, functions X, sequences rwU to all three roles).
-- Set BEFORE any object below is created, so they inherit them as on prod.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ── auth ─────────────────────────────────────────────────────────────────────
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ── tables (prod columns, types, defaults, NOT NULL, constraints) ───────────
-- Stand-ins for FK targets that are out of scope.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text
);
CREATE TABLE public.workspace_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE TABLE public.workspaces (
  id         uuid NOT NULL DEFAULT uuid_generate_v4(),
  owner_id   uuid NOT NULL,
  name       text NOT NULL DEFAULT 'My Workspace'::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  icon       text,
  logo_url   text,
  CONSTRAINT workspaces_pkey PRIMARY KEY (id),
  CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT workspaces_icon_len CHECK (((icon IS NULL) OR ((char_length(icon) >= 1) AND (char_length(icon) <= 16))))
);

CREATE TABLE public.workspace_members (
  id                uuid NOT NULL DEFAULT uuid_generate_v4(),
  workspace_id      uuid NOT NULL,
  user_id           uuid NOT NULL,
  role              text NOT NULL DEFAULT 'member'::text,
  permissions_notes text NOT NULL DEFAULT 'write'::text,
  permissions_tasks text NOT NULL DEFAULT 'write'::text,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  permissions_email text,
  role_id           uuid NOT NULL,
  overrides         jsonb NOT NULL DEFAULT '{}'::jsonb,
  perms             text[] NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT workspace_members_pkey PRIMARY KEY (id),
  CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id),
  CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT workspace_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.workspace_roles(id),
  CONSTRAINT workspace_members_permissions_notes_check CHECK ((permissions_notes = ANY (ARRAY['write'::text, 'read'::text, 'none'::text]))),
  CONSTRAINT workspace_members_permissions_tasks_check CHECK ((permissions_tasks = ANY (ARRAY['write'::text, 'read'::text, 'none'::text]))),
  CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text])))
);

CREATE TABLE public.workspace_share_defaults (
  workspace_id uuid NOT NULL,
  notes     text NOT NULL DEFAULT 'edit'::text,
  buckets   text NOT NULL DEFAULT 'edit'::text,
  calendars text NOT NULL DEFAULT 'freebusy'::text,
  contacts  text NOT NULL DEFAULT 'private'::text,
  CONSTRAINT workspace_share_defaults_pkey PRIMARY KEY (workspace_id),
  CONSTRAINT workspace_share_defaults_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT workspace_share_defaults_notes_check CHECK ((notes = ANY (ARRAY['private'::text, 'view'::text, 'edit'::text, 'full'::text])))
);

CREATE TABLE public.notes (
  id               uuid NOT NULL DEFAULT uuid_generate_v4(),
  workspace_id     uuid NOT NULL,
  created_by       uuid,
  title            text NOT NULL DEFAULT ''::text,
  parent_id        uuid,
  "position"       text NOT NULL DEFAULT '0',
  doc_state        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  icon             text,
  kind             text NOT NULL DEFAULT 'note'::text,
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_pinned        boolean NOT NULL DEFAULT false,
  is_archived      boolean NOT NULL DEFAULT false,
  share_scope      text NOT NULL DEFAULT 'private'::text,
  share_permission text NOT NULL DEFAULT 'view'::text,
  body_text        text NOT NULL DEFAULT ''::text,
  body_md          text NOT NULL DEFAULT ''::text,
  doc_version      integer NOT NULL DEFAULT 0,
  published_at     timestamptz,
  publish_token    text,
  search_tsv       tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('simple'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, "left"(COALESCE(body_text, ''::text), 150000)), 'B'::"char"))) STORED,
  share_mode       text NOT NULL DEFAULT 'custom'::text,
  workspace_shared boolean NOT NULL DEFAULT false,
  CONSTRAINT notes_pkey PRIMARY KEY (id),
  CONSTRAINT notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT notes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.notes(id) ON DELETE SET NULL,
  CONSTRAINT notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT notes_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'section'::text]))),
  CONSTRAINT notes_share_mode_chk CHECK ((share_mode = ANY (ARRAY['inherit'::text, 'custom'::text]))),
  CONSTRAINT notes_share_permission_check CHECK ((share_permission = ANY (ARRAY['view'::text, 'edit'::text]))),
  CONSTRAINT notes_share_scope_check CHECK ((share_scope = ANY (ARRAY['private'::text, 'workspace'::text, 'selected'::text])))
);
CREATE INDEX idx_notes_parent_id ON public.notes USING btree (parent_id);
CREATE INDEX idx_notes_workspace_id ON public.notes USING btree (workspace_id);
CREATE UNIQUE INDEX notes_publish_token_key ON public.notes USING btree (publish_token) WHERE (publish_token IS NOT NULL);

CREATE TABLE public.note_updates (
  id           bigint GENERATED BY DEFAULT AS IDENTITY,
  workspace_id uuid NOT NULL,
  note_id      uuid NOT NULL,
  client_id    text NOT NULL,
  client_seq   integer NOT NULL,
  update_b64   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_updates_pkey PRIMARY KEY (id),
  CONSTRAINT note_updates_note_id_client_id_client_seq_key UNIQUE (note_id, client_id, client_seq),
  CONSTRAINT note_updates_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE,
  CONSTRAINT note_updates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

CREATE TABLE public.resource_grants (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id   uuid NOT NULL,
  subject_type  text NOT NULL,
  subject_id    uuid,
  level         text NOT NULL,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  subject_key   uuid GENERATED ALWAYS AS (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  origin        text NOT NULL DEFAULT 'manual'::text,
  manual_level  text,
  CONSTRAINT resource_grants_pkey PRIMARY KEY (id),
  CONSTRAINT resource_grants_resource_type_resource_id_subject_type_subj_key UNIQUE (resource_type, resource_id, subject_type, subject_key),
  CONSTRAINT resource_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT resource_grants_level_check CHECK ((level = ANY (ARRAY['freebusy'::text, 'view'::text, 'edit'::text, 'full'::text]))),
  CONSTRAINT resource_grants_manual_level_check CHECK (((manual_level IS NULL) OR ((origin = 'assign'::text) AND (manual_level = ANY (ARRAY['freebusy'::text, 'view'::text]))))),
  CONSTRAINT resource_grants_origin_check CHECK ((origin = ANY (ARRAY['assign'::text, 'manual'::text]))),
  CONSTRAINT resource_grants_resource_type_check CHECK ((resource_type = ANY (ARRAY['note'::text, 'bucket'::text, 'task'::text, 'calendar'::text, 'contact'::text, 'contact_group'::text, 'channel'::text]))),
  CONSTRAINT resource_grants_subject_shape CHECK ((((subject_type = 'workspace'::text) AND (subject_id IS NULL)) OR ((subject_type = 'member'::text) AND (subject_id IS NOT NULL)) OR (subject_type = 'public_link'::text))),
  CONSTRAINT resource_grants_subject_type_check CHECK ((subject_type = ANY (ARRAY['member'::text, 'workspace'::text, 'public_link'::text])))
);

-- prod ACLs: resource_grants has no anon grant; notes keeps all four.
REVOKE ALL ON public.resource_grants FROM anon;
-- prod: RLS on for notes (policies out of scope; definer ops bypass them).
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY replica_notes_read ON public.notes FOR SELECT TO authenticated USING (true);

-- Local sink for the module_activity_log stub.
CREATE TABLE public.replica_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid, module text, entity_type text, entity_id uuid, action text, payload jsonb,
  actor uuid DEFAULT auth.uid(), at timestamptz DEFAULT clock_timestamp()
);

-- ── STUBS (deep or out of scope) ─────────────────────────────────────────────
CREATE FUNCTION public.module_api_key_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.module_api_key_creator() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.module_api_key_scope(p_workspace_id uuid, p_module text, p_lane text) RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT 'none'::text $$;
CREATE FUNCTION public.perm_is_owner(p_workspace_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT p_user_id IS NOT NULL
     AND p_user_id::text = ANY (string_to_array(coalesce(current_setting('replica.owners', true), ''), ','))
$$;
CREATE FUNCTION public.perm_user_has(p_workspace_id uuid, p_user_id uuid, p_key text) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT p_user_id IS NOT NULL
     AND NOT (p_key = ANY (string_to_array(coalesce(current_setting('replica.denied_perms', true), ''), ',')))
$$;
CREATE FUNCTION public.module_member_permission(p_workspace_id uuid, p_user_id uuid, p_lane text) RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_user_id IS NULL THEN 'none'
              ELSE coalesce(nullif(current_setting('replica.notes_perm', true), ''), 'edit') END
$$;
CREATE FUNCTION public.chat_has_cap(p_workspace_id uuid, p_user_id uuid, p_cap text) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.entities_op_upsert(p_workspace_id uuid, p_type text, p_id uuid, p_label text, p_module text)
  RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.module_activity_log(p_workspace_id uuid, p_module text, p_entity_type text, p_entity_id uuid, p_action text, p_payload jsonb)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.replica_activity (workspace_id, module, entity_type, entity_id, action, payload)
  VALUES (p_workspace_id, p_module, p_entity_type, p_entity_id, p_action, p_payload)
$$;

-- ── REAL prod bodies (pg_get_functiondef, 2026-10-13) ────────────────────────

-- REAL
CREATE OR REPLACE FUNCTION public.perm_actor_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(auth.uid(), public.module_api_key_creator())
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.grant_level_rank(p_level text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_level
    WHEN 'freebusy' THEN 1 WHEN 'view' THEN 2 WHEN 'edit' THEN 3 WHEN 'full' THEN 4
    ELSE 0 END
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.share_direct_rank(p_type text, p_id uuid, p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(max(public.grant_level_rank(g.level)), 0)
  FROM public.resource_grants g
  WHERE g.resource_type = p_type AND g.resource_id = p_id
    AND (
      (g.subject_type = 'member' AND g.subject_id = p_user)
      OR g.subject_type = 'workspace'
    )
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.perm_ceiling_rank(p_workspace_id uuid, p_user_id uuid, p_module text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 0
    WHEN NOT public.perm_user_has(p_workspace_id, p_user_id, p_module || '.view') THEN 0
    WHEN public.perm_user_has(p_workspace_id, p_user_id, p_module || '.delete') THEN 4
    WHEN public.perm_user_has(p_workspace_id, p_user_id, p_module || '.edit') THEN 3
    ELSE 2
  END
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.can_access(p_type text, p_id uuid, p_min text, p_user uuid DEFAULT NULL::uuid)
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
      -- Inherit the bucket. Call the rank by re-entering for 'full' then scaling
      -- is wrong; read the bucket rank directly via a nested check's grant.
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

-- REAL
CREATE OR REPLACE FUNCTION public.share_member_count(p_workspace_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::int FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.share_grant_workspace(p_workspace_id uuid, p_type text, p_id uuid, p_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_level IS NULL OR p_level = 'private' THEN RETURN; END IF;
  IF public.share_member_count(p_workspace_id) < 2 THEN RETURN; END IF;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
  VALUES (p_workspace_id, p_type, p_id, 'workspace', p_level, public.perm_actor_id())
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET level = EXCLUDED.level;
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.share_note_before()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    NEW.share_mode := 'inherit';
  END IF;
  RETURN NEW;
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.share_note_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_level text;
BEGIN
  IF NEW.share_mode = 'inherit' THEN RETURN NEW; END IF;
  SELECT notes INTO v_level FROM public.workspace_share_defaults WHERE workspace_id = NEW.workspace_id;
  PERFORM public.share_grant_workspace(NEW.workspace_id, 'note', NEW.id, coalesce(v_level, 'edit'));
  RETURN NEW;
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.share_sync_note_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

-- REAL
CREATE OR REPLACE FUNCTION public.notes_share_fields_owner_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN NEW;
  END IF;

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

-- REAL
CREATE OR REPLACE FUNCTION public.perm_enforce_write()
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
  v_item   text;   -- 'edit' requirement for items inside a container
  v_assignee uuid; -- tasks: an assignee being set, to check
  v_moved boolean := false; -- tasks: going into a project (new, or a move)
BEGIN
  v_ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_actor := public.perm_actor_id();

  -- Member-removal archive writes notes the actor can't open. The removal
  -- function sets this for the rest of its transaction only.
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- System work (service role without a key, cron, migrations).
  IF v_actor IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- A row stays in the workspace it was made in (a NULL workspace included:
  -- checked before the NULL exit below).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'Items can''t move to another workspace.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_ws IS NULL THEN
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

  -- Mirrored external calendar events are the owner's own sync, not edits.
  IF TG_TABLE_NAME = 'calendar_events' THEN
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_account_id ELSE NEW.source_account_id END) IS NOT NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- The first channel of a workspace is chat's own bootstrap (#general).
  IF TG_TABLE_NAME = 'chat_channels' THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_channels c
                   WHERE c.workspace_id = v_ws AND c.id IS DISTINCT FROM coalesce(NEW.id, OLD.id)) THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- Soft delete / restore count as delete. Only tables guarded without a
  -- fixed action, all of which have deleted_at (chat_channels is INSERT-only).
  IF TG_OP = 'UPDATE' AND v_fixed IS NULL AND TG_TABLE_NAME <> 'chat_channels' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := 'delete';
    ELSIF TG_TABLE_NAME = 'chat_messages' THEN
      -- Reactions / thread counters live on the message row; only a body
      -- change is an edit.
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
    -- A task goes only into a project of its own workspace (Edit on a
    -- project elsewhere, say in a workspace of your own, doesn't count).
    IF TG_OP = 'INSERT' THEN
      v_moved := true;
    ELSIF TG_OP = 'UPDATE' THEN
      v_moved := NEW.bucket_id IS DISTINCT FROM OLD.bucket_id;
    END IF;
    IF v_moved AND NEW.bucket_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.buckets b
                       WHERE b.id = NEW.bucket_id AND b.workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'That project is in another workspace.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    ELSE
      -- Tasks are items inside a bucket: Edit covers deleting them.
      IF NOT public.can_access('task', OLD.id, v_item, v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
      END IF;
      -- Moving a task into another bucket needs Edit there too.
      IF TG_OP = 'UPDATE' AND NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
         AND NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    END IF;
    -- Only someone who can work on tasks can be assigned one (TV-D1: the
    -- assignee is assignee_id, no longer owner_id). Checked when the assignee
    -- is set, not on every edit, so a teammate who later became a viewer or
    -- left doesn't freeze the task. An upsert of a row that already exists
    -- arrives here as an INSERT first; its UPDATE pass does the check.
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = NEW.id) THEN
        v_assignee := NEW.assignee_id;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
        v_assignee := NEW.assignee_id;
      END IF;
    END IF;
    IF v_assignee IS NOT NULL AND NOT public.perm_user_has(v_ws, v_assignee, 'tasks.edit') THEN
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
    -- Events are items inside a calendar: Edit covers deleting them.
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

-- REAL
CREATE OR REPLACE FUNCTION public.notes_module_permission(p_workspace_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'notes', 'notes');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'notes');
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.notes_op__guard(p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.notes_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You do not have edit access to notes in this workspace.';
  END IF;
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.notes_op__guard_note(p_workspace_id uuid, p_note_id uuid, p_include_trashed boolean DEFAULT false)
 RETURNS notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  SELECT * INTO n FROM public.notes
    WHERE id = p_note_id AND workspace_id = p_workspace_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found in this workspace.';
  END IF;
  IF NOT p_include_trashed AND n.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This note is in the trash.';
  END IF;
  RETURN n;
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.notes__subtree_ids(p_workspace_id uuid, p_note_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE sub AS (
    SELECT n.id, 1 AS depth FROM public.notes n
      WHERE n.id = p_note_id AND n.workspace_id = p_workspace_id
    UNION ALL
    SELECT n.id, sub.depth + 1 FROM public.notes n
      JOIN sub ON n.parent_id = sub.id
      WHERE n.workspace_id = p_workspace_id
        AND sub.depth < 100
  )
  SELECT DISTINCT id FROM sub;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.notes_op_create(p_workspace_id uuid, p_id uuid DEFAULT NULL::uuid, p_parent_id uuid DEFAULT NULL::uuid, p_title text DEFAULT ''::text, p_position text DEFAULT ''::text, p_icon text DEFAULT NULL::text)
 RETURNS notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notes
      WHERE id = p_parent_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Parent note not found in this workspace.';
    END IF;
  END IF;
  INSERT INTO public.notes
    (id, workspace_id, created_by, parent_id, title, icon, kind, position)
  VALUES
    (coalesce(p_id, gen_random_uuid()), p_workspace_id, auth.uid(), p_parent_id,
     coalesce(p_title, ''), p_icon, 'note', coalesce(p_position, ''))
  RETURNING * INTO n;

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  RETURN n;
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.notes_op_move(p_workspace_id uuid, p_note_id uuid, p_parent_id uuid DEFAULT NULL::uuid, p_position text DEFAULT ''::text)
 RETURNS notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_old_parent uuid;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  v_old_parent := n.parent_id;

  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notes
      WHERE id = p_parent_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Target parent not found in this workspace.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.notes__subtree_ids(p_workspace_id, p_note_id) s
      WHERE s = p_parent_id
    ) THEN
      RAISE EXCEPTION 'A note cannot be moved into its own subtree.';
    END IF;
  END IF;

  UPDATE public.notes
    SET parent_id = p_parent_id,
        position = coalesce(p_position, ''),
        updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;

  IF v_old_parent IS DISTINCT FROM p_parent_id THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.move',
      jsonb_build_object('from_parent', v_old_parent, 'to_parent', p_parent_id));
  END IF;
  RETURN n;
END;
$function$;

-- REAL (prod's current; contains perm_actor_id(), so the migration's guard passes)
CREATE OR REPLACE FUNCTION public.notes_op_import(p_workspace_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_id uuid;
  v_first uuid;
  v_imported integer := 0;
  v_skipped integer := 0;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Import rows must be an array.';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := coalesce(nullif(r.value ->> 'id', '')::uuid, gen_random_uuid());
      IF EXISTS (SELECT 1 FROM public.notes WHERE id = v_id) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.notes
        (id, workspace_id, created_by, parent_id, title, icon, kind, position,
         doc_state, body_text, body_md)
      VALUES
        (v_id, p_workspace_id, public.perm_actor_id(),
         nullif(r.value ->> 'parentId', '')::uuid,
         coalesce(r.value ->> 'title', ''),
         nullif(r.value ->> 'icon', ''),
         'note',
         coalesce(r.value ->> 'position', ''),
         nullif(r.value ->> 'docStateB64', ''),
         coalesce(r.value ->> 'bodyText', ''),
         coalesce(r.value ->> 'bodyMd', ''));
      PERFORM public.entities_op_upsert(
        p_workspace_id, 'note', v_id,
        coalesce(nullif(btrim(r.value ->> 'title'), ''), 'Untitled'), 'note');
      IF v_first IS NULL THEN v_first := v_id; END IF;
      v_imported := v_imported + 1;
    EXCEPTION WHEN data_exception OR not_null_violation OR check_violation
      OR foreign_key_violation OR invalid_text_representation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  IF v_imported > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', v_first, 'notes.import',
      jsonb_build_object('imported', v_imported, 'skipped', v_skipped));
  END IF;
  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.notes_op_set_meta(p_workspace_id uuid, p_note_id uuid, p_patch jsonb)
 RETURNS notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  UPDATE public.notes SET
    icon = CASE WHEN p_patch ? 'icon'
      THEN nullif(p_patch ->> 'icon', '') ELSE icon END,
    is_pinned = CASE WHEN p_patch ? 'isPinned'
      THEN coalesce((p_patch ->> 'isPinned')::boolean, false) ELSE is_pinned END,
    updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;
  IF p_patch ? 'icon' THEN
    PERFORM public.entities_op_upsert(
      p_workspace_id, 'note', n.id,
      coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  END IF;
  RETURN n;
END;
$function$;

-- REAL
CREATE OR REPLACE FUNCTION public.notes_op_duplicate(p_workspace_id uuid, p_source_note_id uuid, p_position text DEFAULT ''::text)
 RETURNS notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src public.notes;
  n public.notes;
BEGIN
  -- The copy carries the whole note, so only from a note the caller can open.
  -- Checked before the guard reads (and locks) the row, so a hidden note gets
  -- the same answer as a missing one, trashed or not.
  PERFORM public.notes_op__guard(p_workspace_id);
  IF NOT coalesce(public.can_access('note', p_source_note_id, 'view'), false) THEN
    RAISE EXCEPTION 'Note not found in this workspace.';
  END IF;
  src := public.notes_op__guard_note(p_workspace_id, p_source_note_id);
  INSERT INTO public.notes
    (workspace_id, created_by, parent_id, title, icon, kind, position,
     doc_state, doc_version, body_text, body_md)
  VALUES
    (p_workspace_id, auth.uid(), src.parent_id,
     CASE WHEN btrim(src.title) = '' THEN '' ELSE src.title || ' (copy)' END,
     src.icon, 'note', coalesce(nullif(p_position, ''), src.position),
     src.doc_state, src.doc_version, src.body_text, src.body_md)
  RETURNING * INTO n;

  -- The un-compacted update tail is part of the doc — copy it or the
  -- duplicate silently lacks everything typed since the last compaction.
  INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
  SELECT u.workspace_id, n.id, u.client_id, u.client_seq, u.update_b64
    FROM public.note_updates u WHERE u.note_id = src.id;

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.duplicate',
    jsonb_build_object('source_note_id', src.id, 'title', n.title));
  RETURN n;
END;
$function$;

-- Prod function ACLs (proacl): ops + can_access are postgres/authenticated/
-- service_role only; perm_actor_id is postgres/service_role only.
DO $acl$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.can_access(text,uuid,text,uuid)',
    'public.notes_op_create(uuid,uuid,uuid,text,text,text)',
    'public.notes_op_duplicate(uuid,uuid,text)',
    'public.notes_op_import(uuid,jsonb)',
    'public.notes_op_move(uuid,uuid,uuid,text)',
    'public.notes_op_set_meta(uuid,uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
  END LOOP;
END $acl$;
REVOKE ALL ON FUNCTION public.perm_actor_id() FROM PUBLIC, anon, authenticated;

-- ── prod triggers (pg_get_triggerdef, verbatim) ──────────────────────────────
CREATE TRIGGER notes_share_fields_owner_only BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION notes_share_fields_owner_only();
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR DELETE OR UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION perm_enforce_write('notes');
CREATE TRIGGER share_note_after AFTER INSERT ON public.notes FOR EACH ROW EXECUTE FUNCTION share_note_after();
CREATE TRIGGER share_note_before BEFORE INSERT ON public.notes FOR EACH ROW EXECUTE FUNCTION share_note_before();
CREATE TRIGGER perm_enforce_write BEFORE INSERT OR DELETE OR UPDATE ON public.note_updates FOR EACH ROW EXECUTE FUNCTION perm_enforce_write('notes', 'edit');
CREATE TRIGGER share_sync_note_flag AFTER INSERT OR DELETE OR UPDATE ON public.resource_grants FOR EACH ROW EXECUTE FUNCTION share_sync_note_flag();

-- ── synthetic seed (no prod rows) ────────────────────────────────────────────
-- Users: A creator of the shared root, B and C members.
--   A = aaaaaaaa-0000-0000-0000-000000000001
--   B = bbbbbbbb-0000-0000-0000-000000000002
--   C = cccccccc-0000-0000-0000-000000000003
-- Workspace W = 00000000-0000-0000-0000-0000000000a1 (share default notes='edit').
-- Inserted as postgres with no actor set, so perm_enforce_write lets them in
-- the way existing data is already there; the real share_note_before/after
-- triggers give children `inherit` and roots a workspace 'edit' grant.
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002'),
  ('cccccccc-0000-0000-0000-000000000003');
INSERT INTO public.profiles (id, display_name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'B'),
  ('cccccccc-0000-0000-0000-000000000003', 'C');
INSERT INTO public.workspace_roles (id) VALUES ('0000000f-0000-0000-0000-000000000001');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Replica');
INSERT INTO public.workspace_share_defaults (workspace_id, notes) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'edit');
INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id, perms) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner',  '0000000f-0000-0000-0000-000000000001', '{notes.view,notes.create,notes.edit,notes.delete}'),
  ('00000000-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-000000000002', 'member', '0000000f-0000-0000-0000-000000000001', '{notes.view,notes.create,notes.edit,notes.delete}'),
  ('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000003', 'member', '0000000f-0000-0000-0000-000000000001', '{notes.view,notes.create,notes.edit,notes.delete}');

-- Notes (ids 10000000-…-000N):
--   1 P    shared root page by A (custom; workspace 'edit' grant via trigger)
--   2 K    child of P by B (inherit)
--   3 G    child of K by A (inherit)
--   4 L    loose root by A
--   5 PIN  pinned root by B
--   6 ARC  archived root by A
--   7 TR   root by A whose only child is trashed
--   8 TRC  trashed child of TR
--   9 PRV  private root by C (custom, workspace grant removed below), pinned
INSERT INTO public.notes (id, workspace_id, created_by, parent_id, title, position, is_pinned, is_archived, deleted_at, created_at, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',NULL,'P shared root','a1',false,false,NULL,'2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','K child by B','a1',false,false,NULL,'2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','G grandchild by A','a1',false,false,NULL,'2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',NULL,'L loose root','a2',false,false,NULL,'2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000002',NULL,'PIN pinned root','a3',true,false,NULL,'2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',NULL,'ARC archived root','a4',false,true,NULL,'2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',NULL,'TR root w/ trashed child','a5',false,false,NULL,'2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','TRC trashed child','a1',false,false,'2026-02-01','2026-01-01','2026-01-01'),
  ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-000000000003',NULL,'PRV private root by C','a6',true,false,NULL,'2026-01-01','2026-01-01');
-- C made PRV private: drop its default workspace grant.
DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = '10000000-0000-0000-0000-000000000009';
-- The trigger UPDATEs above (workspace_shared) did not touch updated_at; pin it anyway.
UPDATE public.notes SET updated_at = '2026-01-01';

-- One un-compacted update on P so duplicate's tail copy is exercised.
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64) VALUES
  ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','client-x',1,'AAAA');
