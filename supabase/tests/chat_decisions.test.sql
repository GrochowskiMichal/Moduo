-- Chat v2 · decisions (CV-14; AC3.3, AC5.2, AC5.3, AC8.7;
-- supabase/migrations/…_chat_v2_decisions.sql).
--
-- Rules, as behaviour: marking a message as a decision needs reading it and
-- the right to post in its conversation (never a viewer, never an event line,
-- never in an archived channel, never without the plan); it is idempotent and
-- logs one quiet history row. Wrap up's "Also mark as decision" marks the
-- settling reply under the same rule. A decision shows on an item only to
-- people who can read its conversation and open the item: every decision of a
-- channel linked to the item, and the decisions that themselves refer to it in
-- a conversation that mentions it, direct messages included. No op takes a
-- person from the caller; an API key reads no decision through the spine.
--
-- Cast: O owns workspace W (Duo). A, B and N are members, V a viewer; X is in
-- no workspace; M is an admin; K is A's API key (chat and tasks at Edit). Q is a public channel
-- of A and B; P a private one of A and B; D a direct message of A and B.
-- SB is a shared project; PB is O's private project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'N', 'V', 'M', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Decisions');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('M'), 'admin')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv14'),
        '{"chat": "edit", "tasks": "edit", "contacts": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
CREATE FUNCTION test.send(p_who text, p_msg text, p_channel text, p_body text, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.mid(p_msg), test.ref(p_channel), p_body, CASE WHEN p_reply IS NOT NULL THEN test.mid(p_reply) END))
$$;
CREATE FUNCTION test.mark(p_who text, p_msg text, p_on boolean DEFAULT true) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT id FROM public.chat_op_mark_decision(%L::uuid, %L::boolean)$q$,
    test.mid(p_msg), p_on))
$$;
CREATE FUNCTION test.is_decision(p_msg text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
  SELECT decision_at IS NOT NULL FROM public.chat_messages WHERE id = test.mid(p_msg)
$$;
-- The decisions an item shows to p_who, as message names (sorted), or ''.
CREATE FUNCTION test.on_item(p_who text, p_type text, p_id uuid) RETURNS text LANGUAGE sql AS $$
  WITH raw AS (
    SELECT coalesce(test.value_as(p_who, format(
      $q$SELECT string_agg(d.message_id::text, ',') FROM public.chat_decisions_for_item(%L, %L::uuid) d$q$,
      p_type, p_id)), '') AS v
  )
  SELECT CASE WHEN raw.v LIKE 'ERROR%' THEN raw.v ELSE coalesce((
    SELECT string_agg(coalesce(t.name, '?'), ',' ORDER BY coalesce(t.name, '?'))
      FROM unnest(string_to_array(nullif(raw.v, ''), ',')) u(id)
      LEFT JOIN test.ids t ON t.id = u.id::uuid), '') END
    FROM raw
$$;

-- ── Setup ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
  v_contact uuid;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'acme', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q with B', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'acme';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'founders', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'founders';
  v := test.value_as('A', format($q$SELECT id::text FROM public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v ~ '^[0-9a-f-]{36}$', 'setup: A opens a direct message with B', v);
  INSERT INTO test.ids VALUES ('D', v::uuid);
  v := test.as_user('A', format($q$SELECT public.contacts_op_create(%L, 'Acme Corp contact', NULL, NULL, NULL, NULL, NULL, NULL)$q$,
    test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A adds the Acme contact', v);
  SELECT entity_id INTO v_contact FROM public.entities
   WHERE workspace_id = test.id('W') AND entity_type = 'contact' AND label = 'Acme Corp contact';
  INSERT INTO test.ids VALUES ('CT', v_contact);
  -- Both founders open it.
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'contact', v_contact, 'member', test.id('B'), 'view', test.id('A'))
  ON CONFLICT DO NOTHING;
  PERFORM test.ok(test.value_as('B', format($q$SELECT public.perm_can_see_entity(%L, 'contact', %L)::text$q$,
    test.id('W'), v_contact)) = 'true', 'setup: B can open the contact');
END;
$$;
-- Every message gets a name in test.ids, so test.on_item can name what it sees.
INSERT INTO test.ids SELECT n, test.mid(n) FROM unnest(ARRAY['q1', 'q2', 'q3', 'p1', 'p2', 'd1', 'd2', 'r', 'r1', 'r2', 's', 's1']) AS n;

-- ── Marking: who may, what may be ───────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('B', 'q1', 'Q', 'Price at $20');
  PERFORM test.ok(v LIKE 'ok %', 'setup: B posts in Q', v);
  v := test.mark('A', 'q1');
  PERFORM test.ok(v LIKE 'ok %' AND test.is_decision('q1'), 'a member marks someone else''s message as a decision', v);
  PERFORM test.ok((SELECT decision_by FROM public.chat_messages WHERE id = test.mid('q1')) = test.id('A'),
    'the decision is the caller''s (no person from the client)');
  PERFORM test.ok((SELECT count(*) FROM public.module_activity WHERE workspace_id = test.id('W')
                     AND op = 'chat.decision' AND entity_id = test.ref('Q')) = 1,
    'marking logs one quiet history row');
  v := test.mark('A', 'q1');
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT count(*) FROM public.module_activity WHERE workspace_id = test.id('W')
                     AND op = 'chat.decision' AND entity_id = test.ref('Q')) = 1,
    'marking again changes nothing and logs nothing', v);
  v := test.mark('B', 'q1', false);
  PERFORM test.ok(v LIKE 'ok %' AND NOT test.is_decision('q1'), 'any poster unmarks it', v);
  v := test.mark('B', 'q1', true);
  PERFORM test.ok(v LIKE 'ok %' AND test.is_decision('q1'), 'and marks it again', v);

  v := test.mark('V', 'q1', false);
  PERFORM test.ok(v LIKE '42501 %' AND test.is_decision('q1'), 'a viewer can''t unmark (no post rights)', v);
  v := test.send('B', 'p1', 'P', 'Founders only: we go with Stripe');
  PERFORM test.ok(v LIKE 'ok %', 'setup: B posts in P', v);
  v := test.mark('N', 'p1');
  PERFORM test.ok(v LIKE '42501 %' AND NOT test.is_decision('p1'), 'someone who can''t read the conversation can''t mark', v);
  v := test.mark('X', 'p1');
  PERFORM test.ok(v NOT LIKE 'ok %' AND NOT test.is_decision('p1'), 'an outsider can''t mark', v);
  v := test.as_key('K', format($q$SELECT id FROM public.chat_op_mark_decision(%L::uuid, true)$q$, test.mid('p1')));
  PERFORM test.ok(v NOT LIKE 'ok %' AND NOT test.is_decision('p1'), 'an API key can''t mark (no person)', v);
  v := test.mark('A', 'nothing');
  PERFORM test.ok(v LIKE 'P0002 %', 'an unknown message: refused like a missing one', v);
  v := test.as_user('A', format($q$SELECT id FROM public.chat_op_mark_decision(%L::uuid, NULL)$q$, test.mid('q1')));
  PERFORM test.ok(v LIKE '22023 %', 'no on/off: refused', v);
END;
$$;

-- Event lines are never decisions.
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, kind, event)
SELECT test.id('ev'), test.id('W'), test.ref('Q'), test.id('A'), '', 'event',
       jsonb_build_object('type', 'moved_out', 'count', 1, 'to_channel_id', test.ref('P'));
