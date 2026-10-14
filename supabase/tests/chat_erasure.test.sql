-- Chat v2 account erasure (AC12.8, its tables). CV-1 adds chat_catchup and
-- chat_chain_mutes to account_erase_workspace_data (preview counts and deletes);
-- later blocks add their own per-person tables here (user_clients, statuses).
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
  PERFORM test.ok((SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('E')) = 3,
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
END;
$$;
