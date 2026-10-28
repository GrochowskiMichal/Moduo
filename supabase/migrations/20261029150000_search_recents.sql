-- GS-8: recents and personal ranking (specs/global-search.md AC7;
-- Assumption 14; Q11–Q13b, Q19).
--
--   1. search_recents (user_id, workspace_id, entity_type, entity_id,
--      last_opened_at, open_count): what you opened, per workspace, private to
--      you. Clients read their own rows; every write goes through the ops below,
--      so the cap and the "your own opens only" rule always hold.
--   2. search__recent_item(ws, type, id): the item, when it is in that
--      workspace, not deleted, and the caller may open it.
--   3. search_op_record_open(ws, type, id): the app records your open. An API
--      key's call records nothing (Q19). Pruned to 50 per person per workspace.
--      search_op_forget_open and search_op_clear_recents remove one or all (Q13).
--   4. search_recents_list(ws, limit): ⌘K's Recent, newest first, each row
--      checked for visibility when read (8 by default, 50 at most).
--   5. search_all's personal term: frecency (search__frecency) of your own
--      opens, weight 0.20, 0 for a key. Cut into the live body (pg_temp.recut),
--      so it keeps whichever modules' sources the live search_all has.
--   6. account_erase_workspace_data removes the person's recents; the foreign
--      keys cascade with the account and the workspace too.
--
-- Types are search_all's names: a project is a bucket, an email an
-- email_thread. Chat joins when it joins search_all (GS-6).

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.search_recents (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  open_count integer NOT NULL DEFAULT 1 CHECK (open_count >= 1),
  PRIMARY KEY (user_id, workspace_id, entity_type, entity_id)
);

-- Recent and pruning read a person's rows in a workspace, newest first.
CREATE INDEX IF NOT EXISTS search_recents_recent_idx
  ON public.search_recents (user_id, workspace_id, last_opened_at DESC);

COMMENT ON TABLE public.search_recents IS
  'Search (GS-8): what a person opened, per workspace, for ⌘K''s Recent and the personal ranking term. Private to its person; written only through search_op_record_open, search_op_forget_open and search_op_clear_recents.';

ALTER TABLE public.search_recents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS search_recents_select_own ON public.search_recents;
CREATE POLICY search_recents_select_own ON public.search_recents
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.search_recents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.search_recents TO authenticated;
GRANT ALL ON public.search_recents TO service_role;

