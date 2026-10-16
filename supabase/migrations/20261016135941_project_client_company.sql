-- MOD-155 · A project's client can be a company (Maciej, 2026-10-16: "The
-- client row on projects can only be a person now, but it could also be a
-- company"; decision in docs/decisions/tasks.md "MOD-155").
--
--   * buckets.client_company_id: the project's client when it's a company
--     (public.companies, ON DELETE SET NULL, like client_contact_id). A
--     project's client is a contact or a company, never both:
--     buckets_client_one_kind refuses a row with both set.
--   * The project ops take `client_company_id` beside `client_contact_id`.
--     Setting one clears the other; naming both in one patch is refused.
--   * The guard trigger checks a company the way it checks a contact: live,
--     in this workspace, and one the setter can open. Missing, deleted, in
--     another workspace and private all get the same message, so it never
--     confirms that a private company exists. A company cleared by its
--     foreign key (deleted for good) passes the edit gate, as a contact does.
--
-- Redefines, each re-cut from its live body: buckets__project_check
-- (20261011110000_task_sessions_access), projects__apply_fields,
-- projects_op_update and projects_op_create (20261013240000). Signatures are
-- unchanged, so CREATE OR REPLACE keeps every grant; the trigger is
-- re-created to watch the new column. No new table or policy: the column is
-- the project's, read and written under the project's rules. Erasure needs no
-- step: a deleted account's private companies go by `DELETE`, and the
-- foreign key clears the project's client (supabase/tests/project_client.test.sql).
-- "Duplicate project…" and templates don't copy a client today; unchanged.

DO $$
BEGIN
  IF to_regprocedure('public.projects__apply_fields(public.buckets, jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'buckets' AND column_name = 'description') THEN
    RAISE EXCEPTION 'Apply TV-U16 (20261013240000_project_description_team_defaults) before this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                 WHERE oid = 'public.buckets__project_check()'::regprocedure
                   AND prosrc LIKE '%pg_trigger_depth()%') THEN
    RAISE EXCEPTION 'Apply TV-D10-fix (20261011110000_task_sessions_access) before this migration.';
  END IF;
END;
$$;

-- ── 1. The column ───────────────────────────────────────────────────────────

ALTER TABLE public.buckets
  ADD COLUMN IF NOT EXISTS client_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_client_one_kind;
ALTER TABLE public.buckets ADD CONSTRAINT buckets_client_one_kind
  CHECK (client_contact_id IS NULL OR client_company_id IS NULL);

CREATE INDEX IF NOT EXISTS buckets_client_company_id_idx
  ON public.buckets (client_company_id) WHERE client_company_id IS NOT NULL;

