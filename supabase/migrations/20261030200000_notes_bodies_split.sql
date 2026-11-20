-- NS-11 · Split content from the row (specs/notes-schema-hardening.md AC12,
-- Assumption 11). Test: supabase/tests/notes_bodies_split.test.sql.
--
-- Every edit push rewrote notes.body_text and body_md (both TOASTed),
-- recomputed the generated search_tsv, wrote its GIN entries and added a new
-- tuple to every index of the hot notes row the list and meta reads use. A
-- note's content now lives in note_bodies, one row per note:
--   * note_bodies holds doc_state, doc_version, body_text, body_md and
--     search_tsv (generated exactly as notes.search_tsv was), keyed on note_id,
--     with (workspace_id, note_id) → notes (workspace_id, id) ON DELETE CASCADE.
--     The GIN index moves with it. RLS SELECT through can_access, and no
--     client grant: people read content only through notes_pull, notes__search,
--     the published subtree and the computed fields below.
--   * The title stays on notes. search_tsv weighs the title A and the body B in
--     one vector, so note_bodies keeps a copy of the title, written by the
--     notes__bodies_sync trigger on insert and on a rename (a rare write). The
--     alternative, a title vector on notes beside the body vector here, keeps a
--     GIN index on the hot row and splits every search across two indexes.
--   * Every reader and writer moves: notes_pull, notes_op_apply_updates,
--     notes_op_save_snapshot, notes_op_seed_doc, notes_op_duplicate,
--     notes_op_import, notes_list_unmaterialized, notes__search,
--     notes_public_subtree, notes__compact, notes__compact_source and
--     notes__meta (notes_meta keeps doc_version, read from note_bodies).
--     An edit push now changes only updated_at and edited_* on notes; the row
--     lock notes__require takes stays the one every writer serialises on
--     (notes__compact's no-gaps guarantee).
--   * The five columns leave notes. v1.4.0 selects them from notes directly
--     (listMeta's doc_version, the editor's doc_state, excerpts' body_text, the
--     export's body_md, search's search_tsv), and migrations land before the
--     app, so each keeps its name as a PostgREST computed field: a function
--     public.<column>(notes) that reads note_bodies for a note the caller can
--     open (`select=body_md` and `search_tsv=wfts…` work as before). body_text
--     and body_md stay as the content read for excerpts and the export;
--     doc_state, doc_version and search_tsv go with is_pinned once v1.4.0 has
--     aged out.
--   * The SELECT grants on notes and note_updates stay one release: v1.4.0's
--     pullDoc reads note_updates and notes directly.
-- Account erasure deletes notes, and note_bodies goes with them by cascade.

-- One transaction: LOCK TABLE and SET LOCAL need one, and CI applies each
-- file with plain psql, not inside a transaction as Supabase does.
BEGIN;

SET LOCAL lock_timeout = '5s';
-- One acquisition: the key below and the DROP COLUMN both lock notes.
LOCK TABLE public.notes IN ACCESS EXCLUSIVE MODE;

-- Built on NS-7 to NS-10's bodies: refuse before anything changes when they
-- are missing.
DO $do$
BEGIN
  IF to_regprocedure('public.notes__compact(uuid, text, bigint, bigint)') IS NULL
     OR to_regprocedure('public.notes_pull(uuid, uuid, bigint, integer)') IS NULL
     OR to_regprocedure('public.notes__require(uuid, uuid, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'NS-11 needs NS-7 to NS-10 (notes_pull, notes__require, notes__compact) applied first.';
  END IF;
END;
$do$;

-- ── The table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.note_bodies (
  note_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  doc_state text,
  doc_version integer NOT NULL DEFAULT 0,
  body_text text NOT NULL DEFAULT '',
  body_md text NOT NULL DEFAULT '',
  search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, public.search__unaccent(COALESCE(title, ''::text))), 'A'::"char")
    || setweight(to_tsvector('simple'::regconfig,
         public.search__unaccent("left"(COALESCE(body_text, ''::text), 150000))), 'B'::"char")
  ) STORED,
  CONSTRAINT note_bodies_note_id_fkey FOREIGN KEY (workspace_id, note_id)
    REFERENCES public.notes (workspace_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.note_bodies IS
  'A note''s content (NS-11): its Yjs snapshot, version, derived bodies and search vector. title is a copy of notes.title for search_tsv''s weight A, kept by notes__bodies_sync. No client grant.';

CREATE INDEX IF NOT EXISTS note_bodies_search_tsv_idx ON public.note_bodies USING gin (search_tsv);

ALTER TABLE public.note_bodies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS note_bodies_read ON public.note_bodies;
CREATE POLICY note_bodies_read ON public.note_bodies FOR SELECT TO authenticated
  USING (public.can_access('note'::text, note_id, 'view'::text));

REVOKE ALL ON public.note_bodies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_bodies TO service_role;

-- ── Backfill, then keep every note's row ────────────────────────────────────

DO $do$
DECLARE
  v_missing bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notes'::regclass
                   AND attname = 'body_text' AND NOT attisdropped) THEN
    RETURN;  -- Already split (a re-run).
  END IF;
  EXECUTE $q$
    INSERT INTO public.note_bodies (note_id, workspace_id, title, doc_state, doc_version, body_text, body_md)
    SELECT n.id, n.workspace_id, n.title, n.doc_state, n.doc_version, n.body_text, n.body_md
      FROM public.notes n
    ON CONFLICT (note_id) DO NOTHING
  $q$;
  EXECUTE $q$
    SELECT count(*) FROM public.notes n
     WHERE NOT EXISTS (
       SELECT 1 FROM public.note_bodies b
        WHERE b.note_id = n.id AND b.workspace_id = n.workspace_id AND b.title = n.title
          AND b.doc_state IS NOT DISTINCT FROM n.doc_state AND b.doc_version = n.doc_version
          AND b.body_text = n.body_text AND b.body_md = n.body_md AND b.search_tsv = n.search_tsv)
  $q$ INTO v_missing;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'NS-11 backfill: % notes have no matching note_bodies row.', v_missing;
  END IF;
