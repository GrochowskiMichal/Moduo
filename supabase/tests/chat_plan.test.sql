-- Chat v2 plan source (CV-4: supabase/migrations/…_chat_v2_plan_source.sql).
-- "Chat is on with the owner's plan or a dated grant; a paused plan keeps reading"
-- (AC2.1, AC2.8, AC10.8 at the database; tests/chat-plan.spec.ts proves them over the API).
--
-- Cast: O owns W on Free, A is a member; D owns W2 on Duo; F owns W3 on Free. The grant
-- function TX-9b defines (public.plan_grant_effective_tier(uuid)) is played by a stub
-- reading test.grants (workspace, tier, ends_at); a real one, once TX-9b lands, is
-- renamed out of the way for this run. Everything rolls back.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'D', 'F']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('D');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Plan source'),
  (test.id('W2'), test.id('D'), 'Paid'),
  (test.id('W3'), test.id('F'), 'Free');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (test.id('W'), test.id('A'), 'member') ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.grants (workspace_id uuid NOT NULL, tier text, ends_at timestamptz NOT NULL);
CREATE FUNCTION test.on(p_ws text) RETURNS boolean LANGUAGE sql AS $$
  SELECT public.chat_workspace_enabled(test.id(p_ws))
$$;
-- The stub TX-9b's function stands for: the tier of a grant that hasn't ended, or null.
CREATE FUNCTION test.install_grant_stub() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  CREATE FUNCTION public.plan_grant_effective_tier(p_workspace_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
    SELECT g.tier FROM test.grants g
     WHERE g.workspace_id = p_workspace_id AND g.ends_at > now()
     ORDER BY g.ends_at DESC LIMIT 1
  $f$;
END;
$$;

-- Without TX-9b's function, whatever this stack holds.
DO $$
BEGIN
  IF to_regprocedure('public.plan_grant_effective_tier(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.plan_grant_effective_tier(uuid) RENAME TO plan_grant_effective_tier__hidden_by_chat_plan_test;
  END IF;
END;
$$;

-- ── The function keeps its definer settings and grants ──────────────────────
DO $$
DECLARE
  v_fn regprocedure := 'public.chat_workspace_enabled(uuid)'::regprocedure;
BEGIN
  PERFORM test.ok(
    (SELECT p.prosecdef AND p.provolatile = 's'
            AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       FROM pg_proc p WHERE p.oid = v_fn)
    AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
    AND has_function_privilege('authenticated', v_fn, 'EXECUTE')
    AND has_function_privilege('service_role', v_fn, 'EXECUTE'),
    'definer: STABLE, search_path pinned, no PUBLIC or anon EXECUTE, signed-in people and the connector may ask');
END;
$$;

-- ── Without TX-9b: the owner's plan decides, exactly as v1 did ──────────────
DO $$
DECLARE
  v_tier text;
  v_bad text := '';
BEGIN
  FOREACH v_tier IN ARRAY ARRAY['free', 'pro', 'duo', 'team', 'founder'] LOOP
    UPDATE public.profiles SET plan_tier = v_tier::public.plan_tier WHERE id = test.id('O');
    IF test.on('W') IS DISTINCT FROM (v_tier IN ('duo', 'team', 'founder')) THEN
      v_bad := v_bad || v_tier || ' ';
    END IF;
  END LOOP;
  PERFORM test.ok(v_bad = '', 'no grant function: Duo, Team and Founder owners have chat, Free and Pro don''t (CHAT_PLAN_TIERS)', v_bad);
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');

  PERFORM test.ok(test.on('W2') AND NOT test.on('W3') AND NOT test.on('W'),
    'no grant function: W2 (Duo owner) on; W3 and W (Free owners) off');
  PERFORM test.ok(public.chat_workspace_enabled(test.id('nowhere')) IS FALSE,
    'no grant function: an unknown workspace is off');
END;
$$;

-- ── With a dated grant: a handed-out Team workspace has chat (AC2.1) ─────────
SELECT test.install_grant_stub();
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(NOT test.on('W'), 'grant function, no grant: W stays off');

  INSERT INTO test.grants VALUES (test.id('W'), 'team', now() + interval '2 days');
  PERFORM test.ok(test.on('W'), 'grant: a Team grant turns chat on for W, whose owner is on Free');
  PERFORM test.ok(NOT test.on('W3'), 'grant: only the granted workspace (W3 stays off)');

  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'grant: A opens chat in W and General is made', v);
  PERFORM test.ok(
    (SELECT count(*) FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'general') = 1,
    'grant: W has General');
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_send(c.id, 'Kickoff plangrantcheck', NULL, '{}'::uuid[], false, NULL, NULL)
         FROM public.chat_channels c WHERE c.workspace_id = %L AND c.name = 'general'$q$, test.id('W')));
  PERFORM test.ok(v = 'ok 1', 'grant: A posts in General', v);

  UPDATE test.grants SET tier = 'pro' WHERE workspace_id = test.id('W');
  PERFORM test.ok(NOT test.on('W'), 'grant: a Pro grant doesn''t include chat');
  UPDATE test.grants SET tier = 'founder' WHERE workspace_id = test.id('W');
  PERFORM test.ok(test.on('W'), 'grant: a Founder grant does');
  UPDATE test.grants SET tier = 'unknown' WHERE workspace_id = test.id('W');
  PERFORM test.ok(NOT test.on('W'), 'grant: an unknown tier counts as none');
  UPDATE test.grants SET tier = 'team' WHERE workspace_id = test.id('W');

  UPDATE public.workspaces SET deleted_at = now() WHERE id = test.id('W3');
  INSERT INTO test.grants VALUES (test.id('W3'), 'team', now() + interval '2 days');
  PERFORM test.ok(NOT test.on('W3'), 'grant: a deleted workspace stays off, grant or not');
