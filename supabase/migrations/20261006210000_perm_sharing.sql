-- PERM-3…8 + PERM-2b. One grants table for notes, buckets, tasks, calendars,
-- contacts, contact groups, and channels. Access = role ceiling ∩ grant,
-- with inheritance (sub-note → parent, task → bucket, contact → group).
-- specs/permissions.md

-- ── vocabulary ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.resource_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('note','bucket','task','calendar','contact','contact_group','channel')),
  resource_id   uuid NOT NULL,
  subject_type  text NOT NULL CHECK (subject_type IN ('member','workspace','public_link')),
  subject_id    uuid,
  level         text NOT NULL CHECK (level IN ('freebusy','view','edit','full')),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  subject_key   uuid GENERATED ALWAYS AS (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  CONSTRAINT resource_grants_subject_shape CHECK (
    (subject_type = 'workspace' AND subject_id IS NULL)
    OR (subject_type = 'member' AND subject_id IS NOT NULL)
    OR subject_type = 'public_link'
  ),
  UNIQUE (resource_type, resource_id, subject_type, subject_key)
);

CREATE INDEX IF NOT EXISTS resource_grants_resource_idx
  ON public.resource_grants (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS resource_grants_subject_idx
  ON public.resource_grants (subject_id);

ALTER TABLE public.resource_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resource_grants FROM PUBLIC, anon;
GRANT SELECT ON public.resource_grants TO authenticated;
GRANT ALL ON public.resource_grants TO service_role;

DROP POLICY IF EXISTS resource_grants_read ON public.resource_grants;
CREATE POLICY resource_grants_read ON public.resource_grants
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id));

CREATE TABLE IF NOT EXISTS public.workspace_share_defaults (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,
  notes        text NOT NULL DEFAULT 'edit' CHECK (notes IN ('private','view','edit','full')),
  buckets      text NOT NULL DEFAULT 'edit' CHECK (buckets IN ('private','view','edit','full')),
  calendars    text NOT NULL DEFAULT 'freebusy' CHECK (calendars IN ('private','freebusy','view','edit','full')),
  contacts     text NOT NULL DEFAULT 'private' CHECK (contacts IN ('private','view','edit','full'))
);

ALTER TABLE public.workspace_share_defaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_share_defaults FROM PUBLIC, anon;
GRANT SELECT ON public.workspace_share_defaults TO authenticated;
GRANT ALL ON public.workspace_share_defaults TO service_role;
DROP POLICY IF EXISTS workspace_share_defaults_read ON public.workspace_share_defaults;
CREATE POLICY workspace_share_defaults_read ON public.workspace_share_defaults
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id));

INSERT INTO public.workspace_share_defaults (workspace_id)
SELECT id FROM public.workspaces
ON CONFLICT DO NOTHING;

-- ── level math ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.grant_level_rank(p_level text)
RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level
    WHEN 'freebusy' THEN 1 WHEN 'view' THEN 2 WHEN 'edit' THEN 3 WHEN 'full' THEN 4
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.perm_ceiling_rank(p_workspace_id uuid, p_user_id uuid, p_module text)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 0
    WHEN NOT public.perm_user_has(p_workspace_id, p_user_id, p_module || '.view') THEN 0
    WHEN public.perm_user_has(p_workspace_id, p_user_id, p_module || '.delete') THEN 4
    WHEN public.perm_user_has(p_workspace_id, p_user_id, p_module || '.edit') THEN 3
    ELSE 2
  END
$$;

