-- MOD-66 · profile_plan_tier_text, workspace_seat_cap and
-- workspaces_owned_count_for_user answer only for the caller, the owner of a
-- workspace the caller belongs to, and server code
-- (supabase/migrations/20261022100000_plan_helpers_caller_scope.sql).
--
-- Cast: O owns W on the Pro plan; M is a member of W; X owns W2 (free) and
-- is not in W.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'pro' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (test.id('W'), test.id('M'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

DO $$
DECLARE
  r text;
BEGIN
  -- Callers asking about themselves.
  r := test.value_as('O', format('SELECT public.profile_plan_tier_text(%L)', test.id('O')));
  PERFORM test.ok(r = 'pro', 'a person reads their own plan tier', r);
  r := test.value_as('O', format('SELECT public.workspaces_owned_count_for_user(%L)', test.id('O')));
  PERFORM test.ok(r = '1', 'a person reads their own workspace count', r);
  r := test.value_as('X', format('SELECT public.workspace_seat_cap(%L)', test.id('X')));
  PERFORM test.ok(r = '1', 'a free owner reads their own seat cap', r);

  -- A member asking about the workspace owner (what the policies and the
  -- chat / storage limits do).
  r := test.value_as('M', format('SELECT public.profile_plan_tier_text(%L)', test.id('O')));
  PERFORM test.ok(r = 'pro', 'a member reads the workspace owner''s plan tier', r);
  r := test.value_as('M', format('SELECT public.workspace_seat_cap(%L)', test.id('O')));
  PERFORM test.ok(r = '1', 'a member reads the workspace owner''s seat cap', r);
  r := test.value_as('M', format('SELECT * FROM public.storage__limits_for_owner(%L)', test.id('O')));
  PERFORM test.ok(r = 'pro', 'a member still reads the owner''s storage limits', r);

  -- Probing someone else gets NULL.
  r := test.value_as('X', format('SELECT public.profile_plan_tier_text(%L) IS NULL', test.id('O')));
  PERFORM test.ok(r = 'true', 'an outsider cannot read another person''s plan tier', r);
  r := test.value_as('X', format('SELECT public.workspace_seat_cap(%L) IS NULL', test.id('O')));
  PERFORM test.ok(r = 'true', 'an outsider cannot read another person''s seat cap', r);
  r := test.value_as('X', format('SELECT public.workspaces_owned_count_for_user(%L) IS NULL', test.id('O')));
  PERFORM test.ok(r = 'true', 'an outsider cannot count another person''s workspaces', r);
  r := test.value_as('M', format('SELECT public.workspaces_owned_count_for_user(%L) IS NULL', test.id('O')));
  PERFORM test.ok(r = 'true', 'even a member cannot count the owner''s workspaces', r);
  r := test.value_as('M', format('SELECT public.profile_plan_tier_text(%L) IS NULL', test.id('X')));
  PERFORM test.ok(r = 'true', 'a member cannot read the tier of someone outside their workspaces', r);

  -- A trashed workspace still counts as the relationship.
  UPDATE public.workspaces SET deleted_at = now() WHERE id = test.id('W');
  r := test.value_as('M', format('SELECT public.profile_plan_tier_text(%L)', test.id('O')));
  PERFORM test.ok(r = 'pro', 'a member still reads the owner''s tier after the workspace is trashed', r);
  UPDATE public.workspaces SET deleted_at = NULL WHERE id = test.id('W');

  -- Server code (no signed-in person) is unchanged.
  PERFORM test.ok(public.profile_plan_tier_text(test.id('O')) = 'pro', 'server code still reads any plan tier');
  PERFORM test.ok(public.workspaces_owned_count_for_user(test.id('O')) = 1, 'and any workspace count');

  -- Grants: signed-in and server only; the scope check is server-only.
  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.profile_plan_tier_text(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.workspace_seat_cap(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.workspaces_owned_count_for_user(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.profile_plan_tier_text(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.workspace_seat_cap(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.workspaces_owned_count_for_user(uuid)', 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['plan__caller_may_ask_about', 'plan__tier_of', 'plan__owned_count_of']) AS f(fn),
                    unnest(ARRAY['anon', 'authenticated']) AS r(role)
      WHERE has_function_privilege(r.role, format('public.%I(uuid)', f.fn), 'EXECUTE')),
    'grants: signed-in callers only, and the scope check is not client-callable');
END;
$$;
