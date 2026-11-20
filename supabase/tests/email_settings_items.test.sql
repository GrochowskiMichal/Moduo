-- Mail settings that follow the user (MR-7, AC36;
-- supabase/migrations/20261104010000_email_settings_items.sql): one row per
-- item, owner-only, written through ops, last write wins per row, deleted with
-- the account, and the old senderOverrides become sender_override rows.
--
-- Cast: A and B are two people. A writes rules and overrides; B tries to read,
-- steal and delete them.

SELECT test.person(n) FROM unnest(ARRAY['A', 'B']) AS n;

DO $$
DECLARE
  r text;
  v_a uuid := test.id('A');
  v_rule uuid := test.id('rule1');
  v_tab uuid := test.id('tab1');
BEGIN
  -- Grants: SELECT only for clients; no direct writes; helper service-only.
  PERFORM test.ok(has_table_privilege('authenticated', 'public.email_settings_items', 'SELECT'), 'authenticated can select');
  PERFORM test.ok(NOT has_table_privilege('authenticated', 'public.email_settings_items', 'INSERT'), 'authenticated cannot insert directly');
  PERFORM test.ok(NOT has_table_privilege('authenticated', 'public.email_settings_items', 'UPDATE'), 'authenticated cannot update directly');
  PERFORM test.ok(NOT has_table_privilege('authenticated', 'public.email_settings_items', 'DELETE'), 'authenticated cannot delete directly');
  PERFORM test.ok(NOT has_table_privilege('anon', 'public.email_settings_items', 'SELECT'), 'anon cannot select');
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.email_op_settings_upsert(uuid,text,jsonb,double precision)', 'EXECUTE'), 'anon cannot upsert');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.email_settings__backfill_overrides()', 'EXECUTE'), 'backfill helper is service-only');

  -- A writes a rule and a custom tab.
  r := test.as_user('A', format($q$SELECT public.email_op_settings_upsert(%L, 'rule', '{"when":{"from":"x@y.com"},"then":["mark_read"]}', 1)$q$, v_rule));
  PERFORM test.ok(r = 'ok 1', 'owner upserts a rule', r);
  r := test.as_user('A', format($q$SELECT public.email_op_settings_upsert(%L, 'custom_tab', '{"name":"Clients"}', 2)$q$, v_tab));
  PERFORM test.ok(r = 'ok 1', 'owner upserts a custom tab', r);
  PERFORM test.ok((SELECT user_id FROM public.email_settings_items WHERE id = v_rule AND user_id = v_a) = v_a, 'row is owned by the caller');

  -- Owner reads both; B reads none.
  r := test.as_user('A', format($q$SELECT 1 FROM public.email_settings_items WHERE id IN (%L, %L)$q$, v_rule, v_tab));
  PERFORM test.ok(r = 'ok 2', 'owner reads own rows', r);
  r := test.as_user('B', format($q$SELECT 1 FROM public.email_settings_items WHERE id IN (%L, %L)$q$, v_rule, v_tab));
  PERFORM test.ok(r = 'ok 0', 'another person reads none', r);
  r := test.try('B', format($q$INSERT INTO public.email_settings_items (id, user_id, kind) VALUES (%L, %L, 'rule')$q$, test.id('forged'), v_a));
  PERFORM test.ok(r LIKE '42501%', 'direct insert is refused', r);

  -- B cannot overwrite or delete A's row through the ops.
  r := test.as_user('B', format($q$SELECT public.email_op_settings_upsert(%L, 'rule', '{}', 0)$q$, v_rule));
  PERFORM test.ok(r = 'ok 1', 'another person upserting the same id gets their own row', r);
  PERFORM test.ok((SELECT value->'when'->>'from' FROM public.email_settings_items WHERE id = v_rule AND user_id = v_a) = 'x@y.com',
                  'the owner''s row is untouched');
  r := test.as_user('B', format($q$SELECT 1 WHERE public.email_op_settings_delete(%L)$q$, v_rule));
  PERFORM test.ok(r = 'ok 1', 'another person deleting the same id deletes only their own row', r);
  PERFORM test.ok((SELECT deleted_at IS NULL FROM public.email_settings_items WHERE id = v_rule AND user_id = v_a), 'row survives the stranger delete');

  -- CHECKs and validation.
  r := test.try('A', format($q$SELECT public.email_op_settings_upsert(%L, 'bogus', '{}', 0)$q$, test.id('bad')));
  PERFORM test.ok(r LIKE '23514%', 'an unknown kind fails the CHECK', r);
  r := test.try('A', format($q$SELECT public.email_op_settings_upsert(%L, 'rule', '[1]', 0)$q$, test.id('bad2')));
  PERFORM test.ok(r LIKE '23514%', 'a non-object value fails the CHECK', r);
  r := test.try('A', format($q$SELECT public.email_op_settings_upsert(%L, 'snippet', '{}', 0)$q$, v_rule));
  PERFORM test.ok(r LIKE '22023%', 'an existing id keeps its kind', r);
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    PERFORM public.email_op_settings_upsert(test.id('x'), 'rule', '{}', 0);
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN
    r := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM test.ok(r LIKE '42501%', 'a caller without a user is refused', r);

  -- Last write wins per row: a second write replaces the value, the other row is untouched.
  r := test.as_user('A', format($q$SELECT public.email_op_settings_upsert(%L, 'rule', '{"when":{"from":"z@y.com"}}', NULL)$q$, v_rule));
  PERFORM test.ok((SELECT value->'when'->>'from' FROM public.email_settings_items WHERE id = v_rule AND user_id = v_a) = 'z@y.com', 'second write wins');
  PERFORM test.ok((SELECT position FROM public.email_settings_items WHERE id = v_rule AND user_id = v_a) = 1, 'a null position keeps the old one');
  PERFORM test.ok((SELECT value->>'name' FROM public.email_settings_items WHERE id = v_tab AND user_id = v_a) = 'Clients', 'another row is untouched');

  -- Delete tombstones; upsert brings it back.
  r := test.as_user('A', format($q$SELECT 1 WHERE public.email_op_settings_delete(%L)$q$, v_tab));
  PERFORM test.ok(r = 'ok 1', 'owner deletes', r);
  PERFORM test.ok((SELECT deleted_at IS NOT NULL FROM public.email_settings_items WHERE id = v_tab AND user_id = v_a), 'delete is a tombstone');
  r := test.as_user('A', format($q$SELECT public.email_op_settings_upsert(%L, 'custom_tab', '{"name":"Again"}', 2)$q$, v_tab));
  PERFORM test.ok((SELECT deleted_at IS NULL FROM public.email_settings_items WHERE id = v_tab AND user_id = v_a), 'upsert restores a tombstone');
