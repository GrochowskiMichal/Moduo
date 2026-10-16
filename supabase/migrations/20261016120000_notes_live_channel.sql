-- NR-7: a secure live channel for each note (specs/notes-refresh.md AC12,
-- assumption 18).
--
-- Until now a note's live edits and presence rode a PUBLIC Realtime channel
-- (`notes:<id>`): anyone signed in who knew a note's id could listen to its
-- keystrokes, appear in its facepile and broadcast bytes into it.
--
-- Realtime itself can't be the gate: it checks `realtime.messages` policies
-- only when a client joins (or sends a new token), so a person whose share is
-- taken away keeps hearing a joined topic; and a policy can't see a message's
-- event or payload, so anyone allowed to send could forge presence for
-- another member. So clients send nothing over Realtime at all. The server
-- does all of it:
--
--   • Each person listens on ONE private topic of their own, `notes-live:<uid>`.
--     Only they can read it; nobody can write to it but the server.
--   • Saying "I have this note open" is a call (`notes_live_here`) that checks
--     view access and records the caller from the session, never from an
--     argument. It answers with who else is there.
--   • When an update is saved (`note_updates` insert: people and agents
--     alike), a trigger hands it to the people who have that note open,
--     re-checking each one's access at that moment. Someone whose share was
--     taken away hears nothing more, from the next save on.
--   • Agent (MCP) rows go out content-free: clients pull them, so the stored
--     row stays the only source of "an agent wrote this" (gotchas §NR-6).

-- ── Who has which note open ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.note_live_viewers (
  note_id    uuid NOT NULL REFERENCES public.notes (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- One row per open tab/window, so closing one keeps the others.
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 64),
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id, session_id)
);
CREATE INDEX IF NOT EXISTS note_live_viewers_user_idx ON public.note_live_viewers (user_id);
ALTER TABLE public.note_live_viewers ENABLE ROW LEVEL SECURITY;
-- No policies: only the definer functions below read or write it.
REVOKE ALL ON public.note_live_viewers FROM PUBLIC, anon, authenticated;

-- A tab that stopped saying it's there (closed without a goodbye, asleep, offline).
CREATE OR REPLACE FUNCTION public.notes_live__fresh() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '60 seconds' $$;

-- The people who have a note open right now and may still view it.
CREATE OR REPLACE FUNCTION public.notes_live__viewers(p_note_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT v.user_id ORDER BY v.user_id), '{}')
  FROM public.note_live_viewers v
  WHERE v.note_id = p_note_id
    AND v.seen_at > now() - public.notes_live__fresh()
    AND public.can_access('note', p_note_id, 'view', v.user_id)
$$;