-- ── 2. The item behind a recent ──────────────────────────────────────────────
-- One row when the item is in this workspace, not deleted, and the caller may
-- open it (perm_can_see_entity, the registry's own check); nothing otherwise.
-- Someone else's private event is never shown (Q23).

CREATE OR REPLACE FUNCTION public.search__recent_type(p_type text)
  RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = ''
AS $$
  SELECT CASE lower(btrim(coalesce(p_type, '')))
           WHEN 'project' THEN 'bucket'
           WHEN 'email' THEN 'email_thread'
           WHEN 'task' THEN 'task' WHEN 'bucket' THEN 'bucket' WHEN 'note' THEN 'note'
           WHEN 'contact' THEN 'contact' WHEN 'company' THEN 'company' WHEN 'event' THEN 'event'
           WHEN 'email_thread' THEN 'email_thread'
         END
$$;

CREATE OR REPLACE FUNCTION public.search__recent_item(p_workspace_id uuid, p_type text, p_id uuid)
  RETURNS TABLE (title text, icon text, archived boolean, updated_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_title text;
  v_archived boolean := false;
  v_updated timestamptz;
BEGIN
  IF p_workspace_id IS NULL OR p_id IS NULL THEN
    RETURN;
  END IF;
  IF p_type = 'note' THEN
    SELECT n.title, coalesce(n.is_archived, false), n.updated_at INTO v_title, v_archived, v_updated
      FROM public.notes n WHERE n.id = p_id AND n.workspace_id = p_workspace_id AND n.deleted_at IS NULL;
  ELSIF p_type = 'task' THEN
    SELECT t.title, b.archived_at IS NOT NULL, t.updated_at INTO v_title, v_archived, v_updated
      FROM public.tasks t LEFT JOIN public.buckets b ON b.id = t.bucket_id
     WHERE t.id = p_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL;
  ELSIF p_type = 'bucket' THEN
    SELECT b.name, b.archived_at IS NOT NULL, b.updated_at INTO v_title, v_archived, v_updated
      FROM public.buckets b WHERE b.id = p_id AND b.workspace_id = p_workspace_id AND b.deleted_at IS NULL;
  ELSIF p_type = 'contact' THEN
    SELECT c.name, c.updated_at INTO v_title, v_updated
      FROM public.contacts c WHERE c.id = p_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL;
  ELSIF p_type = 'company' THEN
    SELECT c.name, c.updated_at INTO v_title, v_updated
      FROM public.companies c WHERE c.id = p_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL;
  ELSIF p_type = 'event' THEN
    SELECT e.title, e.updated_at INTO v_title, v_updated
      FROM public.calendar_events e
     WHERE e.id = p_id AND e.workspace_id = p_workspace_id AND e.deleted_at IS NULL
       AND (NOT coalesce(e.is_private, false) OR e.owner_id = public.perm_actor_id());
  ELSIF p_type = 'email_thread' THEN
    SELECT r.subject, r.updated_at INTO v_title, v_updated
      FROM public.email_refs r WHERE r.id = p_id AND r.workspace_id = p_workspace_id AND r.deleted_at IS NULL;
  ELSE
    RETURN;
  END IF;
  IF v_updated IS NULL OR NOT coalesce(public.perm_can_see_entity(p_workspace_id, p_type, p_id), false) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT coalesce(v_title, ''),
           (SELECT e.icon FROM public.entities e
             WHERE e.workspace_id = p_workspace_id AND e.entity_type = p_type AND e.entity_id = p_id),
           coalesce(v_archived, false), v_updated;
END;
$$;

COMMENT ON FUNCTION public.search__recent_item(uuid, text, uuid) IS
  'Search (GS-8): the item behind a recent (title, icon, archived, updated_at) when it is in the workspace, not deleted, and the caller may open it; no row otherwise.';

-- ── 3. Recording, removing, clearing ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_op_record_open(p_workspace_id uuid, p_entity_type text, p_entity_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_type text := public.search__recent_type(p_entity_type);
BEGIN
  -- Only a person's own opens count: an API key (its agent) never does (Q19).
  IF v_me IS NULL OR public.module_api_key_id() IS NOT NULL
     OR p_workspace_id IS NULL OR p_entity_id IS NULL OR v_type IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members m
                  WHERE m.workspace_id = p_workspace_id AND m.user_id = v_me) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.search__recent_item(p_workspace_id, v_type, p_entity_id)) THEN
    RETURN false;
  END IF;

  INSERT INTO public.search_recents AS r (user_id, workspace_id, entity_type, entity_id, last_opened_at, open_count)
  VALUES (v_me, p_workspace_id, v_type, p_entity_id, now(), 1)
  ON CONFLICT (user_id, workspace_id, entity_type, entity_id)
  DO UPDATE SET last_opened_at = now(), open_count = least(r.open_count, 999999) + 1;

  -- Keep the 50 newest per person per workspace.
  DELETE FROM public.search_recents r
   WHERE r.user_id = v_me AND r.workspace_id = p_workspace_id
     AND (r.entity_type, r.entity_id) IN (
       SELECT k.entity_type, k.entity_id FROM public.search_recents k
        WHERE k.user_id = v_me AND k.workspace_id = p_workspace_id
        ORDER BY k.last_opened_at DESC, k.entity_type, k.entity_id
        OFFSET 50);
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.search_op_record_open(uuid, text, uuid) IS
  'Search (GS-8): records the caller''s open of an item they can see, for Recent and the personal ranking. An API key records nothing (Q19). Keeps the 50 newest per person per workspace. True when recorded.';

CREATE OR REPLACE FUNCTION public.search_op_forget_open(p_workspace_id uuid, p_entity_type text, p_entity_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RETURN false;
  END IF;
  DELETE FROM public.search_recents r
   WHERE r.user_id = v_me AND r.workspace_id = p_workspace_id
     AND r.entity_type = public.search__recent_type(p_entity_type) AND r.entity_id = p_entity_id;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.search_op_forget_open(uuid, text, uuid) IS
  'Search (GS-8): removes one item from the caller''s Recent in a workspace (Q13). True when it was there.';

CREATE OR REPLACE FUNCTION public.search_op_clear_recents(p_workspace_id uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n integer;
BEGIN
  IF v_me IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM public.search_recents r WHERE r.user_id = v_me AND r.workspace_id = p_workspace_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.search_op_clear_recents(uuid) IS
  'Search (GS-8): clears the caller''s Recent in a workspace (Q13). Returns how many items it removed.';

-- ── 4. Recent ────────────────────────────────────────────────────────────────
-- SearchHit rows (match 'title', rank 0, no snippet or context) plus when you
-- last opened each. Visibility is checked as the list is read, so an item you
-- lost access to (or trashed) drops out and the next one moves up.

CREATE OR REPLACE FUNCTION public.search_recents_list(p_workspace_id uuid, p_limit integer DEFAULT 8)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text, icon text,
                 match text, rank real, updated_at timestamptz, archived boolean, last_opened_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 50);
BEGIN
  IF v_me IS NULL OR public.module_api_key_id() IS NOT NULL OR p_workspace_id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.entity_type, r.entity_id, i.title, NULL::text, NULL::text, i.icon, 'title'::text, 0::real,
           i.updated_at, i.archived, r.last_opened_at
      FROM public.search_recents r
     CROSS JOIN LATERAL public.search__recent_item(r.workspace_id, r.entity_type, r.entity_id) i
     WHERE r.user_id = v_me AND r.workspace_id = p_workspace_id
     ORDER BY r.last_opened_at DESC, r.entity_type, r.entity_id
     LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.search_recents_list(uuid, integer) IS
  'Search (GS-8): ⌘K''s Recent: the caller''s last opened items in a workspace, newest first, each one they can still open (8 by default, 50 at most). Empty for an API key.';

-- ── 5. The personal term ─────────────────────────────────────────────────────
-- Frecency in 0..1: how often (log-scaled, 20 opens = 1) times how lately
-- (halves every 14 days). Weighted 0.20 in search_all: gently, below text (Q13b).

CREATE OR REPLACE FUNCTION public.search__frecency(p_count integer, p_last timestamptz)
  RETURNS real
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  SELECT CASE WHEN p_count IS NULL OR p_count < 1 OR p_last IS NULL THEN 0::real
    ELSE least(1.0, ln(1 + p_count) / ln(21.0)
                    * power(0.5, greatest(extract(epoch FROM (now() - p_last)), 0) / (14 * 86400.0)))::real
  END
$$;

COMMENT ON FUNCTION public.search__frecency(integer, timestamptz) IS
  'Search (GS-8): frecency of a person''s opens in 0..1 (log-scaled count, 20 opens = 1, halving every 14 days). search_all''s personal term.';

-- search_all is SECURITY INVOKER: a person reads their own rows through RLS;
-- the service role (an API key) has no auth.uid(), so nothing matches, and the
-- key check says so outright.
CREATE OR REPLACE FUNCTION pg_temp.recut(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
BEGIN
  -- Already cut (a re-run): the new text may contain the old, so look for it first.
  IF position(p_new IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old IN v_def) = 0 THEN
    RAISE EXCEPTION '% isn''t the body this migration expects; redefine it by hand.', p_fn;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$$;

SELECT pg_temp.recut('public.search_all(uuid, text, text[], integer, text, uuid)'::regprocedure,
$o$+ 0.20 * 0
$o$,
$n$+ 0.20 * coalesce((SELECT public.search__frecency(sr.open_count, sr.last_opened_at)
                                     FROM public.search_recents sr
                                    WHERE sr.user_id = auth.uid() AND public.module_api_key_id() IS NULL
                                      AND sr.workspace_id = p_workspace_id
                                      AND sr.entity_type = o.entity_type AND sr.entity_id = o.entity_id), 0)
$n$);

COMMENT ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) IS
  'Search (GS-3, GS-8): ⌘K''s one search. Merges every module''s <module>__search (registry__search for types not yet on the contract), ranks (0.55 text, 0.15 recency, 0.20 your own opens, 0.10 context), and returns up to limit_per_type rows per type with the type''s total and one Top result. SECURITY INVOKER: every hit comes from a module function that resolves the caller.';

-- ── 6. Account erasure ───────────────────────────────────────────────────────
-- Changed in place from its live body (as CV-18, CV-20, CV-22).

SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$  v_saved_statuses integer;
$o$,
$n$  v_saved_statuses integer;
  v_search_recents integer;
$n$);
SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$o$,
$n$  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  -- GS-8: what they opened, in every workspace.
  SELECT count(*) INTO v_search_recents FROM public.search_recents x WHERE x.user_id = p_user;
$n$);
-- jsonb_build_object takes at most 100 arguments and the counts already use
-- them all: this one is merged on.
SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$    'status_changes_deleted', v_status_changes
  );$o$,
