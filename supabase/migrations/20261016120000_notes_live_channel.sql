-- NR-7: a secure live channel for each note (specs/notes-refresh.md AC12,
-- assumption 18).
--
-- Until now a note's live edits and presence rode a PUBLIC Realtime channel
-- (`notes:<id>`): anyone signed in who knew a note's id could listen to its
-- keystrokes, appear in its facepile and broadcast bytes into it. Clients now
-- join a PRIVATE channel, topic `note:<id>`, and Realtime admits a join only
-- if these `realtime.messages` policies allow it:
--
--   • read (receive broadcasts, see presence): view access to the note;
--   • track presence:                          view access to the note;
--   • broadcast (relay edits):                 edit access to the note.
--
-- Access is the app's one rule, `can_access('note', …)` (creator, direct
-- grants, inheritance up the tree, capped by the member's module ceiling).
-- The policies sit beside chat's; permissive policies OR together and each
-- topic helper refuses every topic that isn't its own, so neither widens the
-- other. The MCP connector's "an agent wrote, pull" cue is sent with the
-- service role, which Realtime lets past these policies; it stays content-free
-- and clients keep pulling (docs/gotchas/notes.md §Agent writes).

-- Does the signed-in person have at least `p_min` on the note this topic names?
-- Any other topic (chat's, a malformed one) is refused.
CREATE OR REPLACE FUNCTION public.notes_realtime_topic_allowed(p_topic text, p_min text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_min IN ('view', 'edit')
     AND p_topic ~ '^note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN coalesce(public.can_access('note', substring(p_topic from 6)::uuid, p_min), false)
    ELSE false
  END
$$;
REVOKE ALL ON FUNCTION public.notes_realtime_topic_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_realtime_topic_allowed(text, text) TO authenticated;

DROP POLICY IF EXISTS notes_realtime_read ON realtime.messages;
CREATE POLICY notes_realtime_read ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension IN ('broadcast', 'presence')
         AND public.notes_realtime_topic_allowed(realtime.topic(), 'view'));

DROP POLICY IF EXISTS notes_realtime_write ON realtime.messages;
CREATE POLICY notes_realtime_write ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK ((realtime.messages.extension = 'presence'
               AND public.notes_realtime_topic_allowed(realtime.topic(), 'view'))
           OR (realtime.messages.extension = 'broadcast'
               AND public.notes_realtime_topic_allowed(realtime.topic(), 'edit')));

-- ── Assert the grants and the policies ──────────────────────────────────────

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.notes_realtime_topic_allowed(text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.notes_realtime_topic_allowed(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Grants on public.notes_realtime_topic_allowed are not as intended: signed-in people, never anon.';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'realtime' AND tablename = 'messages'
        AND policyname IN ('notes_realtime_read', 'notes_realtime_write')) <> 2 THEN
    RAISE EXCEPTION 'The notes Realtime policies are not both in place.';
  END IF;
END;
$$;
