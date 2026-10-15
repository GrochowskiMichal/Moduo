-- Chat v2 channel lifecycle and who may do what (CV-15:
-- supabase/migrations/…_chat_v2_channel_lifecycle.sql). "private, delete,
-- archive, removal" (AC10.1, AC10.5–10.7, AC6.2, AC6.3, AC1.12): managers add
-- and remove managers (the last one stays); only a manager in effect renames,
-- archives or changes a channel, so someone demoted loses it at once; public →
-- private once; delete to Recently deleted with Restore and the purge after 30
-- days; General refuses; archive is read only, searchable, and clears Catch up;
-- removal sticks (even for someone who had left or only read it) and writes the
-- quiet line; membership rows are stamped, never deleted; a key does none of it.
--
-- Cast: O owns W (Duo); D is an admin; A, B, C, F, G are members; V is a
-- viewer; X is in no workspace; K is A's API key with Chat at Edit. A makes the
-- public channel Q (with B, C, D, F, V) and the private channel P (with B).

SELECT test.person(n) FROM unnest(ARRAY['O', 'D', 'A', 'B', 'C', 'F', 'G', 'V', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Lifecycle');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C', 'F', 'G']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('D'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
-- Run an op on a conversation as someone: 'ok n' or '<sqlstate> <message>'.
CREATE FUNCTION test.op(p_who text, p_sql text, p_conv text, p_user text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(p_sql, test.ref(p_conv), test.id(p_user)))
$$;
CREATE FUNCTION test.key_op(p_sql text, p_conv text, p_user text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_key('K', format(p_sql, test.ref(p_conv), test.id(p_user)))
$$;
CREATE FUNCTION test.chan(p_conv text) RETURNS public.chat_channels LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_channels WHERE id = test.ref(p_conv)
$$;
CREATE FUNCTION test.mem(p_conv text, p_who text) RETURNS public.chat_members LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_members WHERE channel_id = test.ref(p_conv) AND user_id = test.id(p_who)
$$;
CREATE FUNCTION test.reads(p_who text, p_conv text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
  SELECT public.chat__can_read_channel_as(test.ref(p_conv), test.id(p_who))
$$;
CREATE FUNCTION test.set_role(p_who text, p_key text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.workspace_members m
     SET role = p_key,
         role_id = (SELECT r.id FROM public.workspace_roles r
                     WHERE r.workspace_id = test.id('W') AND r.system_key = p_key)
   WHERE m.workspace_id = test.id('W') AND m.user_id = test.id(p_who)
$$;
CREATE FUNCTION test.acts(p_conv text, p_op text) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.module_activity a
   WHERE a.entity_type = 'chat_channel' AND a.entity_id = test.ref(p_conv) AND a.op = p_op
$$;
-- Every membership key ever seen: none may disappear (rows are stamped, never deleted).
CREATE TABLE test.seen (channel_id uuid, user_id uuid, PRIMARY KEY (channel_id, user_id));
CREATE FUNCTION test.remember() RETURNS void LANGUAGE sql AS $$
  INSERT INTO test.seen SELECT channel_id, user_id FROM public.chat_members
   WHERE workspace_id = test.id('W') ON CONFLICT DO NOTHING
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  INSERT INTO test.ids SELECT 'General', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND is_default;
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'launch', '', false, ARRAY[%L, %L, %L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('D'), test.id('F'), test.id('V')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'launch';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'founders', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'founders';
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  INSERT INTO test.ids SELECT 'DM', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv15'),
          '{"chat": "edit"}'::jsonb, test.id('A'));
  PERFORM test.remember();
END;
$$;

-- ── Managers: who adds and removes them; the last one stays ─────────────────
DO $$
DECLARE
  v text;
  q_set text := $q$SELECT public.chat_op_set_manager(%L, %L, true)$q$;
  q_unset text := $q$SELECT public.chat_op_set_manager(%L, %L, false)$q$;
BEGIN
  v := test.op('B', q_set, 'Q', 'C');
  PERFORM test.ok(v LIKE '42501%', 'managers: a member can''t make someone a manager', v);
  v := test.op('V', q_set, 'Q', 'B');
  PERFORM test.ok(v LIKE '42501%', 'managers: a viewer can''t make someone a manager', v);
  v := test.op('X', q_set, 'Q', 'B');
  PERFORM test.ok(v LIKE '42501%', 'managers: an outsider is refused', v);
  v := test.key_op(q_set, 'Q', 'B');
  PERFORM test.ok(v NOT LIKE 'ok%', 'managers: a key is refused', v);
  v := test.op('A', q_set, 'Q', 'V');
  PERFORM test.ok(v LIKE '22023%', 'managers: a viewer can''t be made a manager', v);
  v := test.op('A', q_set, 'Q', 'G');
  PERFORM test.ok(v LIKE '22023%', 'managers: someone not in the channel can''t be made a manager', v);

  v := test.op('A', q_set, 'Q', 'B');
  PERFORM test.ok(v LIKE 'ok%' AND EXISTS (SELECT 1 FROM public.chat_channel_managers
                                             WHERE channel_id = test.ref('Q') AND user_id = test.id('B')),
    'managers: the manager makes B a manager', v);
  PERFORM test.ok(test.acts('Q', 'chat.manager_add') = 1
                  AND (SELECT actor_id FROM public.module_activity WHERE entity_id = test.ref('Q')
                        AND op = 'chat.manager_add') = test.id('A'),
    'managers: one chat.manager_add row, by the person who did it');
  PERFORM test.ok((test.chan('Q')).roster_at IS NOT NULL, 'managers: the channel''s roster stamp moves');
  v := test.op('D', q_set, 'Q', 'C');
  PERFORM test.ok(v LIKE 'ok%', 'managers: an admin (Manage any channel) makes C a manager', v);
  v := test.op('O', q_unset, 'Q', 'C');
  PERFORM test.ok(v LIKE 'ok%', 'managers: the owner removes C as manager', v);
  PERFORM test.ok(test.acts('Q', 'chat.manager_remove') = 1, 'managers: one chat.manager_remove row');

  -- P: A is its only manager.
  v := test.op('A', q_unset, 'P', 'A');
  PERFORM test.ok(v LIKE '22023%' AND v LIKE '%needs a manager%', 'last manager: A can''t un-manage themselves while last', v);
  v := test.op('A', q_set, 'P', 'B');
  v := test.op('A', q_unset, 'P', 'A');
  PERFORM test.ok(v LIKE 'ok%', 'last manager: with B managing too, A steps down', v);
  v := test.op('B', q_unset, 'P', 'B');
  PERFORM test.ok(v LIKE '22023%', 'last manager: now B is the last and stays', v);
  v := test.op('D', q_unset, 'P', 'B');
  PERFORM test.ok(v NOT LIKE 'ok%', 'last manager: an admin outside the private channel can''t reach it', v);
  v := test.op('A', q_set, 'DM', 'B');
  PERFORM test.ok(v LIKE '22023%', 'managers: a direct message has none', v);
END;
$$;

-- ── Rule: only a manager in effect renames, archives or changes a channel ──
DO $$
DECLARE
  v text;
  q_rename text := $q$SELECT public.chat_op_update_channel(%L, 'launch-2', NULL)$q$;
  q_archive text := $q$SELECT public.chat_op_archive_channel(%L, true)$q$;
  q_announce text := $q$SELECT public.chat_op_set_announcement(%L, true)$q$;
BEGIN
  -- B manages Q (above). Demoted to member of the channel: everything goes.
  PERFORM test.ok(test.op('B', $q$SELECT public.chat_op_update_channel(%L, 'launch', 'A topic')$q$, 'Q') LIKE 'ok%',
    'demotion: as a manager B can change the channel');
  v := test.op('A', $q$SELECT public.chat_op_set_manager(%L, %L, false)$q$, 'Q', 'B');
  PERFORM test.ok(v LIKE 'ok%', 'demotion: A removes B as manager', v);
  v := test.op('B', q_rename, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'demotion: B can''t rename any more', v);
  v := test.op('B', q_archive, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'demotion: B can''t archive any more', v);
  v := test.op('B', q_announce, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'demotion: B can''t flip the announcement switch any more', v);
  v := test.op('B', $q$SELECT public.chat_op_make_private(%L)$q$, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'demotion: B can''t make it private any more', v);
  v := test.op('B', $q$SELECT public.chat_op_delete_channel(%L)$q$, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'demotion: B can''t delete it any more', v);
  v := test.op('B', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'C');
  PERFORM test.ok(v LIKE '42501%', 'demotion: B can''t remove people any more', v);

  -- C manages Q again, then their role becomes viewer: their manager row stays but manages nothing.
  PERFORM test.op('A', $q$SELECT public.chat_op_set_manager(%L, %L, true)$q$, 'Q', 'C');
  PERFORM test.set_role('C', 'viewer');
  v := test.op('C', q_rename, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'role demotion: a manager whose role became viewer can''t rename', v);
  v := test.op('C', q_archive, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'role demotion: … nor archive', v);
  v := test.op('C', $q$SELECT public.chat_op_set_manager(%L, %L, true)$q$, 'Q', 'F');
  PERFORM test.ok(v LIKE '42501%', 'role demotion: … nor make managers', v);
  PERFORM test.set_role('C', 'member');
  PERFORM test.ok(test.op('C', $q$SELECT public.chat_op_update_channel(%L, 'launch', NULL)$q$, 'Q') LIKE 'ok%',
    'role demotion: back to member, C manages again');
  PERFORM test.op('A', $q$SELECT public.chat_op_set_manager(%L, %L, false)$q$, 'Q', 'C');

  -- D manages through the admin role alone: demoted to member, it's gone.
  PERFORM test.set_role('D', 'member');
  v := test.op('D', q_archive, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'admin demotion: a former admin can''t archive', v);
  PERFORM test.set_role('D', 'admin');
  PERFORM test.ok(test.op('D', q_rename, 'Q') LIKE 'ok%', 'admin: Manage any channel renames');
  PERFORM test.op('D', $q$SELECT public.chat_op_update_channel(%L, 'launch', NULL)$q$, 'Q');
END;
$$;

-- ── Make private: public → private once ────────────────────────────────────
DO $$
DECLARE
  v text;
  v_item uuid;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'roadmap', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  INSERT INTO test.ids SELECT 'R', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'roadmap';
  -- G reads R without being in it and is mentioned there: an open item.
  v := test.as_user('A', format($q$SELECT public.chat_op_send(gen_random_uuid(), %L::uuid, %L::text, NULL::uuid)$q$,
    test.ref('R'), format('Look moduo://person/%s', test.id('G'))));
  SELECT id INTO v_item FROM public.chat_catchup WHERE user_id = test.id('G') AND channel_id = test.ref('R') AND done_at IS NULL;
  PERFORM test.ok(v_item IS NOT NULL AND test.reads('G', 'R'), 'private: G reads R and has an item for it', v);

  v := test.op('B', $q$SELECT public.chat_op_make_private(%L)$q$, 'R');
  PERFORM test.ok(v LIKE '42501%', 'private: a member can''t make it private', v);
  v := test.key_op($q$SELECT public.chat_op_make_private(%L)$q$, 'R');
  PERFORM test.ok(v NOT LIKE 'ok%', 'private: a key can''t', v);
  v := test.op('A', $q$SELECT public.chat_op_make_private(%L)$q$, 'General');
  PERFORM test.ok(v LIKE '22023%', 'private: General stays public', v);
  v := test.op('A', $q$SELECT public.chat_op_make_private(%L)$q$, 'DM');
  PERFORM test.ok(v LIKE '22023%', 'private: a direct message refuses', v);
  v := test.op('A', $q$SELECT public.chat_op_make_private(%L)$q$, 'R');
  PERFORM test.ok(v LIKE 'ok%' AND (test.chan('R')).is_private, 'private: its manager makes R private', v);
  PERFORM test.ok(NOT test.reads('G', 'R') AND test.reads('B', 'R') AND test.reads('A', 'R'),
    'private: G (not in it) loses it; its members keep it');
  PERFORM test.ok((SELECT done_how FROM public.chat_catchup WHERE id = v_item) = 'closed',
    'private: G''s item for it closes (closed)');
  PERFORM test.ok(NOT public.perm_can_see_entity(test.id('W'), 'chat_channel', test.ref('R')) IS TRUE,
    'private: nobody without a session sees it through the spine');
  PERFORM test.ok(test.acts('R', 'chat.channel_private') = 1, 'private: one chat.channel_private row');
  v := test.op('A', $q$SELECT public.chat_op_make_private(%L)$q$, 'R');
  PERFORM test.ok(v LIKE 'ok%' AND test.acts('R', 'chat.channel_private') = 1, 'private: twice changes nothing', v);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('chat_op_make_public')),
    'private: there is no way back to public');
  PERFORM test.ok(test.op('A', $q$SELECT public.chat_op_join(%L)$q$, 'R') LIKE 'ok%'
                  AND test.op('G', $q$SELECT public.chat_op_join(%L)$q$, 'R') LIKE '42501%',
    'private: someone outside it can''t join');
  v := test.op('A', $q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])$q$, 'R', 'G');
  PERFORM test.ok(v LIKE 'ok%' AND test.reads('G', 'R'), 'private: its manager adds G (AC6.2)', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.chat_catchup WHERE user_id = test.id('G') AND channel_id = test.ref('R')
                           AND reason = 'added' AND actor_id = test.id('A') AND channel_name = 'roadmap'),
    'added: G gets the quiet "A added you to roadmap" line');
  PERFORM test.remember();