END;
$do$;

CREATE OR REPLACE FUNCTION public.notes__bodies_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.note_bodies (note_id, workspace_id, title)
  VALUES (NEW.id, NEW.workspace_id, NEW.title)
  ON CONFLICT (note_id) DO UPDATE SET title = EXCLUDED.title
    WHERE public.note_bodies.title IS DISTINCT FROM EXCLUDED.title;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notes__bodies_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__bodies_sync() TO service_role;

DROP TRIGGER IF EXISTS notes_bodies_insert ON public.notes;
CREATE TRIGGER notes_bodies_insert AFTER INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes__bodies_sync();
DROP TRIGGER IF EXISTS notes_bodies_title ON public.notes;
CREATE TRIGGER notes_bodies_title AFTER UPDATE OF title ON public.notes
  FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION public.notes__bodies_sync();

-- ── Readers and writers ─────────────────────────────────────────────────────

-- doc_version from note_bodies: STABLE now (it reads a table), no longer IMMUTABLE.
CREATE OR REPLACE FUNCTION public.notes__meta(n public.notes)
 RETURNS public.notes_meta
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT n.id, n.workspace_id, n.created_by, n.parent_id, n.title, n.icon,
         n.position, n.is_archived, n.published_at, n.publish_token,
         coalesce((SELECT b.doc_version FROM public.note_bodies b WHERE b.note_id = n.id), 0),
         n.share_mode, n.workspace_shared, n.in_inbox, n.full_width, n.edited_by,
         n.edited_at, n.created_at, n.updated_at, n.deleted_at
$function$;