SELECT test.ok(test.as_user('A', format($q$SELECT id FROM public.chat_op_mark_decision(%L::uuid, true)$q$,
  test.id('ev'))) LIKE '22023 %', 'an event line can''t be a decision');
DELETE FROM public.chat_messages WHERE id = test.id('ev');
SELECT test.ok((SELECT count(*) FROM pg_constraint WHERE conname = 'chat_messages_decision_check') = 1,
  'the table refuses a decision on an event line too');

-- ── AC3.3: a decision from a direct message shows on the mentioned contact ──
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'd1', 'D', 'We go with Stripe for moduo://contact/' || test.ref('CT'));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A mentions the contact in the direct message', v);
  v := test.send('B', 'd2', 'D', 'Agreed, unrelated: lunch at noon');
  v := test.mark('B', 'd1');
  PERFORM test.ok(v LIKE 'ok %', 'B marks it as a decision', v);
  v := test.mark('B', 'd2');
END;
$$;
SELECT test.ok(test.on_item('A', 'contact', test.ref('CT')) = 'd1', 'the contact shows the decision to A');
SELECT test.ok(test.on_item('B', 'contact', test.ref('CT')) = 'd1', 'and to B (both founders)');
SELECT test.ok(test.value_as('A', format($q$SELECT array_to_string(with_names, ',') || '|' || channel_kind
    FROM public.chat_decisions_for_item('contact', %L::uuid)$q$, test.ref('CT'))) = 'B|dm',
  'a direct message''s line is "Decided with" the other person');
SELECT test.ok(test.on_item('N', 'contact', test.ref('CT')) = '', 'N (not in the direct message) sees nothing');
SELECT test.ok(test.on_item('O', 'contact', test.ref('CT')) = '', 'not even the workspace owner, outside the conversation');
SELECT test.ok(test.on_item('X', 'contact', test.ref('CT')) = '', 'an outsider sees nothing');
SELECT test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_decisions_for_item('contact', %L::uuid)$q$,
  test.ref('CT'))) = 'ok 0', 'an API key gets no decision through the spine');