-- Tell everyone who has the note open (and may still view it) something.
CREATE OR REPLACE FUNCTION public.notes_live__tell(p_note_id uuid, p_event text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
BEGIN
  FOREACH v_user IN ARRAY public.notes_live__viewers(p_note_id) LOOP
    PERFORM realtime.send(p_payload || jsonb_build_object('noteId', p_note_id),
                          p_event, 'notes-live:' || v_user::text, true);
  END LOOP;
END;
$$;

-- "I have this note open" (every ~20s while it is), or "I closed it".
-- The caller is the session; answers with the people viewing it, self
-- included, or NULL when the caller may not view it (and is then forgotten).
CREATE OR REPLACE FUNCTION public.notes_live_here(
  p_note_id uuid,
  p_session_id text,
  p_leaving boolean DEFAULT false
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_before uuid[];
  v_after uuid[];
  v_gone int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NULL OR length(p_session_id) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'Invalid session.' USING ERRCODE = '22023';
  END IF;

  v_before := public.notes_live__viewers(p_note_id);
  DELETE FROM public.note_live_viewers
  WHERE note_id = p_note_id AND seen_at <= now() - public.notes_live__fresh();

  IF coalesce(p_leaving, false) OR NOT public.can_access('note', p_note_id, 'view', v_user) THEN
    DELETE FROM public.note_live_viewers
    WHERE note_id = p_note_id AND user_id = v_user AND session_id = p_session_id;
    GET DIAGNOSTICS v_gone = ROW_COUNT;
    v_after := public.notes_live__viewers(p_note_id);
    -- A person who just lost access was already left out of v_before, so a
    -- removed row counts as a change on its own: the others must hear it.
    IF v_gone > 0 OR v_after IS DISTINCT FROM v_before THEN
      PERFORM public.notes_live__tell(p_note_id, 'viewers', jsonb_build_object('viewers', to_jsonb(v_after)));
    END IF;
    -- Refused is an answer, not an error: an error would undo the forgetting.
    RETURN CASE WHEN coalesce(p_leaving, false) THEN '{}'::uuid[] END;
  END IF;

  INSERT INTO public.note_live_viewers (note_id, user_id, session_id)
  VALUES (p_note_id, v_user, p_session_id)
  ON CONFLICT (note_id, user_id, session_id) DO UPDATE SET seen_at = now();

  v_after := public.notes_live__viewers(p_note_id);
  IF v_after IS DISTINCT FROM v_before THEN
    PERFORM public.notes_live__tell(p_note_id, 'viewers', jsonb_build_object('viewers', to_jsonb(v_after)));
  END IF;
  RETURN v_after;
END;
$$;

-- ── Saved updates reach the people who have the note open ──────────────────

-- Small updates travel inline (applied at once); a big one, or an agent's,
-- is announced and pulled. Never fails the save.
CREATE OR REPLACE FUNCTION public.notes_live__on_updates() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.note_id,
           jsonb_agg(n.update_b64 ORDER BY n.id) FILTER (WHERE n.origin IS DISTINCT FROM 'api_key') AS updates,
           sum(length(n.update_b64)) AS bytes,
           bool_or(n.origin = 'api_key') AS agent
    FROM new_rows n
    WHERE EXISTS (SELECT 1 FROM public.note_live_viewers v
                  WHERE v.note_id = n.note_id AND v.seen_at > now() - public.notes_live__fresh())
    GROUP BY n.note_id
  LOOP
    BEGIN
      IF r.agent OR r.bytes > 60000 THEN
        PERFORM public.notes_live__tell(r.note_id, 'changed', '{"pull": true}'::jsonb);
      ELSE
        PERFORM public.notes_live__tell(r.note_id, 'changed', jsonb_build_object('updates', r.updates));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notes_live__on_updates: % (note %)', SQLERRM, r.note_id;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notes_live_on_updates ON public.note_updates;
CREATE TRIGGER notes_live_on_updates
  AFTER INSERT ON public.note_updates
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notes_live__on_updates();

REVOKE ALL ON FUNCTION public.notes_live__fresh() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notes_live__viewers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notes_live__tell(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notes_live__on_updates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notes_live_here(uuid, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.notes_live_here(uuid, text, boolean) TO authenticated;

-- ── Each person's own topic: they read it, nobody writes it ────────────────

DROP POLICY IF EXISTS notes_live_read ON realtime.messages;
CREATE POLICY notes_live_read ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension = 'broadcast'
         AND realtime.topic() = 'notes-live:' || auth.uid()::text);
-- (No INSERT policy: a client can't broadcast or track presence on it.)

-- ── Assert ─────────────────────────────────────────────────────────────────

DO $$
DECLARE fn text;
BEGIN
  IF has_function_privilege('anon', 'public.notes_live_here(uuid, text, boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.notes_live_here(uuid, text, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.notes_live_here(uuid, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'notes_live_here must be callable by signed-in people only.';
  END IF;
  FOREACH fn IN ARRAY ARRAY['notes_live__viewers(uuid)', 'notes_live__tell(uuid, text, jsonb)', 'notes_live__on_updates()'] LOOP
    IF has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% is internal: no client may call it.', fn;
    END IF;
  END LOOP;
  -- realtime.send inserts as the function's owner and turns a refusal into a
  -- warning, so the owner must bypass RLS on realtime.messages.
  IF NOT (SELECT r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.oid = 'public.notes_live__tell(uuid, text, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'notes_live__tell must be owned by a role that bypasses RLS (postgres).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
                 AND policyname = 'notes_live_read')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
                AND policyname LIKE 'notes_live%' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'The notes live policy is not as intended (read-only, own topic).';
  END IF;
END;
$$;