CREATE OR REPLACE FUNCTION public.share_direct_rank(p_type text, p_id uuid, p_user uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(max(public.grant_level_rank(g.level)), 0)
  FROM public.resource_grants g
  WHERE g.resource_type = p_type AND g.resource_id = p_id
    AND (
      (g.subject_type = 'member' AND g.subject_id = p_user)
      OR g.subject_type = 'workspace'
    )
$$;

CREATE OR REPLACE FUNCTION public.share_member_count(p_workspace_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id
$$;

-- ── can_access ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_access(
  p_type text,
  p_id uuid,
  p_min text,
  p_user uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.can_access(text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access(text, uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_can(p_type text, p_id uuid, p_min text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access(p_type, p_id, p_min, public.perm_actor_id())
$$;
REVOKE ALL ON FUNCTION public.share_can(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_can(text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_visible_ids(p_workspace_id uuid, p_resource_type text)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.perm_actor_id();
BEGIN
  IF p_resource_type = 'note' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.notes n
      WHERE n.workspace_id = p_workspace_id AND public.can_access('note', n.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'task' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.tasks t
      WHERE t.workspace_id = p_workspace_id AND public.can_access('task', t.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'contact' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND public.can_access('contact', c.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'calendar' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.calendars c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND public.can_access('calendar', c.id, 'view', v_user)), '{}');
  ELSE
    RETURN '{}';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.share_visible_ids(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_visible_ids(uuid, text) TO authenticated, service_role;

-- ── note / contact columns ───────────────────────────────────────────────────

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS share_mode text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS workspace_shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_share_mode_chk;
ALTER TABLE public.notes ADD CONSTRAINT notes_share_mode_chk CHECK (share_mode IN ('inherit','custom'));

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual';
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_origin_chk;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_origin_chk CHECK (origin IN ('manual','booking'));

UPDATE public.notes n SET created_by = w.owner_id
FROM public.workspaces w
WHERE n.workspace_id = w.id AND n.created_by IS NULL;

-- Booking-created contacts (born with the booking) stay private.
UPDATE public.contacts c SET origin = 'booking'
WHERE c.origin = 'manual'
  AND EXISTS (
    SELECT 1 FROM public.slot_bookings b
    WHERE b.contact_id = c.id
      AND c.created_at BETWEEN b.created_at - interval '2 minutes' AND b.created_at + interval '2 minutes'
  );

-- ── calendars, groups, chat caps, hosts ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.calendars (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id       uuid NOT NULL,
  name           text NOT NULL DEFAULT 'Calendar',
  color          text,
  kind           text NOT NULL CHECK (kind IN ('moduo','custom','integration')),
  account_id     uuid REFERENCES public.calendar_accounts (id) ON DELETE CASCADE,
  publish_token  text,
  publish_level  text CHECK (publish_level IN ('freebusy','view')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS calendars_moduo_owner_idx
  ON public.calendars (workspace_id, owner_id) WHERE kind = 'moduo' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS calendars_account_idx
  ON public.calendars (account_id) WHERE account_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS calendars_publish_token_idx
  ON public.calendars (publish_token) WHERE publish_token IS NOT NULL;

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS calendar_ref uuid REFERENCES public.calendars (id) ON DELETE SET NULL;

ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendars FROM PUBLIC, anon;
GRANT SELECT ON public.calendars TO authenticated;
GRANT ALL ON public.calendars TO service_role;
DROP POLICY IF EXISTS calendars_read ON public.calendars;
CREATE POLICY calendars_read ON public.calendars
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_access('calendar', id, 'freebusy'));

CREATE TABLE IF NOT EXISTS public.calendar_sets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.calendar_set_items (
  set_id      uuid NOT NULL REFERENCES public.calendar_sets (id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES public.calendars (id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, calendar_id)
);
ALTER TABLE public.calendar_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_set_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_sets, public.calendar_set_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_set_items TO authenticated;
GRANT ALL ON public.calendar_sets, public.calendar_set_items TO service_role;
DROP POLICY IF EXISTS calendar_sets_owner ON public.calendar_sets;
CREATE POLICY calendar_sets_owner ON public.calendar_sets
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS calendar_set_items_owner ON public.calendar_set_items;
CREATE POLICY calendar_set_items_owner ON public.calendar_set_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.calendar_sets s WHERE s.id = set_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.calendar_sets s WHERE s.id = set_id AND s.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.contact_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE TABLE IF NOT EXISTS public.contact_group_members (
  group_id   uuid NOT NULL REFERENCES public.contact_groups (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, contact_id)
);
CREATE TABLE IF NOT EXISTS public.contact_private_notes (
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  body       text NOT NULL DEFAULT '',
  PRIMARY KEY (contact_id, user_id)
);
ALTER TABLE public.contact_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_private_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_groups, public.contact_group_members, public.contact_private_notes FROM PUBLIC, anon;
GRANT SELECT ON public.contact_groups, public.contact_group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_private_notes TO authenticated;
GRANT ALL ON public.contact_groups, public.contact_group_members, public.contact_private_notes TO service_role;
DROP POLICY IF EXISTS contact_groups_read ON public.contact_groups;
CREATE POLICY contact_groups_read ON public.contact_groups
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_access('contact_group', id, 'view'));
DROP POLICY IF EXISTS contact_group_members_read ON public.contact_group_members;
CREATE POLICY contact_group_members_read ON public.contact_group_members
  FOR SELECT TO authenticated
  USING (public.can_access('contact_group', group_id, 'view'));
DROP POLICY IF EXISTS contact_private_notes_own ON public.contact_private_notes;
CREATE POLICY contact_private_notes_own ON public.contact_private_notes
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.workspace_chat_caps (
  workspace_id      uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  role_key          text NOT NULL CHECK (role_key IN ('admin','member','viewer')),
  create_public     boolean NOT NULL DEFAULT false,
  create_private    boolean NOT NULL DEFAULT false,
  manage_any        boolean NOT NULL DEFAULT false,
  delete_others     boolean NOT NULL DEFAULT false,
  mention_everyone  boolean NOT NULL DEFAULT false,
  post              boolean NOT NULL DEFAULT false,
  start_calls       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, role_key)
);
ALTER TABLE public.workspace_chat_caps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_chat_caps FROM PUBLIC, anon;
GRANT SELECT ON public.workspace_chat_caps TO authenticated;
GRANT ALL ON public.workspace_chat_caps TO service_role;
DROP POLICY IF EXISTS workspace_chat_caps_read ON public.workspace_chat_caps;
CREATE POLICY workspace_chat_caps_read ON public.workspace_chat_caps
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id));

INSERT INTO public.workspace_chat_caps (
  workspace_id, role_key, create_public, create_private, manage_any, delete_others, mention_everyone, post, start_calls
)
SELECT w.id, r.role_key,
  r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key = 'admin', r.role_key = 'admin',
  r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key <> 'viewer'
FROM public.workspaces w
CROSS JOIN (VALUES ('admin'), ('member'), ('viewer')) AS r(role_key)
ON CONFLICT DO NOTHING;

ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS managers_only boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.chat_channel_managers (
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
ALTER TABLE public.chat_channel_managers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_channel_managers FROM PUBLIC, anon;
GRANT SELECT ON public.chat_channel_managers TO authenticated;
GRANT ALL ON public.chat_channel_managers TO service_role;
DROP POLICY IF EXISTS chat_channel_managers_read ON public.chat_channel_managers;
CREATE POLICY chat_channel_managers_read ON public.chat_channel_managers
  FOR SELECT TO authenticated
  USING (public.chat_can_read_channel(channel_id));

INSERT INTO public.chat_channel_managers (channel_id, user_id)
SELECT id, created_by FROM public.chat_channels
WHERE created_by IS NOT NULL AND kind = 'channel'
ON CONFLICT DO NOTHING;

ALTER TABLE public.workspace_invites
  ADD COLUMN IF NOT EXISTS share_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.booking_link_hosts (
  link_id  uuid NOT NULL REFERENCES public.exposed_slot_links (id) ON DELETE CASCADE,
  user_id  uuid NOT NULL,
  status   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  PRIMARY KEY (link_id, user_id)
);
ALTER TABLE public.exposed_slot_links
  ADD COLUMN IF NOT EXISTS collective boolean NOT NULL DEFAULT false;
ALTER TABLE public.booking_link_hosts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_link_hosts FROM PUBLIC, anon;
GRANT SELECT ON public.booking_link_hosts TO authenticated;
GRANT ALL ON public.booking_link_hosts TO service_role;
DROP POLICY IF EXISTS booking_link_hosts_read ON public.booking_link_hosts;
CREATE POLICY booking_link_hosts_read ON public.booking_link_hosts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.exposed_slot_links l
      WHERE l.id = link_id AND l.owner_user_id = auth.uid()::text
    )
  );

-- ── seed calendars + backfill grants (collaborative workspaces only) ────────

INSERT INTO public.calendars (workspace_id, owner_id, name, kind)
SELECT m.workspace_id, m.user_id, 'Moduo', 'moduo'
FROM public.workspace_members m
ON CONFLICT DO NOTHING;

INSERT INTO public.calendars (workspace_id, owner_id, name, kind, account_id)
SELECT a.workspace_id, a.owner_id,
  coalesce(nullif(btrim(a.display_label), ''), 'Calendar'),
  'integration', a.id
FROM public.calendar_accounts a
WHERE a.deleted_at IS NULL AND a.owner_id IS NOT NULL AND a.workspace_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE public.calendar_events e
SET calendar_ref = c.id
FROM public.calendars c
WHERE e.calendar_ref IS NULL
  AND c.deleted_at IS NULL
  AND c.workspace_id = e.workspace_id
  AND c.owner_id = e.owner_id
  AND c.kind = 'moduo'
  AND e.source_account_id IS NULL;

UPDATE public.calendar_events e
SET calendar_ref = c.id
FROM public.calendars c
WHERE e.calendar_ref IS NULL
  AND c.account_id = e.source_account_id
  AND c.deleted_at IS NULL;

-- Nothing disappears in a workspace that already has two people.
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level)
SELECT n.workspace_id, 'note', n.id, 'workspace', 'edit'
FROM public.notes n
WHERE public.share_member_count(n.workspace_id) >= 2
ON CONFLICT DO NOTHING;

UPDATE public.notes n SET workspace_shared = true
WHERE EXISTS (
  SELECT 1 FROM public.resource_grants g
  WHERE g.resource_type = 'note' AND g.resource_id = n.id AND g.subject_type = 'workspace'
);

INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level)
SELECT b.workspace_id, 'bucket', b.id, 'workspace', 'edit'
FROM public.buckets b
WHERE b.is_system = false AND b.deleted_at IS NULL
  AND public.share_member_count(b.workspace_id) >= 2
ON CONFLICT DO NOTHING;

INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level)
SELECT c.workspace_id, 'contact', c.id, 'workspace', 'edit'
FROM public.contacts c
WHERE c.deleted_at IS NULL AND c.origin <> 'booking'
  AND public.share_member_count(c.workspace_id) >= 2
ON CONFLICT DO NOTHING;

INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level)
SELECT c.workspace_id, 'calendar', c.id, 'workspace', 'freebusy'
FROM public.calendars c
WHERE c.deleted_at IS NULL AND public.share_member_count(c.workspace_id) >= 2
ON CONFLICT DO NOTHING;

-- Tasks someone else owns inside a now-private inbox stay visible to that person.
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level)
SELECT t.workspace_id, 'task', t.id, 'member', t.owner_id, 'edit'
FROM public.tasks t
JOIN public.buckets b ON b.id = t.bucket_id
WHERE b.is_system = true AND t.owner_id IS NOT NULL AND t.owner_id IS DISTINCT FROM b.owner_id
  AND t.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- One Inbox per person. The existing system bucket stays with its owner.
DROP INDEX IF EXISTS public.buckets_one_system_per_workspace_idx;
CREATE UNIQUE INDEX IF NOT EXISTS buckets_one_system_per_owner_idx
  ON public.buckets (workspace_id, owner_id)
  WHERE is_system AND deleted_at IS NULL;

-- ── default grants on create ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.share_grant_workspace(
  p_workspace_id uuid, p_type text, p_id uuid, p_level text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_level IS NULL OR p_level = 'private' THEN RETURN; END IF;
  IF public.share_member_count(p_workspace_id) < 2 THEN RETURN; END IF;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
  VALUES (p_workspace_id, p_type, p_id, 'workspace', p_level, public.perm_actor_id())
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET level = EXCLUDED.level;
END;
$$;

CREATE OR REPLACE FUNCTION public.share_note_before()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    NEW.share_mode := 'inherit';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_note_before ON public.notes;
CREATE TRIGGER share_note_before BEFORE INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.share_note_before();

CREATE OR REPLACE FUNCTION public.share_note_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_level text;
BEGIN
  IF NEW.share_mode = 'inherit' THEN RETURN NEW; END IF;
  SELECT notes INTO v_level FROM public.workspace_share_defaults WHERE workspace_id = NEW.workspace_id;
  PERFORM public.share_grant_workspace(NEW.workspace_id, 'note', NEW.id, coalesce(v_level, 'edit'));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_note_after ON public.notes;
CREATE TRIGGER share_note_after AFTER INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.share_note_after();

CREATE OR REPLACE FUNCTION public.share_bucket_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_level text;
BEGIN
  IF NEW.is_system THEN RETURN NEW; END IF;
  SELECT buckets INTO v_level FROM public.workspace_share_defaults WHERE workspace_id = NEW.workspace_id;
  PERFORM public.share_grant_workspace(NEW.workspace_id, 'bucket', NEW.id, coalesce(v_level, 'edit'));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_bucket_after ON public.buckets;
CREATE TRIGGER share_bucket_after AFTER INSERT ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.share_bucket_after();

CREATE OR REPLACE FUNCTION public.share_contact_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_level text;
BEGIN
  IF NEW.origin = 'booking' THEN RETURN NEW; END IF;
  SELECT contacts INTO v_level FROM public.workspace_share_defaults WHERE workspace_id = NEW.workspace_id;
  PERFORM public.share_grant_workspace(NEW.workspace_id, 'contact', NEW.id, coalesce(v_level, 'private'));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_contact_after ON public.contacts;
CREATE TRIGGER share_contact_after AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.share_contact_after();

CREATE OR REPLACE FUNCTION public.share_task_assign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
DROP TRIGGER IF EXISTS share_task_assign ON public.tasks;
CREATE TRIGGER share_task_assign AFTER INSERT OR UPDATE OF owner_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.share_task_assign();

CREATE OR REPLACE FUNCTION public.share_sync_note_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
DROP TRIGGER IF EXISTS share_sync_note_flag ON public.resource_grants;
CREATE TRIGGER share_sync_note_flag
  AFTER INSERT OR UPDATE OR DELETE ON public.resource_grants
  FOR EACH ROW EXECUTE FUNCTION public.share_sync_note_flag();

-- ── read policies ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.perm_can_see_entity(p_workspace_id uuid, p_type text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_type = 'note' THEN RETURN public.can_access('note', p_id, 'view');
  ELSIF p_type IN ('task', 'task_project') THEN RETURN public.can_access('task', p_id, 'view');
  ELSIF p_type = 'bucket' THEN RETURN public.can_access('bucket', p_id, 'view');
  ELSIF p_type = 'contact' THEN RETURN public.can_access('contact', p_id, 'view');
  ELSIF p_type = 'company' THEN RETURN public.can_access('company', p_id, 'view');
  ELSIF p_type = 'event' THEN RETURN public.can_access('event', p_id, 'view');
  ELSIF p_type = 'email_thread' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_refs r WHERE r.id = p_id AND r.owner_id = public.perm_actor_id());
  ELSIF p_type = 'email_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = p_id AND a.owner_id = public.perm_actor_id());
  ELSIF p_type = 'calendar_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.calendar_accounts a WHERE a.id = p_id AND a.owner_id = public.perm_actor_id());
  ELSE
    RETURN public.perm_can_view_entity(p_workspace_id, p_type);
  END IF;
END;
$$;

DROP POLICY IF EXISTS entities_workspace_read ON public.entities;
CREATE POLICY entities_workspace_read ON public.entities
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND public.perm_can_see_entity(workspace_id, entity_type, entity_id)
  );

DROP POLICY IF EXISTS module_activity_workspace_read ON public.module_activity;
CREATE POLICY module_activity_workspace_read ON public.module_activity
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND (
      (actor_type = 'user' AND actor_id = (SELECT auth.uid()))
      OR public.perm_can_see_entity(workspace_id, entity_type, entity_id)
    )
  );

DROP POLICY IF EXISTS comments_workspace_read ON public.comments;
CREATE POLICY comments_workspace_read ON public.comments
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND public.perm_can_see_entity(workspace_id, entity_type, entity_id)
  );

