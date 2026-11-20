-- NS-8 · Writes check once (specs/notes-schema-hardening.md, Assumption 8, AC9).
--
-- notes_op_apply_updates inserted a batch row by row, and every row fired a
-- BEFORE trigger (perm_enforce_write: the role key and can_access edit, even
-- for a row that then turned out to be a duplicate) and the live-notice
-- trigger. A 500-update batch made 500 access checks; compaction's DELETE
-- made one per folded row. And the note UPDATE always ran, so replaying
-- updates the server already had bumped updated_at and reordered Recents.
--
-- Now:
--   • apply_updates inserts the batch in one INSERT … SELECT … ON CONFLICT DO
--     NOTHING, and touches `notes` only when rows went in or a body changed.
--     Its result, the edited_* rules and the key-write activity row are as
--     before.
--   • On note_updates, INSERT and DELETE are checked per statement
--     (notes__updates_check, REFERENCING NEW/OLD TABLE): once per distinct
--     note, with perm_enforce_write's rules (share.bypass, no actor, the role
--     key notes.edit, can_access edit). UPDATE keeps the row trigger.
--   • Live notices are queued per statement, once per note
--     (notes__updates_live), into NR-7's note_live_pending, still sent by its
--     deferred trigger at commit.

-- The bodies below build on NS-6's guard: refuse to replay this over older ones.
DO $$
BEGIN
  IF to_regprocedure('public.notes__require(uuid, uuid, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'NS-8 needs NS-6 (20261030150000) applied first.';
  END IF;
END;
$$;

-- ── Statement-level checks on note_updates ─────────────────────────────────

-- The rows a statement inserted or deleted arrive as `changed` (both triggers
-- name their transition table so). Errors and messages match
-- perm_enforce_write('notes', 'edit'), which these replace for INSERT and
-- DELETE.
CREATE OR REPLACE FUNCTION public.notes__updates_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  r record;
BEGIN
  -- Member-removal archive and duplicate write under share.bypass.
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN NULL;
  END IF;
  -- System work (service role without a key, cron, migrations).
  v_actor := public.perm_actor_id();
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  FOR r IN SELECT DISTINCT c.workspace_id, c.note_id FROM changed c WHERE c.workspace_id IS NOT NULL LOOP
    IF NOT public.perm_is_owner(r.workspace_id, v_actor)
       AND NOT public.perm_user_has(r.workspace_id, v_actor, 'notes.edit') THEN
      RAISE EXCEPTION 'Your role can''t edit notes in this workspace.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access('note', r.note_id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Saved updates reach the people who have the note open: one pending row per
-- note per transaction, sent at commit by notes_live_send_pending (NR-7).
CREATE OR REPLACE FUNCTION public.notes__updates_live() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Nobody has the note open: nothing to do (imports, duplicates, agents
  -- writing to closed notes).
  INSERT INTO public.note_live_pending (note_id)
  SELECT DISTINCT c.note_id FROM changed c
  WHERE EXISTS (SELECT 1 FROM public.note_live_viewers v
                WHERE v.note_id = c.note_id AND v.seen_at > now() - public.notes_live__fresh())
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS perm_enforce_write ON public.note_updates;
DROP TRIGGER IF EXISTS notes_live_note_update ON public.note_updates;
DROP TRIGGER IF EXISTS notes_updates_check_insert ON public.note_updates;
DROP TRIGGER IF EXISTS notes_updates_check_delete ON public.note_updates;
DROP TRIGGER IF EXISTS notes_updates_live ON public.note_updates;
DROP FUNCTION IF EXISTS public.notes_live__note_update();

-- Rows are written only through definer ops, which never update them: an
-- UPDATE stays checked row by row, as before.
CREATE TRIGGER perm_enforce_write
  BEFORE UPDATE ON public.note_updates
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('notes', 'edit');
CREATE TRIGGER notes_updates_check_insert
  AFTER INSERT ON public.note_updates
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notes__updates_check();
CREATE TRIGGER notes_updates_check_delete
  AFTER DELETE ON public.note_updates
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notes__updates_check();
CREATE TRIGGER notes_updates_live
  AFTER INSERT ON public.note_updates
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notes__updates_live();

-- ── apply_updates: one INSERT, no write for a replay ───────────────────────

CREATE OR REPLACE FUNCTION public.notes_op_apply_updates(
  p_workspace_id uuid,
  p_note_id uuid,
  p_client_id text,
  p_updates jsonb,
  p_body_text text DEFAULT NULL,
  p_body_md text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n public.notes;
  v_key uuid := public.module_api_key_id();
  -- The signed-in person (perm_actor_id() is auth.uid() when no key is
  -- set); NULL for a key, whose write is attributed to the key instead.
  v_user uuid := CASE WHEN v_key IS NULL THEN public.perm_actor_id() END;
  v_origin text := CASE WHEN v_key IS NULL THEN 'user' ELSE 'api_key' END;
  v_sent integer := 0;
  v_inserted integer := 0;
  v_max_id bigint;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  IF p_client_id IS NULL OR btrim(p_client_id) = '' THEN
    RAISE EXCEPTION 'A client id is required.';
  END IF;

  IF p_updates IS NOT NULL AND jsonb_typeof(p_updates) = 'array' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) e
               WHERE (e.value ->> 'clientSeq') IS NULL OR (e.value ->> 'updateB64') IS NULL) THEN
      RAISE EXCEPTION 'Each update needs clientSeq and updateB64.';
    END IF;
    v_sent := jsonb_array_length(p_updates);

    -- In the order sent; a repeat (stored, or twice in the batch) is a duplicate.
    WITH ins AS (
      INSERT INTO public.note_updates
        (workspace_id, note_id, client_id, client_seq, update_b64, origin, actor_key_id, user_id)
      SELECT p_workspace_id, n.id, p_client_id, u.seq, u.b64, v_origin, v_key, v_user
        FROM ROWS FROM (jsonb_to_recordset(p_updates) AS ("clientSeq" integer, "updateB64" text))
             WITH ORDINALITY AS u(seq, b64, ord)
        ORDER BY u.ord
      ON CONFLICT (note_id, client_id, client_seq) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  END IF;

  -- A replay of updates the server already has, with the body it already
  -- has, leaves the note alone: updated_at orders Recents.
  IF v_inserted > 0
     OR (p_body_text IS NOT NULL AND p_body_text IS DISTINCT FROM n.body_text)
     OR (p_body_md IS NOT NULL AND p_body_md IS DISTINCT FROM n.body_md) THEN
    UPDATE public.notes SET
      body_text = coalesce(p_body_text, body_text),
      body_md = coalesce(p_body_md, body_md),
      updated_at = now(),
      edited_by = CASE WHEN v_inserted > 0 AND v_user IS NOT NULL THEN v_user ELSE edited_by END,
      edited_at = CASE WHEN v_inserted > 0 AND v_user IS NOT NULL THEN now() ELSE edited_at END
      WHERE id = n.id;
  END IF;

  -- One attributed row per key write that changed the doc; human typing
  -- stays activity-free ("continuous edits").
  IF v_origin = 'api_key' AND v_inserted > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.agent_edit',
      jsonb_build_object('title', n.title, 'clientId', p_client_id));
  END IF;

  SELECT max(u.id) INTO v_max_id FROM public.note_updates u WHERE u.note_id = n.id;
  RETURN jsonb_build_object(
    'inserted', v_inserted, 'duplicates', v_sent - v_inserted, 'max_update_id', v_max_id);
END;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.notes_op_apply_updates(uuid, uuid, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_apply_updates(uuid, uuid, text, jsonb, text, text) TO authenticated, service_role;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['notes__updates_check()', 'notes__updates_live()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;

-- ── Assert ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['notes__updates_check()', 'notes__updates_live()'] LOOP
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% is internal: no client may call it.', fn;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger t
             WHERE t.tgrelid = 'public.note_updates'::regclass AND NOT t.tgisinternal
               AND (t.tgtype & 1) = 1 AND (t.tgtype & (4 | 8)) <> 0) THEN
    RAISE EXCEPTION 'note_updates must have no per-row INSERT or DELETE trigger.';
  END IF;
END;
$$;