-- The list joins note_bodies once instead of calling notes__meta per row (a
-- function with its own SET is never inlined, and its doc_version lookup ran
-- 5,000 times). The columns are notes__meta's, in notes_meta's order.
CREATE OR REPLACE FUNCTION public.notes_list_meta(p_workspace_id uuid, p_trash_since timestamp with time zone)
 RETURNS SETOF public.notes_meta
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_vis uuid[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to use notes.' USING ERRCODE = '42501';
  END IF;
  -- A role or key that can't open notes lists nothing (RLS's answer), not an error.
  BEGIN
    PERFORM public.notes__require_module(p_workspace_id, 'view');
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  v_vis := public.notes__visible_ids(p_workspace_id, v_actor);
  IF cardinality(v_vis) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT n.id, n.workspace_id, n.created_by, n.parent_id, n.title, n.icon,
           n.position, n.is_archived, n.published_at, n.publish_token,
           coalesce(b.doc_version, 0),
           n.share_mode, n.workspace_shared, n.in_inbox, n.full_width, n.edited_by,
           n.edited_at, n.created_at, n.updated_at, n.deleted_at
      FROM public.notes n
      JOIN (SELECT DISTINCT v.id FROM unnest(v_vis) AS v(id)) vis ON vis.id = n.id
      LEFT JOIN public.note_bodies b ON b.note_id = n.id
     WHERE n.workspace_id = p_workspace_id
       AND (n.deleted_at IS NULL OR n.deleted_at > p_trash_since)
     ORDER BY n.position COLLATE "C", n.id
     LIMIT 5000;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_pull(p_workspace_id uuid, p_note_id uuid, p_after_id bigint, p_known_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc_state text;
  v_doc_version integer;
  v_updates jsonb;
  v_has_more boolean;
  v_out jsonb;
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, 'view');
  IF NOT coalesce(public.can_access('note', p_note_id, 'view', public.perm_actor_id()), false) THEN
    RAISE EXCEPTION 'Note not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;
  SELECT b.doc_state, b.doc_version INTO v_doc_state, v_doc_version
    FROM public.note_bodies b
   WHERE b.note_id = p_note_id AND b.workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;

  -- One row past the page says whether there is more.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'client_id', p.client_id, 'client_seq', p.client_seq,
           'update_b64', p.update_b64, 'origin', p.origin, 'actor_key_id', p.actor_key_id)
           ORDER BY p.id) FILTER (WHERE p.rn <= 1000), '[]'::jsonb),
         count(*) > 1000
    INTO v_updates, v_has_more
    FROM (SELECT u.id, u.client_id, u.client_seq, u.update_b64, u.origin, u.actor_key_id,
                 row_number() OVER (ORDER BY u.id) AS rn
            FROM public.note_updates u
           WHERE u.note_id = p_note_id
             AND u.workspace_id = p_workspace_id
             AND u.id > coalesce(p_after_id, 0)
           ORDER BY u.id
           LIMIT 1001) p;

  v_out := jsonb_build_object('updates', v_updates, 'has_more', v_has_more,
                              'doc_version', coalesce(v_doc_version, 0));
  IF p_known_version IS DISTINCT FROM coalesce(v_doc_version, 0) THEN
    v_out := v_out || jsonb_build_object('snapshot', v_doc_state);
  END IF;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_apply_updates(p_workspace_id uuid, p_note_id uuid, p_client_id text, p_updates jsonb, p_body_text text DEFAULT NULL::text, p_body_md text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_text text;
  v_md text;
  v_body_changed boolean;
BEGIN
  -- Takes the note's row lock: every insert into an existing note's log
  -- holds it before its id (notes__compact relies on that).
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

  SELECT b.body_text, b.body_md INTO v_text, v_md FROM public.note_bodies b WHERE b.note_id = n.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % has no note_bodies row.', n.id;
  END IF;
  v_body_changed := (p_body_text IS NOT NULL AND p_body_text IS DISTINCT FROM v_text)
                    OR (p_body_md IS NOT NULL AND p_body_md IS DISTINCT FROM v_md);

  -- The content goes to note_bodies; notes gets only the edit's stamp.
  IF v_body_changed THEN
    UPDATE public.note_bodies SET
      body_text = coalesce(p_body_text, body_text),
      body_md = coalesce(p_body_md, body_md)
      WHERE note_id = n.id;
  END IF;

  -- A replay of updates the server already has, with the body it already
  -- has, leaves the note alone: updated_at orders Recents.
  IF v_inserted > 0 OR v_body_changed THEN
    UPDATE public.notes SET
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
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_save_snapshot(p_workspace_id uuid, p_note_id uuid, p_snapshot_b64 text, p_upto_update_id bigint, p_body_text text DEFAULT NULL::text, p_body_md text DEFAULT NULL::text, p_expected_doc_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_version integer;
  v_folded integer;
BEGIN
  -- The note's row lock makes check-and-write atomic against another fold.
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  IF p_snapshot_b64 IS NULL OR p_snapshot_b64 = '' THEN
    RAISE EXCEPTION 'A snapshot is required.';
  END IF;
  SELECT b.doc_version INTO v_version FROM public.note_bodies b WHERE b.note_id = n.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % has no note_bodies row.', n.id;
  END IF;

  IF p_expected_doc_version IS NOT NULL
     AND v_version IS DISTINCT FROM p_expected_doc_version THEN
    RETURN jsonb_build_object('folded', 0, 'refused', true, 'doc_version', v_version);
  END IF;

  DELETE FROM public.note_updates
    WHERE note_id = n.id AND id <= coalesce(p_upto_update_id, 0);
  GET DIAGNOSTICS v_folded = ROW_COUNT;

  UPDATE public.note_bodies SET
    doc_state = p_snapshot_b64,
    doc_version = doc_version + 1,
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md)
    WHERE note_id = n.id;
  UPDATE public.notes SET updated_at = now() WHERE id = n.id;

  RETURN jsonb_build_object('folded', v_folded, 'refused', false, 'doc_version', v_version + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes__compact(p_note uuid, p_snapshot_b64 text, p_upto_id bigint, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_version integer;
  v_folded integer;
BEGIN
  IF p_snapshot_b64 IS NULL OR p_snapshot_b64 = '' THEN
    RAISE EXCEPTION 'A snapshot is required.';
  END IF;
  IF p_upto_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'A fold needs the last row it merged and the version it loaded.';
  END IF;

  -- The notes row lock makes check-and-write atomic against a client's fold
  -- (notes__require takes the same lock).
  PERFORM 1 FROM public.notes WHERE id = p_note FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('folded', 0, 'refused', true, 'doc_version', NULL);
  END IF;
  SELECT b.doc_version INTO v_version FROM public.note_bodies b WHERE b.note_id = p_note;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % has no note_bodies row.', p_note;
  END IF;

  IF v_version IS DISTINCT FROM p_expected_version
     OR EXISTS (SELECT 1 FROM public.note_live_viewers v WHERE v.note_id = p_note) THEN
    RETURN jsonb_build_object('folded', 0, 'refused', true, 'doc_version', v_version);
  END IF;

  -- No gaps: every insert into an existing note's log (notes_op_apply_updates)
  -- takes the notes row lock before its id, so a row pushed after the load
  -- always has an id above p_upto_id. Keep it that way for any new writer.
  DELETE FROM public.note_updates WHERE note_id = p_note AND id <= p_upto_id;
  GET DIAGNOSTICS v_folded = ROW_COUNT;

  UPDATE public.note_bodies SET
    doc_state = p_snapshot_b64,
    doc_version = doc_version + 1
    WHERE note_id = p_note;

  RETURN jsonb_build_object('folded', v_folded, 'refused', false, 'doc_version', v_version + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes__compact_source(p_note uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'doc_state', b.doc_state,
    'doc_version', b.doc_version,
    'updates', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'update_b64', u.update_b64) ORDER BY u.id)
      FROM (SELECT u.id, u.update_b64 FROM public.note_updates u
            WHERE u.note_id = b.note_id ORDER BY u.id LIMIT 5000) u
    ), '[]'::jsonb))
  FROM public.note_bodies b
  WHERE b.note_id = p_note
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_seed_doc(p_workspace_id uuid, p_note_id uuid, p_doc_state_b64 text, p_body_text text DEFAULT NULL::text, p_body_md text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_state text;
  v_version integer;
BEGIN
  -- Takes the note's row lock (FOR UPDATE), so concurrent seeders serialize
  -- here and exactly one of them can pass the emptiness check below.
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');

  IF p_doc_state_b64 IS NULL OR btrim(p_doc_state_b64) = '' THEN
    RAISE EXCEPTION 'A doc state is required.';
  END IF;
  SELECT b.doc_state, b.doc_version INTO v_state, v_version
    FROM public.note_bodies b WHERE b.note_id = n.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % has no note_bodies row.', n.id;
  END IF;

  -- Already has a snapshot → someone materialized it first.
  IF v_state IS NOT NULL AND v_state <> '' THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'already_materialized');
  END IF;

  -- A note with NO snapshot can still hold content: `doc_state` is only
  -- written by compaction, so a normally-created note that has been edited
  -- lives entirely in `note_updates` until it folds. Seeding over THAT would
  -- duplicate every block. This check is what makes the op safe to call on
  -- any note, not just an imported one.
  IF EXISTS (SELECT 1 FROM public.note_updates u WHERE u.note_id = n.id) THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'has_updates');
  END IF;

  -- NOTE: `updated_at` is deliberately NOT touched (the notes row isn't
  -- written at all). This is a repair, not an edit — the user changed
  -- nothing. Bumping it would reorder Recents and the Home notes widget (both
  -- sort by updated_at DESC) so that the first load after deploy showed
  -- nothing but backfilled notes, from a pass the user never saw. Callers
  -- pass NULL bodies too, so `body_md` (the faithful imported markdown)
  -- survives untouched via the coalesce.
  UPDATE public.note_bodies SET
    doc_state = p_doc_state_b64,
    doc_version = doc_version + 1,
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md)
    WHERE note_id = n.id;

  RETURN jsonb_build_object('seeded', true, 'reason', NULL,
                            'doc_version', v_version + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_list_unmaterialized(p_workspace_id uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(o_id uuid, o_body_md text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, 'edit');
  RETURN QUERY
    SELECT n.id, b.body_md
      FROM public.notes n
      JOIN public.note_bodies b ON b.note_id = n.id
     WHERE n.workspace_id = p_workspace_id
       AND n.deleted_at IS NULL
       AND (b.doc_state IS NULL OR b.doc_state = '')
       AND coalesce(btrim(b.body_md), '') <> ''
       -- doc_state is only written by compaction, so "no snapshot" does NOT
       -- mean "empty" — a normally-edited note lives in note_updates until it
       -- folds. Seeding one of those would duplicate every block.
       AND NOT EXISTS (SELECT 1 FROM public.note_updates u WHERE u.note_id = n.id)
       -- Only notes this caller can seed (and so may read).
       AND public.can_access('note', n.id, 'edit')
     ORDER BY n.created_at ASC
     LIMIT greatest(1, least(coalesce(p_limit, 200), 1000));
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_duplicate(p_workspace_id uuid, p_source_note_id uuid, p_position text DEFAULT ''::text)
 RETURNS public.notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src public.notes;
  n public.notes;
  v_bypass text;
BEGIN
  src := public.notes__require(p_workspace_id, p_source_note_id, 'view');
  PERFORM public.notes__require_module(p_workspace_id, 'create');
  IF src.parent_id IS NOT NULL THEN
    PERFORM public.notes__require_parent(p_workspace_id, src.parent_id);
  END IF;
  INSERT INTO public.notes
    (workspace_id, created_by, parent_id, title, icon, position, in_inbox, full_width)
  VALUES
    (p_workspace_id, public.perm_actor_id(), src.parent_id,
     CASE WHEN btrim(src.title) = '' THEN '' ELSE src.title || ' (copy)' END,
     src.icon, coalesce(nullif(p_position, ''), src.position),
     src.in_inbox, src.full_width)
  RETURNING * INTO n;

  -- The copy's body row (made by notes__bodies_sync) takes the source's content.
  UPDATE public.note_bodies d SET
    doc_state = s.doc_state,
    doc_version = s.doc_version,
    body_text = s.body_text,
    body_md = s.body_md
    FROM public.note_bodies s
   WHERE s.note_id = src.id AND d.note_id = n.id;

  -- The un-compacted update tail is part of the doc — copy it or the
  -- duplicate silently lacks everything typed since the last compaction. It
  -- is the new note's own content, so it belongs to the create checked above,
  -- not to an edit (note_updates' trigger asks notes.edit).
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);
  INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
  SELECT u.workspace_id, n.id, u.client_id, u.client_seq, u.update_b64
    FROM public.note_updates u WHERE u.note_id = src.id;
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.duplicate',
    jsonb_build_object('source_note_id', src.id, 'title', n.title));
  RETURN public.notes__meta(n);
END;
$function$;

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
  v_batch uuid[] := '{}';
  v_parent uuid;
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, 'create');
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Import rows must be an array.';
  END IF;

  -- PQ6: every parent is a note of this workspace or a new row earlier in
  -- this batch, checked before anything is written. A note the caller can't
  -- see answers like a missing one (PQ7); one they can see needs edit. A
  -- malformed id is left to the row loop, which skips it as before.
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_parent := nullif(r.value ->> 'parentId', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_parent := NULL;
    END;
    IF v_parent IS NOT NULL AND v_parent <> ALL (v_batch) THEN
      IF NOT EXISTS (SELECT 1 FROM public.notes
                     WHERE id = v_parent AND workspace_id = p_workspace_id)
         OR NOT coalesce(public.can_access('note', v_parent, 'view', public.perm_actor_id()), false) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('A note''s parent isn''t in this workspace: %s', v_parent),
          DETAIL = json_build_object('parentId', v_parent)::text;
      END IF;
      IF NOT public.can_access('note', v_parent, 'edit', public.perm_actor_id()) THEN
        RAISE EXCEPTION 'You can''t add pages inside that note.' USING ERRCODE = '42501';
      END IF;
    END IF;
    BEGIN
      v_id := nullif(r.value ->> 'id', '')::uuid;
      IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.notes WHERE id = v_id) THEN
        v_batch := v_batch || v_id;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := coalesce(nullif(r.value ->> 'id', '')::uuid, gen_random_uuid());
      IF EXISTS (SELECT 1 FROM public.notes WHERE id = v_id) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.notes
        (id, workspace_id, created_by, parent_id, title, icon, position, in_inbox)
      VALUES
        (v_id, p_workspace_id, public.perm_actor_id(),
         nullif(r.value ->> 'parentId', '')::uuid,
         coalesce(r.value ->> 'title', ''),
         nullif(r.value ->> 'icon', ''),
         coalesce(r.value ->> 'position', ''),
         (r.value ->> 'inInbox')::boolean);
      -- The new note's body row (made by notes__bodies_sync): its first
      -- snapshot is version 0, as an imported row's always was.
      UPDATE public.note_bodies SET
        doc_state = nullif(r.value ->> 'docStateB64', ''),
        doc_version = 0,
        body_text = coalesce(r.value ->> 'bodyText', ''),
        body_md = coalesce(r.value ->> 'bodyMd', '')
        WHERE note_id = v_id;
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