END;
$$;

-- ── Removal: sticks, the quiet line, items close ───────────────────────────
DO $$
DECLARE
  v text;
  v_item uuid;
BEGIN
  -- C has an open item in Q.
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_send(gen_random_uuid(), %L::uuid, %L::text, NULL::uuid)$q$,
    test.ref('Q'), format('Over to moduo://person/%s', test.id('C'))));
  SELECT id INTO v_item FROM public.chat_catchup WHERE user_id = test.id('C') AND channel_id = test.ref('Q') AND done_at IS NULL;
  PERFORM test.ok(v_item IS NOT NULL, 'removal: C has an open item in Q');

  v := test.key_op($q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'C');
  PERFORM test.ok(v NOT LIKE 'ok%', 'removal: a key can''t remove people', v);
  v := test.op('V', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'C');
  PERFORM test.ok(v LIKE '42501%', 'removal: a viewer can''t remove people', v);
  v := test.op('A', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'C');
  PERFORM test.ok(v LIKE 'ok%' AND (test.mem('Q', 'C')).removed_at IS NOT NULL
                  AND (test.mem('Q', 'C')).removed_by = test.id('A') AND (test.mem('Q', 'C')).left_at IS NOT NULL,
    'removal: its manager removes C (stamped, by A)', v);
  PERFORM test.ok((SELECT done_how FROM public.chat_catchup WHERE id = v_item) = 'closed',
    'removal: C''s open items for it close');
  PERFORM test.ok((SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('C') AND channel_id = test.ref('Q')
                    AND reason = 'removed' AND actor_id = test.id('A') AND channel_name = 'launch' AND done_at IS NULL) = 1,
    'removal: one quiet "A removed you from launch" line');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity a
                               WHERE a.entity_id = test.ref('Q') AND a.op = 'chat.member_remove'
                                 AND a.payload ? 'notify_user_ids'),
    'removal: no bell for it');
  v := test.op('C', $q$SELECT public.chat_op_join(%L)$q$, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'removal sticks: C can''t rejoin the public channel', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_send(gen_random_uuid(), %L::uuid, 'back'::text, NULL::uuid)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE '42501%', 'removal sticks: C can''t post back in', v);
  v := test.op('B', $q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])$q$, 'Q', 'C');
  PERFORM test.ok(v = 'ok 1' AND (test.mem('Q', 'C')).removed_at IS NOT NULL,
    'removal sticks: a member can''t add C back', v);
  v := test.op('A', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'C');
  PERFORM test.ok(v LIKE 'ok%' AND (SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('C')
                                     AND reason = 'removed') = 1,
    'removal: removing twice writes nothing more', v);

  -- F had already left: the removal is still recorded and sticks.
  PERFORM test.op('F', $q$SELECT public.chat_op_leave(%L)$q$, 'Q');
  PERFORM test.ok((test.mem('Q', 'F')).left_at IS NOT NULL AND (test.mem('Q', 'F')).removed_at IS NULL,
    'removal after leaving: F left Q');
  v := test.op('A', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'F');
  PERFORM test.ok(v LIKE 'ok%' AND (test.mem('Q', 'F')).removed_at IS NOT NULL
                  AND (test.mem('Q', 'F')).removed_by = test.id('A'),
    'removal after leaving: recorded on F''s row', v);
  PERFORM test.ok(test.op('F', $q$SELECT public.chat_op_join(%L)$q$, 'Q') LIKE '42501%',
    'removal after leaving: F can''t rejoin');

  -- G never joined the public channel Q: the removal is recorded too.
  v := test.op('A', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'G');
  PERFORM test.ok(v LIKE 'ok%' AND (test.mem('Q', 'G')).removed_at IS NOT NULL,
    'removal of a reader: a stamped row for G', v);
  PERFORM test.ok(test.op('G', $q$SELECT public.chat_op_join(%L)$q$, 'Q') LIKE '42501%',
    'removal of a reader: G can''t join');
  v := test.op('A', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'Q', 'X');
  PERFORM test.ok(v LIKE 'ok%' AND (test.mem('Q', 'X')).channel_id IS NULL,
    'removal: someone outside the workspace gets no row', v);

  -- A manager adds C back: a membership again, and the added line.
  v := test.op('A', $q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])$q$, 'Q', 'C');
  PERFORM test.ok(v LIKE 'ok%' AND (test.mem('Q', 'C')).left_at IS NULL AND (test.mem('Q', 'C')).removed_at IS NULL,
    'removal: a manager adds C back', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.chat_catchup WHERE user_id = test.id('C') AND channel_id = test.ref('Q')
                           AND reason = 'added'),
    'added: C gets the quiet added line');

  -- Private P: B removed, it leaves their reach; the line still names it.
  v := test.op('B', $q$SELECT public.chat_op_remove_member(%L, %L)$q$, 'P', 'A');
  PERFORM test.ok(v LIKE 'ok%', 'removal: B (P''s manager) removes A from P', v);
  PERFORM test.ok(NOT test.reads('A', 'P'), 'removal: A no longer reads P');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.chat_catchup WHERE user_id = test.id('A') AND channel_id = test.ref('P')
                           AND reason = 'removed' AND channel_name = 'founders'),
    'removal: A''s line names P though A can''t read it');
  PERFORM test.ok(test.op('A', $q$SELECT public.chat_op_join(%L)$q$, 'P') LIKE '42501%',
    'removal: A can''t rejoin P');
  PERFORM test.remember();