$n$    'status_changes_deleted', v_status_changes
  ) || jsonb_build_object('search_recents_deleted', v_search_recents);$n$);
SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$o$,
$n$  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  DELETE FROM public.search_recents x WHERE x.user_id = p_user;
$n$);

-- ── 7. Grants ────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.account_erase_workspace_data(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erase_workspace_data(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) TO authenticated, service_role;

-- App RPCs: the caller is read from the request, never an argument.
REVOKE ALL ON FUNCTION public.search_op_record_open(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_op_record_open(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_op_forget_open(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_op_forget_open(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_op_clear_recents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_op_clear_recents(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_recents_list(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_recents_list(uuid, integer) TO authenticated, service_role;

-- Pure helpers search_all (SECURITY INVOKER) and the ops call: they read only
-- their arguments, so a client may hold EXECUTE.
REVOKE ALL ON FUNCTION public.search__recent_type(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search__recent_type(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search__frecency(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search__frecency(integer, timestamptz) TO authenticated, service_role;

-- Internal: called only by the definer ops above.
REVOKE ALL ON FUNCTION public.search__recent_item(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search__recent_item(uuid, text, uuid) TO service_role;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.search_op_record_open(uuid, text, uuid)',
                           'public.search_op_forget_open(uuid, text, uuid)',
                           'public.search_op_clear_recents(uuid)',
                           'public.search_recents_list(uuid, integer)',
                           'public.search_all(uuid, text, text[], integer, text, uuid)',
                           'public.search__frecency(integer, timestamptz)',
                           'public.search__recent_type(text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be callable by authenticated and service_role, never anon.', f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.search__recent_item(uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.search__recent_item(uuid, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'search__recent_item is internal: no client may call it.';
  END IF;
  IF has_table_privilege('anon', 'public.search_recents', 'SELECT')
     OR has_table_privilege('authenticated', 'public.search_recents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.search_recents', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.search_recents', 'DELETE') THEN
    RAISE EXCEPTION 'search_recents: clients may only read their own rows.';
  END IF;
  IF position('search__frecency' IN pg_get_functiondef(
       'public.search_all(uuid, text, text[], integer, text, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'search_all lost its personal term.';
  END IF;
END;
$$;
