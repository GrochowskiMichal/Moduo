-- TV-D8 · Server ops, the search registry and handles (specs/tasks-v3.md
-- block 5, §Assumptions #1, #2, #6, #9).
--
--   * app_settings(key, value): app-wide settings every client may read. The
--     first one is min_build, the oldest client build that may still write
--     (§6.7). It starts at "0.0.0", so nobody is held back until TV-D7 raises it.
--   * Handles (MOD-142): workspaces.task_key (2 to 5 letters A–Z, from the
--     workspace name; the owner can change it, and every earlier key stays an
--     alias so old text still resolves) and tasks.number (a per-workspace
--     number, never reused, never changed). The counter is
--     workspaces.task_number_last; only tasks__next_number moves it.
--   * The entities registry follows every task: a trigger registers it on
--     create, re-labels it on rename, tombstones it on delete and revives it on
--     restore, on every write path (the ops below, and old builds' raw writes
--     until TV-D7 revokes them). entities.handle carries "KEY-number", so
--     search finds a task by its handle.
--   * tasks_op_create / tasks_op_update: every create and every field edit, from
--     the app, capture, MCP and imports. They check access, write, log one
--     attributed activity row and answer with the row(s). Moving a task moves
--     its subtasks in the same transaction; deleting promotes them.
--   * One dependency store: a live "blocks" link between two tasks is a
--     task_relations row (it now blocks), whichever side it was made from. The
--     relation → link mirror (20260627130000) already ran the other way.
--
-- Expand only: nothing is dropped, old builds keep working (their raw inserts
-- are numbered and registered by the triggers). Verified on the local stack by
-- supabase/tests/tasks_ops.test.sql (bun run db:test).

SET LOCAL lock_timeout = '5s';

-- ── 1. app_settings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_read ON public.app_settings;
CREATE POLICY app_settings_read ON public.app_settings
  FOR SELECT TO anon, authenticated USING (true);
-- Read-only for clients (checked before sign-in too); only the service role
-- and migrations change a setting.
REVOKE ALL ON public.app_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

INSERT INTO public.app_settings (key, value)
VALUES ('min_build', '"0.0.0"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Workspace task key and the number counter ────────────────────────────

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS task_key text,
  ADD COLUMN IF NOT EXISTS task_key_aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS task_number_last bigint NOT NULL DEFAULT 0;

-- "Moduo" → MOD, "Acme Design Studio" → ADS, "Łódź" → LOD. Letters only
-- (accents folded); a name with fewer than two letters gets TASK.
CREATE OR REPLACE FUNCTION public.workspaces__default_task_key(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_clean text;
  v_words text[];
  v_key text := '';
  v_word text;
BEGIN
  v_clean := upper(translate(translate(coalesce(p_name, ''),
      'ąćęłńóśźżáàâäãåāéèêëēíìîïīñòôöõøōúùûüūýÿçčďěňřšťžůßæœ',
      'acelnoszzaaaaaaaeeeeeiiiiinoooooouuuuuyyccdenrstzusao'),
    'ĄĆĘŁŃÓŚŹŻÁÀÂÄÃÅĀÉÈÊËĒÍÌÎÏĪÑÒÔÖÕØŌÚÙÛÜŪÝŸÇČĎĚŇŘŠŤŽŮÆŒ',
    'ACELNOSZZAAAAAAAEEEEEIIIIINOOOOOOUUUUUYYCCDENRSTZUAO'));
  v_words := array_remove(regexp_split_to_array(
    btrim(regexp_replace(v_clean, '[^A-Z]+', ' ', 'g')), ' '), '');
  IF cardinality(v_words) >= 2 THEN
    FOREACH v_word IN ARRAY v_words LOOP
      v_key := v_key || left(v_word, 1);
      EXIT WHEN length(v_key) = 5;
    END LOOP;
  ELSIF cardinality(v_words) = 1 THEN
    v_key := left(v_words[1], 3);
  END IF;
  IF length(v_key) < 2 THEN
    RETURN 'TASK';
  END IF;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.workspaces__default_task_key(text) FROM PUBLIC, anon, authenticated;

-- A new workspace gets its key and an empty counter; a change of key is
-- checked, upper-cased and remembered as an alias. The counter and the alias
-- list are never written directly (only tasks__next_number and this trigger
-- write them; system work without an actor may).
CREATE OR REPLACE FUNCTION public.workspaces__task_key_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system boolean := public.perm_actor_id() IS NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.task_key := upper(btrim(coalesce(NEW.task_key, '')));
    IF NEW.task_key !~ '^[A-Z]{2,5}$' THEN
      NEW.task_key := public.workspaces__default_task_key(NEW.name);
    END IF;
    IF NOT v_system THEN
      NEW.task_key_aliases := '{}';
      NEW.task_number_last := 0;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.task_number_last IS DISTINCT FROM OLD.task_number_last
     AND NOT v_system
     AND current_setting('tasks.counter_write', true) IS DISTINCT FROM '1' THEN
    NEW.task_number_last := OLD.task_number_last;
  END IF;
  IF NOT v_system THEN
    NEW.task_key_aliases := OLD.task_key_aliases;
  END IF;
  IF NEW.task_key IS DISTINCT FROM OLD.task_key THEN
    NEW.task_key := upper(btrim(coalesce(NEW.task_key, '')));
    IF NEW.task_key !~ '^[A-Z]{2,5}$' THEN
      RAISE EXCEPTION 'A task key is 2 to 5 letters, A to Z.' USING ERRCODE = '22023';
    END IF;
    IF OLD.task_key IS NOT NULL AND NEW.task_key IS DISTINCT FROM OLD.task_key THEN
      NEW.task_key_aliases := array_remove(
        ARRAY(SELECT DISTINCT a FROM unnest(NEW.task_key_aliases || OLD.task_key) AS a ORDER BY a),
        NEW.task_key);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.workspaces__task_key_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workspaces_task_key_insert ON public.workspaces;
CREATE TRIGGER workspaces_task_key_insert
  BEFORE INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces__task_key_guard();
DROP TRIGGER IF EXISTS workspaces_task_key_update ON public.workspaces;
CREATE TRIGGER workspaces_task_key_update
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  WHEN (OLD.task_key IS DISTINCT FROM NEW.task_key
        OR OLD.task_key_aliases IS DISTINCT FROM NEW.task_key_aliases
        OR OLD.task_number_last IS DISTINCT FROM NEW.task_number_last)
  EXECUTE FUNCTION public.workspaces__task_key_guard();

UPDATE public.workspaces
SET task_key = public.workspaces__default_task_key(name)
WHERE task_key IS NULL;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_task_key_format;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_task_key_format CHECK (task_key ~ '^[A-Z]{2,5}$');
ALTER TABLE public.workspaces ALTER COLUMN task_key SET NOT NULL;

-- The next number in a workspace. The row lock on the workspace serialises
-- concurrent creates; taking the larger of the counter and the highest number
-- in use means a number is never handed out twice.
CREATE OR REPLACE FUNCTION public.tasks__next_number(p_workspace_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v bigint;
BEGIN
  PERFORM set_config('tasks.counter_write', '1', true);
  UPDATE public.workspaces w
  SET task_number_last = greatest(
        w.task_number_last,
        coalesce((SELECT max(t.number) FROM public.tasks t WHERE t.workspace_id = w.id), 0)) + 1
  WHERE w.id = p_workspace_id
  RETURNING w.task_number_last INTO v;
  PERFORM set_config('tasks.counter_write', '', true);
  IF v IS NULL THEN
    RAISE EXCEPTION 'Workspace not found.';
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__next_number(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. tasks.number ─────────────────────────────────────────────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS number bigint;

-- Every task so far, in creation order per workspace (deleted ones burn their
-- number too). The triggers stay off for the backfill: it isn't an edit, and
-- it mustn't re-stamp updated_at or wake the notification triggers.
ALTER TABLE public.tasks DISABLE TRIGGER USER;
WITH base AS (
  SELECT t.workspace_id, coalesce(max(t.number), 0) AS used
  FROM public.tasks t GROUP BY t.workspace_id
), numbered AS (
  SELECT t.id,
         b.used + row_number() OVER (PARTITION BY t.workspace_id ORDER BY t.created_at, t.id) AS n
  FROM public.tasks t JOIN base b ON b.workspace_id = t.workspace_id
  WHERE t.number IS NULL
)
UPDATE public.tasks t SET number = numbered.n FROM numbered WHERE t.id = numbered.id;
ALTER TABLE public.tasks ENABLE TRIGGER USER;

UPDATE public.workspaces w
SET task_number_last = greatest(w.task_number_last,
  coalesce((SELECT max(t.number) FROM public.tasks t WHERE t.workspace_id = w.id), 0));

ALTER TABLE public.tasks ALTER COLUMN number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_workspace_number_key
  ON public.tasks (workspace_id, number);

-- A genuine insert gets the next number, whatever the writer sent; an upsert of
-- a row that already exists (old builds save whole rows) arrives here as an
-- INSERT first and keeps its number, so it burns none. A number never changes.
-- Named to run after perm_enforce_write.
CREATE OR REPLACE FUNCTION public.tasks__number_assign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.number INTO v_existing FROM public.tasks t WHERE t.id = NEW.id;
    IF FOUND THEN
      NEW.number := v_existing;
      RETURN NEW;
    END IF;
    NEW.number := public.tasks__next_number(NEW.workspace_id);
    RETURN NEW;
  END IF;
  IF OLD.number IS NOT NULL THEN
    NEW.number := OLD.number;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__number_assign() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_number_assign ON public.tasks;
CREATE TRIGGER tasks_number_assign
  BEFORE INSERT OR UPDATE OF number ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__number_assign();

-- ── 4. The registry follows every task ──────────────────────────────────────

ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS handle text;

-- Register (or re-label, or revive) one task. Its label is the title, its
-- handle "KEY-number".
CREATE OR REPLACE FUNCTION public.tasks__register(p_task public.tasks)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon, handle, deleted_at, updated_at)
  SELECT p_task.workspace_id, 'task', p_task.id, coalesce(p_task.title, ''), 'task',
         w.task_key || '-' || p_task.number, NULL, now()
  FROM public.workspaces w WHERE w.id = p_task.workspace_id
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE
    SET label = excluded.label,
        handle = excluded.handle,
        icon = coalesce(public.entities.icon, excluded.icon),
        deleted_at = NULL,
        updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.tasks__register(public.tasks) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tasks__registry_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      PERFORM public.tasks__register(NEW);
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    IF OLD.deleted_at IS NULL THEN
      UPDATE public.entities e
      SET deleted_at = now(), updated_at = now()
      WHERE e.workspace_id = NEW.workspace_id AND e.entity_type = 'task'
        AND e.entity_id = NEW.id AND e.deleted_at IS NULL;
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.deleted_at IS NOT NULL
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.number IS DISTINCT FROM OLD.number THEN
    PERFORM public.tasks__register(NEW);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__registry_sync() FROM PUBLIC, anon, authenticated;

-- Every task now, before the trigger: live ones registered with their title,
-- deleted ones tombstoned.
INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon, handle, deleted_at, updated_at)
SELECT t.workspace_id, 'task', t.id, coalesce(t.title, ''), 'task',
       w.task_key || '-' || t.number,
       CASE WHEN t.deleted_at IS NOT NULL THEN now() END, now()
FROM public.tasks t JOIN public.workspaces w ON w.id = t.workspace_id
ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE
  SET label = excluded.label,
      handle = excluded.handle,
      icon = coalesce(public.entities.icon, excluded.icon),
      deleted_at = CASE WHEN excluded.deleted_at IS NULL THEN NULL
                        ELSE coalesce(public.entities.deleted_at, excluded.deleted_at) END,
      updated_at = now();

DROP TRIGGER IF EXISTS tasks_registry_sync ON public.tasks;
CREATE TRIGGER tasks_registry_sync
  AFTER INSERT OR UPDATE OF title, deleted_at, number ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__registry_sync();

-- A new key re-labels every handle in the workspace.
CREATE OR REPLACE FUNCTION public.workspaces__task_key_handles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.entities e
  SET handle = NEW.task_key || '-' || t.number
  FROM public.tasks t
  WHERE e.workspace_id = NEW.id AND e.entity_type = 'task'
    AND t.id = e.entity_id AND t.workspace_id = NEW.id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.workspaces__task_key_handles() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workspaces_task_key_handles ON public.workspaces;
CREATE TRIGGER workspaces_task_key_handles
  AFTER UPDATE OF task_key ON public.workspaces
  FOR EACH ROW WHEN (OLD.task_key IS DISTINCT FROM NEW.task_key)
  EXECUTE FUNCTION public.workspaces__task_key_handles();

-- The owner changes the key (Settings → Workspace → Task key). The old key
-- stays an alias.
CREATE OR REPLACE FUNCTION public.workspace_op_set_task_key(p_workspace_id uuid, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := upper(btrim(coalesce(p_key, '')));
  w public.workspaces;
BEGIN
  IF NOT public.perm_is_owner(p_workspace_id, public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Only the workspace owner can change the task key.' USING ERRCODE = '42501';
  END IF;
  IF v_key !~ '^[A-Z]{2,5}$' THEN
    RAISE EXCEPTION 'A task key is 2 to 5 letters, A to Z.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspaces SET task_key = v_key
  WHERE id = p_workspace_id AND deleted_at IS NULL
  RETURNING * INTO w;
  IF w.id IS NULL THEN
    RAISE EXCEPTION 'Workspace not found.';
  END IF;
  RETURN jsonb_build_object('task_key', w.task_key, 'task_key_aliases', to_jsonb(w.task_key_aliases));
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_op_set_task_key(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_op_set_task_key(uuid, text) TO authenticated, service_role;

-- ── 5. Shared helpers for the ops ───────────────────────────────────────────

-- The person's Inbox in a workspace, made when it's missing.
CREATE OR REPLACE FUNCTION public.tasks__inbox(p_workspace_id uuid, p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT b.id INTO v_id FROM public.buckets b
  WHERE b.workspace_id = p_workspace_id AND b.owner_id = p_user
    AND b.is_system AND b.deleted_at IS NULL
  ORDER BY b.created_at, b.id
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.buckets (workspace_id, owner_id, name, is_system, position, created_at, updated_at)
  VALUES (p_workspace_id, p_user, 'Inbox', true, 'a0', now(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__inbox(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A position after every live task in the project (the app's 10-digit base-36
-- keys, 2^20 apart; a longer key gets a middle digit appended, like endPosition
-- in src/features/tasks/helpers.ts).
CREATE OR REPLACE FUNCTION public.tasks__end_position(p_bucket_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max text;
  v_n bigint;
BEGIN
  SELECT max(t.position COLLATE "C") INTO v_max FROM public.tasks t
  WHERE t.bucket_id = p_bucket_id AND t.deleted_at IS NULL;
  IF v_max IS NULL OR v_max = '' THEN
    RETURN public.tasks_queue__key(1048576);
  END IF;
  v_n := public.tasks_queue__num(v_max);
  IF v_n IS NOT NULL AND v_n + 1048576 < 3656158440062976 THEN
    RETURN public.tasks_queue__key(v_n + 1048576);
  END IF;
  RETURN v_max || 'i';
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__end_position(uuid) FROM PUBLIC, anon, authenticated;

-- jsonb null / missing → SQL NULL; an object stays.
CREATE OR REPLACE FUNCTION public.tasks__json_object(p_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object' THEN p_value END
$$;
REVOKE ALL ON FUNCTION public.tasks__json_object(jsonb) FROM PUBLIC, anon, authenticated;

-- Someone a task can go to: the owner or a member who can work on tasks.
CREATE OR REPLACE FUNCTION public.tasks__check_assignee(p_workspace_id uuid, p_assignee_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_assignee_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.perm_is_owner(p_workspace_id, p_assignee_id)
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
                     WHERE m.workspace_id = p_workspace_id AND m.user_id = p_assignee_id) THEN
    RAISE EXCEPTION 'That person isn''t a member of this workspace.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.perm_user_has(p_workspace_id, p_assignee_id, 'tasks.edit') THEN
    RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__check_assignee(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A project a task can go into: live and in this workspace.
CREATE OR REPLACE FUNCTION public.tasks__check_bucket(p_workspace_id uuid, p_bucket_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_bucket_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.buckets b
    WHERE b.id = p_bucket_id AND b.workspace_id = p_workspace_id AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__check_bucket(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A parent must be a live task here that the caller can see. One message for
-- missing and hidden alike, so it can't be used to test whether a task exists.
CREATE OR REPLACE FUNCTION public.tasks__check_parent(p_workspace_id uuid, p_parent_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_parent_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks x
                 WHERE x.id = p_parent_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL)
     OR NOT public.can_access('task', p_parent_id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'That parent task isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__check_parent(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- What a create does when the task is born done (an import of finished work):
-- nothing here; the second TV-D8 migration records the completion.
CREATE OR REPLACE FUNCTION public.tasks__created_done(t public.tasks)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__created_done(public.tasks) FROM PUBLIC, anon, authenticated;

-- Refuses a field an op doesn't take (a typo shouldn't be dropped silently).
CREATE OR REPLACE FUNCTION public.tasks__check_keys(p_fields jsonb, p_allowed text[])
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'Expected an object of task fields.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
    IF NOT (v_key = ANY (p_allowed)) THEN
      RAISE EXCEPTION 'Tasks have no field "%".', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__check_keys(jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- A repeat rule the app can store: what the server's engine would evaluate
-- stays within fixed bounds (INTERVAL and COUNT 1–1000, UNTIL and DTSTART
-- between 1900 and 2200, a short rule), whether or not the engine supports the
-- rule's frequency. NULL when it's fine, else why not, in words. Enforced by
-- the ops and by a CHECK on tasks.recurrence (old builds' raw writes too).
CREATE OR REPLACE FUNCTION public.tasks__recurrence_problem(p_rec jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_rule text;
  v_part text;
  v_key text;
  v_val text;
  v_m text[];
  v_start timestamptz;
BEGIN
  IF p_rec IS NULL OR jsonb_typeof(p_rec) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_rec) <> 'object' THEN
    RETURN 'a repeat is a rule';
  END IF;
  IF pg_catalog.pg_column_size(p_rec) > 4096 THEN
    RETURN 'the repeat is too long';
  END IF;
  v_rule := p_rec ->> 'rrule';
  IF v_rule IS NULL OR btrim(v_rule) = '' THEN
    RETURN 'the repeat has no rule';
  END IF;
  IF length(v_rule) > 500 THEN
    RETURN 'the rule is too long';
  END IF;
  FOREACH v_part IN ARRAY string_to_array(regexp_replace(btrim(v_rule), '^RRULE:', '', 'i'), ';') LOOP
    v_key := upper(btrim(split_part(v_part, '=', 1)));
    v_val := upper(btrim(split_part(v_part, '=', 2)));
    IF v_key = 'INTERVAL' AND (v_val !~ '^[0-9]{1,4}$' OR v_val::integer NOT BETWEEN 1 AND 1000) THEN
      RETURN 'INTERVAL must be 1 to 1000';
    ELSIF v_key = 'COUNT' AND (v_val !~ '^[0-9]{1,4}$' OR v_val::integer NOT BETWEEN 1 AND 1000) THEN
      RETURN 'COUNT must be 1 to 1000';
    ELSIF v_key = 'UNTIL' THEN
      v_m := regexp_match(v_val, '^([0-9]{4})([0-9]{2})([0-9]{2})(T[0-9]{6}Z?)?$');
      IF v_m IS NULL OR v_m[1]::integer NOT BETWEEN 1900 AND 2199 THEN
        RETURN 'UNTIL must be a date between 1900 and 2200';
      END IF;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_rec -> 'dtstart') = 'string' THEN
    BEGIN
      v_start := (p_rec ->> 'dtstart')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RETURN 'the start isn''t a date';
    END;
    IF v_start < '1900-01-01T00:00:00Z'::timestamptz OR v_start >= '2200-01-01T00:00:00Z'::timestamptz THEN
      RETURN 'the start must be between 1900 and 2200';
    END IF;
  END IF;
  IF jsonb_typeof(p_rec -> 'mode') = 'string' AND p_rec ->> 'mode' <> 'after_completion' THEN
    RETURN 'unknown repeat mode';
  END IF;
  RETURN NULL;
END;
$$;
-- The CHECK below runs it as whoever writes the row, so writers keep EXECUTE
-- (it only reads its argument).
REVOKE ALL ON FUNCTION public.tasks__recurrence_problem(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasks__recurrence_problem(jsonb) TO authenticated, service_role;

-- The ops' check, with the reason in the error.
CREATE OR REPLACE FUNCTION public.tasks__check_recurrence(p_rec jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_problem text := public.tasks__recurrence_problem(p_rec);
BEGIN
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'That repeat can''t be saved: %.', v_problem USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__check_recurrence(jsonb) FROM PUBLIC, anon, authenticated;

-- Every write (raw ones from old builds too) stores only a bounded rule. NOT
-- VALID: rows saved before today are checked when they are next written.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recurrence_bounded;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_recurrence_bounded
  CHECK (public.tasks__recurrence_problem(recurrence) IS NULL) NOT VALID;

-- ── 6. tasks_op_create ──────────────────────────────────────────────────────

-- p_task: id (optional, so a resend answers with the task it made), title,
-- description, bucket_id (default: the creator's Inbox), parent_id, due_date,
-- scheduled_at, duration_minutes, recurrence, energy_level, priority, status
-- (default todo), position (default: the end of the project), assignee_id
-- (absent: the creator; null: Unassigned).
CREATE OR REPLACE FUNCTION public.tasks_op_create(p_workspace_id uuid, p_task jsonb)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
  v_id uuid;
  v_bucket uuid;
  v_assignee uuid;
  v_status text;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  PERFORM public.tasks__check_keys(p_task, ARRAY[
    'id', 'title', 'description', 'bucket_id', 'parent_id', 'due_date', 'scheduled_at',
    'duration_minutes', 'recurrence', 'energy_level', 'priority', 'status', 'position',
    'assignee_id']);

  v_id := coalesce(nullif(p_task ->> 'id', '')::uuid, gen_random_uuid());
  SELECT * INTO t FROM public.tasks WHERE id = v_id;
  IF FOUND THEN
    -- A resend of a create that landed: answer with that task.
    IF t.workspace_id IS DISTINCT FROM p_workspace_id
       OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;
    RETURN t;
  END IF;

  PERFORM public.tasks__check_recurrence(public.tasks__json_object(p_task -> 'recurrence'));
  v_status := coalesce(nullif(p_task ->> 'status', ''), 'todo');
  IF v_status NOT IN ('todo', 'in_progress', 'done', 'archived') THEN
    RAISE EXCEPTION 'Unknown task status.';
  END IF;

  v_bucket := nullif(p_task ->> 'bucket_id', '')::uuid;
  IF v_bucket IS NULL THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'A task needs a project.';
    END IF;
    v_bucket := public.tasks__inbox(p_workspace_id, v_actor);
  ELSE
    PERFORM public.tasks__check_bucket(p_workspace_id, v_bucket);
  END IF;

  IF p_task ? 'assignee_id' THEN
    v_assignee := nullif(p_task ->> 'assignee_id', '')::uuid;
  ELSE
    v_assignee := v_actor;
  END IF;
  IF v_assignee IS DISTINCT FROM v_actor THEN
    PERFORM public.tasks__check_assignee(p_workspace_id, v_assignee);
  END IF;
  PERFORM public.tasks__check_parent(p_workspace_id, nullif(p_task ->> 'parent_id', '')::uuid);

  -- perm_enforce_write checks the creator's role and the project; the number,
  -- creator, registry entry and any assignment notice come from the triggers.
  INSERT INTO public.tasks (
    id, workspace_id, bucket_id, parent_id, title, description, due_date, scheduled_at,
    duration_minutes, recurrence, energy_level, priority, status, position, assignee_id,
    owner_id, created_at, updated_at)
  VALUES (
    v_id, p_workspace_id, v_bucket, nullif(p_task ->> 'parent_id', '')::uuid,
    coalesce(p_task ->> 'title', ''), coalesce(p_task ->> 'description', ''),
    (p_task ->> 'due_date')::timestamptz, (p_task ->> 'scheduled_at')::timestamptz,
    (p_task ->> 'duration_minutes')::numeric::integer,
    public.tasks__json_object(p_task -> 'recurrence'),
    nullif(p_task ->> 'energy_level', ''), nullif(p_task ->> 'priority', ''),
    v_status,
    coalesce(nullif(p_task ->> 'position', ''), public.tasks__end_position(v_bucket)),
    v_assignee, v_actor, now(), now())
  RETURNING * INTO t;

  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.create',
    jsonb_build_object('title', t.title, 'number', t.number, 'bucket_id', t.bucket_id));
  IF t.status = 'done' THEN
    PERFORM public.tasks__created_done(t);
  END IF;
  RETURN t;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks_op_create(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasks_op_create(uuid, jsonb) TO authenticated, service_role;

-- ── 7. tasks_op_update ──────────────────────────────────────────────────────

-- p_patch carries only the fields that change: title, description, bucket_id,
-- parent_id, due_date, scheduled_at, duration_minutes, recurrence,
-- energy_level, priority, position, status (through the status logic of
-- tasks_op_set_status), assignee_id (through tasks_op_assign), deleted_at
-- (any value deletes, null restores), and until TV-D7 the old
-- committed_for / commit_order / reschedule_count. Answers with the task,
-- then any subtasks the change carried along.
CREATE OR REPLACE FUNCTION public.tasks_op_update(p_workspace_id uuid, p_task_id uuid, p_patch jsonb)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  t0 public.tasks;
  c public.tasks;
  v_carried public.tasks[] := '{}';
  v_restore boolean;
  v_delete boolean;
  v_fields text[] := '{}';
  v_payload jsonb := '{}';
  -- Who the trail row names: the person, or the API key.
  v_actor uuid := coalesce(public.module_api_key_id(), public.perm_actor_id());
  v_field text;
  v_bypass text;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  PERFORM public.tasks__check_keys(p_patch, ARRAY[
    'title', 'description', 'bucket_id', 'parent_id', 'due_date', 'scheduled_at',
    'duration_minutes', 'recurrence', 'energy_level', 'priority', 'position', 'status',
    'assignee_id', 'deleted_at', 'committed_for', 'commit_order', 'reschedule_count']);

  SELECT * INTO t FROM public.tasks
  WHERE id = p_task_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  v_restore := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null';
  v_delete := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') <> 'null';
  -- A task the caller can't see reads as missing (never answered with, even
  -- for a patch that changes nothing); writes are checked again row by row.
  IF NOT FOUND OR (t.deleted_at IS NOT NULL AND NOT v_restore)
     OR NOT public.can_access('task', t.id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;

  -- Restore first, so the rest of the patch edits a live task.
  IF v_restore AND t.deleted_at IS NOT NULL THEN
    BEGIN
      UPDATE public.tasks SET deleted_at = NULL, updated_at = now()
      WHERE id = t.id RETURNING * INTO t;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'trash_expired' THEN
        RAISE EXCEPTION 'This task was deleted more than 30 days ago, so it can''t be restored.';
      END IF;
      RAISE;
    END;
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.restore', '{}'::jsonb);
  END IF;

  IF p_patch ? 'recurrence' THEN
    PERFORM public.tasks__check_recurrence(public.tasks__json_object(p_patch -> 'recurrence'));
  END IF;
  IF p_patch ? 'bucket_id' THEN
    PERFORM public.tasks__check_bucket(p_workspace_id, nullif(p_patch ->> 'bucket_id', '')::uuid);
  END IF;
  IF p_patch ? 'parent_id' THEN
    PERFORM public.tasks__check_parent(p_workspace_id, nullif(p_patch ->> 'parent_id', '')::uuid);
  END IF;

  t0 := t;
  IF p_patch ?| ARRAY['title', 'description', 'bucket_id', 'parent_id', 'due_date', 'scheduled_at',
                      'duration_minutes', 'recurrence', 'energy_level', 'priority', 'position',
                      'committed_for', 'commit_order', 'reschedule_count'] THEN
    UPDATE public.tasks SET
      title = CASE WHEN p_patch ? 'title' THEN coalesce(p_patch ->> 'title', '') ELSE title END,
      description = CASE WHEN p_patch ? 'description' THEN coalesce(p_patch ->> 'description', '') ELSE description END,
      bucket_id = CASE WHEN p_patch ? 'bucket_id' THEN (p_patch ->> 'bucket_id')::uuid ELSE bucket_id END,
      parent_id = CASE WHEN p_patch ? 'parent_id' THEN nullif(p_patch ->> 'parent_id', '')::uuid ELSE parent_id END,
      due_date = CASE WHEN p_patch ? 'due_date' THEN (p_patch ->> 'due_date')::timestamptz ELSE due_date END,
      scheduled_at = CASE WHEN p_patch ? 'scheduled_at' THEN (p_patch ->> 'scheduled_at')::timestamptz ELSE scheduled_at END,
      duration_minutes = CASE WHEN p_patch ? 'duration_minutes'
                              THEN (p_patch ->> 'duration_minutes')::numeric::integer ELSE duration_minutes END,
      recurrence = CASE WHEN p_patch ? 'recurrence' THEN public.tasks__json_object(p_patch -> 'recurrence') ELSE recurrence END,
      energy_level = CASE WHEN p_patch ? 'energy_level' THEN nullif(p_patch ->> 'energy_level', '') ELSE energy_level END,
      priority = CASE WHEN p_patch ? 'priority' THEN nullif(p_patch ->> 'priority', '') ELSE priority END,
      position = CASE WHEN p_patch ? 'position' THEN coalesce(p_patch ->> 'position', '') ELSE position END,
      committed_for = CASE WHEN p_patch ? 'committed_for' THEN (p_patch ->> 'committed_for')::date ELSE committed_for END,
      commit_order = CASE WHEN p_patch ? 'commit_order' THEN (p_patch ->> 'commit_order')::numeric::integer ELSE commit_order END,
      reschedule_count = CASE WHEN p_patch ? 'reschedule_count'
                              THEN coalesce((p_patch ->> 'reschedule_count')::numeric::integer, 0) ELSE reschedule_count END,
      updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;

    -- Moving a task takes its subtasks along, in this transaction.
    IF t.bucket_id IS DISTINCT FROM t0.bucket_id THEN
      FOR c IN
        SELECT * FROM public.tasks x
        WHERE x.parent_id = t.id AND x.deleted_at IS NULL AND x.bucket_id IS DISTINCT FROM t.bucket_id
        ORDER BY x.id
        FOR UPDATE
      LOOP
        UPDATE public.tasks SET bucket_id = t.bucket_id, updated_at = now()
        WHERE id = c.id RETURNING * INTO c;
        v_carried := v_carried || c;
      END LOOP;
    END IF;

    -- One trail line for what changed (status, assignee and delete log their own).
    FOREACH v_field IN ARRAY ARRAY['title', 'description', 'bucket_id', 'parent_id', 'due_date',
                                   'scheduled_at', 'duration_minutes', 'recurrence',
                                   'energy_level', 'priority'] LOOP
      IF to_jsonb(t) -> v_field IS DISTINCT FROM to_jsonb(t0) -> v_field THEN
        v_fields := v_fields || v_field;
        IF v_field = 'description' THEN
          CONTINUE; -- the text itself stays out of the trail
        ELSIF v_field = 'recurrence' THEN
          v_payload := v_payload || jsonb_build_object(v_field, jsonb_build_object(
            'from', to_jsonb(t0) -> v_field -> 'rrule', 'to', to_jsonb(t) -> v_field -> 'rrule'));
        ELSE
          v_payload := v_payload || jsonb_build_object(v_field, jsonb_build_object(
            'from', to_jsonb(t0) -> v_field, 'to', to_jsonb(t) -> v_field));
        END IF;
      END IF;
    END LOOP;
    IF cardinality(v_fields) > 0 THEN
      v_payload := v_payload || jsonb_build_object('fields', to_jsonb(v_fields));
      IF cardinality(v_carried) > 0 THEN
        v_payload := v_payload || jsonb_build_object('subtasks_moved', cardinality(v_carried));
      END IF;
      -- Typing in the description saves often: one line per stretch of editing
      -- (the same person's description edit in the last 10 minutes, with
      -- nothing logged on the task since).
      IF NOT (v_fields = ARRAY['description'] AND EXISTS (
            SELECT 1 FROM public.module_activity a
            WHERE a.workspace_id = p_workspace_id AND a.module = 'tasks'
              AND a.entity_type = 'task' AND a.entity_id = t.id
              AND a.op = 'tasks.update' AND a.actor_id IS NOT DISTINCT FROM v_actor
              AND a.payload -> 'fields' = '["description"]'::jsonb
              AND a.created_at > now() - interval '10 minutes'
              AND NOT EXISTS (
                SELECT 1 FROM public.module_activity b
                WHERE b.workspace_id = a.workspace_id AND b.module = 'tasks'
                  AND b.entity_type = 'task' AND b.entity_id = a.entity_id
                  AND b.created_at > a.created_at))) THEN
        PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.update', v_payload);
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'assignee_id' THEN
    t := public.tasks_op_assign(p_workspace_id, t.id, nullif(p_patch ->> 'assignee_id', '')::uuid);
  END IF;

  IF p_patch ? 'status' THEN
    t := public.tasks__apply_status(t, p_patch ->> 'status', NULL, NULL);
  END IF;

  IF v_delete AND t.deleted_at IS NULL THEN
    UPDATE public.tasks SET deleted_at = now(), updated_at = now()
    WHERE id = t.id RETURNING * INTO t;
    -- Its subtasks stay, at the top level (work is never lost with a parent).
    -- That's the server's own consequence of the delete, so it runs as
    -- system work: a subtask the caller can't edit doesn't refuse the delete,
    -- and the answer names only the subtasks the caller can see.
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    FOR c IN
      SELECT * FROM public.tasks x
      WHERE x.parent_id = t.id AND x.deleted_at IS NULL
      ORDER BY x.id
      FOR UPDATE
    LOOP
      UPDATE public.tasks SET parent_id = NULL, updated_at = now()
      WHERE id = c.id RETURNING * INTO c;
      IF public.can_access('task', c.id, 'view', public.perm_actor_id()) THEN
        v_carried := v_carried || c;
      END IF;
    END LOOP;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.delete', '{}'::jsonb);
  END IF;

  RETURN NEXT t;
  FOREACH c IN ARRAY v_carried LOOP
    RETURN NEXT c;
  END LOOP;
  RETURN;
END;
$$;

-- ── 8. Status changes share one path ────────────────────────────────────────

-- The status half of tasks_op_set_status, also used by tasks_op_update. The
-- recurrence pointer is computed on the server from TV-D8's second migration
-- on; until then (and for rules the server engine can't read) the caller's
-- p_recurrence rides along as before.
CREATE OR REPLACE FUNCTION public.tasks__apply_status(t public.tasks, p_status text, p_recurrence jsonb, p_position text)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text := t.status;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('todo', 'in_progress', 'done', 'archived') THEN
    RAISE EXCEPTION 'Unknown task status.';
  END IF;
  IF t.status = p_status AND p_position IS NULL AND p_recurrence IS NULL THEN
    RETURN t;
  END IF;
  UPDATE public.tasks
    SET status = p_status,
        recurrence = CASE WHEN p_recurrence IS NOT NULL AND t.recurrence IS NOT NULL
                          THEN p_recurrence ELSE recurrence END,
        position = coalesce(p_position, position),
        updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  IF v_from <> t.status THEN
    PERFORM public.module_activity_log(
      t.workspace_id, 'tasks', 'task', t.id, 'tasks.set_status',
      jsonb_build_object('from', v_from, 'to', t.status,
                         'next_occurrence', p_recurrence ->> 'nextOccurrence'));
  END IF;
  RETURN t;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__apply_status(public.tasks, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- Production's body (read from the catalog, 2026-10-10), with the status half
-- moved into tasks__apply_status. Same signature, so the grants stand.
CREATE OR REPLACE FUNCTION public.tasks_op_set_status(p_workspace_id uuid, p_task_id uuid, p_status text, p_recurrence jsonb DEFAULT NULL::jsonb, p_position text DEFAULT NULL::text)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  -- The guard checks the workspace role only: a task the caller can't see
  -- reads as missing, even when nothing would change.
  IF NOT public.can_access('task', t.id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  RETURN public.tasks__apply_status(t, p_status, p_recurrence, p_position);
END;
$$;

REVOKE ALL ON FUNCTION public.tasks_op_update(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasks_op_update(uuid, uuid, jsonb) TO authenticated, service_role;

-- ── 9. One dependency store: a "blocks" link blocks ─────────────────────────

-- A live "blocks" link between two tasks is a dependency (source waits on
-- nothing; target waits on source). Making one needs what a dependency needs:
-- edit on the waiting task, view on the one it waits on; loops are refused by
-- task_relations_forbid_cycles. Ending the link (deleted, or another kind)
-- ends the dependency. The relation → link mirror runs the other way; both
-- stop at their ON CONFLICT / deleted_at guards.
CREATE OR REPLACE FUNCTION public.entity_links__blocks_to_relations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_is boolean;
  v_was boolean := false;
BEGIN
  IF NEW.source_type <> 'task' OR NEW.target_type <> 'task' THEN
    RETURN NULL;
  END IF;
  v_is := NEW.relation_kind = 'blocks' AND NEW.deleted_at IS NULL;
  IF TG_OP = 'UPDATE' THEN
    v_was := OLD.relation_kind = 'blocks' AND OLD.deleted_at IS NULL;
  END IF;
  IF v_is AND NOT v_was THEN
    IF NOT EXISTS (SELECT 1 FROM public.task_relations r
                   WHERE r.workspace_id = NEW.workspace_id
                     AND r.blocker_task_id = NEW.source_id AND r.blocked_task_id = NEW.target_id) THEN
      IF v_actor IS NOT NULL
         AND NOT (public.can_access('task', NEW.target_id, 'edit', v_actor)
                  AND public.can_access('task', NEW.source_id, 'view', v_actor)) THEN
        RAISE EXCEPTION 'You can''t make that task wait on another one.' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id)
      VALUES (NEW.workspace_id, NEW.source_id, NEW.target_id)
      ON CONFLICT (workspace_id, blocker_task_id, blocked_task_id) DO NOTHING;
    END IF;
  ELSIF v_was AND NOT v_is THEN
    DELETE FROM public.task_relations r
    WHERE r.workspace_id = OLD.workspace_id
      AND r.blocker_task_id = OLD.source_id AND r.blocked_task_id = OLD.target_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.entity_links__blocks_to_relations() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS entity_links_blocks_to_relations ON public.entity_links;
CREATE TRIGGER entity_links_blocks_to_relations
  AFTER INSERT OR UPDATE OF relation_kind, deleted_at ON public.entity_links
  FOR EACH ROW EXECUTE FUNCTION public.entity_links__blocks_to_relations();

-- "blocks" links made from the hub or MCP before today become dependencies,
-- except where that would make a loop or a task is gone (left as plain links).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT l.id, l.workspace_id, l.source_id, l.target_id
    FROM public.entity_links l
    WHERE l.relation_kind = 'blocks' AND l.deleted_at IS NULL
      AND l.source_type = 'task' AND l.target_type = 'task'
      AND NOT EXISTS (SELECT 1 FROM public.task_relations x
                      WHERE x.workspace_id = l.workspace_id
                        AND x.blocker_task_id = l.source_id AND x.blocked_task_id = l.target_id)
      AND EXISTS (SELECT 1 FROM public.tasks s WHERE s.id = l.source_id AND s.workspace_id = l.workspace_id)
      AND EXISTS (SELECT 1 FROM public.tasks d WHERE d.id = l.target_id AND d.workspace_id = l.workspace_id)
    ORDER BY l.created_at, l.id
  LOOP
    BEGIN
      INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id)
      VALUES (r.workspace_id, r.source_id, r.target_id)
      ON CONFLICT (workspace_id, blocker_task_id, blocked_task_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'tasks_ops_registry_handles: blocks link % left as a link (%)', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