END;
$$;

-- ── Archive: read only, searchable, Catch up clears ─────────────────────────
DO $$
DECLARE
  v text;
  v_item uuid;
BEGIN
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_send(gen_random_uuid(), %L::uuid, %L::text, NULL::uuid)$q$,
    test.ref('Q'), format('Ship it moduo://person/%s', test.id('B'))));
  SELECT id INTO v_item FROM public.chat_catchup WHERE user_id = test.id('B') AND channel_id = test.ref('Q')
     AND reason = 'mention' AND done_at IS NULL;
  v := test.op('B', $q$SELECT public.chat_op_archive_channel(%L, true)$q$, 'Q');
  PERFORM test.ok(v LIKE '42501%', 'archive: a member can''t', v);
  v := test.op('A', $q$SELECT public.chat_op_archive_channel(%L, true)$q$, 'Q');
  PERFORM test.ok(v LIKE 'ok%' AND (test.chan('Q')).archived_at IS NOT NULL, 'archive: its manager archives Q', v);
  PERFORM test.ok((SELECT done_how FROM public.chat_catchup WHERE id = v_item) = 'closed',
    'archive: B''s open item for it closes');
  PERFORM test.ok(test.reads('B', 'Q') AND test.reads('G', 'Q'), 'archive: still readable (and searchable) by its readers');
  v := test.as_user('B', format($q$SELECT public.chat_op_send(gen_random_uuid(), %L::uuid, 'late'::text, NULL::uuid)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE '42501%', 'archive: read only', v);
  v := test.op('A', $q$SELECT public.chat_op_archive_channel(%L, false)$q$, 'Q');
  PERFORM test.ok(v LIKE 'ok%' AND (test.chan('Q')).archived_at IS NULL
                  AND (SELECT done_how FROM public.chat_catchup WHERE id = v_item) = 'closed',
    'archive: unarchived, the closed item stays closed', v);
  v := test.op('O', $q$SELECT public.chat_op_archive_channel(%L, true)$q$, 'General');
  PERFORM test.ok(v LIKE '22023%', 'archive: General refuses', v);
END;
$$;

-- ── Delete, Recently deleted, restore ──────────────────────────────────────
DO $$
DECLARE
  v text;
  q_list text := $q$SELECT count(*) FROM public.chat_recently_deleted(%L)$q$;
BEGIN
  v := test.op('A', $q$SELECT public.chat_op_delete_channel(%L)$q$, 'General');
  PERFORM test.ok(v LIKE '22023%', 'delete: General refuses', v);
  v := test.op('A', $q$SELECT public.chat_op_delete_channel(%L)$q$, 'DM');
  PERFORM test.ok(v LIKE '22023%', 'delete: a direct message refuses (leave it instead)', v);
  v := test.op('B', $q$SELECT public.chat_op_delete_channel(%L)$q$, 'R');
  PERFORM test.ok(v LIKE '42501%', 'delete: a member can''t', v);
  v := test.key_op($q$SELECT public.chat_op_delete_channel(%L)$q$, 'R');
  PERFORM test.ok(v NOT LIKE 'ok%', 'delete: a key can''t', v);

  v := test.op('A', $q$SELECT public.chat_op_delete_channel(%L)$q$, 'R');
  PERFORM test.ok(v LIKE 'ok%' AND (test.chan('R')).deleted_at IS NOT NULL AND (test.chan('R')).deleted_by = test.id('A'),
    'delete: its manager deletes R (private)', v);
  PERFORM test.ok(NOT test.reads('A', 'R') AND NOT test.reads('B', 'R'), 'delete: nobody reads it');
  PERFORM test.ok((SELECT deleted_at FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = test.ref('R')) IS NOT NULL,
    'delete: its registry row is a tombstone');
  PERFORM test.ok(test.value_as('A', format(q_list, test.id('W'))) = '1', 'Recently deleted: its manager sees R');
  PERFORM test.ok(test.value_as('B', format(q_list, test.id('W'))) = '0', 'Recently deleted: a member doesn''t');
  PERFORM test.ok(test.value_as('D', format(q_list, test.id('W'))) = '0',
    'Recently deleted: an admin not in the private channel doesn''t');
  PERFORM test.ok(test.value_as('X', format(q_list, test.id('W'))) = '0', 'Recently deleted: an outsider doesn''t');
  v := test.as_key('K', format($q$SELECT 1 FROM public.chat_recently_deleted(%L)$q$, test.id('W')));
  PERFORM test.ok(v = 'ok 0' OR v NOT LIKE 'ok%', 'Recently deleted: a key gets nothing', v);
  PERFORM test.ok(public.perm_can_see_entity(test.id('W'), 'chat_channel', test.ref('Q')) IS NOT TRUE,
    'spine: without a session (as a key would) no chat row is seen');

  v := test.op('B', $q$SELECT public.chat_op_restore_channel(%L)$q$, 'R');
  PERFORM test.ok(v LIKE 'P0002%', 'restore: a member can''t', v);
  v := test.key_op($q$SELECT public.chat_op_restore_channel(%L)$q$, 'R');
  PERFORM test.ok(v NOT LIKE 'ok%', 'restore: a key can''t', v);
  v := test.op('A', $q$SELECT public.chat_op_restore_channel(%L)$q$, 'R');
  PERFORM test.ok(v LIKE 'ok%' AND (test.chan('R')).deleted_at IS NULL AND test.reads('B', 'R') AND test.reads('G', 'R'),
    'restore: its manager brings R back, everyone in it reads it again', v);
  PERFORM test.ok((SELECT deleted_at FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = test.ref('R')) IS NULL,
    'restore: its registry row is live again');
  PERFORM test.ok(test.acts('R', 'chat.channel_delete') = 1 AND test.acts('R', 'chat.channel_restore') = 1,
    'delete / restore: one history row each');

  -- A public channel whose name was taken meanwhile comes back renamed.
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'alpha', '', false, '{}'::uuid[])$q$, test.id('W')));
  INSERT INTO test.ids SELECT 'S', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'alpha';
  PERFORM test.op('A', $q$SELECT public.chat_op_delete_channel(%L)$q$, 'S');
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'Alpha', '', false, '{}'::uuid[])$q$, test.id('W')));
  PERFORM test.ok(test.value_as('D', format(q_list, test.id('W'))) = '1', 'Recently deleted: an admin sees a deleted public channel');
  v := test.op('D', $q$SELECT public.chat_op_restore_channel(%L)$q$, 'S');
  PERFORM test.ok(v LIKE 'ok%' AND (test.chan('S')).name = 'alpha (restored)',
    'restore: an admin restores it; the taken name becomes "alpha (restored)"', v);
  PERFORM test.remember();