CREATE OR REPLACE FUNCTION public.notes_public_subtree(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE root AS (
    SELECT n.id, n.workspace_id
    FROM public.notes n
    WHERE p_token IS NOT NULL AND p_token <> ''
      AND n.publish_token = p_token
      AND n.published_at IS NOT NULL
      AND n.deleted_at IS NULL
      AND NOT n.is_archived
  ),
  tree AS (
    SELECT r.id, NULL::uuid AS parent_id, 0 AS depth, ARRAY[r.id] AS path
    FROM root r
    UNION ALL
    SELECT c.id, c.parent_id, t.depth + 1, t.path || c.id
    FROM tree t
    JOIN public.notes c ON c.parent_id = t.id
    JOIN root r ON c.workspace_id = r.workspace_id
    WHERE c.share_mode = 'inherit'
      AND c.deleted_at IS NULL
      AND NOT c.is_archived
      AND t.depth < 100
      AND NOT c.id = ANY (t.path)
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM root) THEN
    jsonb_build_object(
      'rootId', (SELECT id FROM root),
      'notes', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', n.id,
                 'parentId', t.parent_id,
                 'title', coalesce(n.title, ''),
                 'icon', n.icon,
                 'bodyMd', coalesce(b.body_md, ''),
                 'position', coalesce(n.position, ''),
                 'createdAt', n.created_at
               ) ORDER BY t.depth, n.position, n.created_at, n.id)
        FROM tree t
        JOIN public.notes n ON n.id = t.id
        LEFT JOIN public.note_bodies b ON b.note_id = n.id
      ), '[]'::jsonb))
  END
