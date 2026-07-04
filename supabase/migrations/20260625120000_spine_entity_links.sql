-- Connective-tissue spine — block CT-1: the link substrate.
-- (specs/connective-tissue.md block 1; .design/connective-tissue/DESIGN_BRIEF.md §Data.)
--
-- The keystone of Moduo's moat: any entity can link to any other. This migration
-- adds the central polymorphic `entities` registry (the referential anchor),
-- the typed `entity_links` table (THE keystone), and the `link_suggestion_declines`
-- table, plus the spine intent ops (`links_op_create` / `_set_kind` / `_delete`)
-- and the registry helpers (`entities_op_upsert` authoritative write /
-- `entities_op_ensure` link-time insert-if-absent / `entities_op_tombstone`).
--
-- Mirrors the proven Tasks intent-op pattern (…_module_activity_intent_ops.sql):
--   * Pillar 1 — intent ops: SECURITY DEFINER plpgsql, SET search_path=public,
--     permission guard + mutation + attributed `module_activity` row in ONE txn.
--   * Pillar 2 — actor attribution: derived server-side from auth.uid().
--   * Pillar 3 — activity: writes the shared append-only `module_activity` table.
--   * Pillar 4 — permission: `spine_module_permission()` normalizes the
--     none/view/edit/admin ladder; ops require edit+.
--
-- RLS posture: `entities`, `entity_links`, `link_suggestion_declines` are
-- READ-only to members (SELECT policy) — every state-changing write goes through
-- the SECURITY DEFINER ops, never a raw client write (module contract Pillar 1).
-- This matches `module_activity`, the other cross-module spine table. The
-- workspace-access predicate `tasks_module_can_access_workspace` is module-
-- agnostic (owner OR member) and is already reused by `module_activity`, so the
-- spine reuses it rather than cloning a near-identical function.

-- ── Pillar 4: permission helper ──────────────────────────────────────────────
-- Owner → admin; member → their normalized Tasks permission level (legacy
-- write/read mapped). At alpha the spine reuses the Tasks permission lane
-- (`permissions_tasks`) as the link-edit gate: Tasks is the proving link
-- consumer and links are task-centric. A dedicated `permissions_spine` lane is
-- a one-line future migration if cross-module link permissions ever diverge.
-- SECURITY DEFINER so the membership lookup bypasses RLS and can't recurse.
CREATE OR REPLACE FUNCTION public.spine_module_permission(p_workspace_id uuid)
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

REVOKE ALL ON FUNCTION public.spine_module_permission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spine_module_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spine_module_permission(uuid) TO service_role;

