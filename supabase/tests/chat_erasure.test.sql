-- Chat v2 account erasure (AC12.8, its tables). CV-1 adds chat_catchup and
-- chat_chain_mutes to account_erase_workspace_data (preview counts and deletes);
-- CV-22 adds user_clients, user_statuses, user_saved_statuses and CV-18's
-- user_notice_pauses and user_status_changes, and checks that
-- no published table is keyed by a person.
--
-- Cast: O owns workspace W; E and F are members; E also owns W2. Rows are written
-- as the ops will write them (directly, as the server).

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'G']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Shared'),
  (test.id('W2'), test.id('E'), 'E''s own');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['E', 'F', 'G']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

SET LOCAL session_replication_role = replica;
INSERT INTO public.chat_channels (id, workspace_id, kind, name, is_private, dm_key) VALUES
  (test.id('c:W'), test.id('W'), 'channel', 'general', false, NULL),
  (test.id('c:W2'), test.id('W2'), 'channel', 'general', false, NULL),
  -- Private channels E is in: with F, who left (it goes), and with G, still here (it stays).
  (test.id('c:left'), test.id('W'), 'channel', 'with-f', true, NULL),
  (test.id('c:kept'), test.id('W'), 'channel', 'with-g', true, NULL),
  -- E manages it alone; the owner O was in it and left, G is still in it.
  (test.id('c:hand'), test.id('W'), 'channel', 'handover', true, NULL),
  -- E and F manage it; F left it, G is still in it.
  (test.id('c:hand2'), test.id('W'), 'channel', 'co-managed', true, NULL);
INSERT INTO public.chat_members (channel_id, user_id, workspace_id, left_at) VALUES
  (test.id('c:W'), test.id('E'), test.id('W'), NULL),
  (test.id('c:W'), test.id('F'), test.id('W'), NULL),
  (test.id('c:left'), test.id('E'), test.id('W'), NULL),
  (test.id('c:left'), test.id('F'), test.id('W'), now()),
  (test.id('c:kept'), test.id('E'), test.id('W'), NULL),
  (test.id('c:kept'), test.id('G'), test.id('W'), NULL),
  (test.id('c:hand'), test.id('O'), test.id('W'), now()),
  (test.id('c:hand'), test.id('E'), test.id('W'), NULL),
  (test.id('c:hand'), test.id('G'), test.id('W'), NULL),
  (test.id('c:hand2'), test.id('E'), test.id('W'), NULL),
  (test.id('c:hand2'), test.id('F'), test.id('W'), now()),
  (test.id('c:hand2'), test.id('G'), test.id('W'), NULL);
INSERT INTO public.chat_channel_managers (channel_id, user_id) VALUES
  (test.id('c:hand'), test.id('E')),
  (test.id('c:hand2'), test.id('E')),
  (test.id('c:hand2'), test.id('F'));
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body) VALUES
  (test.id('m:1'), test.id('W'), test.id('c:W'), test.id('F'), 'one'),
  (test.id('m:2'), test.id('W'), test.id('c:W'), test.id('F'), 'two'),
  (test.id('m:3'), test.id('W2'), test.id('c:W2'), test.id('E'), 'three');
SET LOCAL session_replication_role = origin;

INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, message_id, reason, actor_id) VALUES
  (test.id('W'), test.id('E'), test.id('c:W'), test.id('m:1'), 'mention', test.id('F')),
  (test.id('W'), test.id('E'), test.id('c:W'), NULL, 'level_reset', NULL),
  (test.id('W2'), test.id('E'), test.id('c:W2'), test.id('m:3'), 'everyone', NULL),
  (test.id('W'), test.id('F'), test.id('c:W'), test.id('m:2'), 'reply', test.id('E'));
INSERT INTO public.chat_chain_mutes (user_id, root_id, workspace_id) VALUES
  (test.id('E'), test.id('m:1'), test.id('W')),
  (test.id('E'), test.id('m:3'), test.id('W2')),
  (test.id('F'), test.id('m:2'), test.id('W'));