END;
$$;

-- ── The purge: after 30 days, for good ──────────────────────────────────────
DO $$
DECLARE
  v text;
  v_msg uuid := gen_random_uuid();
  v_n int;
BEGIN
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'old', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  INSERT INTO test.ids SELECT 'T', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'old';
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, NULL::uuid)$q$,
    v_msg, test.ref('T'), format('hi moduo://person/%s', test.id('B'))));
  PERFORM test.remember();
  PERFORM test.op('A', $q$SELECT public.chat_op_delete_channel(%L)$q$, 'T');
  PERFORM public.chat__purge_deleted(50);
  PERFORM test.ok((test.chan('T')).purged_at IS NULL AND EXISTS (SELECT 1 FROM public.chat_messages WHERE id = v_msg),
    'purge: nothing before 30 days');
  UPDATE public.chat_channels SET deleted_at = now() - interval '31 days' WHERE id = test.ref('T');
  v_n := public.chat__purge_deleted(50);
  PERFORM test.ok(v_n >= 1 AND (test.chan('T')).purged_at IS NOT NULL, 'purge: after 30 days it runs');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE channel_id = test.ref('T'))
                  AND NOT EXISTS (SELECT 1 FROM public.chat_catchup WHERE channel_id = test.ref('T'))
                  AND NOT EXISTS (SELECT 1 FROM public.chat_channel_managers WHERE channel_id = test.ref('T'))
                  AND NOT EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.ref('T')),
    'purge: its messages, Catch up items, managers and history are gone');
  PERFORM test.ok((test.chan('T')).name = 'Deleted channel' AND (test.chan('T')).topic = '',
    'purge: the channel row keeps no name');
  PERFORM test.ok((test.mem('T', 'B')).left_at IS NOT NULL, 'purge: memberships are stamped as left');
  v := test.op('A', $q$SELECT public.chat_op_restore_channel(%L)$q$, 'T');
  PERFORM test.ok(v LIKE 'P0002%', 'purge: it can''t be restored', v);
  PERFORM test.ok(test.value_as('A', format($q$SELECT count(*) FROM public.chat_recently_deleted(%L) WHERE id = %L$q$,
    test.id('W'), test.ref('T'))) = '0', 'purge: it leaves Recently deleted');
  PERFORM test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-purge-deleted'), 'purge: the daily job is scheduled');
