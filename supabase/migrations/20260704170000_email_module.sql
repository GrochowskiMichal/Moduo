-- Email module (cloud substrate) — block EM-3: schema + intent ops.
-- (specs/email.md block 3; .design/email/DESIGN_BRIEF.md §7. Covers AC14 schema +
-- AC17 permission lane.)
--
-- Desktop-first hybrid: the Rust IMAP/SMTP engine + redb own bodies/folders/flags/
-- send. Supabase receives ONLY "tissue" metadata — an `email_refs` row exists
-- exclusively for a thread deliberately pulled into the spine (converted / linked /
-- snoozed / followed-up / tagged). Plain reading & triage write NOTHING here
-- (AC14 privacy). No secrets ever reach the cloud (the OS keychain owns them, EM-1).
--
-- Two owned tables:
--   • email_accounts — the per-user account registry (address/status/signature/
--     unread_count/hue) so web can render attribution + counts. OWNER-scoped RLS:
--     nobody but you ever sees your accounts.
--   • email_refs — the tissue thread refs. WORKSPACE-readable RLS (a linked email
--     card shows for the whole workspace, like any other spine entity), registered
--     in the central `entities` registry as entity_type 'email_thread'.
--
-- Pillars (docs/moduo-module-contract.md): SECURITY DEFINER intent ops (guard →
-- write → entities_op_upsert → module_activity_log, one txn), server-derived
-- attribution, shared module_activity, an email_module_permission ladder.
--
-- ⚠ Permission lane: Email has its OWN lane (`permissions_email`), like Notes —
-- NOT the Tasks lane that Contacts/Calendar borrow. The permission fn carries the
-- `module_api_key_id()` branch FROM DAY ONE (`scopes->>'email'`) so a keyed MCP
-- agent WRITE isn't silently dead — the CAL-7 gotcha that shipped broken in three
-- modules (docs/gotchas.md "module_api_key_id"). Copied from tasks_module_permission,
-- NOT from contacts' old auth-only shape.
--
-- The atomic `email_op_convert_to_task` (the great moment) is AC8 / block EM-8 and
-- lands with its gesture there; this migration is the substrate it builds on.

-- ── permission lane column ───────────────────────────────────────────────────
-- Nullable; the permission fn coalesces NULL → 'edit' (existing members keep full
-- access). The FOR-ALL own-row workspace_members RLS already covers new columns.
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS permissions_email text;