-- ── Canonical direction-agnostic pair key ────────────────────────────────────
-- The SINGLE source of truth for the unordered-pair dedupe key, used by the
-- `entity_links.pair_key` generated column, `links_op_create`, and (block 6)
-- `link_suggestion_declines`. The `<=` comparison is forced to the byte-order
-- "C" collation so it provably matches the TS mirror `deriveLinkKey` (JS
-- code-unit `<=`) regardless of the database's default collation — the output
-- string itself carries no collation. IMMUTABLE so it is legal in a generated
-- column. Keep this in lockstep with src/lib/entity-links.ts:deriveLinkKey.
CREATE OR REPLACE FUNCTION public.spine_pair_key(
  a_type text, a_id uuid, b_type text, b_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN (a_type || ':' || a_id::text) COLLATE "C"
       <= (b_type || ':' || b_id::text) COLLATE "C"
    THEN (a_type || ':' || a_id::text) || '|' || (b_type || ':' || b_id::text)
    ELSE (b_type || ':' || b_id::text) || '|' || (a_type || ':' || a_id::text)
  END;
$$;

REVOKE ALL ON FUNCTION public.spine_pair_key(text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spine_pair_key(text, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spine_pair_key(text, uuid, text, uuid) TO service_role;

-- ── The central polymorphic registry ─────────────────────────────────────────
-- One referential anchor for the whole spine. UPSERTED by every module intent
-- op in the same transaction as its own mutation (a single-row PK upsert). Gives
-- the spine: one indexed FK anchor, one search/@mention/roll-up label projection,
-- and clean tombstone-on-delete (deleted_at) instead of dangling polymorphic refs.
CREATE TABLE IF NOT EXISTS public.entities (
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  entity_type  text NOT NULL,  -- 'task'|'note'|'contact'|'company'|'payment'|'email'|'event'|...
  entity_id    uuid NOT NULL,
  label        text NOT NULL DEFAULT '',  -- denormalized title for search + @mention + roll-up
  icon         text,                       -- type glyph hint (resolved client-side to a lucide icon)
  deleted_at   timestamptz,                -- tombstone → cascade dimming + search exclusion
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entity_type, entity_id)
);

-- Search + @mention picker: live entities by label within a workspace.
CREATE INDEX IF NOT EXISTS entities_workspace_label_idx
  ON public.entities (workspace_id, label)
  WHERE deleted_at IS NULL;

-- ── THE keystone: entity_links ───────────────────────────────────────────────
-- One table, typed, polymorphic both ends, FK'd into the registry. Direction is
-- preserved in source/target; uniqueness is direction-agnostic (see pair_key).
CREATE TABLE IF NOT EXISTS public.entity_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  source_type   text NOT NULL,
  source_id     uuid NOT NULL,
  target_type   text NOT NULL,
  target_id     uuid NOT NULL,
  relation_kind text NOT NULL DEFAULT 'references'
    CHECK (relation_kind IN (
      'references', 'spawned-from', 'blocks', 'attachment',
      'mentions', 'works-at', 'follow-up', 'paid-by'
    )),
  origin        text NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'drag', 'mention', 'ref', 'suggest')),
  -- Actor attribution (Pillar 2): never an unattributed link. NOT NULL so an
  -- anon/actor-less write fails loudly rather than persisting a NULL author.
  created_by    uuid NOT NULL DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  -- Direction-agnostic dedupe key, via the canonical IMMUTABLE helper (the same
  -- formula the ops + TS deriveLinkKey use). STORED so the partial unique index
  -- below can dedupe regardless of source/target order.
  pair_key      text GENERATED ALWAYS AS (
    public.spine_pair_key(source_type, source_id, target_type, target_id)
  ) STORED,
  -- No self-links.
  CONSTRAINT entity_links_not_self
    CHECK (NOT (source_type = target_type AND source_id = target_id)),
  FOREIGN KEY (workspace_id, source_type, source_id)
    REFERENCES public.entities (workspace_id, entity_type, entity_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, target_type, target_id)
    REFERENCES public.entities (workspace_id, entity_type, entity_id) ON DELETE CASCADE
);

-- Direction-agnostic uniqueness: one live link per (workspace, unordered pair, kind).
-- Partial (live only) so a soft-deleted link never blocks re-linking the pair.
CREATE UNIQUE INDEX IF NOT EXISTS entity_links_unique_pair_kind_idx
  ON public.entity_links (workspace_id, pair_key, relation_kind)
  WHERE deleted_at IS NULL;

-- Both ends indexed so a hub roll-up is ONE indexed query, never N fan-outs.
CREATE INDEX IF NOT EXISTS entity_links_source_idx
  ON public.entity_links (workspace_id, source_type, source_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS entity_links_target_idx
  ON public.entity_links (workspace_id, target_type, target_id)
  WHERE deleted_at IS NULL;

-- ── "Remember my no": dismissed auto-suggestions ─────────────────────────────
-- Block 6 (deterministic auto-suggest) writes/reads this; created here so the
-- substrate is complete. Direction-agnostic via pair_key so a no sticks
-- regardless of which way the suggestion was framed.
CREATE TABLE IF NOT EXISTS public.link_suggestion_declines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  pair_key     text NOT NULL,
  declined_by  uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, pair_key)
);

CREATE INDEX IF NOT EXISTS link_suggestion_declines_workspace_idx
  ON public.link_suggestion_declines (workspace_id);