-- ── AC5.2: a linked channel's decisions reach the project ───────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_link_channel(%L::uuid, 'project', %L::uuid)$q$,
    test.ref('Q'), test.id('SB')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A links Q to the shared project', v);
  v := test.send('A', 'q2', 'Q', 'Nothing decided here');
  v := test.send('A', 'p2', 'P', 'Launch on the 20th for moduo://project/' || test.id('SB'));
  v := test.mark('A', 'p2');
  PERFORM test.ok(v LIKE 'ok %', 'A marks a decision in P that names the project', v);
  v := test.send('A', 'p3x', 'P', 'Also moduo://project/' || test.id('PB'));
END;
$$;
SELECT test.ok(test.on_item('N', 'project', test.id('SB')) = 'q1',
  'every decision of the linked public channel shows on the project to a reader (N)');
SELECT test.ok(test.on_item('A', 'project', test.id('SB')) = 'p2,q1',
  'A also sees the decision from P that refers to the project');
SELECT test.ok(test.on_item('A', 'bucket', test.id('SB')) = 'p2,q1', 'the registry''s name answers the same');
SELECT test.ok(test.on_item('V', 'project', test.id('SB')) = 'q1', 'a viewer reading Q sees its decision');
SELECT test.ok(test.on_item('X', 'project', test.id('SB')) = '', 'an outsider sees nothing on the project');
SELECT test.ok(test.on_item('A', 'project', test.id('PB')) = '', 'an item the caller can''t open shows nothing');

-- A decision in a mentioning conversation that doesn't refer to the item stays off it.
SELECT test.ok(test.on_item('A', 'contact', test.ref('CT')) = 'd1',
  'the direct message''s other decision (no reference) stays off the contact');

-- ── Deleting hides; restoring brings it back ────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT id FROM public.chat_op_delete(%L::uuid)$q$, test.mid('p2')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A deletes the P decision', v);
  PERFORM test.ok(test.on_item('A', 'project', test.id('SB')) = 'q1', 'a deleted decision leaves the item');
  v := test.mark('A', 'p2', false);
  PERFORM test.ok(v LIKE 'P0002 %', 'a deleted message can''t be unmarked', v);
END;
$$;

-- ── AC5.3: Wrap up with "Also mark as decision" ─────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'r', 'Q', 'Which logo?');
  v := test.send('B', 'r1', 'Q', 'The round one', 'r');
  v := test.send('B', 'r2', 'Q', 'Got them, the square one', 'r');
  PERFORM test.ok((SELECT parent_id FROM public.chat_messages WHERE id = test.mid('r2')) = test.mid('r'),
    'setup: a chain of two replies');
  v := test.as_user('A', format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid)$q$, test.mid('r'), test.mid('r1')));
  PERFORM test.ok(v LIKE 'ok %' AND NOT test.is_decision('r1'), 'Wrap up without the tick marks nothing', v);
  v := test.as_user('A', format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid, true)$q$, test.mid('r'), test.mid('r2')));
  PERFORM test.ok(v LIKE 'ok %' AND test.is_decision('r2') AND NOT test.is_decision('r1'),
    'Wrap up with "Also mark as decision" marks the settling reply', v);
  PERFORM test.ok((SELECT settled_id FROM public.chat_messages WHERE id = test.mid('r')) = test.mid('r2'),
    'and the chain is wrapped on it');
  PERFORM test.ok((SELECT decision_by FROM public.chat_messages WHERE id = test.mid('r2')) = test.id('A'),
    'the decision is the wrapper''s');
  v := test.as_user('A', format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid, true)$q$, test.mid('r'), test.mid('r2')));
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT count(*) FROM public.module_activity WHERE op = 'chat.decision'
                     AND payload->>'message_id' = test.mid('r2')::text) = 1,
    'wrapping up again on the same reply logs no second decision', v);
  PERFORM test.ok(test.on_item('N', 'project', test.id('SB')) = 'q1,r2',
    'the settled decision shows on the linked project');
END;
$$;

