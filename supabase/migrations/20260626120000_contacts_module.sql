-- Contacts module (light CRM) — block CO-1: schema + intent ops.
-- (specs/contacts.md block 1; .design/contacts/DESIGN_BRIEF.md §Data.)
--
-- People (`contacts`) and companies (`companies`) are hub entities that own
-- almost no native depth — ~90% of a contact's page is rolled up from the spine
-- (entity_links → the entities registry). This migration adds the two owned
-- tables and the contacts intent ops, mirroring the proven Tasks pattern
-- (…_module_activity_intent_ops.sql) and consuming the spine substrate from
-- 20260625120000_spine_entity_links.sql (entities_op_upsert / _ensure,
-- module_activity_log, the entity_links keystone).
--
-- Pillars (docs/moduo-module-contract.md):
--   1. Intent ops — contacts_op_* / companies_op_*: SECURITY DEFINER plpgsql,
--      SET search_path=public, permission guard + mutation + an UPSERT into the
--      central `entities` registry + an attributed `module_activity` row, all in
--      ONE transaction.
--   2. Actor attribution — derived server-side from auth.uid().
--   3. Activity — writes the shared append-only `module_activity` table.
--   4. Permission — contacts_module_permission() normalizes the none/view/edit/
--      admin ladder; ops require edit+.
--
-- Permission lane (alpha): like the spine (CT-1 decision a), Contacts reuses the
-- Tasks permission lane (`permissions_tasks`) as its edit gate — there is no
-- `permissions_contacts` column yet and a dedicated lane is a one-line future
-- migration if contact permissions ever need to diverge from tasks.
--
-- RLS posture: `contacts` / `companies` are READ-only to members (SELECT policy);
-- every write goes through a SECURITY DEFINER op, never a raw client write
-- (module contract Pillar 1) — matching the spine + module_activity tables.

-- ── Pillar 4: permission helper ──────────────────────────────────────────────
-- Owner → admin; member → their normalized Tasks permission level (legacy
-- write/read mapped). Identical body to spine_module_permission /
-- tasks_module_permission. SECURITY DEFINER so the membership lookup bypasses
-- RLS and can't recurse.
CREATE OR REPLACE FUNCTION public.contacts_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
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
  END;
$$;

REVOKE ALL ON FUNCTION public.contacts_module_permission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts_module_permission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contacts_module_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_module_permission(uuid) TO service_role;

-- ── companies ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id      uuid DEFAULT auth.uid(),
  name          text NOT NULL DEFAULT '',
  -- Email domains: the deterministic email-domain→company suggestion key (AC7).
  domains       text[] NOT NULL DEFAULT '{}',
  website       text,
  notes_inline  text NOT NULL DEFAULT '',
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS companies_workspace_id_idx ON public.companies (workspace_id);

-- ── contacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id      uuid DEFAULT auth.uid(),
  name          text NOT NULL DEFAULT '',
  -- Primary email + all known addresses (dedupe/suggest match on these; AC6/AC7).
  email         text,
  emails        text[] NOT NULL DEFAULT '{}',
  phone         text,
  title         text,
  -- Denormalized company FK convenience; the canonical edge is the `works-at`
  -- entity_link (specs/contacts.md decision 3). ON DELETE SET NULL so deleting a
  -- company never orphans a contact row.
  company_id    uuid REFERENCES public.companies (id) ON DELETE SET NULL,
  -- Renamable flat status, NEVER a pipeline (AC3). Default 'lead'.
  status        text NOT NULL DEFAULT 'lead',
  -- One-line scratch only; rich notes live in the Notes module, linked (dec. 9).
  notes_inline  text NOT NULL DEFAULT '',
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS contacts_workspace_id_idx ON public.contacts (workspace_id);
CREATE INDEX IF NOT EXISTS contacts_company_id_idx ON public.contacts (company_id);
-- Email-first dedupe (AC6) + email→person suggestion (AC7): one indexed lookup.
CREATE INDEX IF NOT EXISTS contacts_workspace_email_idx
  ON public.contacts (workspace_id, lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read for members; writes are op-only (SECURITY DEFINER ops bypass RLS). Reuses
-- the module-agnostic workspace-access predicate already used by tasks/spine.
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_workspace_read ON public.companies;
CREATE POLICY companies_workspace_read ON public.companies
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

DROP POLICY IF EXISTS contacts_workspace_read ON public.contacts;
CREATE POLICY contacts_workspace_read ON public.contacts
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

-- ── op-internal guard: permission only (used by create + company ops) ─────────
CREATE OR REPLACE FUNCTION public.contacts_op__guard(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.contacts_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Contacts in this workspace.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.contacts_op__guard(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts_op__guard(uuid) FROM authenticated;

-- ── op-internal guard: permission + scoped, live, locked contact row ─────────
CREATE OR REPLACE FUNCTION public.contacts_op__guard_contact(p_workspace_id uuid, p_contact_id uuid)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.contacts;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  SELECT * INTO c FROM public.contacts
    WHERE id = p_contact_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found in this workspace.';
  END IF;
  RETURN c;
END;
$$;

REVOKE ALL ON FUNCTION public.contacts_op__guard_contact(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts_op__guard_contact(uuid, uuid) FROM authenticated;

-- ── contacts.create ──────────────────────────────────────────────────────────
-- Writes the contact row AND upserts the central `entities` registry
-- (entity_type 'contact') in the same transaction, so the new person is
-- immediately addressable / linkable / @mentionable (AC1). Logs an attributed
-- activity row.
CREATE OR REPLACE FUNCTION public.contacts_op_create(
  p_workspace_id uuid,
  p_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_status text DEFAULT 'lead',
  p_notes_inline text DEFAULT ''
)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.contacts;
  v_emails text[] := CASE WHEN p_email IS NOT NULL AND p_email <> '' THEN ARRAY[p_email] ELSE '{}'::text[] END;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);

  INSERT INTO public.contacts
    (workspace_id, owner_id, name, email, emails, phone, title, company_id, status, notes_inline)
  VALUES
    (p_workspace_id, auth.uid(), coalesce(p_name, ''), p_email, v_emails, p_phone, p_title,
     p_company_id, coalesce(NULLIF(p_status, ''), 'lead'), coalesce(p_notes_inline, ''))
  RETURNING * INTO c;

  PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.create',
    jsonb_build_object('name', c.name, 'status', c.status)
  );
  RETURN c;
END;
$$;

-- ── contacts.update ──────────────────────────────────────────────────────────
-- Scalar field edits (name / email / phone / title / company / inline note).
-- A name change refreshes the registry label (authoritative upsert). NULL params
-- mean "leave unchanged". company_id is updated only when p_set_company is true
-- (so a NULL can intentionally clear it).
CREATE OR REPLACE FUNCTION public.contacts_op_update(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_notes_inline text DEFAULT NULL,
  p_set_company boolean DEFAULT false,
  p_company_id uuid DEFAULT NULL
)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.contacts;
  v_emails text[];
BEGIN
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);

  -- Keep the emails array in sync when the primary email changes. Dedupe
  -- case-insensitively (matches contacts_workspace_email_idx's lower(email)) so
  -- the array doesn't accrete case-variants on repeated edits (AC6/AC7 key on it).
  v_emails := c.emails;
  IF p_email IS NOT NULL AND p_email <> ''
     AND NOT EXISTS (SELECT 1 FROM unnest(c.emails) AS e WHERE lower(e) = lower(p_email)) THEN
    v_emails := array_prepend(p_email, c.emails);
  END IF;

  UPDATE public.contacts
    SET name = coalesce(p_name, name),
        email = coalesce(p_email, email),
        emails = v_emails,
        phone = coalesce(p_phone, phone),
        title = coalesce(p_title, title),
        notes_inline = coalesce(p_notes_inline, notes_inline),
        company_id = CASE WHEN p_set_company THEN p_company_id ELSE company_id END,
        updated_at = now()
    WHERE id = c.id
    RETURNING * INTO c;

  IF p_name IS NOT NULL AND p_name <> '' THEN
    PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.update',
    jsonb_build_object('name', c.name)
  );
  RETURN c;
END;
$$;

-- ── contacts.set_status ──────────────────────────────────────────────────────
-- Optimistic, flat status change (AC3). Accepts any non-empty label (renamed /
-- custom statuses are first-class); no stage gate, no transition rules. No-op if
-- unchanged.
CREATE OR REPLACE FUNCTION public.contacts_op_set_status(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_status text
)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.contacts;
  v_from text;
  v_to text := lower(trim(coalesce(p_status, '')));
BEGIN
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);
  IF v_to = '' THEN
    RAISE EXCEPTION 'A status is required.';
  END IF;
  IF c.status = v_to THEN
    RETURN c; -- no-op, no log
  END IF;
  v_from := c.status;
  UPDATE public.contacts
    SET status = v_to, updated_at = now()
    WHERE id = c.id
    RETURNING * INTO c;
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.set_status',
    jsonb_build_object('from', v_from, 'to', c.status)
  );
  RETURN c;
