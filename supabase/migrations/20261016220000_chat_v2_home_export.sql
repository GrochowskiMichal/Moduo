-- Chat v2 · CV-22 Home widgets, export and the shortcut sheet
-- (specs/chat-v2.md §10 "Home", §Edge cases "The export", AC12.8;
-- §Assumptions #31). The stamp is fixed by the build's queue (after CV-13,
-- CV-19, CV-16, CV-18). It runs again cleanly over itself.
--
-- What it does:
--   1. Every published chat table is keyed by its own row id. Realtime sends a
--      removed row's key to listeners without a read rule (a removed row can't
--      be checked against one), so a key must say nothing about anyone:
--      user_statuses and chat_members get an `id` primary key, and the person
--      columns that were their key stay unique (the ops' ON CONFLICT targets
--      keep working). The other published tables (chat_channels,
--      chat_messages, chat_catchup, notice_deliveries) already are.
--   2. Table grants re-stated for both (people read through the rules, the
--      server writes).
--   3. Account erasure also counts and removes CV-18's per-person tables
--      (user_notice_pauses, user_status_changes), re-cut from the live body;
--      it already covered chat_catchup, chat_chain_mutes, user_clients,
--      user_statuses and user_saved_statuses. Neither new table is published;
--      the published rows erasure removes (user_statuses, chat_catchup,
--      notice_deliveries, a cascaded chat_members row) reach listeners as
--      their row ids alone.
--   4. Asserts: no table in supabase_realtime has a key column that refers to
--      a person.
--
-- Needs CV-18 (20261016210000) applied first.

SET LOCAL lock_timeout = '5s';

-- ── 1. Row ids as the keys ──────────────────────────────────────────────────

ALTER TABLE public.user_statuses ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.chat_members ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

-- The default filled every existing row with its own id (a volatile default
-- is evaluated per row); check before the ids become the keys.
DO $$
BEGIN
  IF (SELECT count(*) <> count(DISTINCT id) FROM public.chat_members)
     OR (SELECT count(*) <> count(DISTINCT id) FROM public.user_statuses) THEN
    RAISE EXCEPTION 'CV-22: a row id repeats';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.user_statuses'::regclass AND conname = 'user_statuses_user_id_key') THEN
    ALTER TABLE public.user_statuses
      DROP CONSTRAINT user_statuses_pkey,
      ADD CONSTRAINT user_statuses_user_id_key UNIQUE (user_id),
      ADD CONSTRAINT user_statuses_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.chat_members'::regclass AND conname = 'chat_members_channel_user_key') THEN
    ALTER TABLE public.chat_members
      DROP CONSTRAINT chat_members_pkey,
      ADD CONSTRAINT chat_members_channel_user_key UNIQUE (channel_id, user_id),
      ADD CONSTRAINT chat_members_pkey PRIMARY KEY (id);
  END IF;
END;
$$;

-- ── 2. Grants (as last set: 20261016160000 for user_statuses, the foundation for chat_members) ──

REVOKE ALL ON public.user_statuses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_statuses TO authenticated;
GRANT ALL ON public.user_statuses TO service_role;

REVOKE ALL ON public.chat_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_members TO authenticated;
GRANT ALL ON public.chat_members TO service_role;

-- ── 3. Account erasure: CV-18's per-person tables ──────────────────────────
-- Changed in place from its live body (pg_temp.recut, as CV-6a, CV-17 and
-- CV-18): a body that has moved on stops the migration. Grants as last set
-- (20261015140000).

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

SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$  v_saved_statuses integer;
$o$,
$n$  v_saved_statuses integer;
  v_notice_pauses integer;
  v_status_changes integer;
$n$);
SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$o$,
$n$  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  -- CV-18: the workspaces whose notices they paused, and their status-change
  -- counter (CV-22 counts and removes both).
  SELECT count(*) INTO v_notice_pauses FROM public.user_notice_pauses x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_status_changes FROM public.user_status_changes x WHERE x.user_id = p_user;
$n$);
SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$    'saved_statuses_deleted', v_saved_statuses
  );$o$,
$n$    'saved_statuses_deleted', v_saved_statuses,
    'notice_pauses_deleted', v_notice_pauses,
    'status_changes_deleted', v_status_changes
  );$n$);
SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$o$,
$n$  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  DELETE FROM public.user_notice_pauses x WHERE x.user_id = p_user;
  DELETE FROM public.user_status_changes x WHERE x.user_id = p_user;
$n$);

REVOKE ALL ON FUNCTION public.account_erase_workspace_data(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erase_workspace_data(uuid, boolean) TO service_role;

-- ── 4. Asserts ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') INTO v_bad
  FROM pg_publication_tables t
  JOIN pg_constraint c ON c.conrelid = format('%I.%I', t.schemaname, t.tablename)::regclass AND c.contype = 'p'
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE t.pubname = 'supabase_realtime'
    AND EXISTS (
      SELECT 1 FROM pg_constraint f
      WHERE f.conrelid = c.conrelid AND f.contype = 'f'
        AND f.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
        AND a.attnum = ANY (f.conkey));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CV-22: a published table is keyed by a person: %', v_bad;
  END IF;

  IF (SELECT count(*) FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename IN ('user_statuses', 'chat_members')) <> 2 THEN
    RAISE EXCEPTION 'CV-22: user_statuses and chat_members must stay published';
  END IF;
END;
$$;