-- ── 2. The guard (20261011110000's body, plus the company) ──────────────────

CREATE OR REPLACE FUNCTION public.buckets__project_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF NEW.is_system AND (NEW.status <> 'active' OR NEW.starts_on IS NOT NULL OR NEW.target_on IS NOT NULL
                        OR NEW.lead_id IS NOT NULL OR NEW.client_contact_id IS NOT NULL
                        OR NEW.client_company_id IS NOT NULL) THEN
    RAISE EXCEPTION 'The Inbox isn''t a project, so it has no project settings or sections.' USING ERRCODE = '22023';
  END IF;
  -- System hand-overs (member removal, account erasure) aren't checked.
  IF coalesce(current_setting('share.bypass', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  -- The same gate as the project ops: changing a project's fields needs edit
  -- on it (PERM-W's write check says so too; this keeps one helper). A write
  -- another trigger makes skips it only when all it does is clear the lead or
  -- the client (a profile, a contact or a company deleted for good).
  IF TG_OP = 'UPDATE' AND v_actor IS NOT NULL
     AND row(NEW.status, NEW.starts_on, NEW.target_on, NEW.lead_id, NEW.client_contact_id, NEW.client_company_id)
         IS DISTINCT FROM row(OLD.status, OLD.starts_on, OLD.target_on, OLD.lead_id, OLD.client_contact_id, OLD.client_company_id)
     AND NOT (pg_trigger_depth() > 1
              AND row(NEW.status, NEW.starts_on, NEW.target_on)
                  IS NOT DISTINCT FROM row(OLD.status, OLD.starts_on, OLD.target_on)
              AND (NEW.lead_id IS NOT DISTINCT FROM OLD.lead_id OR NEW.lead_id IS NULL)
              AND (NEW.client_contact_id IS NOT DISTINCT FROM OLD.client_contact_id OR NEW.client_contact_id IS NULL)
              AND (NEW.client_company_id IS NOT DISTINCT FROM OLD.client_company_id OR NEW.client_company_id IS NULL))
     AND NOT public.projects__editable(NEW.id) THEN
    RAISE EXCEPTION 'You don''t have edit access to this project.' USING ERRCODE = '42501';
  END IF;
  IF NEW.lead_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.lead_id IS DISTINCT FROM OLD.lead_id)
     AND NOT public.tasks__is_member(NEW.workspace_id, NEW.lead_id) THEN
    RAISE EXCEPTION 'A project''s lead has to be in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF NEW.client_contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.client_contact_id IS DISTINCT FROM OLD.client_contact_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.contacts c
                   WHERE c.id = NEW.client_contact_id AND c.workspace_id = NEW.workspace_id
                     AND c.deleted_at IS NULL)
       OR (v_actor IS NOT NULL AND NOT public.can_access('contact', NEW.client_contact_id, 'view', v_actor)) THEN
      RAISE EXCEPTION 'That contact isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- MOD-155: a company client, checked like a contact one.
  IF NEW.client_company_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.client_company_id IS DISTINCT FROM OLD.client_company_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.companies co
                   WHERE co.id = NEW.client_company_id AND co.workspace_id = NEW.workspace_id
                     AND co.deleted_at IS NULL)
       OR (v_actor IS NOT NULL AND NOT public.can_access('company', NEW.client_company_id, 'view', v_actor)) THEN
      RAISE EXCEPTION 'That company isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger watches the new column too: without it an editor's raw write
-- of client_company_id (the project policy allows direct row writes) would
-- skip the checks above.
DROP TRIGGER IF EXISTS buckets_project_check ON public.buckets;
CREATE TRIGGER buckets_project_check
  BEFORE INSERT OR UPDATE OF status, starts_on, target_on, lead_id, client_contact_id, client_company_id, is_system
  ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.buckets__project_check();

-- ── 3. The ops (20261013240000's bodies, plus the company) ──────────────────

CREATE OR REPLACE FUNCTION public.projects__apply_fields(b buckets, p_fields jsonb)
 RETURNS buckets
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_fields ? 'name' THEN
    b.name := public.tasks__clean_name(p_fields ->> 'name', 'A project', 120);
  END IF;
  IF p_fields ? 'status' THEN
    IF coalesce(p_fields ->> 'status', '') NOT IN ('active', 'on_hold', 'done') THEN
      RAISE EXCEPTION 'A project is Active, On hold or Done.' USING ERRCODE = '22023';
    END IF;
    b.status := p_fields ->> 'status';
  END IF;
  IF p_fields ? 'starts_on' THEN
    b.starts_on := public.tasks__patch_date(p_fields, 'starts_on');
  END IF;
  IF p_fields ? 'target_on' THEN
    b.target_on := public.tasks__patch_date(p_fields, 'target_on');
  END IF;
  IF b.starts_on IS NOT NULL AND b.target_on IS NOT NULL AND b.starts_on > b.target_on THEN
    RAISE EXCEPTION 'A project''s target date can''t be before its start.' USING ERRCODE = '22023';
  END IF;
  IF p_fields ? 'lead_id' THEN
    b.lead_id := public.tasks__try_uuid(p_fields ->> 'lead_id');
    IF p_fields ->> 'lead_id' IS NOT NULL AND b.lead_id IS NULL THEN
      RAISE EXCEPTION 'A project''s lead has to be in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- MOD-155: the client is a contact or a company. Naming one clears the
  -- other; naming both is refused.
  IF p_fields ->> 'client_contact_id' IS NOT NULL AND p_fields ->> 'client_company_id' IS NOT NULL THEN
    RAISE EXCEPTION 'A project''s client is a person or a company, not both.' USING ERRCODE = '22023';
  END IF;
  IF p_fields ? 'client_contact_id' THEN
    b.client_contact_id := public.tasks__try_uuid(p_fields ->> 'client_contact_id');
    IF p_fields ->> 'client_contact_id' IS NOT NULL AND b.client_contact_id IS NULL THEN
      RAISE EXCEPTION 'That contact isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
    IF b.client_contact_id IS NOT NULL THEN
      b.client_company_id := NULL;
    END IF;
  END IF;
  IF p_fields ? 'client_company_id' THEN
    b.client_company_id := public.tasks__try_uuid(p_fields ->> 'client_company_id');
    IF p_fields ->> 'client_company_id' IS NOT NULL AND b.client_company_id IS NULL THEN
      RAISE EXCEPTION 'That company isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
    IF b.client_company_id IS NOT NULL THEN
      b.client_contact_id := NULL;
    END IF;
  END IF;
  IF p_fields ? 'area_id' THEN
    b.area_id := public.tasks__try_uuid(p_fields ->> 'area_id');
    IF p_fields ->> 'area_id' IS NOT NULL AND b.area_id IS NULL THEN
      RAISE EXCEPTION 'That area isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_fields ? 'position' THEN
    b.position := coalesce(p_fields ->> 'position', '');
  END IF;
  -- TV-U6: a label hue name, or null for neutral (the same check as an area's).
  IF p_fields ? 'color' THEN
    b.color := public.areas__check_color(p_fields -> 'color');
  END IF;
  -- TV-U16: the project's description (plain text; null clears it).
  IF p_fields ? 'description' THEN
    IF jsonb_typeof(p_fields -> 'description') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'A project''s description is text.' USING ERRCODE = '22023';
    END IF;
    b.description := rtrim(coalesce(p_fields ->> 'description', ''));
    IF char_length(b.description) > 20000 THEN
      RAISE EXCEPTION 'A project''s description can be up to 20,000 characters.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN b;
END;
$function$;

CREATE OR REPLACE FUNCTION public.projects_op_update(p_workspace_id uuid, p_project_id uuid, p_patch jsonb)
 RETURNS buckets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b public.buckets;
  n public.buckets;
BEGIN
  PERFORM public.tasks__check_keys(p_patch, ARRAY[
    'name', 'status', 'starts_on', 'target_on', 'lead_id', 'client_contact_id', 'client_company_id',
    'area_id', 'position', 'color', 'archived_at', 'description']);
  b := public.projects__guard(p_workspace_id, p_project_id);
  SELECT * INTO b FROM public.buckets WHERE id = b.id FOR UPDATE;
  n := public.projects__apply_fields(b, p_patch);
  IF p_patch ? 'archived_at' THEN
    n.archived_at := CASE WHEN jsonb_typeof(p_patch -> 'archived_at') = 'null' THEN NULL
                          ELSE coalesce(b.archived_at, now()) END;
    IF n.archived_at IS DISTINCT FROM b.archived_at
       AND NOT public.can_access('bucket', b.id, 'full', public.perm_actor_id()) THEN
      RAISE EXCEPTION 'Only people with full access to this project can archive or unarchive it.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF row(n.name, n.status, n.starts_on, n.target_on, n.lead_id, n.client_contact_id, n.client_company_id,
         n.area_id, n.position, n.color, n.archived_at, n.description)
     IS NOT DISTINCT FROM
     row(b.name, b.status, b.starts_on, b.target_on, b.lead_id, b.client_contact_id, b.client_company_id,
         b.area_id, b.position, b.color, b.archived_at, b.description) THEN
    RETURN b;
  END IF;
  UPDATE public.buckets SET
    name = n.name, status = n.status, starts_on = n.starts_on, target_on = n.target_on,
    lead_id = n.lead_id, client_contact_id = n.client_contact_id, client_company_id = n.client_company_id,
    area_id = n.area_id, position = n.position, color = n.color, archived_at = n.archived_at,
    description = n.description, updated_at = now()
  WHERE id = b.id
  RETURNING * INTO b;
  RETURN b;
END;
$function$;

CREATE OR REPLACE FUNCTION public.projects_op_create(p_workspace_id uuid, p_project jsonb)
 RETURNS buckets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
  v_id uuid;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(p_project, ARRAY[
    'id', 'name', 'position', 'area_id', 'status', 'starts_on', 'target_on', 'lead_id',
    'client_contact_id', 'client_company_id', 'color', 'description']);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A project needs an owner.' USING ERRCODE = '42501';
  END IF;
  v_id := coalesce(public.tasks__try_uuid(p_project ->> 'id'), gen_random_uuid());
  SELECT * INTO b FROM public.buckets WHERE id = v_id;
  IF FOUND THEN
    IF b.workspace_id IS DISTINCT FROM p_workspace_id OR NOT public.projects__visible_to(b.id, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
    RETURN b;
  END IF;

  b.id := v_id;
  b.workspace_id := p_workspace_id;
  b.owner_id := v_actor;
  b.is_system := false;
  b.status := 'active';
  b.description := '';
  b := public.projects__apply_fields(b, p_project || jsonb_build_object('name', coalesce(p_project ->> 'name', '')));
  IF nullif(b.position, '') IS NULL THEN
    b.position := public.projects__end_position(p_workspace_id);
  END IF;

  -- perm_enforce_write checks the role; the triggers check the lead, the
  -- client and the area, and set group_label.
  INSERT INTO public.buckets (
    id, workspace_id, owner_id, name, is_system, position, status, starts_on, target_on,
    lead_id, client_contact_id, client_company_id, area_id, color, description, created_at, updated_at)
  VALUES (
    b.id, b.workspace_id, b.owner_id, b.name, false, b.position, b.status, b.starts_on, b.target_on,
    b.lead_id, b.client_contact_id, b.client_company_id, b.area_id, b.color, b.description, now(), now())
  RETURNING * INTO b;
  RETURN b;
END;
$function$;

-- ── 4. Grants (unchanged; asserted) ─────────────────────────────────────────

-- CREATE OR REPLACE kept every grant. The two internal helpers stay
-- server-only, as 20261010180000's loop left them (a no-op where it ran;
-- the local stack's snapshot grants every function broadly).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['buckets__project_check()', 'projects__apply_fields(public.buckets, jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is still callable by a client role.', fn;
    END IF;
  END LOOP;
END;
$$;
