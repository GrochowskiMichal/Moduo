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
  PERFORM test.ok((SELECT user_id FROM public.email_settings_items WHERE id = v_rule) = v_a, 'row is owned by the caller');

  -- Owner reads both; B reads none.
  r := test.as_user('A', format($q$SELECT 1 FROM public.email_settings_items WHERE id IN (%L, %L)$q$, v_rule, v_tab));
  PERFORM test.ok(r = 'ok 2', 'owner reads own rows', r);
  r := test.as_user('B', format($q$SELECT 1 FROM public.email_settings_items WHERE id IN (%L, %L)$q$, v_rule, v_tab));
  PERFORM test.ok(r = 'ok 0', 'another person reads none', r);
  r := test.try('B', format($q$INSERT INTO public.email_settings_items (id, user_id, kind) VALUES (%L, %L, 'rule')$q$, test.id('forged'), v_a));
  PERFORM test.ok(r LIKE '42501%', 'direct insert is refused', r);

  -- B cannot overwrite or delete A's row through the ops.
  r := test.try('B', format($q$SELECT public.email_op_settings_upsert(%L, 'rule', '{}', 0)$q$, v_rule));
  PERFORM test.ok(r LIKE 'P0002%', 'another person upserting an owned id is refused as not found', r);
  r := test.as_user('B', format($q$SELECT 1 WHERE public.email_op_settings_delete(%L)$q$, v_rule));
  PERFORM test.ok(r = 'ok 0', 'another person deleting is a no-op', r);
  PERFORM test.ok((SELECT deleted_at IS NULL FROM public.email_settings_items WHERE id = v_rule), 'row survives the stranger delete');

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
  PERFORM test.ok((SELECT value->'when'->>'from' FROM public.email_settings_items WHERE id = v_rule) = 'z@y.com', 'second write wins');
  PERFORM test.ok((SELECT position FROM public.email_settings_items WHERE id = v_rule) = 1, 'a null position keeps the old one');
  PERFORM test.ok((SELECT value->>'name' FROM public.email_settings_items WHERE id = v_tab) = 'Clients', 'another row is untouched');

  -- Delete tombstones; upsert brings it back.
  r := test.as_user('A', format($q$SELECT 1 WHERE public.email_op_settings_delete(%L)$q$, v_tab));
  PERFORM test.ok(r = 'ok 1', 'owner deletes', r);
  PERFORM test.ok((SELECT deleted_at IS NOT NULL FROM public.email_settings_items WHERE id = v_tab), 'delete is a tombstone');
  r := test.as_user('A', format($q$SELECT public.email_op_settings_upsert(%L, 'custom_tab', '{"name":"Again"}', 2)$q$, v_tab));
  PERFORM test.ok((SELECT deleted_at IS NULL FROM public.email_settings_items WHERE id = v_tab), 'upsert restores a tombstone');
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

-- Erasure: deleting the account removes every row.
DELETE FROM auth.users WHERE id = test.id('A');
DO $$
BEGIN
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.email_settings_items WHERE user_id = test.id('A')), 'account deletion erases the rows');
END;
$$;