END;
$$;

-- ── contacts.link ────────────────────────────────────────────────────────────
-- Link a contact to any other entity through the spine's entity_links keystone,
-- attributed to the Contacts module. Idempotent + direction-agnostic (a
-- duplicate pair+kind no-ops and returns the live row); registers both endpoints
-- in the registry without reviving a tombstone. Self-contained (its own guard +
-- write + registry ensure + activity) so Contacts owns no spine machinery while
-- still attributing the action to itself (specs/contacts.md decisions 2 & 11).
CREATE OR REPLACE FUNCTION public.contacts_op_link(
  p_workspace_id uuid,
  p_contact_type text,
  p_contact_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_relation_kind text DEFAULT 'references',
  p_origin text DEFAULT 'manual',
  p_contact_label text DEFAULT NULL,
  p_target_label text DEFAULT NULL,
  p_target_icon text DEFAULT NULL
)
RETURNS public.entity_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.entity_links;
  v_kind text := coalesce(p_relation_kind, 'references');
  v_origin text := coalesce(p_origin, 'manual');
  v_pair_key text;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;
  IF v_origin NOT IN ('manual', 'drag', 'mention', 'ref', 'suggest') THEN
    RAISE EXCEPTION 'Unknown link origin: %', v_origin;
  END IF;
  IF p_contact_type = p_target_type AND p_contact_id = p_target_id THEN
    RAISE EXCEPTION 'An entity cannot link to itself.';
  END IF;

  -- Insert-if-absent only; never clobbers the authoritative label/icon the
  -- owning create/update op wrote. Icon left NULL so a company endpoint keeps its
  -- own glyph (the contact endpoint may be a 'contact' OR a 'company').
  PERFORM public.entities_op_ensure(p_workspace_id, p_contact_type, p_contact_id, p_contact_label, NULL);
  PERFORM public.entities_op_ensure(p_workspace_id, p_target_type, p_target_id, p_target_label, p_target_icon);

  v_pair_key := public.spine_pair_key(p_contact_type, p_contact_id, p_target_type, p_target_id);

  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, p_contact_type, p_contact_id, p_target_type, p_target_id, v_kind, v_origin, auth.uid())
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    -- Already linked — return the live row, no new activity (idempotent).
    SELECT * INTO v_link FROM public.entity_links
      WHERE workspace_id = p_workspace_id
        AND pair_key = v_pair_key
        AND relation_kind = v_kind
        AND deleted_at IS NULL
      LIMIT 1;
    RETURN v_link;
  END IF;

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', p_contact_type, p_contact_id, 'contacts.link',
    jsonb_build_object(
      'link_id', v_link.id,
      'target_type', p_target_type, 'target_id', p_target_id,
      'relation_kind', v_kind, 'origin', v_origin)
  );
  RETURN v_link;
END;
$$;

