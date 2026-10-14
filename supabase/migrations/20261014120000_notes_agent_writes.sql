-- NR-6 (specs/notes-refresh.md, assumption 19): agent writes land live.
--
-- The MCP connector now writes notes as real Yjs updates through
-- notes_op_apply_updates, like any client. Each update row records who wrote
-- it: `origin` ('user' | 'api_key', the closed vocabulary CONTENT_AUTHOR_KINDS
-- in supabase/functions/_shared/contracts/vocabularies.ts, the same split
-- comments and chat use), the API key for a key's write, and the signed-in
-- person for a human one. Clients pull `api_key` rows with an agent origin,
-- which is what their per-session Undo tracks.
--
-- notes.edited_by / edited_at record the last HUMAN edit, for the header's
-- "Edited … by …". Key writes leave them alone and log a `notes.agent_edit`
-- activity row instead ("<key name> edited · 2 min ago · Undo").
--
-- Additive, and the function keeps its signature: who wrote a row is a fact
-- of the call (module_api_key_id()), never a parameter, so neither side has
-- to deploy first.

-- Fail fast instead of queueing every note push and pull behind a long
-- transaction while these take their table locks.
SET lock_timeout = '5s';

ALTER TABLE public.note_updates
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS actor_key_id uuid NULL,
  ADD COLUMN IF NOT EXISTS user_id uuid NULL;

ALTER TABLE public.note_updates DROP CONSTRAINT IF EXISTS note_updates_origin_check;
-- NOT VALID, then VALIDATE: the scan of existing rows runs without the
-- exclusive lock the ADD takes.
ALTER TABLE public.note_updates
  ADD CONSTRAINT note_updates_origin_check CHECK (origin IN ('user','api_key')) NOT VALID;
ALTER TABLE public.note_updates VALIDATE CONSTRAINT note_updates_origin_check;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS edited_by uuid NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.notes_op_apply_updates(
  p_workspace_id uuid,
  p_note_id uuid,
  p_client_id text,
  p_updates jsonb,
  p_body_text text DEFAULT NULL,
  p_body_md text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  r record;
  v_key uuid := public.module_api_key_id();
  -- The signed-in person (perm_actor_id() is auth.uid() when no key is
  -- set); NULL for a key, whose write is attributed to the key instead.
  v_user uuid := CASE WHEN v_key IS NULL THEN public.perm_actor_id() END;
  v_origin text := CASE WHEN v_key IS NULL THEN 'user' ELSE 'api_key' END;
  v_inserted integer := 0;
  v_duplicate integer := 0;
  v_max_id bigint;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  IF p_client_id IS NULL OR btrim(p_client_id) = '' THEN
    RAISE EXCEPTION 'A client id is required.';
  END IF;

  IF p_updates IS NOT NULL AND jsonb_typeof(p_updates) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
      IF (r.value ->> 'clientSeq') IS NULL OR (r.value ->> 'updateB64') IS NULL THEN
        RAISE EXCEPTION 'Each update needs clientSeq and updateB64.';
      END IF;
      INSERT INTO public.note_updates
        (workspace_id, note_id, client_id, client_seq, update_b64, origin, actor_key_id, user_id)
      VALUES (p_workspace_id, n.id, p_client_id,
              (r.value ->> 'clientSeq')::integer, r.value ->> 'updateB64',
              v_origin, v_key, v_user)
      ON CONFLICT (note_id, client_id, client_seq) DO NOTHING;
      IF FOUND THEN
        v_inserted := v_inserted + 1;
      ELSE
        v_duplicate := v_duplicate + 1;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.notes SET
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md),
    updated_at = now(),
    edited_by = CASE WHEN v_inserted > 0 AND v_user IS NOT NULL THEN v_user ELSE edited_by END,
    edited_at = CASE WHEN v_inserted > 0 AND v_user IS NOT NULL THEN now() ELSE edited_at END
    WHERE id = n.id;

  -- One attributed row per key write that changed the doc; human typing
  -- stays activity-free ("continuous edits").
  IF v_origin = 'api_key' AND v_inserted > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.agent_edit',
      jsonb_build_object('title', n.title, 'clientId', p_client_id));
  END IF;

  SELECT max(u.id) INTO v_max_id FROM public.note_updates u WHERE u.note_id = n.id;
  RETURN jsonb_build_object(
    'inserted', v_inserted, 'duplicates', v_duplicate, 'max_update_id', v_max_id);
END;
$$;

REVOKE ALL ON FUNCTION public.notes_op_apply_updates(uuid, uuid, text, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_apply_updates(uuid, uuid, text, jsonb, text, text)
  TO authenticated, service_role;