-- CV-22: the per-person tables of CV-6a and CV-17 (devices, statuses, saved
-- statuses), written as their ops write them.
INSERT INTO public.user_clients (id, user_id, surface) VALUES
  (test.id('dev:E1'), test.id('E'), 'web'),
  (test.id('dev:E2'), test.id('E'), 'desktop'),
  (test.id('dev:F'), test.id('F'), 'web');
INSERT INTO public.user_statuses (user_id, emoji, text, set_at) VALUES
  (test.id('E'), '🌴', 'On vacation', now()),
  (test.id('F'), NULL, 'In a meeting', now());
INSERT INTO public.user_saved_statuses (user_id, text, clear_after, position) VALUES
  (test.id('E'), 'Sleeping', 'never', 0),
  (test.id('E'), 'Deep work', 'never', 1),
  (test.id('F'), 'Lunch', 'never', 0);
-- CV-18: paused workspaces and the status-change counter.
INSERT INTO public.user_notice_pauses (user_id, workspace_id) VALUES
  (test.id('E'), test.id('W')),
  (test.id('E'), test.id('W2')),
  (test.id('F'), test.id('W'));
INSERT INTO public.user_status_changes (user_id, window_start, n) VALUES
  (test.id('E'), now(), 3),
  (test.id('F'), now(), 1);

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v ->> 'chat_catchup_deleted')::int = 3 AND (v ->> 'chat_chain_mutes_deleted')::int = 2,
    'preview: counts every Catch up item and chain mute of E''s, in every workspace', v::text);
  PERFORM test.ok((v ->> 'chat_channels_deleted')::int = 1,
    'preview: a private channel whose only other person left goes; one with someone still in it stays',
    v ->> 'chat_channels_deleted');
  PERFORM test.ok((v ->> 'user_clients_deleted')::int = 2 AND (v ->> 'user_statuses_deleted')::int = 1
                  AND (v ->> 'saved_statuses_deleted')::int = 2,
    'preview: counts E''s devices, status and saved statuses', v::text);
  PERFORM test.ok((v ->> 'notice_pauses_deleted')::int = 2 AND (v ->> 'status_changes_deleted')::int = 1,
    'preview: counts E''s paused workspaces and status-change counter', v::text);
  PERFORM test.ok((SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('E')) = 3
                  AND (SELECT count(*) FROM public.user_clients WHERE user_id = test.id('E')) = 2
                  AND (SELECT count(*) FROM public.user_statuses WHERE user_id = test.id('E')) = 1,
    'preview: changes nothing');

  PERFORM public.account_erase_workspace_data(test.id('E'), false);
  PERFORM test.ok(
    (SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('E')) = 0
    AND (SELECT count(*) FROM public.chat_chain_mutes WHERE user_id = test.id('E')) = 0,
    'erase: E''s Catch up items and chain mutes are gone');
  PERFORM test.ok(
    (SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('F')) = 1
    AND (SELECT count(*) FROM public.chat_chain_mutes WHERE user_id = test.id('F')) = 1,
    'erase: nobody else''s rows are touched (F''s item naming E as its actor stays)');
  PERFORM test.ok(
    NOT EXISTS (SELECT 1 FROM public.user_clients WHERE user_id = test.id('E'))
    AND NOT EXISTS (SELECT 1 FROM public.user_statuses WHERE user_id = test.id('E'))
    AND NOT EXISTS (SELECT 1 FROM public.user_saved_statuses WHERE user_id = test.id('E')),
    'erase: E''s devices, status and saved statuses are gone');
  PERFORM test.ok(
    (SELECT count(*) FROM public.user_clients WHERE user_id = test.id('F')) = 1
    AND (SELECT count(*) FROM public.user_statuses WHERE user_id = test.id('F')) = 1
    AND (SELECT count(*) FROM public.user_saved_statuses WHERE user_id = test.id('F')) = 1,
    'erase: F''s devices and statuses are untouched');
  PERFORM test.ok(
    NOT EXISTS (SELECT 1 FROM public.user_notice_pauses WHERE user_id = test.id('E'))
    AND NOT EXISTS (SELECT 1 FROM public.user_status_changes WHERE user_id = test.id('E'))
    AND EXISTS (SELECT 1 FROM public.user_notice_pauses WHERE user_id = test.id('F'))
    AND EXISTS (SELECT 1 FROM public.user_status_changes WHERE user_id = test.id('F')),
    'erase: E''s pauses and status-change counter are gone; F''s stay');
  PERFORM test.ok(
    NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = test.id('c:left'))
    AND EXISTS (SELECT 1 FROM public.chat_channels WHERE id = test.id('c:kept')),
    'erase: the channel only a former member shared with E goes; the one G is in stays');
  PERFORM test.ok(
    (SELECT array_agg(user_id) FROM public.chat_channel_managers WHERE channel_id = test.id('c:hand'))
      = ARRAY[test.id('G')],
    'erase: a channel E managed alone goes to G, still in it, not to the owner who left it');
  PERFORM test.ok(
    EXISTS (SELECT 1 FROM public.chat_channel_managers WHERE channel_id = test.id('c:hand2') AND user_id = test.id('G')),
    'erase: a co-manager who left doesn''t count: E''s channel still gets a manager who is in it (G)');

  -- The rows also go with the profile (account deletion's cascade).
  DELETE FROM auth.users WHERE id = test.id('F');
  PERFORM test.ok(
    (SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('F')) = 0
    AND (SELECT count(*) FROM public.chat_chain_mutes WHERE user_id = test.id('F')) = 0,
    'cascade: deleting the account removes its Catch up items and chain mutes');
  PERFORM test.ok(
    NOT EXISTS (SELECT 1 FROM public.user_clients WHERE user_id = test.id('F'))
    AND NOT EXISTS (SELECT 1 FROM public.user_statuses WHERE user_id = test.id('F'))
    AND NOT EXISTS (SELECT 1 FROM public.user_saved_statuses WHERE user_id = test.id('F'))
    AND NOT EXISTS (SELECT 1 FROM public.chat_members WHERE user_id = test.id('F'))
    AND NOT EXISTS (SELECT 1 FROM public.user_notice_pauses WHERE user_id = test.id('F'))
    AND NOT EXISTS (SELECT 1 FROM public.user_status_changes WHERE user_id = test.id('F')),
    'cascade: and its devices, statuses, memberships and pauses');
END;
$$;

-- CV-22: a removed row reaches Realtime listeners as its key alone, without a
-- read rule (a removed row can't be checked against one). Every published
-- table is keyed by its own row id, never by a person, so an erasure or an
-- account's cascade tells nobody who it was.
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
  PERFORM test.ok(v_bad IS NULL, 'realtime: no published table is keyed by a person', v_bad);
  PERFORM test.ok(
    (SELECT array_agg(a.attname::text) FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'public.chat_members'::regclass AND c.contype = 'p') = ARRAY['id']
    AND (SELECT array_agg(a.attname::text) FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'public.user_statuses'::regclass AND c.contype = 'p') = ARRAY['id'],
    'realtime: chat_members and user_statuses are keyed by their row id');
  PERFORM test.ok(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.chat_members'::regclass
              AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (channel_id, user_id)')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_statuses'::regclass
              AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (user_id)'),
    'one membership per person and conversation, one status per person');
  PERFORM test.ok(
    (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename IN ('chat_members', 'user_statuses')) = 2,
    'realtime: both tables stay published');
  PERFORM test.ok(
    has_table_privilege('authenticated', 'public.chat_members', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.chat_members', 'INSERT, UPDATE, DELETE')
    AND NOT has_table_privilege('anon', 'public.chat_members', 'SELECT, INSERT, UPDATE, DELETE')
    AND has_table_privilege('authenticated', 'public.user_statuses', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.user_statuses', 'INSERT, UPDATE, DELETE')
    AND NOT has_table_privilege('anon', 'public.user_statuses', 'SELECT, INSERT, UPDATE, DELETE'),
    'grants: people read both tables through their rules; only the server writes');
  PERFORM test.ok(
    NOT EXISTS (SELECT 1 FROM pg_publication_tables t
                  JOIN pg_class c ON c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
                 WHERE t.pubname = 'supabase_realtime' AND c.relreplident <> 'd'),
    'realtime: a removed row sends only its key (no published table has a full replica identity)');
END;
$$;