END;
$$;

-- The overrides migration.
INSERT INTO public.user_preferences (user_id, email)
VALUES (test.id('B'), '{"senderOverrides": {" Anna@Example.com ": "personal", "bad": 3, "": "personal"}}')
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

DO $$
DECLARE
  v_id uuid := md5(test.id('B')::text || ':sender_override:anna@example.com')::uuid;
BEGIN
  PERFORM public.email_settings__backfill_overrides();
  PERFORM test.ok((SELECT count(*) FROM public.email_settings_items WHERE user_id = test.id('B') AND kind = 'sender_override') = 1,
                  'one valid override becomes one row');
  PERFORM test.ok((SELECT value FROM public.email_settings_items WHERE id = v_id) = '{"address":"anna@example.com","section":"personal"}'::jsonb,
                  'override row carries the lowercased address and section');
  PERFORM test.ok(public.email_settings__backfill_overrides() = 0, 'backfill is idempotent');
  UPDATE public.email_settings_items SET deleted_at = now() WHERE id = v_id;
  PERFORM public.email_settings__backfill_overrides();
  PERFORM test.ok((SELECT deleted_at IS NOT NULL FROM public.email_settings_items WHERE id = v_id), 'backfill never revives a deleted override');
END;
$$;

-- Id squatting: ids are per person, so B minting A's deterministic id (or any
-- id A already holds) gets B's own row and never blocks or touches A's.
DO $$
DECLARE
  r text;
  v_shared uuid := test.id('shared-id');