END;
$$;

-- ── Rule: membership rows are stamped, never deleted ───────────────────────
DO $$
BEGIN
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM test.seen s WHERE NOT EXISTS (
                    SELECT 1 FROM public.chat_members m WHERE m.channel_id = s.channel_id AND m.user_id = s.user_id)),
    'memberships: no row ever disappeared (removal, leave, delete, purge)',
    (SELECT count(*)::text FROM test.seen));
END;
$$;

-- ── Grants, function by function ───────────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'chat__touch_roster(uuid)',
    'chat__quiet_line(public.chat_channels, uuid, text, uuid)',
    'chat__close_channel_items(uuid, uuid[])',
    'chat__may_restore(public.chat_channels, uuid)',
    'chat__purge_deleted(integer)'
  ] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
                    AND NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
                    AND has_function_privilege('service_role', 'public.' || fn, 'EXECUTE'),
      'grants: ' || fn || ' is server-only');
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_set_manager(uuid, uuid, boolean)',
    'chat_op_set_announcement(uuid, boolean)',
    'chat_op_make_private(uuid)',
    'chat_op_delete_channel(uuid)',
    'chat_op_restore_channel(uuid)',
    'chat_recently_deleted(uuid)',
    'share_op_announce(uuid, boolean)',
    'chat_op_remove_member(uuid, uuid)',
    'chat_op_add_members(uuid, uuid[])',
    'chat_op_join(uuid)',
    'chat_op_leave(uuid)',
    'chat_op_archive_channel(uuid, boolean)'
  ] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
                    AND has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
                    AND has_function_privilege('service_role', 'public.' || fn, 'EXECUTE'),
      'grants: ' || fn || ' is for signed-in people, never anon');
  END LOOP;
END;
$$;
