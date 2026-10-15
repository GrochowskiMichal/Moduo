-- TX-7 · Workspace emails (specs/transactional-email.md AC34–AC39;
-- supabase/migrations/20261015153935_tx7_workspace_emails.sql).
--
--   bun run db:test workspace_emails
--
-- Cast: O owns workspace W ("Northwind Studio", on the founder plan so seats
-- never get in the way). A is an admin of W, M and R are members, V is a
-- viewer. T (tom@…) is the person invited; X is someone else who gets hold of
-- T's link. O also owns W2, untouched by W's daily cap. Queued emails kick the
-- worker through pg_net, which only sends after commit, so the rollback sends
-- nothing.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'M', 'R', 'V', 'T', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'founder' WHERE id = test.id('O');
UPDATE auth.users SET email = 'Tom@Becker.Studio' WHERE id = test.id('T');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Northwind Studio'),
  (test.id('W2'), test.id('O'), 'Other Studio');
INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id)
VALUES
  (test.id('W'), test.id('A'), 'admin', public.perm_system_role_id(test.id('W'), 'admin')),
  (test.id('W'), test.id('M'), 'member', public.perm_system_role_id(test.id('W'), 'member')),
  (test.id('W'), test.id('R'), 'member', public.perm_system_role_id(test.id('W'), 'member')),
  (test.id('W'), test.id('V'), 'viewer', public.perm_system_role_id(test.id('W'), 'viewer'))
ON CONFLICT (workspace_id, user_id) DO NOTHING;
DELETE FROM public.email_outbox WHERE to_email LIKE 'db-test-%@example.com' OR to_email LIKE '%@becker.studio';

-- An invite as the app sends it (runtime.workspace.issueInvite), as p_who.
-- p_created_by / p_created_at: what a client could put in those columns.
CREATE FUNCTION test.invite(p_who text, p_ws text, p_email text,
                            p_created_by uuid DEFAULT NULL, p_created_at timestamptz DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$INSERT INTO public.workspace_invites (workspace_id, created_by, email, role, created_at)
       VALUES (%L, %L, %L, 'member', %L)$q$,
    test.id(p_ws), coalesce(p_created_by, test.id(p_who)), p_email, coalesce(p_created_at, now())))