-- ── Registry helpers (op-internal; not client-callable) ──────────────────────
-- entities_op_upsert: the AUTHORITATIVE write — an entity's own create/rename op
-- calls this to register/refresh its label+icon and to revive a tombstone (a
-- re-created entity is live again). Owns the registry projection. Called inside
-- permission-checked ops, so it does no guard itself.
CREATE OR REPLACE FUNCTION public.entities_op_upsert(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_label text DEFAULT NULL,
  p_icon text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon, updated_at)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, coalesce(p_label, ''), p_icon, now())
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE
    SET label = CASE WHEN p_label IS NOT NULL AND p_label <> '' THEN excluded.label
                     ELSE public.entities.label END,
        icon = coalesce(p_icon, public.entities.icon),
        deleted_at = NULL,  -- a re-created/renamed entity is live again
        updated_at = now();
$$;

REVOKE ALL ON FUNCTION public.entities_op_upsert(uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.entities_op_upsert(uuid, text, uuid, text, text) FROM authenticated;

-- entities_op_ensure: the NON-AUTHORITATIVE write used at link time — insert the
-- endpoint with a best-effort label IF it is not already registered, and do
-- NOTHING if it exists. Never overwrites an owning op's authoritative label and
-- never revives a tombstone (so a drag carrying a stale title can't corrupt
-- search/@mention or silently un-delete an entity).
CREATE OR REPLACE FUNCTION public.entities_op_ensure(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_label text DEFAULT NULL,
  p_icon text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, coalesce(p_label, ''), p_icon)
  ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.entities_op_ensure(uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.entities_op_ensure(uuid, text, uuid, text, text) FROM authenticated;

-- ── op-internal guard: permission only (links have no single owning row) ─────
CREATE OR REPLACE FUNCTION public.spine_op__guard(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.spine_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to links in this workspace.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.spine_op__guard(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.spine_op__guard(uuid) FROM authenticated;

-- ── entities.tombstone (public op): soft-delete a registry entry ─────────────
-- The "deleting an entity sets deleted_at" half of the registry contract. A
-- module's own delete op calls this in its transaction; exposed as a guarded op
-- so the capability is testable before each module wires it in (block 7).
CREATE OR REPLACE FUNCTION public.entities_op_tombstone(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = p_entity_type
      AND entity_id = p_entity_id
      AND deleted_at IS NULL;
END;
$$;

-- ── links.create ─────────────────────────────────────────────────────────────
-- Idempotent, direction-agnostic. Registers both endpoints (without reviving a
-- tombstone), then inserts the link; a duplicate (same unordered pair + kind)
-- no-ops and returns the existing live row. Rejects unknown kinds and self-links.
-- Stamps origin (drag|mention|ref|suggest|manual) and logs an attributed row.
CREATE OR REPLACE FUNCTION public.links_op_create(
  p_workspace_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_relation_kind text DEFAULT 'references',
  p_origin text DEFAULT 'manual',
  p_source_label text DEFAULT NULL,
  p_source_icon text DEFAULT NULL,
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
  PERFORM public.spine_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;
  IF v_origin NOT IN ('manual', 'drag', 'mention', 'ref', 'suggest') THEN
    RAISE EXCEPTION 'Unknown link origin: %', v_origin;
  END IF;
  IF p_source_type = p_target_type AND p_source_id = p_target_id THEN
    RAISE EXCEPTION 'An entity cannot link to itself.';
  END IF;

  -- Ensure both endpoints exist in the registry (satisfies the FK) without
  -- clobbering an owning op's authoritative label or reviving a tombstone.
  PERFORM public.entities_op_ensure(p_workspace_id, p_source_type, p_source_id,
                                    p_source_label, p_source_icon);
  PERFORM public.entities_op_ensure(p_workspace_id, p_target_type, p_target_id,
                                    p_target_label, p_target_icon);

  v_pair_key := public.spine_pair_key(p_source_type, p_source_id, p_target_type, p_target_id);

  -- Idempotent insert: the partial unique index makes a re-link a no-op even
  -- under concurrent (async-multiplayer) creates from either direction.
  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, p_source_type, p_source_id, p_target_type, p_target_id, v_kind, v_origin, auth.uid())
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
    p_workspace_id, 'links', p_source_type, p_source_id, 'links.create',
    jsonb_build_object(
      'link_id', v_link.id,
      'target_type', p_target_type, 'target_id', p_target_id,
      'relation_kind', v_kind, 'origin', v_origin)
  );
  RETURN v_link;
END;
$$;

-- ── links.set_kind ───────────────────────────────────────────────────────────
-- Re-type an existing live link. No-op if unchanged. A kind change that would
-- collide with an existing live link for the same pair surfaces a friendly error.
CREATE OR REPLACE FUNCTION public.links_op_set_kind(
  p_workspace_id uuid,
  p_link_id uuid,
  p_relation_kind text
)
RETURNS public.entity_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.entity_links;
  v_from text;
  v_kind text := p_relation_kind;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found in this workspace.';
  END IF;
  IF v_link.relation_kind = v_kind THEN
    RETURN v_link; -- no-op, no log
  END IF;

  v_from := v_link.relation_kind;
  BEGIN
    UPDATE public.entity_links
      SET relation_kind = v_kind
      WHERE id = v_link.id
      RETURNING * INTO v_link;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'These two are already linked as %.', v_kind;
  END;

  PERFORM public.module_activity_log(
    p_workspace_id, 'links', v_link.source_type, v_link.source_id, 'links.set_kind',
    jsonb_build_object(
      'link_id', v_link.id, 'from', v_from, 'to', v_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$$;

-- ── links.delete ─────────────────────────────────────────────────────────────
-- Soft-delete (deleted_at) so Undo and re-link are clean and the partial unique
-- index frees up immediately. Idempotent: deleting an already-gone link no-ops.
CREATE OR REPLACE FUNCTION public.links_op_delete(
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
  PERFORM public.spine_op__guard(p_workspace_id);

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    -- Idempotent no-op: return the already-tombstoned row, or SQL NULL if the
    -- link never existed in this workspace (never an all-NULL composite row).
    SELECT * INTO v_link FROM public.entity_links
      WHERE id = p_link_id AND workspace_id = p_workspace_id;
    IF v_link.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN v_link;
  END IF;

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE id = v_link.id
    RETURNING * INTO v_link;

  PERFORM public.module_activity_log(
    p_workspace_id, 'links', v_link.source_type, v_link.source_id, 'links.delete',
    jsonb_build_object(
      'link_id', v_link.id, 'relation_kind', v_link.relation_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read for members; writes are op-only (SECURITY DEFINER bypasses RLS). Reuses
-- the module-agnostic workspace-access predicate already used by module_activity.
ALTER TABLE public.entities                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_links             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_suggestion_declines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entities_workspace_read ON public.entities;
CREATE POLICY entities_workspace_read ON public.entities
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

DROP POLICY IF EXISTS entity_links_workspace_read ON public.entity_links;
CREATE POLICY entity_links_workspace_read ON public.entity_links
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

DROP POLICY IF EXISTS link_suggestion_declines_workspace_read ON public.link_suggestion_declines;
CREATE POLICY link_suggestion_declines_workspace_read ON public.link_suggestion_declines
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

-- ── grants ───────────────────────────────────────────────────────────────────
-- Public ops are callable by signed-in users only (v1). Supabase's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE on new functions to anon/authenticated/service_role,
-- so REVOKE FROM PUBLIC alone leaves them anon-executable — revoke anon
-- explicitly (the lesson of 20260612151000_intent_ops_revoke_anon.sql).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'links_op_create(uuid, text, uuid, text, uuid, text, text, text, text, text, text)',
    'links_op_set_kind(uuid, uuid, text)',
    'links_op_delete(uuid, uuid)',
    'entities_op_tombstone(uuid, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;

-- Op-internal helpers must never be anon-reachable (they self-trust auth.uid()).
REVOKE ALL ON FUNCTION public.spine_module_permission(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.spine_op__guard(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.entities_op_upsert(uuid, text, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.entities_op_ensure(uuid, text, uuid, text, text) FROM anon;