END;
$$;

-- ── The grant ends: paused, everything stays readable (AC2.8, AC10.8) ────────
DO $$
DECLARE
  v text;
  v_general uuid := (SELECT id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'general');
BEGIN
  UPDATE test.grants SET ends_at = now() - interval '1 minute' WHERE workspace_id = test.id('W');
  PERFORM test.ok(NOT test.on('W'), 'grant ended: chat is paused in W');

  v := test.as_user('A', format(
    $q$SELECT public.chat_op_send(%L, 'After the end', NULL, '{}'::uuid[], false, NULL, NULL)$q$, v_general));
  PERFORM test.ok(v NOT LIKE 'ok %' AND v ILIKE '%plan%', 'grant ended: A can''t post (the plan refuses it)', v);

  PERFORM test.ok(test.value_as('A', format('SELECT public.chat_can_read_channel(%L)::text', v_general)) = 'true',
    'grant ended: A still reads General');
  PERFORM test.ok(
    test.value_as('A', format($q$SELECT count(*)::text FROM public.chat_messages WHERE channel_id = %L$q$, v_general)) = '1'
    AND test.value_as('A', format($q$SELECT count(*)::text FROM public.chat_channels WHERE workspace_id = %L$q$, test.id('W'))) = '1',
    'grant ended: A reads the conversation and its message');
  PERFORM test.ok(
    test.value_as('A', format(
      $q$SELECT count(*)::text FROM public.chat_messages
          WHERE workspace_id = %L AND search_tsv @@ to_tsquery('simple', 'plangrantcheck')$q$, test.id('W'))) = '1'
    AND test.value_as('A', format(
      $q$SELECT count(*)::text FROM public.chat_messages WHERE workspace_id = %L AND body ILIKE '%%plangrantcheck%%'$q$,
      test.id('W'))) = '1',
    'grant ended: search still finds it (v2 search_tsv and v1''s ilike)');

  UPDATE test.grants SET ends_at = now() + interval '1 day' WHERE workspace_id = test.id('W');
  PERFORM test.ok(test.on('W'), 'a new grant turns it back on');
END;
$$;

-- ── The owner's plan is asked first: a broken grant function can't take chat
--    from a paying workspace, and is never called for one ───────────────────
DROP FUNCTION public.plan_grant_effective_tier(uuid);
CREATE FUNCTION public.plan_grant_effective_tier(p_workspace_id uuid) RETURNS text
LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'grant function called'; END; $$;
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.on('W2'), 'owner on Duo: chat on without calling the grant function');
  v := test.as_op('A', format('SELECT public.chat_workspace_enabled(%L)', test.id('W')));
  PERFORM test.ok(v LIKE '%grant function called%', 'owner on Free: the grant function''s error is not swallowed', v);
END;
$$;

-- A grant function returning the plan_tier enum works the same.
DROP FUNCTION public.plan_grant_effective_tier(uuid);
DO $do$
BEGIN
  EXECUTE format($f$CREATE FUNCTION public.plan_grant_effective_tier(p_workspace_id uuid) RETURNS public.plan_tier
    LANGUAGE sql STABLE AS $b$SELECT %L::public.plan_tier WHERE p_workspace_id = %L::uuid$b$$f$, 'team', test.id('W'));
  UPDATE public.workspaces SET deleted_at = NULL WHERE id = test.id('W3');
  PERFORM test.ok(test.on('W') AND NOT test.on('W3'), 'grant: a function returning plan_tier works too');
END;
$do$;

-- ── TX-9b's function gone again: back to the owner's plan, still readable ───
DROP FUNCTION public.plan_grant_effective_tier(uuid);
DO $$
DECLARE
  v text;
  v_general uuid := (SELECT id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'general');
BEGIN
  PERFORM test.ok(NOT test.on('W'), 'no grant function: W (Free owner) is off again');
  PERFORM test.ok(
    test.value_as('A', format($q$SELECT count(*)::text FROM public.chat_messages WHERE channel_id = %L$q$, v_general)) = '1',
    'no grant function: A still reads W''s conversation on a Free owner''s plan');
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_send(%L, 'Still paused', NULL, '{}'::uuid[], false, NULL, NULL)$q$, v_general));
  PERFORM test.ok(v NOT LIKE 'ok %', 'no grant function: A can''t post', v);
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_send(%L, 'Back on', NULL, '{}'::uuid[], false, NULL, NULL)$q$, v_general));
  PERFORM test.ok(test.on('W') AND v = 'ok 1', 'no grant function: the owner moves to Duo and A posts again', v);
END;
$$;