-- ── contacts.unlink ──────────────────────────────────────────────────────────
-- Soft-delete a link the contact owns (Undo-friendly; idempotent). Returns the
-- tombstoned row, or SQL NULL if it never existed in this workspace.
CREATE OR REPLACE FUNCTION public.contacts_op_unlink(
  p_workspace_id uuid,
  p_link_id uuid
)
RETURNS public.entity_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.entity_links;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_link FROM public.entity_links
      WHERE id = p_link_id AND workspace_id = p_workspace_id;
    IF v_link.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN v_link;
  END IF;

  -- This op only removes links a contact/company actually owns — it must not be
  -- a back door to delete (and mis-attribute) an unrelated cross-module link
  -- (e.g. a task↔note edge). Spine-owned links are removed via links_op_delete.
  IF v_link.source_type NOT IN ('contact', 'company')
     AND v_link.target_type NOT IN ('contact', 'company') THEN
    RAISE EXCEPTION 'This link is not owned by Contacts.';
  END IF;

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE id = v_link.id
    RETURNING * INTO v_link;

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', v_link.source_type, v_link.source_id, 'contacts.unlink',
    jsonb_build_object(
      'link_id', v_link.id, 'relation_kind', v_link.relation_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$$;

-- ── companies.create / companies.update ──────────────────────────────────────
-- Companies are first-class spine entities too (AC1) — create/update register
-- entity_type 'company' in the registry. The richer company→people union +
-- works-at edge is block CO-4; these are the minimal ops that make a company
-- creatable, renamable, and addressable.
CREATE OR REPLACE FUNCTION public.companies_op_create(
  p_workspace_id uuid,
  p_name text,
  p_domains text[] DEFAULT '{}',
  p_website text DEFAULT NULL,
  p_notes_inline text DEFAULT ''
)
RETURNS public.companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  co public.companies;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);

  INSERT INTO public.companies (workspace_id, owner_id, name, domains, website, notes_inline)
  VALUES (p_workspace_id, auth.uid(), coalesce(p_name, ''), coalesce(p_domains, '{}'::text[]),
          p_website, coalesce(p_notes_inline, ''))
  RETURNING * INTO co;

  PERFORM public.entities_op_upsert(p_workspace_id, 'company', co.id, co.name, 'building-2');
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'company', co.id, 'companies.create',
    jsonb_build_object('name', co.name)
  );
  RETURN co;
END;
$$;

CREATE OR REPLACE FUNCTION public.companies_op_update(
  p_workspace_id uuid,
  p_company_id uuid,
  p_name text DEFAULT NULL,
  p_domains text[] DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_notes_inline text DEFAULT NULL
)
RETURNS public.companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  co public.companies;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);

  SELECT * INTO co FROM public.companies
    WHERE id = p_company_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found in this workspace.';
  END IF;

  UPDATE public.companies
    SET name = coalesce(p_name, name),
        domains = coalesce(p_domains, domains),
        website = coalesce(p_website, website),
        notes_inline = coalesce(p_notes_inline, notes_inline),
        updated_at = now()
    WHERE id = co.id
    RETURNING * INTO co;

  IF p_name IS NOT NULL AND p_name <> '' THEN
    PERFORM public.entities_op_upsert(p_workspace_id, 'company', co.id, co.name, 'building-2');
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'company', co.id, 'companies.update',
    jsonb_build_object('name', co.name)
  );
  RETURN co;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
-- Public ops are callable by signed-in users only (v1). Supabase's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE to anon/authenticated, so REVOKE FROM PUBLIC alone
-- leaves them anon-executable — revoke anon explicitly (the lesson of
-- 20260612151000_intent_ops_revoke_anon.sql).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'contacts_op_create(uuid, text, text, text, text, uuid, text, text)',
    'contacts_op_update(uuid, uuid, text, text, text, text, text, boolean, uuid)',
    'contacts_op_set_status(uuid, uuid, text)',
    'contacts_op_link(uuid, text, uuid, text, uuid, text, text, text, text, text)',
    'contacts_op_unlink(uuid, uuid)',
    'companies_op_create(uuid, text, text[], text, text)',
    'companies_op_update(uuid, uuid, text, text[], text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;
