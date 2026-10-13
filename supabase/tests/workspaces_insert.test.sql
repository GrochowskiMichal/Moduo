-- SEC2 · Workspaces are created only for the signed-in person; the free-plan
-- workspace limit is enforced in the database
-- (supabase/migrations/20261013224816_workspaces_insert_owner.sql).
--
-- Cast: O owns workspace W. On the free plan, owning nothing at the start:
-- F; G (a member of W); H (one request, several rows); R (restores); K (a
-- function they call); L and N (the lock); S (server writes); X2 and U
-- (incoming transfers). X1 is on the free plan and owns one. A and X3 are on
-- pro. P is on pro, D on duo, T on team, Z is a founder.
-- Writes go through RLS the way the app sends them
-- (runtime.workspace.create: INSERT (name, owner_id) … RETURNING, no id).

SELECT test.person(n) FROM unnest(ARRAY['O', 'F', 'G', 'H', 'R', 'K', 'L', 'N', 'S', 'P', 'D', 'T', 'Z',
                                    'A', 'X1', 'X2', 'X3', 'U']) AS n;
UPDATE public.profiles SET plan_tier = 'pro' WHERE id = test.id('P');
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('D');
UPDATE public.profiles SET plan_tier = 'team' WHERE id = test.id('T');
UPDATE public.profiles SET plan_tier = 'founder' WHERE id = test.id('Z');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (test.id('W'), test.id('G'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- A statement run with a given API role and claims, the way PostgREST runs
-- the anon key (p_role anon) or server code (p_role service_role, no person).
CREATE FUNCTION test.as_role(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_rows bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    RETURN 'ok ' || v_rows;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    RETURN v_state || ' ' || v_msg;
  END;
END;
$$;

-- A workspace insert as p_who, owned by p_owner. With p_app it is the app's
-- call (… RETURNING, which also needs the SELECT policy); without, a bare
-- insert (PostgREST's return=minimal), so only the insert rules decide.
-- Refusals are probed bare.
CREATE FUNCTION test.create_ws(p_who text, p_owner text, p_name text, p_app boolean DEFAULT false)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$INSERT INTO public.workspaces (name, owner_id) VALUES (%L, %L)$q$ || CASE WHEN p_app THEN ' RETURNING id' ELSE '' END,
    p_name, test.id(p_owner)))
$$;
-- Live workspaces a person owns (read past RLS).
CREATE FUNCTION test.owned(p_who text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.workspaces WHERE owner_id = test.id(p_who) AND deleted_at IS NULL
$$;
-- Workspaces a person owns without being their owner member.
CREATE FUNCTION test.owned_without_owner_member(p_who text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.workspaces w
  WHERE w.owner_id = test.id(p_who)
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = w.id AND m.user_id = w.owner_id AND m.role = 'owner')
$$;
-- The two refusals: the INSERT policy's, and the free plan's.
CREATE FUNCTION test.rls_refused(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p = '42501 new row violates row-level security policy for table "workspaces"'
$$;
CREATE FUNCTION test.plan_refused(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p = '42501 The free plan includes one workspace.'
$$;
-- The lock key the trigger takes for a person.
CREATE FUNCTION test.lock_key(p_who text) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT hashtextextended('workspaces_plan_limit:owner:' || test.id(p_who)::text, 0)
$$;

-- ── The rules in the catalog ─────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(
    (SELECT array_agg(polname::text ORDER BY polname) FROM pg_policy
      WHERE polrelid = 'public.workspaces'::regclass AND polpermissive AND polcmd IN ('a', '*'))
      = ARRAY['workspaces_insert_owner'],
    'policy: workspaces_insert_owner is the only permissive policy that covers INSERT');
  PERFORM test.ok(
    (SELECT polroles FROM pg_policy
      WHERE polrelid = 'public.workspaces'::regclass AND polname = 'workspaces_insert_owner')
      = ARRAY['authenticated'::regrole::oid],
    'policy: it applies to signed-in people only');
  PERFORM test.ok(
    NOT has_table_privilege('anon', 'public.workspaces', 'INSERT')
    AND NOT has_any_column_privilege('anon', 'public.workspaces', 'INSERT'),
    'grants: anon holds no INSERT on workspaces');
  PERFORM test.ok(has_table_privilege('authenticated', 'public.workspaces', 'INSERT'),
    'grants: signed-in people keep INSERT on workspaces (the app inserts directly)');
  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.profile_plan_tier_text(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.workspaces_owned_count_for_user(uuid)', 'EXECUTE'),
    'grants: signed-in people can run the helpers the policy calls');
  PERFORM test.ok(
    EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.workspaces'::regclass AND tgname = 'workspaces_plan_limit' AND tgenabled = 'O'
        AND tgtype::int & 3 = 1 AND tgtype::int & 28 = 20
        AND (SELECT array_agg(a ORDER BY a) FROM unnest(tgattr::int2[]) a)
          = (SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
             WHERE attrelid = 'public.workspaces'::regclass AND attname IN ('deleted_at', 'owner_id'))),
    'trigger: workspaces_plan_limit is on, AFTER each row inserted, restored or given a new owner');
  PERFORM test.ok(
    to_regprocedure('public.workspaces__plan_limit()') IS NOT NULL
    AND NOT has_function_privilege('anon', to_regprocedure('public.workspaces__plan_limit()'), 'EXECUTE')
    AND NOT has_function_privilege('authenticated', to_regprocedure('public.workspaces__plan_limit()'), 'EXECUTE'),
    'grants: no client role can call the trigger''s function');
END;
$$;

-- ── Signed out ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_role('anon', format(
    $q$INSERT INTO public.workspaces (name, owner_id) VALUES ('Signed out', %L)$q$, test.id('F')));
  PERFORM test.ok(v = '42501 permission denied for table workspaces', 'anon: creating a workspace is refused', v);
  v := test.as_role('anon', format(
    $q$INSERT INTO public.workspaces (name, owner_id) VALUES ('Signed out', %L)$q$, test.id('P')));
  PERFORM test.ok(v = '42501 permission denied for table workspaces', 'anon: refused for a paid person''s id too', v);
  v := test.as_role('anon', format(
    $q$INSERT INTO public.workspaces (name, owner_id) VALUES ('Signed out', %L) RETURNING id$q$, test.id('F')));
  PERFORM test.ok(v = '42501 permission denied for table workspaces', 'anon: refused with RETURNING too', v);
  PERFORM test.ok(test.owned('F') = 0 AND test.owned('P') = 0, 'anon: nothing was created');
END;
$$;

-- ── Another person's owner_id ────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.owned('F') = 0 AND test.owned('G') = 0, 'owner: F and G own nothing yet');
  -- Each target owns nothing or is on a paid plan, so only the owner check can refuse.
  v := test.create_ws('F', 'G', 'For G');
  PERFORM test.ok(test.rls_refused(v),
    'owner: a free person with no workspace cannot create one owned by another free person', v);
  v := test.create_ws('F', 'P', 'For P');
  PERFORM test.ok(test.rls_refused(v), 'owner: …nor one owned by a pro person', v);
  v := test.create_ws('P', 'F', 'For F');
  PERFORM test.ok(test.rls_refused(v), 'owner: a pro person cannot create one owned by someone else', v);
  v := test.create_ws('Z', 'G', 'For G');
  PERFORM test.ok(test.rls_refused(v), 'owner: a founder cannot create one owned by someone else', v);
  -- O is on the free plan and owns W: the answer is the same, so it tells
  -- nothing about the owner.
  v := test.create_ws('F', 'O', 'For O');
  PERFORM test.ok(test.rls_refused(v), 'owner: the refusal is the same whoever the owner is', v);
  v := test.create_ws('P', 'O', 'For O');
  PERFORM test.ok(test.rls_refused(v), 'owner: …from a pro person too', v);
  -- Signed in with no user id (a token without sub).
  v := test.create_ws(NULL, 'F', 'No sub');
  PERFORM test.ok(test.rls_refused(v), 'owner: a signed-in request without a user id is refused', v);
  PERFORM test.ok(test.owned('F') = 0 AND test.owned('G') = 0 AND test.owned('P') = 0 AND test.owned('O') = 1,
    'owner: nothing was created for anyone');
END;
$$;

-- ── Free plan: one workspace ─────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.create_ws('F', 'F', 'F first', true);
  PERFORM test.ok(v = 'ok 1', 'free: the first workspace is created (the app''s insert … returning)', v);
  PERFORM test.ok(test.value_as('F',
      $q$SELECT count(*)::text FROM public.workspaces WHERE owner_id = auth.uid() AND deleted_at IS NULL$q$) = '1',
    'free: the creator reads the new workspace back');
  PERFORM test.ok(test.owned('F') = 1 AND test.owned_without_owner_member('F') = 0,
    'free: the creator is the new workspace''s owner member');
  v := test.create_ws('F', 'F', 'F second');
  PERFORM test.ok(test.rls_refused(v), 'free: the second workspace is refused', v);
  PERFORM test.ok(test.owned('F') = 1, 'free: still exactly one');

  -- Membership elsewhere doesn't count: G is a member of O's workspace.
  v := test.create_ws('G', 'G', 'G first', true);
  PERFORM test.ok(v = 'ok 1', 'free: a member of someone else''s workspace still creates their own first one', v);
  PERFORM test.ok(test.owned_without_owner_member('G') = 0, 'free: …and is its owner member');
  v := test.create_ws('G', 'G', 'G second');
  PERFORM test.ok(test.rls_refused(v), 'free: …and their second is refused', v);

  -- One request with several rows (supabase-js .insert([…]) sends an array).
  v := test.as_user('H', format(
    $q$INSERT INTO public.workspaces (name, owner_id) VALUES ('H one', %1$L), ('H two', %1$L)$q$, test.id('H')));
  PERFORM test.ok(test.plan_refused(v), 'free: two workspaces in one request are refused', v);
  v := test.as_user('H', format(
    $q$INSERT INTO public.workspaces (name, owner_id)
       SELECT r.name, r.owner_id FROM json_populate_recordset(NULL::public.workspaces, %L) r$q$,
    json_build_array(json_build_object('name', 'H one', 'owner_id', test.id('H')),
                     json_build_object('name', 'H two', 'owner_id', test.id('H')))::text));
  PERFORM test.ok(test.plan_refused(v), 'free: …also in PostgREST''s array form', v);
  PERFORM test.ok(test.owned('H') = 0, 'free: …and neither row is kept');
  v := test.create_ws('H', 'H', 'H one');
  PERFORM test.ok(v = 'ok 1', 'free: one at a time, the first still works', v);
END;
$$;

-- ── The INSERT policy holds the free plan on its own too ─────────────────────
DO $$
DECLARE
  v text;
  v_has_trigger boolean := EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.workspaces'::regclass AND tgname = 'workspaces_plan_limit');
BEGIN
  IF v_has_trigger THEN
    ALTER TABLE public.workspaces DISABLE TRIGGER workspaces_plan_limit;
  END IF;
  v := test.create_ws('F', 'F', 'F second, policy only');
  PERFORM test.ok(test.rls_refused(v), 'policy: with the trigger off, a free second workspace is still refused', v);
  IF v_has_trigger THEN
    ALTER TABLE public.workspaces ENABLE TRIGGER workspaces_plan_limit;
  END IF;
  PERFORM test.ok(test.owned('F') = 1, 'policy: still exactly one');
END;
$$;

-- ── Restoring a deleted workspace ────────────────────────────────────────────
DO $$
DECLARE
  v text;
  v_first uuid;
  v_second uuid;
BEGIN
  v := test.create_ws('R', 'R', 'R first', true);
  SELECT id INTO v_first FROM public.workspaces WHERE owner_id = test.id('R');
  v := test.as_user('R', format($q$UPDATE public.workspaces SET deleted_at = now() WHERE id = %L$q$, v_first));
  PERFORM test.ok(v = 'ok 1' AND test.owned('R') = 0, 'restore: the owner deletes their workspace', v);
  v := test.create_ws('R', 'R', 'R second', true);
  PERFORM test.ok(v = 'ok 1', 'restore: with none live, a free person creates another', v);
  v := test.as_user('R', format($q$UPDATE public.workspaces SET deleted_at = NULL WHERE id = %L$q$, v_first));
  PERFORM test.ok(test.plan_refused(v), 'restore: a free person cannot restore one while another is live', v);
  PERFORM test.ok(test.owned('R') = 1, 'restore: still exactly one live');
  v := test.as_user('R', format($q$UPDATE public.workspaces SET name = 'R second, renamed' WHERE owner_id = %L$q$,
    test.id('R')));
  PERFORM test.ok(v = 'ok 2', 'restore: other edits are untouched (rename, live and deleted alike)', v);

  SELECT id INTO v_second FROM public.workspaces WHERE owner_id = test.id('R') AND deleted_at IS NULL;
  v := test.as_user('R', format($q$UPDATE public.workspaces SET deleted_at = now() WHERE id = %L$q$, v_second));
  v := test.as_user('R', format($q$UPDATE public.workspaces SET deleted_at = NULL WHERE owner_id = %L$q$,
    test.id('R')));
  PERFORM test.ok(test.plan_refused(v), 'restore: two at once are refused', v);
  PERFORM test.ok(test.owned('R') = 0, 'restore: …and neither comes back');
  v := test.as_user('R', format($q$UPDATE public.workspaces SET deleted_at = NULL WHERE id = %L$q$, v_first));
  PERFORM test.ok(v = 'ok 1' AND test.owned('R') = 1, 'restore: with none live, a free person restores one', v);

  -- Paid plans restore as before.
  v := test.create_ws('P', 'P', 'P kept', true);
  v := test.create_ws('P', 'P', 'P binned', true);
  v := test.as_user('P', format(
    $q$UPDATE public.workspaces SET deleted_at = now() WHERE owner_id = %L AND name = 'P binned'$q$, test.id('P')));
  v := test.as_user('P', format(
    $q$UPDATE public.workspaces SET deleted_at = NULL WHERE owner_id = %L AND name = 'P binned'$q$, test.id('P')));
  PERFORM test.ok(v = 'ok 1' AND test.owned('P') = 2, 'restore: a pro person restores one beside a live one', v);
END;
$$;

-- ── owner_id stays with the owner ────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('F', format($q$UPDATE public.workspaces SET owner_id = %L WHERE owner_id = %L$q$,
    test.id('P'), test.id('F')));
  PERFORM test.ok(test.rls_refused(v), 'owner_id: an owner cannot hand their workspace to someone else', v);
  v := test.as_user('F', format($q$UPDATE public.workspaces SET owner_id = %L WHERE id = %L$q$,
    test.id('F'), test.id('W')));
  PERFORM test.ok(v = 'ok 0', 'owner_id: nobody can take someone else''s workspace', v);
  v := test.as_user('G', format($q$UPDATE public.workspaces SET owner_id = %L WHERE id = %L$q$,
    test.id('G'), test.id('W')));
  PERFORM test.ok(v = 'ok 0', 'owner_id: …not even a member of it', v);
  PERFORM test.ok(
    (SELECT owner_id FROM public.workspaces WHERE id = test.id('W')) = test.id('O')
    AND test.owned('F') = 1 AND test.owned('P') = 2,
    'owner_id: every workspace kept its owner');
END;
$$;

-- ── A function the person calls (runs as its owner, past RLS) ────────────────
CREATE FUNCTION test.definer_create(p_owner uuid, p_name text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.workspaces (name, owner_id) VALUES (p_name, p_owner) RETURNING id
$$;
GRANT USAGE ON SCHEMA test TO authenticated;
GRANT EXECUTE ON FUNCTION test.definer_create(uuid, text) TO authenticated;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('K', format($q$SELECT test.definer_create(%L, 'K first')$q$, test.id('K')));
  PERFORM test.ok(v = 'ok 1', 'function: a free person''s first workspace through a function is created', v);
  v := test.as_user('K', format($q$SELECT test.definer_create(%L, 'K second')$q$, test.id('K')));
  PERFORM test.ok(test.plan_refused(v), 'function: …their second is refused', v);
  v := test.as_user('F', format($q$SELECT test.definer_create(%L, 'For G')$q$, test.id('G')));
  PERFORM test.ok(test.plan_refused(v), 'function: the limit follows the owner (G already owns one)', v);
  v := test.as_user('P', format($q$SELECT test.definer_create(%L, 'P via function')$q$, test.id('P')));
  PERFORM test.ok(v = 'ok 1', 'function: a pro person creates more through a function too', v);
  PERFORM test.ok(test.owned('K') = 1 AND test.owned('G') = 1 AND test.owned_without_owner_member('K') = 0,
    'function: one each, and the creator is the owner member');
END;
$$;

-- ── Server code with no person behind it ─────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_role('service_role', format(
    $q$INSERT INTO public.workspaces (name, owner_id) VALUES ('S one', %1$L), ('S two', %1$L)$q$, test.id('S')));
  PERFORM test.ok(v = 'ok 2' AND test.owned('S') = 2,
    'server: the service role with no person behind it is not limited', v);
  v := test.create_ws('S', 'S', 'S three');
  PERFORM test.ok(test.rls_refused(v), 'server: …but the person still cannot add one themselves', v);
END;
$$;

-- ── Two requests at once: one person's creations take turns ──────────────────
DO $$
DECLARE
  v text;
  v_key bigint := test.lock_key('L');
BEGIN
  -- An insert holds the person's lock until its transaction ends.
  v := test.create_ws('L', 'L', 'L first', true);
  PERFORM test.ok(v = 'ok 1' AND EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted AND objsubid = 1
        AND classid = ((v_key >> 32) & 4294967295)::oid
        AND objid = (v_key & 4294967295)::oid),
    'race: creating a free workspace holds the person''s lock until the transaction ends', v);
  -- Paid plans have no limit to check, so they take no lock.
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM pg_locks l
      WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.objsubid = 1
        AND l.classid = ((test.lock_key('P') >> 32) & 4294967295)::oid
        AND l.objid = (test.lock_key('P') & 4294967295)::oid),
    'race: paid plans take no lock');
END;
$$;

-- A second session holds N's lock, as a concurrent creation would; this
-- session's insert for N then waits for it (and gives up after 300 ms here).
-- This session holds L's lock already, so the second session asks for N's.
-- The second session connects over the local socket as this session's user,
-- which needs a superuser (the default supabase_admin of `bun run db:test`).
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
DO $$
DECLARE
  v text;
  v_conn text := 'sec2_race';
  v_timeout text := current_setting('lock_timeout');
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(v_conn, format('dbname=%s user=%s', current_database(), session_user));
  EXCEPTION WHEN OTHERS THEN
    PERFORM test.ok(false, 'race: a creation waits while another transaction holds the person''s lock',
      'no second session (run as a superuser, e.g. the default db:test URL): ' || SQLERRM);
    RETURN;
  END;
  PERFORM extensions.dblink_exec(v_conn, 'SET lock_timeout = ''5s''');
  PERFORM extensions.dblink_exec(v_conn, 'BEGIN');
  PERFORM * FROM extensions.dblink(v_conn,
    format('SELECT pg_advisory_xact_lock(%s)::text', test.lock_key('N'))) AS t(x text);
  PERFORM set_config('lock_timeout', '300ms', true);
  v := test.create_ws('N', 'N', 'N at the same time');
  PERFORM set_config('lock_timeout', v_timeout, true);
  PERFORM extensions.dblink_exec(v_conn, 'ROLLBACK');
  PERFORM extensions.dblink_disconnect(v_conn);
  PERFORM test.ok(v = '55P03 canceling statement due to lock timeout',
    'race: a creation waits while another transaction holds the person''s lock', v);
EXCEPTION WHEN OTHERS THEN
  IF v_conn = ANY (coalesce(extensions.dblink_get_connections(), '{}')) THEN
    PERFORM extensions.dblink_disconnect(v_conn);
  END IF;
  RAISE;
END;
$$;

-- ── Transfers: the new owner's plan holds ───────────────────────────────────
-- A (pro) owns TA1…TA4 and hands them over with the app's op. X1 (free) owns
-- XW1; X3 (pro) owns XW3. Members: X1 in TA1, X2 in TA2 and TB (B's, free,
-- below), X3 in TA3, U in TA4.
SELECT test.person('B');
UPDATE public.profiles SET plan_tier = 'pro' WHERE id IN (test.id('A'), test.id('X3'));
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('TA1'), test.id('A'), 'TA1'), (test.id('TA2'), test.id('A'), 'TA2'),
  (test.id('TA3'), test.id('A'), 'TA3'), (test.id('TA4'), test.id('A'), 'TA4'),
  (test.id('TB'), test.id('B'), 'TB'),
  (test.id('XW1'), test.id('X1'), 'XW1'), (test.id('XW3'), test.id('X3'), 'XW3');
INSERT INTO public.workspace_members (id, workspace_id, user_id, role) VALUES
  (test.id('m:X1@TA1'), test.id('TA1'), test.id('X1'), 'member'),
  (test.id('m:X2@TA2'), test.id('TA2'), test.id('X2'), 'member'),
  (test.id('m:X2@TB'), test.id('TB'), test.id('X2'), 'member'),
  (test.id('m:X3@TA3'), test.id('TA3'), test.id('X3'), 'member'),
  (test.id('m:U@TA4'), test.id('TA4'), test.id('U'), 'member');

CREATE FUNCTION test.transfer(p_who text, p_member text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.workspace_op_transfer_ownership(%L)$q$, test.id(p_member)))
$$;
CREATE FUNCTION test.owner_of(p_ws text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT owner_id FROM public.workspaces WHERE id = test.id(p_ws)
$$;
CREATE FUNCTION test.transfer_refused(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p = '42501 The new owner is on the free plan, which includes one workspace, and already owns one.'
$$;

DO $$
DECLARE
  v text;
  v_key bigint;
BEGIN
  v := test.transfer('A', 'm:X1@TA1');
  PERFORM test.ok(test.transfer_refused(v),
    'transfer: to a free person who already owns a workspace is refused', v);
  PERFORM test.ok(test.owner_of('TA1') = test.id('A') AND test.owned('X1') = 1
    AND (SELECT role FROM public.workspace_members WHERE id = test.id('m:X1@TA1')) = 'member',
    'transfer: …and nothing changed (owner, their count, their role)');

  v := test.transfer('A', 'm:X2@TA2');
  PERFORM test.ok(v = 'ok 1' AND test.owner_of('TA2') = test.id('X2') AND test.owned('X2') = 1,
    'transfer: to a free person who owns none is allowed', v);
  v_key := test.lock_key('X2');
  PERFORM test.ok(EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted AND objsubid = 1
        AND classid = ((v_key >> 32) & 4294967295)::oid
        AND objid = (v_key & 4294967295)::oid),
    'transfer: it holds the new owner''s lock until the transaction ends');
  v := test.transfer('B', 'm:X2@TB');
  PERFORM test.ok(test.transfer_refused(v), 'transfer: …and a second one to them is refused', v);
  PERFORM test.ok(test.owner_of('TB') = test.id('B') AND test.owned('X2') = 1,
    'transfer: …so they still own one');
  v := test.create_ws('X2', 'X2', 'X2 own');
  PERFORM test.ok(test.rls_refused(v), 'transfer: …and cannot create one of their own either', v);

  v := test.transfer('A', 'm:X3@TA3');
  PERFORM test.ok(v = 'ok 1' AND test.owner_of('TA3') = test.id('X3') AND test.owned('X3') = 2,
    'transfer: to a pro person who already owns one is allowed', v);
END;
$$;

-- Two at once: a second session holds U's lock, as a concurrent creation or
-- transfer for U would; this transfer to U then waits for it.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
DO $$
DECLARE
  v text;
  v_conn text := 'sec2_race_transfer';
  v_timeout text := current_setting('lock_timeout');
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(v_conn, format('dbname=%s user=%s', current_database(), session_user));
  EXCEPTION WHEN OTHERS THEN
    PERFORM test.ok(false, 'transfer: it waits while another transaction holds the new owner''s lock',
      'no second session (run as a superuser, e.g. the default db:test URL): ' || SQLERRM);
    RETURN;
  END;
  PERFORM extensions.dblink_exec(v_conn, 'SET lock_timeout = ''5s''');
  PERFORM extensions.dblink_exec(v_conn, 'BEGIN');
  PERFORM * FROM extensions.dblink(v_conn,
    format('SELECT pg_advisory_xact_lock(%s)::text', test.lock_key('U'))) AS t(x text);
  PERFORM set_config('lock_timeout', '300ms', true);
  v := test.transfer('A', 'm:U@TA4');
  PERFORM set_config('lock_timeout', v_timeout, true);
  PERFORM extensions.dblink_exec(v_conn, 'ROLLBACK');
  PERFORM extensions.dblink_disconnect(v_conn);
  PERFORM test.ok(v = '55P03 canceling statement due to lock timeout',
    'transfer: it waits while another transaction holds the new owner''s lock', v);
  PERFORM test.ok(test.owner_of('TA4') = test.id('A'), 'transfer: …and nothing changed meanwhile');
EXCEPTION WHEN OTHERS THEN
  IF v_conn = ANY (coalesce(extensions.dblink_get_connections(), '{}')) THEN
    PERFORM extensions.dblink_disconnect(v_conn);
  END IF;
  RAISE;
END;
$$;

-- ── Paid plans and founders: as many as before ───────────────────────────────
DO $$
DECLARE
  v_who text;
  v_tier text;
  v text;
  v_before int;
  i int;
BEGIN
  FOR v_who, v_tier IN VALUES ('P', 'pro'), ('D', 'duo'), ('T', 'team'), ('Z', 'founder') LOOP
    v_before := test.owned(v_who);
    FOR i IN 1..3 LOOP
      v := test.create_ws(v_who, v_who, format('%s %s', v_who, i), true);
      PERFORM test.ok(v = 'ok 1', format('%s: workspace %s is created', v_tier, i), v);
    END LOOP;
    v := test.as_user(v_who, format(
      $q$INSERT INTO public.workspaces (name, owner_id) VALUES ('%2$s 4', %1$L), ('%2$s 5', %1$L)$q$,
      test.id(v_who), v_who));
    PERFORM test.ok(v = 'ok 2', format('%s: two more in one request', v_tier), v);
    PERFORM test.ok(test.owned(v_who) = v_before + 5 AND test.owned_without_owner_member(v_who) = 0,
      format('%s: owns them all, as their owner member', v_tier));
  END LOOP;
END;
$$;