BEGIN
  r := test.as_user('A', format($q$SELECT public.email_op_settings_upsert(%L, 'snippet', '{"text":"A"}', 0)$q$, v_shared));
  PERFORM test.ok(r = 'ok 1', 'A writes an id first', r);
  r := test.as_user('B', format($q$SELECT public.email_op_settings_upsert(%L, 'rule', '{"text":"B"}', 0)$q$, v_shared));
  PERFORM test.ok(r = 'ok 1', 'B can use the same id for its own item', r);
  PERFORM test.ok((SELECT value->>'text' FROM public.email_settings_items WHERE id = v_shared AND user_id = test.id('A')) = 'A',
                  'A''s row is untouched by B''s write');
  PERFORM test.ok((SELECT kind FROM public.email_settings_items WHERE id = v_shared AND user_id = test.id('B')) = 'rule',
                  'B''s row is its own');
  r := test.as_user('B', format($q$SELECT 1 WHERE public.email_op_settings_delete(%L)$q$, v_shared));
  PERFORM test.ok((SELECT deleted_at IS NULL FROM public.email_settings_items WHERE id = v_shared AND user_id = test.id('A')),
                  'B deleting the shared id leaves A''s row live');
  -- A squatted override id does not stop A's backfill.
  INSERT INTO public.email_settings_items (id, user_id, kind, value)
  VALUES (md5(test.id('A')::text || ':sender_override:sq@example.com')::uuid, test.id('B'), 'sender_override', '{}');
  INSERT INTO public.user_preferences (user_id, email)
  VALUES (test.id('A'), '{"senderOverrides": {"sq@example.com": "personal"}}')
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
  PERFORM public.email_settings__backfill_overrides();
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.email_settings_items
                           WHERE user_id = test.id('A') AND kind = 'sender_override'
                             AND id = md5(test.id('A')::text || ':sender_override:sq@example.com')::uuid),
                  'a squatted override id still backfills for its owner');
END;
$$;

-- The 2000-item cap counts every row the person owns, tombstones included,
-- and holds on restore.
DO $$
DECLARE
  r text;
  v_b uuid := test.id('B');
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.email_settings_items WHERE user_id = v_b;
  INSERT INTO public.email_settings_items (id, user_id, kind, value, deleted_at)
  SELECT gen_random_uuid(), v_b, 'snippet', '{}', now() FROM generate_series(1, 2000 - v_n);
  r := test.try('B', format($q$SELECT public.email_op_settings_upsert(%L, 'snippet', '{}', 0)$q$, test.id('cap-new')));
  PERFORM test.ok(r LIKE '54000%', 'tombstones count toward the cap', r);
  -- Over the cap (rows from before the fix): restoring a tombstone is refused.
  UPDATE public.email_settings_items SET deleted_at = NULL WHERE user_id = v_b;
  INSERT INTO public.email_settings_items (id, user_id, kind, value, deleted_at)
  VALUES (test.id('cap-tomb'), v_b, 'snippet', '{}', now());
  r := test.try('B', format($q$SELECT public.email_op_settings_upsert(%L, 'snippet', '{}', 0)$q$, test.id('cap-tomb')));
  PERFORM test.ok(r LIKE '54000%', 'restoring a tombstone at the cap is refused', r);
  -- A live row can still be edited at the cap.
  r := test.try('B', format($q$SELECT public.email_op_settings_upsert(%L, 'rule', '{"x":1}', 0)$q$, test.id('shared-id')));
  PERFORM test.ok(r NOT LIKE '54000%', 'editing a live row at the cap still works', r);
  PERFORM test.ok(position('pg_advisory_xact_lock' IN pg_get_functiondef('public.email_op_settings_upsert(uuid,text,jsonb,double precision)'::regprocedure)) > 0,
                  'upsert serializes per person');
END;
$$;

-- Erasure: deleting the account removes every row.
DELETE FROM auth.users WHERE id = test.id('A');
DO $$
BEGIN
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.email_settings_items WHERE user_id = test.id('A')), 'account deletion erases the rows');
END;
$$;