-- ── Wrap up's tick needs post rights too ────────────────────────────────────
-- An admin may wrap up any chain, but in an announcement channel they don't
-- manage they can't post, so they can't mark the decision: the whole wrap-up is
-- refused (the app doesn't offer the tick to them).
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 's', 'Q', 'Which font?');
  v := test.send('B', 's1', 'Q', 'Inter', 's');
  PERFORM test.ok(v LIKE 'ok %', 'setup: a chain in Q', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L::uuid, true)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: Q becomes an announcement channel', v);
  v := test.as_user('M', format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid, true)$q$, test.mid('s'), test.mid('s1')));
  PERFORM test.ok(v LIKE '42501 %' AND NOT test.is_decision('s1')
                  AND (SELECT wrapped_at FROM public.chat_messages WHERE id = test.mid('s')) IS NULL,
    'an admin who can''t post there: Wrap up with the tick is refused, nothing changes', v);
  v := test.mark('M', 's1');
  PERFORM test.ok(v LIKE '42501 %', 'and can''t mark it by hand', v);
  v := test.as_user('M', format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid, false)$q$, test.mid('s'), test.mid('s1')));
  PERFORM test.ok(v LIKE 'ok %' AND NOT test.is_decision('s1'), 'without the tick the admin wraps it up', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L::uuid, false)$q$, test.ref('Q')));
END;
$$;

-- ── Move to… (CV-16): the decision follows the message ──────────────────────
-- The move changes the row's conversation and leaves decision_at / _by alone,
-- so who sees it follows the conversation it now lives in.
DO $$
DECLARE
  v text;
  v_by uuid := (SELECT decision_by FROM public.chat_messages WHERE id = test.mid('q1'));
BEGIN
  PERFORM test.ok(test.on_item('N', 'project', test.id('SB')) = 'q1,r2', 'setup: N sees q1 on the project');
  v := test.as_user('B', format($q$SELECT public.chat_op_move_messages(ARRAY[%L]::uuid[], %L::uuid, true, false)$q$,
    test.mid('q1'), test.ref('P')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: B moves q1 into the private channel P', v);
  PERFORM test.ok(test.is_decision('q1')
                  AND (SELECT decision_by FROM public.chat_messages WHERE id = test.mid('q1')) = v_by,
    'a moved message keeps its decision and who marked it');
  PERFORM test.ok(test.on_item('N', 'project', test.id('SB')) = 'r2',
    'moved out of the linked channel, it leaves the project for someone who can''t read where it went');
  PERFORM test.ok(test.on_item('A', 'project', test.id('SB')) = 'r2',
    'and for its readers too: P isn''t linked and q1 doesn''t name the project');
  v := test.as_user('B', format($q$SELECT public.chat_op_move_messages(ARRAY[%L]::uuid[], %L::uuid, false, true)$q$,
    test.mid('q1'), test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: B undoes the move', v);
  PERFORM test.ok(test.is_decision('q1') AND test.on_item('N', 'project', test.id('SB')) = 'q1,r2',
    'Undo brings it back with its decision');
END;
$$;

-- ── The plan, an archived channel ───────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  v := test.mark('A', 'q2');
  PERFORM test.ok(v LIKE '42501 %' AND NOT test.is_decision('q2'), 'without the plan, decisions wait', v);
  PERFORM test.ok(test.on_item('N', 'project', test.id('SB')) = 'q1,r2', 'reading them still works');
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
  v := test.as_user('A', format($q$SELECT public.chat_op_archive_channel(%L::uuid, true)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A archives Q', v);
  v := test.mark('A', 'q2');
  PERFORM test.ok(v LIKE '42501 %' AND NOT test.is_decision('q2'), 'an archived channel takes no decision', v);
  PERFORM test.ok(test.on_item('N', 'project', test.id('SB')) = 'q1,r2', 'its decisions still show');
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
SELECT test.ok(has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
               AND has_function_privilege('service_role', 'public.' || fn, 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE'),
               'grants: ' || fn || ' for signed-in people and the service role, never anon')
  FROM unnest(ARRAY['chat_op_mark_decision(uuid, boolean)', 'chat_op_wrap_up(uuid, uuid, boolean)',
                    'chat_decisions_for_item(text, uuid)']) AS fn;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                            WHERE p.oid = 'public.chat_op_mark_decision(uuid, boolean)'::regprocedure
                              AND a.grantee = 0),
  'grants: chat_op_mark_decision is not executable by PUBLIC');

-- ── Erasure: whoever marked it goes, the decision stays ─────────────────────
-- decision_by refers to the account (ON DELETE SET NULL, like pinned_by and
-- wrapped_by): deleting the account clears it.
DO $$
BEGIN
  PERFORM test.ok((SELECT decision_by FROM public.chat_messages WHERE id = test.mid('q1')) = test.id('B'),
    'setup: B marked q1');
  DELETE FROM auth.users WHERE id = test.id('B');
  PERFORM test.ok(test.is_decision('q1')
                  AND (SELECT decision_by FROM public.chat_messages WHERE id = test.mid('q1')) IS NULL,
    'deleting the account clears who marked it; the decision stays');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE decision_by = test.id('B')),
    'no decision names the deleted account');
END;
$$;