-- ── Pillar 4: permission helper (WITH the api-key branch) ────────────────────
CREATE OR REPLACE FUNCTION public.email_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_key uuid;
BEGIN
  -- MCP connector path: a scoped api key resolves its own 'email' scope. The
  -- connector runs as service_role (auth.uid() IS NULL), so without this branch
  -- every keyed WRITE would raise "no edit access" even for a valid key.
  v_key := public.module_api_key_id();
  IF v_key IS NOT NULL THEN
    RETURN coalesce((
      SELECT CASE lower(coalesce(k.scopes ->> 'email', 'none'))
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
      SELECT CASE lower(coalesce(m.permissions_email, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END);
END;
$$;

REVOKE ALL ON FUNCTION public.email_module_permission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_module_permission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.email_module_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.email_module_permission(uuid) TO service_role;

-- ── email_accounts (owner-scoped registry; NO secrets) ───────────────────────
CREATE TABLE IF NOT EXISTS public.email_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id       uuid NOT NULL DEFAULT auth.uid(),
  provider       text NOT NULL,                 -- 'gmail'|'icloud'|'imap'|'outlook'
  address        text NOT NULL,                 -- normalized (lowercased) email
  status         text NOT NULL DEFAULT 'active', -- active|reauth_required|error
  signature_html text NOT NULL DEFAULT '',
  unread_count   integer NOT NULL DEFAULT 0,
  color          text,                          -- rail hue attribution (optional)
  last_sync_at   timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE INDEX IF NOT EXISTS email_accounts_workspace_owner_idx
  ON public.email_accounts (workspace_id, owner_id) WHERE deleted_at IS NULL;
-- Upsert identity for account_upsert's ON CONFLICT (address is pre-normalized).
CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_identity_uidx
  ON public.email_accounts (workspace_id, owner_id, provider, address)
  WHERE deleted_at IS NULL;

-- ── email_refs (workspace-readable tissue refs) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_refs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id               uuid NOT NULL DEFAULT auth.uid(),
  -- Which account surfaced it; nulled if that account is later removed.
  account_id             uuid REFERENCES public.email_accounts (id) ON DELETE SET NULL,
  thread_key             text NOT NULL,          -- References-root thread id (engine)
  message_key            text,                   -- the anchored message (optional)
  from_addr              text,
  from_name              text,
  subject                text NOT NULL DEFAULT '',
  snippet                text NOT NULL DEFAULT '',
  sent_at                timestamptz,
  is_snoozed             boolean NOT NULL DEFAULT false,
  snooze_until           timestamptz,
  follow_up_at           timestamptz,
  follow_up_cleared_at   timestamptz,            -- set when a reply (or manual) clears it
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

CREATE INDEX IF NOT EXISTS email_refs_workspace_idx
  ON public.email_refs (workspace_id) WHERE deleted_at IS NULL;
-- One tissue ref per thread per workspace (account_upsert / ref_upsert idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS email_refs_thread_uidx
  ON public.email_refs (workspace_id, thread_key) WHERE deleted_at IS NULL;
-- Widget/web reads: snoozed-due + awaiting-follow-up (owner-scoped).
CREATE INDEX IF NOT EXISTS email_refs_snooze_idx
  ON public.email_refs (owner_id, snooze_until)
  WHERE deleted_at IS NULL AND is_snoozed;
CREATE INDEX IF NOT EXISTS email_refs_followup_idx
  ON public.email_refs (owner_id, follow_up_at)
  WHERE deleted_at IS NULL AND follow_up_at IS NOT NULL AND follow_up_cleared_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Accounts: OWNER-only (email is per-user; nobody else sees your inbox metadata).
-- Refs: workspace-readable (a linked email card is a shared spine entity). Writes
-- op-only on both (SECURITY DEFINER ops bypass RLS).
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_refs     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_accounts_owner_read ON public.email_accounts;
CREATE POLICY email_accounts_owner_read ON public.email_accounts
  FOR SELECT
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS email_refs_workspace_read ON public.email_refs;
CREATE POLICY email_refs_workspace_read ON public.email_refs
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

-- ── op-internal guards ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_op__guard(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.email_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Email in this workspace.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.email_op__guard(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_op__guard(uuid) FROM authenticated;

-- Permission + a scoped, live, locked ref row (snooze / follow-up ops).
CREATE OR REPLACE FUNCTION public.email_op__guard_ref(p_workspace_id uuid, p_ref_id uuid)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  PERFORM public.email_op__guard(p_workspace_id);
  SELECT * INTO r FROM public.email_refs
    WHERE id = p_ref_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Email thread not found in this workspace.';
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.email_op__guard_ref(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_op__guard_ref(uuid, uuid) FROM authenticated;

-- ── email.account_upsert ─────────────────────────────────────────────────────
-- Register/refresh the cloud row for an account connected on the desktop (secrets
-- stay in the keychain). Owner-scoped, idempotent by (workspace, owner, provider,
-- address). No entity registration (accounts aren't spine entities), no activity.
CREATE OR REPLACE FUNCTION public.email_op_account_upsert(
  p_workspace_id uuid,
  p_provider text,
  p_address text,
  p_signature_html text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_unread_count integer DEFAULT NULL
)
RETURNS public.email_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.email_accounts;
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_address  text := lower(trim(coalesce(p_address, '')));
BEGIN
  PERFORM public.email_op__guard(p_workspace_id);
  IF v_provider = '' OR v_address = '' THEN
    RAISE EXCEPTION 'Provider and address are required.';
  END IF;

  INSERT INTO public.email_accounts
    (workspace_id, owner_id, provider, address, signature_html, color, status, unread_count)
  VALUES
    (p_workspace_id, auth.uid(), v_provider, v_address,
     coalesce(p_signature_html, ''), p_color,
     coalesce(NULLIF(p_status, ''), 'active'), coalesce(p_unread_count, 0))
  ON CONFLICT (workspace_id, owner_id, provider, address) WHERE deleted_at IS NULL
  DO UPDATE SET
    -- NULL params leave the stored value; only overwrite what the caller sends.
    signature_html = coalesce(p_signature_html, public.email_accounts.signature_html),
    color          = coalesce(p_color, public.email_accounts.color),
    status         = coalesce(NULLIF(p_status, ''), public.email_accounts.status),
    unread_count   = coalesce(p_unread_count, public.email_accounts.unread_count),
    updated_at     = now()
  RETURNING * INTO a;

  RETURN a;
END;
$$;

-- ── email.account_remove ─────────────────────────────────────────────────────
-- Soft-delete an account the caller owns (idempotent). Refs keep their history
-- (account_id simply points at a removed account; reads filter it).
CREATE OR REPLACE FUNCTION public.email_op_account_remove(
  p_workspace_id uuid,
  p_account_id uuid
)
RETURNS public.email_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.email_accounts;
BEGIN
  PERFORM public.email_op__guard(p_workspace_id);
  UPDATE public.email_accounts
    SET deleted_at = now(), updated_at = now()
    WHERE id = p_account_id AND workspace_id = p_workspace_id
      AND owner_id = auth.uid() AND deleted_at IS NULL
    RETURNING * INTO a;
  IF a.id IS NULL THEN
    RETURN NULL; -- not found / not owned / already removed — idempotent
  END IF;
  RETURN a;
END;
$$;

-- ── email.ref_upsert ─────────────────────────────────────────────────────────
-- Pull a thread into the tissue (the ONLY way an email reaches Supabase, AC14).
-- Idempotent by (workspace, thread_key); registers entity_type 'email_thread'
-- (id = ref.id, label = subject). Does NOT clobber snooze/follow-up state on
-- re-upsert. No activity (the calling gesture — link/snooze/convert — logs its own).
CREATE OR REPLACE FUNCTION public.email_op_ref_upsert(
  p_workspace_id uuid,
  p_thread_key text,
  p_account_id uuid DEFAULT NULL,
  p_message_key text DEFAULT NULL,
  p_from_addr text DEFAULT NULL,
  p_from_name text DEFAULT NULL,
  p_subject text DEFAULT '',
  p_snippet text DEFAULT '',
  p_sent_at timestamptz DEFAULT NULL
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
  v_thread text := trim(coalesce(p_thread_key, ''));
BEGIN
  PERFORM public.email_op__guard(p_workspace_id);
  IF v_thread = '' THEN
    RAISE EXCEPTION 'A thread key is required.';
  END IF;

  INSERT INTO public.email_refs
    (workspace_id, owner_id, account_id, thread_key, message_key,
     from_addr, from_name, subject, snippet, sent_at)
  VALUES
    (p_workspace_id, auth.uid(), p_account_id, v_thread, p_message_key,
     p_from_addr, p_from_name, coalesce(p_subject, ''), coalesce(p_snippet, ''), p_sent_at)
  ON CONFLICT (workspace_id, thread_key) WHERE deleted_at IS NULL
  DO UPDATE SET
    account_id  = coalesce(p_account_id, public.email_refs.account_id),
    message_key = coalesce(p_message_key, public.email_refs.message_key),
    from_addr   = coalesce(p_from_addr, public.email_refs.from_addr),
    from_name   = coalesce(p_from_name, public.email_refs.from_name),
    subject     = coalesce(NULLIF(p_subject, ''), public.email_refs.subject),
    snippet     = coalesce(NULLIF(p_snippet, ''), public.email_refs.snippet),
    sent_at     = coalesce(p_sent_at, public.email_refs.sent_at),
    updated_at  = now()
  RETURNING * INTO r;

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'email_thread', r.id,
    coalesce(NULLIF(r.subject, ''), '(no subject)'), 'mail');
  RETURN r;
END;
$$;

-- ── email.snooze / email.unsnooze ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_op_snooze(
  p_workspace_id uuid,
  p_ref_id uuid,
  p_snooze_until timestamptz
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);
  IF p_snooze_until IS NULL THEN
    RAISE EXCEPTION 'A snooze time is required.';
  END IF;
  UPDATE public.email_refs
    SET is_snoozed = true, snooze_until = p_snooze_until, updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.snooze',
    jsonb_build_object('until', p_snooze_until));
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_op_unsnooze(
  p_workspace_id uuid,
  p_ref_id uuid
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);
  UPDATE public.email_refs
    SET is_snoozed = false, snooze_until = NULL, updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.unsnooze', '{}'::jsonb);
  RETURN r;
END;
$$;

-- ── email.follow_up / email.clear_follow_up ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_op_follow_up(
  p_workspace_id uuid,
  p_ref_id uuid,
  p_follow_up_at timestamptz
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);
  IF p_follow_up_at IS NULL THEN
    RAISE EXCEPTION 'A follow-up time is required.';
  END IF;
  UPDATE public.email_refs
    SET follow_up_at = p_follow_up_at, follow_up_cleared_at = NULL, updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.follow_up',
    jsonb_build_object('at', p_follow_up_at));
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_op_clear_follow_up(
  p_workspace_id uuid,
  p_ref_id uuid
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);
  UPDATE public.email_refs
    SET follow_up_cleared_at = now(), updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.clear_follow_up', '{}'::jsonb);
  RETURN r;
END;
$$;

-- ── email.link ───────────────────────────────────────────────────────────────
-- Link an email_thread to any other entity through the spine's entity_links
-- keystone, attributed to Email. Idempotent + direction-agnostic (mirrors
-- contacts_op_link). Callers should `ref_upsert` first so the thread has a
-- backing email_refs row; like contacts_op_link this only ENSURES the registry
-- entry (a bare stub if absent) — it does not require a pre-existing ref.
CREATE OR REPLACE FUNCTION public.email_op_link(
  p_workspace_id uuid,
  p_thread_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_relation_kind text DEFAULT 'references',
  p_origin text DEFAULT 'manual',
  p_thread_label text DEFAULT NULL,
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
  PERFORM public.email_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;
  IF v_origin NOT IN ('manual', 'drag', 'mention', 'ref', 'suggest') THEN
    RAISE EXCEPTION 'Unknown link origin: %', v_origin;
  END IF;
  IF p_target_type = 'email_thread' AND p_target_id = p_thread_id THEN
    RAISE EXCEPTION 'An entity cannot link to itself.';
  END IF;

  PERFORM public.entities_op_ensure(p_workspace_id, 'email_thread', p_thread_id, p_thread_label, 'mail');
  PERFORM public.entities_op_ensure(p_workspace_id, p_target_type, p_target_id, p_target_label, p_target_icon);

  v_pair_key := public.spine_pair_key('email_thread', p_thread_id, p_target_type, p_target_id);

  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, 'email_thread', p_thread_id, p_target_type, p_target_id, v_kind, v_origin, auth.uid())
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    SELECT * INTO v_link FROM public.entity_links
      WHERE workspace_id = p_workspace_id AND pair_key = v_pair_key
        AND relation_kind = v_kind AND deleted_at IS NULL
      LIMIT 1;
    RETURN v_link; -- already linked, idempotent — no new activity
  END IF;

  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', p_thread_id, 'email.link',
    jsonb_build_object(
      'link_id', v_link.id, 'target_type', p_target_type, 'target_id', p_target_id,
      'relation_kind', v_kind, 'origin', v_origin));
  RETURN v_link;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
-- Signed-in users AND service_role (the MCP connector runs as service_role — the
-- keyed-write lane). Revoke anon explicitly (Supabase's default privileges grant
-- anon EXECUTE otherwise — the 20260612151000 lesson).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'email_op_account_upsert(uuid, text, text, text, text, text, integer)',
    'email_op_account_remove(uuid, uuid)',
    'email_op_ref_upsert(uuid, text, uuid, text, text, text, text, text, timestamptz)',
    'email_op_snooze(uuid, uuid, timestamptz)',
    'email_op_unsnooze(uuid, uuid)',
    'email_op_follow_up(uuid, uuid, timestamptz)',
    'email_op_clear_follow_up(uuid, uuid)',
    'email_op_link(uuid, uuid, text, uuid, text, text, text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;