DROP POLICY IF EXISTS notes_workspace_read ON public.notes;
CREATE POLICY notes_workspace_read ON public.notes
  FOR SELECT TO authenticated USING (public.can_access('note', id, 'view'));

DROP POLICY IF EXISTS note_updates_workspace_read ON public.note_updates;
CREATE POLICY note_updates_workspace_read ON public.note_updates
  FOR SELECT TO authenticated USING (public.can_access('note', note_id, 'view'));

DROP POLICY IF EXISTS tasks_workspace_access ON public.tasks;
CREATE POLICY tasks_workspace_access ON public.tasks
  FOR ALL TO authenticated
  USING (public.can_access('task', id, 'view'))
  WITH CHECK (public.can_access('task', id, 'view') OR public.can_access('bucket', bucket_id, 'edit'));

DROP POLICY IF EXISTS buckets_workspace_access ON public.buckets;
CREATE POLICY buckets_workspace_access ON public.buckets
  FOR ALL TO authenticated
  USING (public.can_access('bucket', id, 'view'))
  WITH CHECK (owner_id = (SELECT auth.uid()) OR public.can_access('bucket', id, 'edit'));

DROP POLICY IF EXISTS contacts_workspace_read ON public.contacts;
CREATE POLICY contacts_workspace_read ON public.contacts
  FOR SELECT TO authenticated USING (public.can_access('contact', id, 'view'));

DROP POLICY IF EXISTS companies_workspace_read ON public.companies;
CREATE POLICY companies_workspace_read ON public.companies
  FOR SELECT TO authenticated USING (public.can_access('company', id, 'view'));

DROP POLICY IF EXISTS calendar_events_owner_read ON public.calendar_events;
CREATE POLICY calendar_events_owner_read ON public.calendar_events
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND public.perm_can_view(workspace_id, 'calendar')
    AND (
      owner_id = (SELECT auth.uid())
      OR (calendar_ref IS NOT NULL AND public.can_access('calendar', calendar_ref, 'view'))
    )
  );