$function$;

CREATE OR REPLACE FUNCTION public.notes__search(p_workspace_id uuid, p_query text, p_limit integer)
 RETURNS TABLE(entity_type text, entity_id uuid, title text, context text, snippet text, icon text, match text, rank real, updated_at timestamp with time zone, archived boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
 SET client_min_messages TO 'warning'
AS $function$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q tsquery;
  v_vis uuid[];
  v_fuzzy text;
  v_threshold text;
  v_words text[];
  v_not tsquery;
  v_ids uuid[] := '{}';
  v_ranks real[] := '{}';
  v_kinds text[] := '{}';
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL
     OR public.notes_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;
  v_vis := public.notes__visible_ids(p_workspace_id, v_actor);
  IF cardinality(v_vis) = 0 THEN
    RETURN;
  END IF;

  -- Exact hits: the text first (the GIN index on note_bodies), then
  -- visibility, both before the limit. The matches are collected on their own
  -- (MATERIALIZED) so the planner can't drive the join from the visible set
  -- (thousands of ids it guesses at 100) and test the text one note at a time.
  WITH cand AS MATERIALIZED (
    SELECT n.id, n.updated_at, n.is_archived,
           pg_catalog.ts_filter(b.search_tsv, '{a}') OPERATOR(pg_catalog.@@) v_q AS in_title
      FROM public.note_bodies b
      JOIN public.notes n ON n.id = b.note_id
     WHERE b.workspace_id = p_workspace_id
       AND n.deleted_at IS NULL
       AND b.search_tsv OPERATOR(pg_catalog.@@) v_q
  ),
  vis AS MATERIALIZED (SELECT u.id FROM unnest(v_vis) AS u(id)),
  ranked AS (
    SELECT c.id, c.updated_at,
           CASE WHEN c.in_title THEN 'title' ELSE 'body' END AS kind,
           ((CASE WHEN c.in_title THEN 0.75 ELSE 0.40 END)
            - (CASE WHEN c.is_archived THEN 0.15 ELSE 0 END))::real AS rank
      FROM cand c
      JOIN vis ON vis.id = c.id
     ORDER BY 4 DESC, c.updated_at DESC, c.id
     LIMIT v_limit
  )
  SELECT coalesce(array_agg(r.id ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}'),
         coalesce(array_agg(r.rank ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}'),
         coalesce(array_agg(r.kind ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}')
    INTO v_ids, v_ranks, v_kinds
    FROM ranked r;

  -- Typo forgiveness, titles only, when exact matching found fewer than 3:
  -- the words someone typed (no quotes, no excluded words), unaccented, against
  -- the best-matching stretch of each title (word similarity ≥ 0.5). The
  -- index operator <% reads pg_trgm.word_similarity_threshold, so it is set for
  -- this one query and put back (a function's own SET of an extension setting
  -- needs a superuser on Supabase); calling pg_trgm first loads the setting.
  IF cardinality(v_ids) < 3 AND cardinality(v_ids) < v_limit THEN
    v_words := (pg_catalog.regexp_split_to_array(
      pg_catalog.translate(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '"', ''), '\s+'))[1:32];
    v_fuzzy := pg_catalog.lower(public.search__unaccent(pg_catalog.array_to_string(
      ARRAY(SELECT w FROM unnest(v_words) AS w WHERE w NOT LIKE '-%'), ' ')));
    -- An excluded word still excludes ("meetng -weekly"): exact, as in search__query.
    v_not := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,
      public.search__unaccent(pg_catalog.array_to_string(
        ARRAY(SELECT pg_catalog.substr(w, 2) FROM unnest(v_words) AS w WHERE w LIKE '-_%'), ' or ')));
    IF pg_catalog.length(pg_catalog.btrim(v_fuzzy)) >= 3 THEN
      PERFORM extensions.word_similarity('', '');
      v_threshold := pg_catalog.current_setting('pg_trgm.word_similarity_threshold');
      PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', '0.5', true);
      WITH cand AS MATERIALIZED (
        SELECT n.id, n.updated_at,
               extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(n.title))) AS sim
          FROM public.notes n
         WHERE n.workspace_id = p_workspace_id
           AND n.deleted_at IS NULL
           AND v_fuzzy OPERATOR(extensions.<%) pg_catalog.lower(public.search__unaccent(n.title))
           AND (pg_catalog.numnode(v_not) = 0
                OR NOT EXISTS (SELECT 1 FROM public.note_bodies b
                                WHERE b.note_id = n.id AND b.search_tsv OPERATOR(pg_catalog.@@) v_not))
      ),
      vis AS MATERIALIZED (SELECT u.id FROM unnest(v_vis) AS u(id)),
      fuzzy AS (
        SELECT c.id, c.updated_at, c.sim
          FROM cand c
          JOIN vis ON vis.id = c.id
         WHERE c.sim >= 0.5
           AND NOT (c.id = ANY (v_ids))
         ORDER BY c.sim DESC, c.updated_at DESC, c.id
         LIMIT v_limit - cardinality(v_ids)
      )
      SELECT v_ids || coalesce(array_agg(f.id ORDER BY f.sim DESC, f.updated_at DESC, f.id), '{}'),
             v_ranks || coalesce(array_agg((0.2 * f.sim)::real ORDER BY f.sim DESC, f.updated_at DESC, f.id), '{}'),
             v_kinds || coalesce(array_agg('title_fuzzy'::text ORDER BY f.sim DESC, f.updated_at DESC, f.id), '{}')
        INTO v_ids, v_ranks, v_kinds
        FROM fuzzy f;
      PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', v_threshold, true);
    END IF;
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  -- Shape only the rows returned: the snippet (ts_headline is the costly part)
  -- and the parent path. The ancestors (at most three per hit) are found
  -- first and only they are checked against the visible set; joining the set
  -- to notes the other way round reads every visible note.
  RETURN QUERY
    WITH hits AS MATERIALIZED (
      SELECT x.id, x.rank, x.kind, x.ord
        FROM unnest(v_ids, v_ranks, v_kinds) WITH ORDINALITY AS x(id, rank, kind, ord)
    ),
    up AS MATERIALIZED (
      SELECT a.id
        FROM hits h
        JOIN public.notes n ON n.id = h.id
        LEFT JOIN public.notes q1 ON q1.id = n.parent_id
        LEFT JOIN public.notes q2 ON q2.id = q1.parent_id
       CROSS JOIN LATERAL unnest(ARRAY[n.parent_id, q1.parent_id, q2.parent_id]) AS a(id)
       WHERE a.id IS NOT NULL
    ),
    vis AS MATERIALIZED (SELECT u.id FROM unnest(v_vis) AS u(id)),
    seen AS MATERIALIZED (SELECT DISTINCT up.id FROM up JOIN vis ON vis.id = up.id)
    SELECT 'note'::text,
           n.id,
           n.title,
           CASE
             WHEN p1.id IS NULL THEN NULL
             WHEN p2.id IS NULL THEN coalesce(nullif(pg_catalog.btrim(p1.title), ''), 'Untitled')
             ELSE CASE WHEN p3.id IS NOT NULL THEN '… / ' ELSE '' END
                  || coalesce(nullif(pg_catalog.btrim(p2.title), ''), 'Untitled') || ' / '
                  || coalesce(nullif(pg_catalog.btrim(p1.title), ''), 'Untitled')
           END,
           CASE WHEN h.kind = 'body' THEN public.search__snippet(hb.body_text, v_q) END,
           n.icon,
           h.kind,
           h.rank,
           n.updated_at,
           n.is_archived
      FROM hits h
      JOIN public.notes n ON n.id = h.id
      LEFT JOIN public.note_bodies hb ON hb.note_id = n.id
      LEFT JOIN public.notes p1 ON p1.id = n.parent_id AND p1.deleted_at IS NULL
                                AND p1.id IN (SELECT seen.id FROM seen)
      LEFT JOIN public.notes p2 ON p1.id IS NOT NULL AND p2.id = p1.parent_id AND p2.deleted_at IS NULL
                                AND p2.id IN (SELECT seen.id FROM seen)
      LEFT JOIN public.notes p3 ON p2.id IS NOT NULL AND p3.id = p2.parent_id AND p3.deleted_at IS NULL
                                AND p3.id IN (SELECT seen.id FROM seen)
     ORDER BY h.ord;
END;
$function$;

-- ── The columns leave notes ─────────────────────────────────────────────────

DROP INDEX IF EXISTS public.notes_search_tsv_idx;
ALTER TABLE public.notes
  DROP COLUMN IF EXISTS search_tsv,
  DROP COLUMN IF EXISTS body_text,
  DROP COLUMN IF EXISTS body_md,
  DROP COLUMN IF EXISTS doc_state,
  DROP COLUMN IF EXISTS doc_version;

-- ── v1.4.0's reads: computed fields of the same names ───────────────────────
-- PostgREST resolves `select=body_md` (and a filter on search_tsv) on notes to
-- body_md(notes). Each answers only for a note the caller can open, so a row
-- forged through /rpc reveals nothing. In SQL, n.body_md on a notes row
-- also resolves to these (NULL without an actor): new SQL joins note_bodies.

CREATE OR REPLACE FUNCTION public.doc_state(n public.notes)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT b.doc_state FROM public.note_bodies b
   WHERE b.note_id = n.id
     AND coalesce(public.can_access('note', b.note_id, 'view', public.perm_actor_id()), false)
$$;

CREATE OR REPLACE FUNCTION public.doc_version(n public.notes)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT b.doc_version FROM public.note_bodies b
   WHERE b.note_id = n.id
     AND coalesce(public.can_access('note', b.note_id, 'view', public.perm_actor_id()), false)
$$;

CREATE OR REPLACE FUNCTION public.body_text(n public.notes)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT b.body_text FROM public.note_bodies b
   WHERE b.note_id = n.id
     AND coalesce(public.can_access('note', b.note_id, 'view', public.perm_actor_id()), false)
$$;

CREATE OR REPLACE FUNCTION public.body_md(n public.notes)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT b.body_md FROM public.note_bodies b
   WHERE b.note_id = n.id
     AND coalesce(public.can_access('note', b.note_id, 'view', public.perm_actor_id()), false)
$$;

CREATE OR REPLACE FUNCTION public.search_tsv(n public.notes)
RETURNS tsvector LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT b.search_tsv FROM public.note_bodies b
   WHERE b.note_id = n.id
     AND coalesce(public.can_access('note', b.note_id, 'view', public.perm_actor_id()), false)
$$;

REVOKE ALL ON FUNCTION public.doc_state(public.notes) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_state(public.notes) TO authenticated, service_role;
COMMENT ON FUNCTION public.doc_state(public.notes) IS
  'NS-11: notes.doc_state as a computed field, read from note_bodies for a note the caller can open.';
REVOKE ALL ON FUNCTION public.doc_version(public.notes) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_version(public.notes) TO authenticated, service_role;
COMMENT ON FUNCTION public.doc_version(public.notes) IS
  'NS-11: notes.doc_version as a computed field, read from note_bodies for a note the caller can open.';
REVOKE ALL ON FUNCTION public.body_text(public.notes) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.body_text(public.notes) TO authenticated, service_role;
COMMENT ON FUNCTION public.body_text(public.notes) IS
  'NS-11: notes.body_text as a computed field, read from note_bodies for a note the caller can open.';
REVOKE ALL ON FUNCTION public.body_md(public.notes) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.body_md(public.notes) TO authenticated, service_role;
COMMENT ON FUNCTION public.body_md(public.notes) IS
  'NS-11: notes.body_md as a computed field, read from note_bodies for a note the caller can open.';
REVOKE ALL ON FUNCTION public.search_tsv(public.notes) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_tsv(public.notes) TO authenticated, service_role;
COMMENT ON FUNCTION public.search_tsv(public.notes) IS
  'NS-11: notes.search_tsv as a computed field, read from note_bodies for a note the caller can open.';

NOTIFY pgrst, 'reload schema';

COMMIT;