$$;
CREATE FUNCTION test.invite_id(p_email text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.workspace_invites WHERE email = p_email ORDER BY created_at DESC, id LIMIT 1
$$;
CREATE FUNCTION test.outbox(p_key text) RETURNS public.email_outbox LANGUAGE sql STABLE AS $$
  SELECT * FROM public.email_outbox WHERE dedupe_key = p_key
$$;
-- Accept as p_who; returns 'ok', or '<message> | <hint>'.
CREATE FUNCTION test.accept(p_who text, p_token text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_msg text;
  v_hint text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test.id(p_who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.workspace_op_accept_invite(p_token);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    RETURN v_msg || ' | ' || coalesce(v_hint, '');
  END;
END;
$$;
CREATE FUNCTION test.member_id(p_ws text, p_who text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.workspace_members WHERE workspace_id = test.id(p_ws) AND user_id = test.id(p_who)
$$;
CREATE FUNCTION test.mails(p_kind text, p_to text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.email_outbox WHERE kind = p_kind AND to_email = p_to
$$;

-- ── AC39: the old trigger is gone ────────────────────────────────────────────

SELECT test.ok(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_workspace_invite_inserted'),
  'the old on_workspace_invite_inserted trigger is gone');
SELECT test.ok(to_regprocedure('public.trigger_send_workspace_invite()') IS NULL,
  'the old trigger_send_workspace_invite() function is gone');
SELECT test.ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspace_invites_enqueue_email'
                        AND tgrelid = 'public.workspace_invites'::regclass),
  'the new enqueue trigger is on workspace_invites');

-- ── AC34: an invite queues B3 ────────────────────────────────────────────────

SELECT test.ok(test.invite('A', 'W', 'Tom@Becker.Studio ', test.id('O')) = 'ok 1',
  'an admin invites Tom');
SELECT test.ok((SELECT created_by FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio ')) = test.id('A'),
  'created_by is pinned to the signed-in inviter, whatever the client sent');
SELECT test.ok((test.outbox('B3:' || test.invite_id('Tom@Becker.Studio '))).id IS NOT NULL,
  'B3 is queued under B3:<invite id>');
SELECT test.ok((test.outbox('B3:' || test.invite_id('Tom@Becker.Studio '))).kind = 'workspace_invite'
           AND (test.outbox('B3:' || test.invite_id('Tom@Becker.Studio '))).to_email = 'tom@becker.studio'
           AND (test.outbox('B3:' || test.invite_id('Tom@Becker.Studio '))).status = 'queued',
  'B3 goes to the invited address, lower-cased, queued');
SELECT test.ok(
  (SELECT o.payload ->> 'inviter_email' = 'db-test-a@example.com'
      AND o.payload ->> 'inviter_name' = 'A'
      AND o.payload ->> 'email' = 'tom@becker.studio'
      AND o.payload ->> 'workspace_name' = 'Northwind Studio'
      AND o.payload ->> 'role_key' = 'member'
      AND o.payload ->> 'role_name' <> ''
      AND o.payload ->> 'token' = i.token
      AND o.payload ->> 'expires_at' = to_char(i.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
     FROM public.email_outbox o JOIN public.workspace_invites i ON o.dedupe_key = 'B3:' || i.id
    WHERE i.id = test.invite_id('Tom@Becker.Studio ')),
  'B3 carries the inviter (the caller, not created_by), workspace, role, expiry and token',
  (SELECT payload::text FROM public.email_outbox WHERE dedupe_key = 'B3:' || test.invite_id('Tom@Becker.Studio ')));
SELECT test.ok((SELECT created_at FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio ')) = now(),
  'the invite is stamped with the server time');

SELECT test.ok(test.invite('M', 'W', 'nope@becker.studio') LIKE '42501 %', 'a member cannot invite');
SELECT test.ok(test.invite('V', 'W', 'nope@becker.studio') LIKE '42501 %', 'a viewer cannot invite');
SELECT test.ok(test.mails('workspace_invite', 'nope@becker.studio') = 0, 'a refused invite queues nothing');

-- Revoking a pending invite cancels its B3 if it hasn't gone out.
SELECT test.ok(test.invite('A', 'W', 'gone@becker.studio') = 'ok 1', 'an invite to revoke');
SELECT test.ok(test.as_user('A', format($q$UPDATE public.workspace_invites SET status = 'revoked' WHERE id = %L$q$,
  test.invite_id('gone@becker.studio'))) = 'ok 1', 'the admin revokes it');
SELECT test.ok((test.outbox('B3:' || test.invite_id('gone@becker.studio'))).status = 'cancelled',
  'revoking cancels the queued B3');

-- ── AC35: only the invited address can accept ───────────────────────────────

SELECT test.ok(
  test.accept('X', (SELECT token FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio ')))
    = 'invite_email_mismatch | t•••@becker.studio',
  'someone else signed in gets invite_email_mismatch with the masked address',
  test.accept('X', (SELECT token FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio '))));
SELECT test.ok(test.member_id('W', 'X') IS NULL, 'and does not join');
SELECT test.ok((SELECT status FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio ')) = 'pending',
  'and the invite stays pending');
SELECT test.ok(test.accept('A', (SELECT token FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio ')))
  LIKE 'invite_email_mismatch |%', 'a member of the workspace with another address gets the mismatch too');

UPDATE public.workspace_invites SET expires_at = now() - interval '1 minute' WHERE id = test.invite_id('Tom@Becker.Studio ');
SELECT test.ok(
  test.accept('X', (SELECT token FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio ')))
    = 'Invalid or expired invite | ',
  'an expired invite says so without revealing its address');
UPDATE public.workspace_invites SET expires_at = now() + interval '7 days' WHERE id = test.invite_id('Tom@Becker.Studio ');

SELECT test.ok(
  test.accept('T', (SELECT token FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio '))) = 'ok',
  'the invited address joins (case and spaces ignored)');
SELECT test.ok(test.member_id('W', 'T') IS NOT NULL, 'Tom is a member now');
SELECT test.ok((SELECT status FROM public.workspace_invites WHERE id = test.invite_id('Tom@Becker.Studio ')) = 'accepted',
  'the invite is accepted');

-- ── AC37: 20 invites per workspace per 24 hours ─────────────────────────────

SELECT test.ok((SELECT count(*) FROM public.workspace_invites WHERE workspace_id = test.id('W')) = 2,
  'two invites so far today (accepted and revoked ones count)');
SELECT test.ok(bool_and(test.invite('A', 'W', 'cap' || g || '@becker.studio') = 'ok 1'),
  'invites 3 to 20 go through') FROM generate_series(3, 20) g;
SELECT test.ok(test.invite('A', 'W', 'cap21@becker.studio')
    = 'P0001 You''ve sent 20 invites today. You can send more tomorrow.',
  'the 21st is refused with the daily-limit copy', test.invite('A', 'W', 'cap21@becker.studio'));
SELECT test.ok(test.invite('O', 'W', 'cap21@becker.studio') LIKE 'P0001 You''ve sent 20 invites today.%',
  'the owner is capped too');
SELECT test.ok(test.mails('workspace_invite', 'cap21@becker.studio') = 0, 'a refused invite sends nothing');
SELECT test.ok(test.invite('O', 'W2', 'cap21@becker.studio') = 'ok 1', 'another workspace has its own count');
SELECT test.ok(test.as_user('A', format($q$UPDATE public.workspace_invites SET status = 'revoked' WHERE id = %L$q$,
  test.invite_id('cap20@becker.studio'))) = 'ok 1', 'at the cap, revoking still works');
SELECT test.ok(test.invite('A', 'W', 'cap21@becker.studio') LIKE 'P0001 You''ve sent 20 invites today.%',
  'and revoking does not free a slot');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.workspace_invites (workspace_id, email, role) VALUES (test.id('W'), 'server@becker.studio', 'member');
    PERFORM test.ok(false, 'a server-side insert (no signed-in person) is capped too');
  EXCEPTION WHEN OTHERS THEN
    PERFORM test.ok(SQLERRM = 'You''ve sent 20 invites today. You can send more tomorrow.',
      'a server-side insert (no signed-in person) is capped too', SQLERRM);
  END;
END $$;
SELECT test.ok(test.invite('A', 'W', 'cap21@becker.studio', NULL, '2000-01-01') LIKE 'P0001 %',
  'a backdated created_at does not dodge the count');
-- Deleting invites (admins may) or moving their created_at doesn't free a
-- slot: the queued emails still count.
SELECT test.ok(test.as_user('A', format($q$DELETE FROM public.workspace_invites WHERE workspace_id = %L AND email LIKE 'cap1%%'$q$,
  test.id('W'))) = 'ok 10', 'the admin deletes ten of the day''s invites');
SELECT test.ok(test.invite('A', 'W', 'cap21@becker.studio') LIKE 'P0001 You''ve sent 20 invites today.%',
  'deleting invites does not free a slot');
SELECT test.ok(test.as_user('A', format($q$UPDATE public.workspace_invites SET created_at = now() - interval '2 days' WHERE workspace_id = %L$q$,
  test.id('W'))) LIKE 'ok %', 'the admin backdates the rest');
SELECT test.ok(test.invite('A', 'W', 'cap21@becker.studio') LIKE 'P0001 You''ve sent 20 invites today.%',
  'backdating invites does not free a slot');
-- A many-row insert counts its own earlier rows.
SELECT test.ok(test.as_user('O', format($q$INSERT INTO public.workspace_invites (workspace_id, email, role)
    SELECT %L, 'bulk' || g || '@becker.studio', 'member' FROM generate_series(1, 21) g$q$, test.id('W2')))
    LIKE 'P0001 You''ve sent 20 invites today.%', 'one insert of 21 invites is refused');
-- A day later the window has moved on.
UPDATE public.email_outbox SET created_at = now() - interval '24 hours 1 second'
 WHERE kind = 'workspace_invite' AND to_email LIKE 'cap1%';
SELECT test.ok(test.invite('A', 'W', 'cap21@becker.studio') = 'ok 1', 'invites older than 24 hours stop counting');

-- ── AC38: B4 on transfer, B5 on removal, nothing on leaving ──────────────────

SELECT test.ok(test.as_user('O', format('SELECT public.workspace_op_remove_member(%L)', test.member_id('W', 'M'))) = 'ok 1',
  'the owner removes M');
SELECT test.ok(test.mails('workspace_removed', 'db-test-m@example.com') = 1, 'M gets B5');
SELECT test.ok(
  (SELECT o.payload ->> 'by_email' = 'db-test-o@example.com' AND o.payload ->> 'by_name' = 'O'
      AND o.payload ->> 'workspace_name' = 'Northwind Studio' AND o.to_user_id = test.id('M')
      AND o.dedupe_key LIKE 'B5:' || test.id('W') || ':' || test.id('M') || ':%'
     FROM public.email_outbox o WHERE o.kind = 'workspace_removed' AND o.to_email = 'db-test-m@example.com'),
  'B5 names who removed them and the workspace');
SELECT test.ok(test.as_user('A', format('SELECT public.workspace_op_remove_member(%L)', test.member_id('W', 'R'))) = 'ok 1',
  'an admin removes R');
SELECT test.ok(test.mails('workspace_removed', 'db-test-r@example.com') = 1
           AND (SELECT payload ->> 'by_email' FROM public.email_outbox
                 WHERE kind = 'workspace_removed' AND to_email = 'db-test-r@example.com') = 'db-test-a@example.com',
  'R gets B5 naming the admin');
SELECT test.ok(test.as_user('T', format(
    $q$DELETE FROM public.workspace_members WHERE workspace_id = %L AND user_id = %L$q$, test.id('W'), test.id('T'))) = 'ok 1',
  'Tom leaves by himself (runtime.workspace.leave)');
SELECT test.ok(test.mails('workspace_removed', 'tom@becker.studio') = 0, 'leaving yourself sends nothing');
SELECT test.ok(test.as_user('A', format('SELECT public.workspace_op_remove_member(%L)', test.member_id('W', 'A'))) LIKE 'P0001 use leave%',
  'removing yourself through the op is refused, so it never mails');
SELECT test.ok(test.mails('workspace_removed', 'db-test-a@example.com') = 0, 'and nothing is queued for it');

SELECT test.ok(test.as_user('O', format('SELECT public.workspace_op_transfer_ownership(%L)', test.member_id('W', 'A'))) = 'ok 1',
  'O hands W to A');
SELECT test.ok(test.mails('workspace_owner', 'db-test-a@example.com') = 1, 'A gets B4');
SELECT test.ok(
  (SELECT o.payload ->> 'by_email' = 'db-test-o@example.com' AND o.payload ->> 'workspace_name' = 'Northwind Studio'
      AND o.to_user_id = test.id('A') AND o.payload ->> 'at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$'
     FROM public.email_outbox o WHERE o.kind = 'workspace_owner' AND o.to_email = 'db-test-a@example.com'),
  'B4 names the previous owner, the workspace and the time');
SELECT test.ok(test.mails('workspace_owner', 'db-test-o@example.com') = 0, 'the previous owner gets nothing');
SELECT test.ok(test.as_user('A', format('SELECT public.workspace_op_transfer_ownership(%L)', test.member_id('W', 'O'))) = 'ok 1',
  'A hands it back');
SELECT test.ok(test.mails('workspace_owner', 'db-test-o@example.com') = 1, 'O gets B4 too: a transfer back mails again');

-- ── Grants ───────────────────────────────────────────────────────────────────

SELECT test.ok(NOT has_function_privilege(r, f, 'EXECUTE'), format('%s cannot call %s', r, f))
  FROM unnest(ARRAY['anon', 'authenticated']) r,
       unnest(ARRAY['public.workspace__email_person(uuid)',
                    'public.workspace__email_time(timestamptz)',
                    'public.workspace_invites__enqueue_email()',
                    'public.workspace__queue_member_email(text, uuid, uuid, uuid)']) f;
SELECT test.ok(has_function_privilege('authenticated', 'public.workspace_op_accept_invite(text)', 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.workspace_op_transfer_ownership(uuid)', 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.workspace_op_remove_member(uuid)', 'EXECUTE'),
  'the app can still call the three ops');