-- ── write enforcement add-on ─────────────────────────────────────────────────

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
  v_need   text;
BEGIN
  v_ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_actor := public.perm_actor_id();

  -- Member-removal archive writes notes the actor can't open. The removal
  -- function sets this for the rest of its transaction only.
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF v_actor IS NULL OR v_ws IS NULL OR public.perm_is_owner(v_ws, v_actor) THEN
    -- Owners still do not see other people's private rows: the bypass here is
    -- the workspace owner acting as themselves on rows they can already reach
    -- through module powers. Per-item checks below still run for owners,
    -- except system jobs with no actor.
    IF v_actor IS NULL OR v_ws IS NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
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
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_account_id ELSE NEW.source_account_id END) IS NOT NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  IF v_module = 'chat' AND TG_TABLE_NAME = 'chat_channels' THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.workspace_id = v_ws AND c.id IS DISTINCT FROM coalesce(NEW.id, OLD.id)) THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_fixed IS NULL AND TG_TABLE_NAME <> 'chat_channels' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := 'delete';
    ELSIF v_module = 'chat' AND NEW.body IS NOT DISTINCT FROM OLD.body THEN
      RETURN NEW;
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

  IF TG_TABLE_NAME = 'notes' AND TG_OP = 'UPDATE' THEN
    IF OLD.publish_token IS NULL AND NEW.publish_token IS NOT NULL
       AND NOT public.perm_user_has(v_ws, v_actor, 'ws.publish') THEN
      RAISE EXCEPTION 'Your role can''t publish to the web in this workspace.' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_need := CASE WHEN v_action = 'delete' THEN 'full' ELSE 'edit' END;

  IF TG_TABLE_NAME = 'notes' AND TG_OP = 'INSERT' AND NEW.parent_id IS NOT NULL THEN
    IF NOT public.can_access('note', NEW.parent_id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'notes' AND TG_OP <> 'INSERT' THEN
    IF NOT public.can_access('note', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'note_updates' THEN
    IF NOT public.can_access('note', NEW.note_id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'buckets' AND TG_OP <> 'INSERT' THEN
    IF NOT public.can_access('bucket', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'tasks' AND TG_OP = 'INSERT' THEN
    IF NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'tasks' AND TG_OP <> 'INSERT' THEN
    IF NOT public.can_access('task', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    NULL;
  ELSIF TG_TABLE_NAME = 'contacts' AND TG_OP <> 'INSERT' THEN
    IF NOT public.can_access('contact', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this contact.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'companies' AND TG_OP <> 'INSERT' THEN
    IF NOT public.can_access('company', OLD.id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this company.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'calendar_events' AND TG_OP <> 'INSERT' AND OLD.source_account_id IS NULL THEN
    IF OLD.owner_id IS DISTINCT FROM v_actor
       AND (OLD.calendar_ref IS NULL OR NOT public.can_access('calendar', OLD.calendar_ref, v_need, v_actor)) THEN
      RAISE EXCEPTION 'You don''t have access to this event.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'tasks' AND TG_OP <> 'DELETE' AND NEW.owner_id IS NOT NULL
     AND NOT public.perm_user_has(v_ws, NEW.owner_id, 'tasks.edit') THEN
    RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'chat_messages' AND v_action = 'delete' AND TG_OP <> 'INSERT' THEN
    IF OLD.author_id IS DISTINCT FROM v_actor
       AND NOT public.chat_has_cap(v_ws, v_actor, 'delete_others') THEN
      RAISE EXCEPTION 'Your role can''t delete other people''s messages.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

-- chat_has_cap is created below; perm_enforce_write calls it at runtime, so
-- the function only has to exist before a write. Created next.

CREATE OR REPLACE FUNCTION public.chat_has_cap(p_workspace_id uuid, p_user uuid, p_cap text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_read_only boolean;
  v_row public.workspace_chat_caps;
BEGIN
  IF p_user IS NULL THEN RETURN false; END IF;
  IF public.perm_is_owner(p_workspace_id, p_user) THEN RETURN true; END IF;
  SELECT r.system_key, r.read_only INTO v_key, v_read_only
  FROM public.workspace_members m
  JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user;
  IF v_read_only OR v_key = 'viewer' THEN v_key := 'viewer';
  ELSIF v_key IS NULL OR v_key NOT IN ('admin','member','viewer') THEN v_key := 'member';
  END IF;
  SELECT * INTO v_row FROM public.workspace_chat_caps
  WHERE workspace_id = p_workspace_id AND role_key = v_key;
  IF v_row.workspace_id IS NULL THEN RETURN false; END IF;
  RETURN CASE p_cap
    WHEN 'create_public' THEN v_row.create_public
    WHEN 'create_private' THEN v_row.create_private
    WHEN 'manage_any' THEN v_row.manage_any
    WHEN 'delete_others' THEN v_row.delete_others
    WHEN 'mention_everyone' THEN v_row.mention_everyone
    WHEN 'post' THEN v_row.post
    WHEN 'start_calls' THEN v_row.start_calls
    ELSE false END;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_has_cap(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_has_cap(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_chat_channel_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'channel' AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.chat_channel_managers (channel_id, user_id)
    VALUES (NEW.id, NEW.created_by) ON CONFLICT DO NOTHING;
    IF NEW.name IS DISTINCT FROM 'general' THEN
      IF NEW.is_private AND NOT public.chat_has_cap(NEW.workspace_id, NEW.created_by, 'create_private') THEN
        RAISE EXCEPTION 'Your role can''t create private channels.' USING ERRCODE = '42501';
      ELSIF NOT NEW.is_private AND NOT public.chat_has_cap(NEW.workspace_id, NEW.created_by, 'create_public') THEN
        RAISE EXCEPTION 'Your role can''t create channels.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_chat_channel_guard ON public.chat_channels;
CREATE TRIGGER share_chat_channel_guard AFTER INSERT ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.share_chat_channel_guard();

CREATE OR REPLACE FUNCTION public.share_chat_message_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel public.chat_channels;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = NEW.channel_id;
  IF NOT public.chat_has_cap(NEW.workspace_id, NEW.author_id, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.managers_only
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_channel_managers m
       WHERE m.channel_id = NEW.channel_id AND m.user_id = NEW.author_id
     ) THEN
    RAISE EXCEPTION 'Only managers can post in this channel.' USING ERRCODE = '42501';
  END IF;
  IF (position('@channel' in lower(NEW.body)) > 0 OR position('@everyone' in lower(NEW.body)) > 0)
     AND NOT public.chat_has_cap(NEW.workspace_id, NEW.author_id, 'mention_everyone') THEN
    RAISE EXCEPTION 'Your role can''t mention everyone.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_chat_message_guard ON public.chat_messages;
CREATE TRIGGER share_chat_message_guard BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.share_chat_message_guard();

-- ── share ops ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.share_op_state(p_type text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.perm_actor_id();
  v_ws uuid;
BEGIN
  IF NOT public.can_access(p_type, p_id, 'view', v_user) THEN
    RETURN jsonb_build_object('visible', false);
  END IF;
  SELECT workspace_id INTO v_ws FROM public.resource_grants WHERE resource_type = p_type AND resource_id = p_id LIMIT 1;
  RETURN jsonb_build_object(
    'visible', true,
    'canManage', public.can_access(p_type, p_id, 'full', v_user),
    'workspaceLevel', (
      SELECT level FROM public.resource_grants
      WHERE resource_type = p_type AND resource_id = p_id AND subject_type = 'workspace' LIMIT 1
    ),
    'people', coalesce((
      SELECT jsonb_agg(jsonb_build_object('userId', subject_id, 'level', level))
      FROM public.resource_grants
      WHERE resource_type = p_type AND resource_id = p_id AND subject_type = 'member'
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.share_op_state(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_state(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_op_set(
  p_type text, p_id uuid, p_subject_type text, p_subject_id uuid, p_level text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.perm_actor_id();
  v_ws uuid;
BEGIN
  IF NOT public.can_access(p_type, p_id, 'full', v_user) THEN
    RAISE EXCEPTION 'You can''t change who has access to this.' USING ERRCODE = '42501';
  END IF;
  IF p_type = 'bucket' AND EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = p_id AND b.is_system) THEN
    RAISE EXCEPTION 'The Inbox stays private.' USING ERRCODE = '42501';
  END IF;
  SELECT CASE p_type
    WHEN 'note' THEN (SELECT workspace_id FROM public.notes WHERE id = p_id)
    WHEN 'bucket' THEN (SELECT workspace_id FROM public.buckets WHERE id = p_id)
    WHEN 'task' THEN (SELECT workspace_id FROM public.tasks WHERE id = p_id)
    WHEN 'calendar' THEN (SELECT workspace_id FROM public.calendars WHERE id = p_id)
    WHEN 'contact' THEN (SELECT workspace_id FROM public.contacts WHERE id = p_id)
    WHEN 'contact_group' THEN (SELECT workspace_id FROM public.contact_groups WHERE id = p_id)
    ELSE NULL END
  INTO v_ws;

  IF p_level IS NULL OR p_level = 'private' THEN
    DELETE FROM public.resource_grants
    WHERE resource_type = p_type AND resource_id = p_id
      AND subject_type = p_subject_type
      AND subject_id IS NOT DISTINCT FROM p_subject_id;
    RETURN;
  END IF;

  IF public.grant_level_rank(p_level) > public.perm_ceiling_rank(
       v_ws, v_user,
       CASE p_type WHEN 'note' THEN 'notes' WHEN 'bucket' THEN 'tasks' WHEN 'task' THEN 'tasks'
                   WHEN 'calendar' THEN 'calendar' ELSE 'contacts' END
     ) THEN
    RAISE EXCEPTION 'You can''t grant more access than you have.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (v_ws, p_type, p_id, p_subject_type, p_subject_id, p_level, v_user)
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET level = EXCLUDED.level;

  IF p_type = 'note' THEN
    UPDATE public.notes SET share_mode = 'custom' WHERE id = p_id AND share_mode = 'inherit';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.share_op_set(text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_set(text, uuid, text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_op_make_private(p_type text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := public.perm_actor_id();
BEGIN
  IF NOT public.can_access(p_type, p_id, 'full', v_user) THEN
    RAISE EXCEPTION 'You can''t change who has access to this.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.resource_grants WHERE resource_type = p_type AND resource_id = p_id;
  IF p_type = 'note' THEN
    UPDATE public.notes SET share_mode = 'custom', workspace_shared = false WHERE id = p_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.share_op_make_private(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_make_private(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_op_follow_parent(p_note_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_access('note', p_note_id, 'full') THEN
    RAISE EXCEPTION 'You can''t change who has access to this.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = p_note_id;
  UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false WHERE id = p_note_id;
END;
$$;
REVOKE ALL ON FUNCTION public.share_op_follow_parent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_follow_parent(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_assign_preview(p_bucket_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
  v_person text;
BEGIN
  IF public.can_access('bucket', p_bucket_id, 'view', p_user_id) THEN RETURN NULL; END IF;
  SELECT name INTO v_name FROM public.buckets WHERE id = p_bucket_id;
  SELECT coalesce(nullif(display_name, ''), 'They') INTO v_person FROM public.profiles WHERE id = p_user_id;
  RETURN coalesce(v_person, 'They') || ' can''t see "' || coalesce(v_name, 'this bucket') || '" — they''ll only see this task.';
END;
$$;
REVOKE ALL ON FUNCTION public.share_assign_preview(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_assign_preview(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_defaults_get(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('notes', notes, 'buckets', buckets, 'calendars', calendars, 'contacts', contacts)
  FROM public.workspace_share_defaults WHERE workspace_id = p_workspace_id
$$;
REVOKE ALL ON FUNCTION public.share_defaults_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_defaults_get(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_defaults_set(
  p_workspace_id uuid, p_notes text, p_buckets text, p_calendars text, p_contacts text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.perm_user_has(p_workspace_id, public.perm_actor_id(), 'ws.manage_roles')
     AND NOT public.perm_is_owner(p_workspace_id, public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Your role can''t change permission settings.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.workspace_share_defaults (workspace_id, notes, buckets, calendars, contacts)
  VALUES (p_workspace_id, p_notes, p_buckets, p_calendars, p_contacts)
  ON CONFLICT (workspace_id) DO UPDATE
    SET notes = EXCLUDED.notes, buckets = EXCLUDED.buckets,
        calendars = EXCLUDED.calendars, contacts = EXCLUDED.contacts;
END;
$$;
REVOKE ALL ON FUNCTION public.share_defaults_set(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_defaults_set(uuid, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_caps_get(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
  FROM public.workspace_chat_caps c WHERE c.workspace_id = p_workspace_id
$$;
REVOKE ALL ON FUNCTION public.chat_caps_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_caps_get(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_caps_set(p_workspace_id uuid, p_role_key text, p_caps jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.perm_is_owner(p_workspace_id, public.perm_actor_id())
     AND NOT public.perm_user_has(p_workspace_id, public.perm_actor_id(), 'ws.manage_roles') THEN
    RAISE EXCEPTION 'Your role can''t change permission settings.' USING ERRCODE = '42501';
  END IF;
  IF p_role_key = 'viewer' THEN
    -- Viewers stay read-only. Posting cannot be turned on.
    p_caps := p_caps || jsonb_build_object('post', false, 'create_public', false, 'create_private', false, 'manage_any', false, 'delete_others', false, 'mention_everyone', false, 'start_calls', false);
  END IF;
  UPDATE public.workspace_chat_caps SET
    create_public = coalesce((p_caps->>'create_public')::boolean, create_public),
    create_private = coalesce((p_caps->>'create_private')::boolean, create_private),
    manage_any = coalesce((p_caps->>'manage_any')::boolean, manage_any),
    delete_others = coalesce((p_caps->>'delete_others')::boolean, delete_others),
    mention_everyone = coalesce((p_caps->>'mention_everyone')::boolean, mention_everyone),
    post = coalesce((p_caps->>'post')::boolean, post),
    start_calls = coalesce((p_caps->>'start_calls')::boolean, start_calls)
  WHERE workspace_id = p_workspace_id AND role_key = p_role_key;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_caps_set(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_caps_set(uuid, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.share_op_announce(p_channel_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_channel public.chat_channels;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF v_channel.id IS NULL THEN RAISE EXCEPTION 'That channel is gone.'; END IF;
  IF NOT (
    public.chat_has_cap(v_channel.workspace_id, auth.uid(), 'manage_any')
    OR EXISTS (SELECT 1 FROM public.chat_channel_managers m WHERE m.channel_id = p_channel_id AND m.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Only a channel manager can change this.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.chat_channels SET managers_only = coalesce(p_on, false) WHERE id = p_channel_id;
END;
$$;
REVOKE ALL ON FUNCTION public.share_op_announce(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_announce(uuid, boolean) TO authenticated, service_role;

-- ── calendars ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_op_create_custom(p_workspace_id uuid, p_name text, p_color text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.perm_user_has(p_workspace_id, auth.uid(), 'calendar.create') THEN
    RAISE EXCEPTION 'Your role can''t add calendars.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.calendars (workspace_id, owner_id, name, color, kind)
  VALUES (p_workspace_id, auth.uid(), left(btrim(coalesce(p_name, 'Calendar')), 80), nullif(p_color, ''), 'custom')
  RETURNING id INTO v_id;
  PERFORM public.share_grant_workspace(
    p_workspace_id, 'calendar', v_id,
    coalesce((SELECT calendars FROM public.workspace_share_defaults WHERE workspace_id = p_workspace_id), 'freebusy')
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_op_create_custom(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_create_custom(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calendar_op_publish(p_calendar_id uuid, p_level text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
  IF NOT public.can_access('calendar', p_calendar_id, 'full') THEN
    RAISE EXCEPTION 'You can''t publish this calendar.' USING ERRCODE = '42501';
  END IF;
  IF p_level IS NULL THEN
    UPDATE public.calendars SET publish_token = NULL, publish_level = NULL WHERE id = p_calendar_id;
    RETURN NULL;
  END IF;
  IF p_level NOT IN ('freebusy','view') THEN
    RAISE EXCEPTION 'Publish as free/busy or full details.';
  END IF;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  UPDATE public.calendars SET publish_token = v_token, publish_level = p_level WHERE id = p_calendar_id;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_op_publish(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_publish(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calendar_busy_blocks(
  p_workspace_id uuid, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE (calendar_id uuid, start_time timestamptz, end_time timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.calendar_ref, e.start_time, e.end_time
  FROM public.calendar_events e
  WHERE e.workspace_id = p_workspace_id
    AND e.deleted_at IS NULL
    AND e.calendar_ref IS NOT NULL
    AND e.start_time < p_to AND e.end_time > p_from
    AND public.can_access('calendar', e.calendar_ref, 'freebusy')
    AND NOT public.can_access('calendar', e.calendar_ref, 'view')
$$;
REVOKE ALL ON FUNCTION public.calendar_busy_blocks(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_busy_blocks(uuid, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calendar_public_feed(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cal public.calendars;
BEGIN
  SELECT * INTO v_cal FROM public.calendars
  WHERE publish_token = p_token AND deleted_at IS NULL;
  IF v_cal.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_cal.publish_level = 'view' THEN
    RETURN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'title', e.title, 'start', e.start_time, 'end', e.end_time, 'allDay', e.all_day
      ))
      FROM public.calendar_events e
      WHERE e.calendar_ref = v_cal.id AND e.deleted_at IS NULL
    ), '[]'::jsonb);
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'title', 'Busy', 'start', e.start_time, 'end', e.end_time, 'allDay', e.all_day
    ))
    FROM public.calendar_events e
    WHERE e.calendar_ref = v_cal.id AND e.deleted_at IS NULL
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_public_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calendar_public_feed(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calendar_set_save(p_workspace_id uuid, p_name text, p_calendar_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_cal uuid;
BEGIN
  INSERT INTO public.calendar_sets (workspace_id, owner_id, name)
  VALUES (p_workspace_id, auth.uid(), left(btrim(p_name), 80))
  RETURNING id INTO v_id;
  FOREACH v_cal IN ARRAY coalesce(p_calendar_ids, '{}') LOOP
    IF public.can_access('calendar', v_cal, 'freebusy') THEN
      INSERT INTO public.calendar_set_items (set_id, calendar_id) VALUES (v_id, v_cal) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_set_save(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_set_save(uuid, text, uuid[]) TO authenticated, service_role;

-- ── contacts ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contact_group_create(p_workspace_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.perm_user_has(p_workspace_id, auth.uid(), 'contacts.create') THEN
    RAISE EXCEPTION 'Your role can''t add contact groups.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.contact_groups (workspace_id, owner_id, name)
  VALUES (p_workspace_id, auth.uid(), left(btrim(p_name), 80))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.contact_group_create(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_group_create(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contact_group_add(p_group_id uuid, p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_access('contact_group', p_group_id, 'edit')
     OR NOT public.can_access('contact', p_contact_id, 'edit') THEN
    RAISE EXCEPTION 'You can''t add that contact to this group.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.contact_group_members (group_id, contact_id)
  VALUES (p_group_id, p_contact_id) ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.contact_group_add(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_group_add(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contact_merge_candidates()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'keepId', shared.id, 'dropId', mine.id, 'name', mine.name, 'email', mine.email
  )), '[]'::jsonb)
  FROM public.contacts mine
  JOIN public.contacts shared
    ON shared.workspace_id = mine.workspace_id
   AND shared.id <> mine.id
   AND shared.deleted_at IS NULL
   AND lower(shared.email) = lower(mine.email)
   AND shared.owner_id IS DISTINCT FROM auth.uid()
  WHERE mine.owner_id = auth.uid()
    AND mine.deleted_at IS NULL
    AND mine.email IS NOT NULL
    AND public.can_access('contact', shared.id, 'view')
$$;
REVOKE ALL ON FUNCTION public.contact_merge_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_merge_candidates() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contact_merge(p_keep_id uuid, p_drop_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_keep public.contacts;
  v_drop public.contacts;
BEGIN
  SELECT * INTO v_keep FROM public.contacts WHERE id = p_keep_id AND deleted_at IS NULL;
  SELECT * INTO v_drop FROM public.contacts WHERE id = p_drop_id AND deleted_at IS NULL AND owner_id = auth.uid();
  IF v_keep.id IS NULL OR v_drop.id IS NULL THEN
    RAISE EXCEPTION 'Those contacts can''t be merged.';
  END IF;
  IF NOT public.can_access('contact', p_keep_id, 'view') THEN
    RAISE EXCEPTION 'You can''t see that contact.';
  END IF;
  IF lower(coalesce(v_keep.email, '')) IS DISTINCT FROM lower(coalesce(v_drop.email, ''))
     OR coalesce(v_drop.email, '') = '' THEN
    RAISE EXCEPTION 'Merge only matches the same email.';
  END IF;
  INSERT INTO public.contact_private_notes (contact_id, user_id, body)
  VALUES (p_keep_id, auth.uid(), coalesce(v_drop.notes_inline, ''))
  ON CONFLICT (contact_id, user_id) DO UPDATE SET body = EXCLUDED.body;
  UPDATE public.contacts SET deleted_at = now() WHERE id = p_drop_id;
END;
$$;
REVOKE ALL ON FUNCTION public.contact_merge(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_merge(uuid, uuid) TO authenticated, service_role;

-- ── removed member: private items go to the owner ───────────────────────────

CREATE OR REPLACE FUNCTION public.share_member_removed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  WHERE workspace_id = OLD.workspace_id
    AND created_by = OLD.user_id
    AND deleted_at IS NULL
    AND share_mode = 'custom'
    AND NOT EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = notes.id AND g.subject_type = 'workspace'
    );

  UPDATE public.buckets SET
    owner_id = v_owner,
    name = 'From ' || v_name || ' (archived) ' || name
  WHERE workspace_id = OLD.workspace_id
    AND owner_id = OLD.user_id
    AND deleted_at IS NULL
    AND is_system = false
    AND NOT EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'bucket' AND g.resource_id = buckets.id AND g.subject_type = 'workspace'
    );

  DELETE FROM public.resource_grants
  WHERE subject_type = 'member' AND subject_id = OLD.user_id AND workspace_id = OLD.workspace_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS share_member_removed ON public.workspace_members;
CREATE TRIGGER share_member_removed AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.share_member_removed();

-- Second member: calendars start showing free/busy to the workspace.
CREATE OR REPLACE FUNCTION public.share_on_member_joined()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.share_member_count(NEW.workspace_id) <> 2 THEN RETURN NEW; END IF;
  INSERT INTO public.calendars (workspace_id, owner_id, name, kind)
  SELECT NEW.workspace_id, m.user_id, 'Moduo', 'moduo'
  FROM public.workspace_members m WHERE m.workspace_id = NEW.workspace_id
  ON CONFLICT DO NOTHING;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level)
  SELECT c.workspace_id, 'calendar', c.id, 'workspace',
    coalesce((SELECT calendars FROM public.workspace_share_defaults d WHERE d.workspace_id = c.workspace_id), 'freebusy')
  FROM public.calendars c
  WHERE c.workspace_id = NEW.workspace_id AND c.deleted_at IS NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_on_member_joined ON public.workspace_members;
CREATE TRIGGER share_on_member_joined AFTER INSERT ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.share_on_member_joined();

CREATE OR REPLACE FUNCTION public.share_apply_invite(p_invite_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite public.workspace_invites;
  v_existing text;
  v_item jsonb;
  v_level text;
  v_type text;
  v_id uuid;
BEGIN
  SELECT * INTO v_invite FROM public.workspace_invites WHERE id = p_invite_id;
  IF v_invite.id IS NULL THEN RETURN; END IF;
  v_existing := coalesce(v_invite.share_payload->>'existing', 'none');
  IF v_existing IN ('view', 'edit') THEN
    INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
    SELECT v_invite.workspace_id, 'note', n.id, 'member', p_user_id, v_existing, v_invite.created_by
    FROM public.notes n
    WHERE n.workspace_id = v_invite.workspace_id AND n.deleted_at IS NULL
      AND public.can_access('note', n.id, 'full', v_invite.created_by)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
    SELECT v_invite.workspace_id, 'bucket', b.id, 'member', p_user_id, v_existing, v_invite.created_by
    FROM public.buckets b
    WHERE b.workspace_id = v_invite.workspace_id AND b.deleted_at IS NULL AND b.is_system = false
      AND public.can_access('bucket', b.id, 'full', v_invite.created_by)
    ON CONFLICT DO NOTHING;
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(v_invite.share_payload->'resources', '[]'::jsonb))
  LOOP
    v_type := v_item->>'type';
    v_id := nullif(v_item->>'id', '')::uuid;
    v_level := coalesce(v_item->>'level', 'view');
    IF v_id IS NULL OR v_type IS NULL THEN CONTINUE; END IF;
    IF public.can_access(v_type, v_id, 'full', v_invite.created_by) THEN
      INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
      VALUES (v_invite.workspace_id, v_type, v_id, 'member', p_user_id, v_level, v_invite.created_by)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_op_accept_invite(p_token text)
RETURNS public.workspace_invites
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_invite public.workspace_invites;
  v_token  text := replace(btrim(coalesce(p_token, '')), ' ', '+');
  v_role_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_token = '' THEN RAISE EXCEPTION 'Invalid or expired invite'; END IF;
  SELECT * INTO v_invite FROM public.workspace_invites
   WHERE token = v_token AND status = 'pending' LIMIT 1;
  IF v_invite.id IS NULL OR v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = v_invite.workspace_id AND m.user_id = v_caller
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
    CASE WHEN (SELECT read_only FROM public.workspace_roles WHERE id = v_role_id) THEN '{}'::jsonb
         ELSE public.perm_legacy_overrides(v_invite.permissions_notes, v_invite.permissions_tasks) END,
    'write', 'write');
  PERFORM public.share_apply_invite(v_invite.id, v_caller);
  UPDATE public.workspace_invites SET status = 'accepted' WHERE id = v_invite.id RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

-- ── booking: private booker contact + collective hosts ──────────────────────

DROP FUNCTION IF EXISTS public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid, text, text
);

CREATE OR REPLACE FUNCTION public.booking_op_commit(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_attendee_name text,
  p_attendee_email text,
  p_host_email text,
  p_source_account_id uuid DEFAULT NULL,
  p_external_event_id text DEFAULT NULL,
  p_calendar_id text DEFAULT NULL,
  p_cohost_ids uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.calendar_events;
  c public.contacts;
  v_emails jsonb;
  v_pair text;
  v_cal uuid;
  v_host uuid;
BEGIN
  IF p_workspace_id IS NULL OR p_owner_id IS NULL THEN RAISE EXCEPTION 'booking_missing_owner'; END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'booking_bad_range'; END IF;

  SELECT id INTO v_cal FROM public.calendars
  WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
    AND (
      (p_source_account_id IS NULL AND owner_id = p_owner_id AND kind = 'moduo')
      OR account_id = p_source_account_id
    )
  LIMIT 1;

  INSERT INTO public.calendar_events
    (workspace_id, owner_id, source_account_id, external_event_id, calendar_id, calendar_ref,
     title, description, location, start_time, end_time, all_day, recurring, status, attendees)
  VALUES (
    p_workspace_id, p_owner_id, p_source_account_id,
    CASE WHEN p_source_account_id IS NULL THEN NULL ELSE NULLIF(p_external_event_id, '') END,
    CASE WHEN p_source_account_id IS NULL THEN 'moduo' ELSE coalesce(NULLIF(p_calendar_id, ''), 'google') END,
    v_cal,
    btrim(p_title), coalesce(p_description, ''), NULLIF(p_location, ''),
    p_starts_at, p_ends_at, false, false, 'confirmed',
    jsonb_build_array(
      jsonb_build_object('email', p_host_email, 'self', true),
      jsonb_build_object('email', p_attendee_email, 'name', p_attendee_name)
    )
  ) RETURNING * INTO e;

  PERFORM public.entities_op_upsert(p_workspace_id, 'event', e.id, e.title, 'calendar');

  SELECT * INTO c FROM public.contacts
  WHERE workspace_id = p_workspace_id AND deleted_at IS NULL AND owner_id = p_owner_id
    AND email IS NOT NULL AND lower(email) = lower(p_attendee_email)
  LIMIT 1;

  IF NOT FOUND THEN
    v_emails := jsonb_build_array(jsonb_build_object('label', 'other', 'value', p_attendee_email, 'primary', true));
    INSERT INTO public.contacts (workspace_id, owner_id, name, email, emails, status, notes_inline, origin)
    VALUES (p_workspace_id, p_owner_id, coalesce(p_attendee_name, ''), p_attendee_email, v_emails, '', '', 'booking')
    RETURNING * INTO c;
  END IF;

  PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  v_pair := public.spine_pair_key('contact', c.id, 'event', e.id);
  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES (p_workspace_id, 'contact', c.id, 'event', e.id, 'references', 'manual', p_owner_id)
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL DO NOTHING;

  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, payload)
  VALUES (p_workspace_id, 'calendar', 'event', e.id, 'calendar.booking_create', 'user', p_owner_id,
    jsonb_build_object('title', e.title, 'guest', p_attendee_email));

  IF p_cohost_ids IS NOT NULL THEN
    FOREACH v_host IN ARRAY p_cohost_ids LOOP
      IF v_host IS NULL OR v_host = p_owner_id THEN CONTINUE; END IF;
      SELECT id INTO v_cal FROM public.calendars
      WHERE workspace_id = p_workspace_id AND owner_id = v_host AND kind = 'moduo' AND deleted_at IS NULL
      LIMIT 1;
      INSERT INTO public.calendar_events
        (workspace_id, owner_id, calendar_id, calendar_ref, title, description, location,
         start_time, end_time, all_day, recurring, status, attendees)
      VALUES (
        p_workspace_id, v_host, 'moduo', v_cal, btrim(p_title), coalesce(p_description, ''),
        NULLIF(p_location, ''), p_starts_at, p_ends_at, false, false, 'confirmed',
        jsonb_build_array(jsonb_build_object('email', p_attendee_email, 'name', p_attendee_name))
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('event_id', e.id, 'contact_id', c.id);
END;
$$;
REVOKE ALL ON FUNCTION public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid, text, text, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid, text, text, uuid[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.booking_hosts_set(p_link_id uuid, p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link public.exposed_slot_links;
  v_tier text;
  v_uid uuid;
BEGIN
  SELECT * INTO v_link FROM public.exposed_slot_links WHERE id = p_link_id AND deleted_at IS NULL;
  IF v_link.id IS NULL OR v_link.owner_user_id IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'You can''t change this booking link.';
  END IF;
  IF coalesce(array_length(p_user_ids, 1), 0) = 0 THEN
    DELETE FROM public.booking_link_hosts WHERE link_id = p_link_id;
    UPDATE public.exposed_slot_links SET collective = false WHERE id = p_link_id;
    RETURN;
  END IF;
  SELECT plan_tier INTO v_tier FROM public.profiles WHERE id = auth.uid();
  IF coalesce(v_tier, 'free') NOT IN ('duo', 'team', 'founder') THEN
    RAISE EXCEPTION 'Collective booking links are on the Duo plan.';
  END IF;
  DELETE FROM public.booking_link_hosts WHERE link_id = p_link_id;
  FOREACH v_uid IN ARRAY p_user_ids LOOP
    IF v_uid IS NULL OR v_uid = auth.uid() THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = v_link.workspace_id::uuid AND m.user_id = v_uid
    ) THEN CONTINUE; END IF;
    INSERT INTO public.booking_link_hosts (link_id, user_id, status) VALUES (p_link_id, v_uid, 'pending');
  END LOOP;
  UPDATE public.exposed_slot_links SET collective = true, paused = true WHERE id = p_link_id;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_hosts_set(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_hosts_set(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.booking_host_respond(p_link_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.booking_link_hosts
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
  WHERE link_id = p_link_id AND user_id = auth.uid() AND status = 'pending';
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_link_hosts WHERE link_id = p_link_id AND status = 'pending'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.booking_link_hosts WHERE link_id = p_link_id AND status = 'declined'
  ) THEN
    UPDATE public.exposed_slot_links SET paused = false WHERE id = p_link_id AND collective = true;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_host_respond(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_host_respond(uuid, boolean) TO authenticated, service_role;

-- @channel notify has to honor the chat cap, not only the words in the body.
CREATE OR REPLACE FUNCTION public.chat_op_send(
  p_channel_id uuid,
  p_body text,
  p_parent_id uuid default null,
  p_mentioned_user_ids uuid[] default '{}',
  p_notify_channel boolean default false,
  p_client_id uuid default null,
  p_excerpt text default null
) RETURNS public.chat_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_body text := coalesce(p_body, '');
  v_parent public.chat_messages;
  v_msg public.chat_messages;
  v_mentions uuid[];
  v_notify jsonb := '[]'::jsonb;
  v_op text;
BEGIN
  IF p_notify_channel AND NOT public.chat_has_cap(v_channel.workspace_id, auth.uid(), 'mention_everyone') THEN
    RAISE EXCEPTION 'Your role can''t mention everyone.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.';
  END IF;
  IF btrim(v_body, E' \n\t') = '' THEN
    RAISE EXCEPTION 'A message can''t be empty.';
  END IF;
  IF char_length(v_body) > 8000 THEN
    RAISE EXCEPTION 'That message is too long (8,000 characters max).';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.chat_messages WHERE author_id = auth.uid() AND client_id = p_client_id;
    IF v_msg.id IS NOT NULL THEN RETURN v_msg; END IF;
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.chat_messages WHERE id = p_parent_id FOR UPDATE;
    IF v_parent.id IS NULL OR v_parent.channel_id <> p_channel_id OR v_parent.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'That thread no longer exists.';
    END IF;
  END IF;

  INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
  VALUES (p_channel_id, auth.uid(), v_channel.workspace_id) ON CONFLICT DO NOTHING;

  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_mentions
    FROM unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[])) u
   WHERE public.chat_is_workspace_member(v_channel.workspace_id, u)
     AND ((v_channel.kind = 'channel' AND NOT v_channel.is_private)
          OR EXISTS (SELECT 1 FROM public.chat_members m WHERE m.channel_id = p_channel_id AND m.user_id = u));

  INSERT INTO public.chat_messages (workspace_id, channel_id, parent_id, author_id, body, mentioned_user_ids, client_id)
  VALUES (v_channel.workspace_id, p_channel_id, p_parent_id, auth.uid(), v_body, v_mentions, p_client_id)
  RETURNING * INTO v_msg;

  IF v_parent.id IS NOT NULL THEN
    UPDATE public.chat_messages
       SET reply_count = reply_count + 1,
           last_reply_at = v_msg.created_at,
           reply_user_ids = (
             SELECT coalesce(array_agg(u), '{}') FROM (
               SELECT u FROM unnest(array[auth.uid()] || array_remove(reply_user_ids, auth.uid())) WITH ORDINALITY t(u, o)
                ORDER BY o LIMIT 5) s)
     WHERE id = v_parent.id;
  ELSE
    UPDATE public.chat_channels SET last_message_at = v_msg.created_at WHERE id = p_channel_id;
    UPDATE public.chat_members SET last_read_at = greatest(last_read_at, v_msg.created_at)
     WHERE channel_id = p_channel_id AND user_id = auth.uid();
  END IF;

  SELECT coalesce(jsonb_agg(DISTINCT s.uid::text), '[]'::jsonb) INTO v_notify FROM (
    SELECT unnest(v_mentions) AS uid
    UNION
    SELECT m.user_id FROM public.chat_members m
     WHERE p_notify_channel AND m.channel_id = p_channel_id AND m.notify_level <> 'none'
    UNION
    SELECT v_parent.author_id WHERE v_parent.id IS NOT NULL
    UNION
    SELECT r.author_id FROM public.chat_messages r
     WHERE v_parent.id IS NOT NULL AND r.parent_id = v_parent.id AND r.deleted_at IS NULL
  ) s
  WHERE s.uid IS NOT NULL AND s.uid IS DISTINCT FROM auth.uid();

  IF v_notify <> '[]'::jsonb THEN
    v_op := CASE WHEN cardinality(v_mentions) > 0 OR p_notify_channel THEN 'chat.mention' ELSE 'chat.reply' END;
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id, v_op,
      jsonb_build_object(
        'message_id', v_msg.id,
        'parent_id', p_parent_id,
        'channel_name', v_channel.name,
        'channel_kind', v_channel.kind,
        'excerpt', left(coalesce(nullif(p_excerpt, ''), v_body), 140),
        'notify_user_ids', v_notify));
  END IF;
  RETURN v_msg;
END;
$$;
