-- The RPC probe of the RLS access matrix (HV-16, rls_matrix.md § RPC probe),
-- included by the generated rls_matrix_rpcs.test.sql after the world and
-- test.mx_allow (the markdown's allow list).
--
-- Every SECURITY DEFINER function in public that `authenticated` may execute
-- is called as `outsider`, as `member`, as `viewer` and with the outsider's API key KX
-- (the way the connector calls), and so is every service-role-only intent op
-- the connector calls with a key (`*_op_*`, share_visible_ids). Each argument is filled
-- from the world by its name and type, once per entity kind when it takes a
-- type. A call fails its check when its output carries the world's secret, or
-- when it changed the private rows (test.mx_print). Each call is undone.

SET LOCAL lock_timeout = '5s';

-- Ids the arguments are filled from.
CREATE TABLE test.mx_ids (name text PRIMARY KEY, id uuid NOT NULL);
SELECT test.as_op('owner', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Comment HV16-SECRET')$q$,
  test.id('W'), test.id('T')));
INSERT INTO test.mx_ids (name, id)
SELECT n, test.id(n) FROM unnest(ARRAY['W', 'T', 'P', 'N', 'C', 'CH', 'MSG', 'S', 'FR', 'K', 'owner', 'viewer', 'outsider']) AS n
UNION ALL SELECT 'MEMBERSHIP', id FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('viewer')
UNION ALL SELECT 'ROLE', role_id FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('admin')
UNION ALL SELECT 'COMMENT', id FROM public.comments WHERE entity_id = test.id('T');

-- The private rows, as one hash: what nobody but the owner and the people
-- they shared with may change.
CREATE FUNCTION test.mx_print() RETURNS text LANGUAGE sql AS $$
  WITH ids AS (SELECT array_agg(id) AS a FROM test.mx_ids WHERE name IN ('T', 'P', 'N', 'C', 'CH', 'MSG', 'S', 'FR', 'K', 'COMMENT')
               UNION ALL SELECT ARRAY[test.id('PE'), test.id('PO')])
  , priv AS (SELECT array_agg(x) AS a FROM ids, unnest(ids.a) AS x)
  SELECT md5(concat_ws('|',
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.tasks t, priv WHERE t.id = ANY (priv.a) OR t.bucket_id = ANY (priv.a)),
    (SELECT string_agg(b::text, ',' ORDER BY b.id) FROM public.buckets b, priv WHERE b.id = ANY (priv.a)),
    (SELECT string_agg(n::text, ',' ORDER BY n.id) FROM public.notes n, priv WHERE n.id = ANY (priv.a) OR n.parent_id = ANY (priv.a)),
    (SELECT string_agg(c::text, ',' ORDER BY c.id) FROM public.contacts c, priv WHERE c.id = ANY (priv.a)),
    (SELECT string_agg(c::text, ',' ORDER BY c.id) FROM public.chat_channels c WHERE c.id = test.id('CH')),
    (SELECT string_agg(m::text, ',' ORDER BY m.user_id) FROM public.chat_members m WHERE m.channel_id = test.id('CH')),
    (SELECT string_agg(m::text, ',' ORDER BY m.id) FROM public.chat_messages m WHERE m.channel_id = test.id('CH')),
    (SELECT string_agg(s::text, ',' ORDER BY s.id) FROM public.agent_sessions s WHERE s.task_id = test.id('T')),
    (SELECT string_agg(f::text, ',' ORDER BY f.id) FROM public.focus_runs f WHERE f.id = test.id('FR')),
    (SELECT string_agg(k::text, ',' ORDER BY k.id) FROM public.workspace_api_keys k WHERE k.workspace_id = test.id('W')),
    (SELECT string_agg(m::text, ',' ORDER BY m.user_id) FROM public.workspace_members m WHERE m.workspace_id = test.id('W')),
    (SELECT string_agg(r::text, ',' ORDER BY r.id) FROM public.workspace_roles r WHERE r.workspace_id = test.id('W')),
    -- Not task_number_last: anyone who adds a task moves the handle counter.
    (SELECT string_agg(concat_ws(',', w.owner_id, w.name, w.deleted_at, w.task_key, w.task_key_aliases), ',')
       FROM public.workspaces w WHERE w.id = test.id('W')),
    (SELECT string_agg(g::text, ',' ORDER BY g.id) FROM public.resource_grants g, priv WHERE g.resource_id = ANY (priv.a)),
    (SELECT string_agg(c::text, ',' ORDER BY c.id) FROM public.comments c, priv WHERE c.entity_id = ANY (priv.a)),
    (SELECT string_agg(l::text, ',' ORDER BY l.id) FROM public.entity_links l, priv
      WHERE l.source_id = ANY (priv.a) OR l.target_id = ANY (priv.a)),
    (SELECT string_agg(u::text, ',') FROM public.user_preferences u WHERE u.user_id = test.id('owner')),
    (SELECT string_agg(p::text, ',') FROM public.profiles p WHERE p.id = test.id('owner'))))
$$;

-- One argument's SQL literal, from its name and type. p_kind is the entity
-- kind of this call (for functions that take a type), else NULL; p_field the
-- field a JSON patch sets (ops name it title or name).
CREATE FUNCTION test.mx_arg(p_fn text, p_name text, p_type regtype, p_kind text, p_field text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_n text := lower(coalesce(regexp_replace(p_name, '^p_', ''), ''));
  v_kind_id text := CASE p_kind WHEN 'task' THEN 'T' WHEN 'note' THEN 'N' WHEN 'contact' THEN 'C'
    WHEN 'bucket' THEN 'P' WHEN 'project' THEN 'P' WHEN 'chat_message' THEN 'MSG' WHEN 'chat_channel' THEN 'CH' END;
  v_other text := CASE WHEN p_kind = 'task' THEN 'note' ELSE 'task' END;
  v_key text;
BEGIN
  IF p_type = 'uuid'::regtype THEN
    v_key := CASE
      WHEN v_n LIKE '%workspace%' THEN 'W'
      WHEN v_n IN ('target_id') AND p_kind IS NOT NULL THEN CASE v_other WHEN 'note' THEN 'N' ELSE 'T' END
      WHEN v_n IN ('id', 'entity_id', 'source_id', 'resource_id', 'contact_id') AND p_kind IS NOT NULL THEN v_kind_id
      WHEN v_n LIKE '%task%' THEN 'T'
      WHEN v_n LIKE '%project%' OR v_n LIKE '%bucket%' THEN 'P'
      WHEN v_n LIKE '%note%' THEN 'N'
      WHEN v_n LIKE '%channel%' THEN 'CH'
      WHEN v_n IN ('message_id', 'reply_to_id', 'settled_id') THEN 'MSG'
      WHEN v_n = 'root_id' THEN CASE WHEN p_fn LIKE 'chat%' THEN 'MSG' ELSE 'N' END
      WHEN v_n IN ('contact_id', 'keep_id', 'drop_id', 'client_contact_id') THEN 'C'
      WHEN v_n = 'member_id' THEN 'MEMBERSHIP'
      WHEN v_n IN ('role_id', 'reassign_to') THEN 'ROLE'
      WHEN v_n = 'key_id' THEN 'K'
      WHEN v_n = 'run_id' THEN 'FR'
      WHEN v_n = 'session_id' THEN 'S'
      WHEN v_n = 'comment_id' THEN 'COMMENT'
      WHEN v_n IN ('user_id', 'owner', 'owner_id', 'subject_id', 'assignee_id', 'user') THEN 'viewer'
      WHEN v_n = 'id' AND p_fn LIKE 'chat%' THEN 'MSG'
      WHEN v_n = 'id' AND p_fn LIKE 'comments%' THEN 'COMMENT'
      WHEN v_n = 'id' AND p_fn LIKE 'focus%' THEN 'FR'
      ELSE 'T' END;
    RETURN quote_literal((SELECT id FROM test.mx_ids WHERE name = v_key)) || '::uuid';
  ELSIF p_type = 'uuid[]'::regtype THEN
    v_key := CASE
      WHEN v_n = 'user_ids' THEN 'outsider'
      WHEN v_n LIKE '%user_ids%' THEN 'viewer'
      WHEN v_n LIKE '%team%' THEN NULL
      WHEN p_fn LIKE 'chat%' THEN 'MSG'
      ELSE 'T' END;
    IF v_key IS NULL THEN RETURN '''{}''::uuid[]'; END IF;
    RETURN format('ARRAY[%L]::uuid[]', (SELECT id FROM test.mx_ids WHERE name = v_key));
  ELSIF p_type IN ('text'::regtype, 'character varying'::regtype) THEN
    IF v_n IN ('type', 'entity_type', 'kind', 'source_type', 'resource_type', 'contact_type') AND p_kind IS NOT NULL THEN
      RETURN quote_literal(p_kind);
    ELSIF v_n = 'target_type' AND p_kind IS NOT NULL THEN
      RETURN quote_literal(v_other);
    END IF;
    RETURN quote_literal(CASE
      WHEN v_n = 'level' OR v_n = 'min' THEN 'edit'
      WHEN v_n = 'role' THEN 'admin'
      WHEN v_n = 'subject_type' THEN 'member'
      WHEN v_n = 'relation_kind' THEN 'references'
      WHEN v_n = 'origin' THEN 'manual'
      WHEN v_n IN ('body', 'title', 'name', 'note', 'topic', 'markdown', 'label') THEN 'HV16 probe'
      ELSE 'hv16' END);
  ELSIF p_type = 'jsonb'::regtype OR p_type = 'json'::regtype THEN
    RETURN quote_literal(json_build_object(coalesce(p_field, 'title'), 'HV16 probe')::text) || '::' || p_type::text;
  ELSIF p_type = 'boolean'::regtype THEN
    RETURN 'true';
  ELSIF p_type IN ('integer'::regtype, 'bigint'::regtype, 'smallint'::regtype, 'numeric'::regtype) THEN
    RETURN '1::' || p_type::text;
  ELSIF p_type IN ('timestamp with time zone'::regtype, 'timestamp without time zone'::regtype) THEN
    RETURN '(now() + interval ''1 day'')::' || p_type::text;
  ELSIF p_type = 'date'::regtype THEN
    RETURN '(current_date + 1)';
  ELSIF p_type = 'text[]'::regtype THEN
    RETURN '''{}''::text[]';
  END IF;
  RETURN 'NULL::' || p_type::text;
END;
$$;

-- One call as a persona ('outsider', 'member') or as a key ('key:<name>'):
-- what it returned (or its error) and whether it changed the private rows.
CREATE FUNCTION test.mx_call(p_who text, p_sql text, p_base text, OUT r text, OUT changed boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_out text;
  v_state text;
  v_msg text;
BEGIN
  changed := false;
  BEGIN
    IF p_who LIKE 'key:%' THEN
      PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
      PERFORM set_config('request.headers',
        json_build_object('x-moduo-key-id', test.id(substr(p_who, 5)))::text, true);
      SET LOCAL ROLE service_role;
    ELSE
      PERFORM set_config('request.jwt.claims', test.mx_claims(p_who), true);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE p_sql INTO v_out;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM set_config('request.headers', '{}', true);
    changed := test.mx_print() IS DISTINCT FROM p_base;
    r := 'ok ' || coalesce(v_out, '');
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state <> 'P0099' THEN
      r := v_state || ' ' || v_msg;
      changed := false;
    END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
END;
$$;

-- The functions and their calls.
CREATE TABLE test.mx_fn AS
SELECT p.oid, p.proname::text AS fn, p.proretset,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS signed_in,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       -- An entry point the connector calls with a key (an intent op, or the
       -- share lookup), as opposed to a service-role helper (`__`, guards).
       p.prosrc ~ 'perm_actor_id|module_api_key|x-moduo-key-id' AND p.proname !~ '__'
         AND (p.proname ~ '_op_' OR p.proname = 'share_visible_ids') AS acts_for_key,
       EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%') AS pinned,
       coalesce(p.proargmodes::text[], '{}') && ARRAY['v'] AS is_variadic,
       -- The input arguments' names and types, in order.
       (SELECT array_agg(coalesce(a.name, '') ORDER BY a.ord)
          FROM unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]), coalesce(p.proargmodes::text[], array_fill('i'::text, ARRAY[p.pronargs])),
                      coalesce(p.proargnames, array_fill(''::text, ARRAY[coalesce(array_length(p.proallargtypes, 1), p.pronargs)])))
               WITH ORDINALITY AS a(type, mode, name, ord)
         WHERE a.mode IN ('i', 'b')) AS arg_names,
       (SELECT array_agg(a.type::regtype ORDER BY a.ord)
          FROM unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]), coalesce(p.proargmodes::text[], array_fill('i'::text, ARRAY[p.pronargs])))
               WITH ORDINALITY AS a(type, mode, ord)
         WHERE a.mode IN ('i', 'b')) AS arg_types
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
  AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype);

CREATE TABLE test.mx_result (fn text, who text, kind text, sql text, r text, changed boolean);

DO $$
DECLARE
  f record;
  v_kinds text[];
  v_kind text;
  v_field text;
  v_args text;
  v_sql text;
  v_who text;
  v_call record;
  v_base text := test.mx_print();
BEGIN
  FOR f IN SELECT * FROM test.mx_fn WHERE NOT is_variadic AND (signed_in OR acts_for_key) ORDER BY fn, oid LOOP
    v_kinds := CASE WHEN f.arg_names && ARRAY['p_type', 'p_entity_type', 'p_kind', 'p_source_type', 'p_resource_type', 'p_contact_type']
      THEN ARRAY['task', 'note', 'contact', 'bucket', 'project', 'chat_message', 'chat_channel'] ELSE ARRAY[NULL::text] END;
    FOREACH v_kind IN ARRAY v_kinds LOOP
    FOREACH v_field IN ARRAY CASE WHEN f.arg_types && ARRAY['jsonb'::regtype, 'json'::regtype]
      THEN ARRAY['title', 'name'] ELSE ARRAY[NULL::text] END LOOP
      SELECT string_agg(test.mx_arg(f.fn, a.name, a.type, v_kind, v_field), ', ' ORDER BY a.ord) INTO v_args
      FROM unnest(coalesce(f.arg_names, '{}'), coalesce(f.arg_types, '{}')) WITH ORDINALITY AS a(name, type, ord);
      v_sql := CASE WHEN f.proretset
        THEN format('SELECT string_agg(x::text, E''\n'') FROM public.%I(%s) AS x', f.fn, coalesce(v_args, ''))
        ELSE format('SELECT (public.%I(%s))::text', f.fn, coalesce(v_args, '')) END;
      -- owner is the control: what they reach shows the probe can tell.
      FOREACH v_who IN ARRAY CASE WHEN f.signed_in THEN ARRAY['outsider', 'member', 'viewer', 'key:KX', 'owner'] ELSE ARRAY['key:KX'] END LOOP
        SELECT * INTO v_call FROM test.mx_call(v_who, v_sql, v_base);
        INSERT INTO test.mx_result VALUES (f.fn, v_who, v_kind, v_sql, v_call.r, v_call.changed);
      END LOOP;
    END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

-- The checks: one per function and caller.
DO $$
DECLARE
  g record;
  v_bad record;
  v_allowed text;
BEGIN
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM test.mx_fn WHERE NOT pinned),
    'every SECURITY DEFINER function in public pins search_path',
    (SELECT string_agg(fn, ', ') FROM test.mx_fn WHERE NOT pinned));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM test.mx_fn f WHERE f.anon
                              AND NOT EXISTS (SELECT 1 FROM test.mx_allow a WHERE a.fn = f.fn AND a.persona = 'anon')),
    'anon executes no SECURITY DEFINER function in public',
    (SELECT string_agg(fn, ', ') FROM test.mx_fn f WHERE f.anon));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM test.mx_fn WHERE is_variadic AND (signed_in OR acts_for_key)),
    'no probed function is VARIADIC (the probe can''t fill one)',
    (SELECT string_agg(fn, ', ') FROM test.mx_fn WHERE is_variadic AND (signed_in OR acts_for_key)));
  PERFORM test.ok((SELECT count(DISTINCT fn) FROM test.mx_result WHERE who = 'outsider')
                  = (SELECT count(DISTINCT fn) FROM test.mx_fn WHERE signed_in),
    'the probe called every function signed-in people may execute',
    format('%s of %s', (SELECT count(DISTINCT fn) FROM test.mx_result WHERE who = 'outsider'),
           (SELECT count(DISTINCT fn) FROM test.mx_fn WHERE signed_in)));

  -- The control: as the owner, the same calls read and change the private
  -- rows through many functions, so a clean run above means something.
  PERFORM test.ok((SELECT count(DISTINCT fn) FROM test.mx_result WHERE who = 'owner' AND r ~* 'hv16-secret') >= 20,
    'control: the owner reads the secret through at least 20 of the probed functions',
    (SELECT count(DISTINCT fn)::text FROM test.mx_result WHERE who = 'owner' AND r ~* 'hv16-secret'));
  PERFORM test.ok((SELECT count(DISTINCT fn) FROM test.mx_result WHERE who = 'owner' AND changed) >= 40,
    'control: the owner changes the private rows through at least 40 of them',
    (SELECT count(DISTINCT fn)::text FROM test.mx_result WHERE who = 'owner' AND changed));
  -- A function whose filled-in arguments fail even for the owner proves nothing
  -- for anyone else: rls_matrix.md lists each, and the list must stay exact.
  PERFORM test.ok(NOT EXISTS (
      SELECT fn FROM test.mx_result WHERE who = 'owner' GROUP BY fn HAVING bool_and(r NOT LIKE 'ok%')
      EXCEPT SELECT fn FROM test.mx_unreached),
    'every function the probe can''t reach as the owner is listed in rls_matrix.md',
    (SELECT string_agg(fn, ', ') FROM (SELECT fn FROM test.mx_result WHERE who = 'owner' GROUP BY fn
       HAVING bool_and(r NOT LIKE 'ok%') EXCEPT SELECT fn FROM test.mx_unreached) x));
  PERFORM test.ok(NOT EXISTS (
      SELECT fn FROM test.mx_unreached
      EXCEPT SELECT fn FROM test.mx_result WHERE who = 'owner' GROUP BY fn HAVING bool_and(r NOT LIKE 'ok%')),
    'every function rls_matrix.md lists as not reached is still out of reach (else drop it from the list)',
    (SELECT string_agg(fn, ', ') FROM (SELECT fn FROM test.mx_unreached
       EXCEPT SELECT fn FROM test.mx_result WHERE who = 'owner' GROUP BY fn HAVING bool_and(r NOT LIKE 'ok%')) x));

  -- An allow line's `as` is a caller ('member'; 'key' for any key), or a caller
  -- and one entity kind ('viewer:chat_channel'): only that kind's calls pass.
  CREATE TEMP TABLE mx_flagged ON COMMIT DROP AS
  SELECT r.*, CASE WHEN r.who LIKE 'key:%' THEN 'key' ELSE r.who END AS caller FROM test.mx_result r
  -- viewer sees the shared items' text by right: only a change counts against them.
  WHERE r.who <> 'owner' AND (r.changed OR (r.who <> 'viewer' AND r.r ~* 'hv16-secret'));
  FOR g IN SELECT a.fn, a.persona, a.why FROM test.mx_allow a WHERE a.persona LIKE '%:%' ORDER BY 1, 2 LOOP
    PERFORM test.ok(EXISTS (SELECT 1 FROM mx_flagged f WHERE f.fn = g.fn AND f.caller || ':' || f.kind = g.persona),
      format('rpc · %s · %s: allowed (%s), and still needed', g.fn, g.persona, g.why));
  END LOOP;

  FOR g IN SELECT fn, who FROM test.mx_result WHERE who <> 'owner' GROUP BY fn, who ORDER BY fn, who LOOP
    SELECT * INTO v_bad FROM mx_flagged r
    WHERE r.fn = g.fn AND r.who = g.who
      AND NOT EXISTS (SELECT 1 FROM test.mx_allow a WHERE a.fn = r.fn AND a.persona = r.caller || ':' || r.kind)
    ORDER BY r.kind NULLS FIRST LIMIT 1;
    SELECT why INTO v_allowed FROM test.mx_allow a
    WHERE a.fn = g.fn AND a.persona = CASE WHEN g.who LIKE 'key:%' THEN 'key' ELSE g.who END;
    IF v_allowed IS NOT NULL THEN
      PERFORM test.ok(v_bad.fn IS NOT NULL,
        format('rpc · %s · %s: allowed (%s), and still needed', g.fn, g.who, v_allowed));
    ELSE
      PERFORM test.ok(v_bad.fn IS NULL,
        format('rpc · %s · %s leaks nothing and changes nothing private', g.fn, g.who),
        CASE WHEN v_bad.fn IS NOT NULL THEN
          format('%s%s: %s', CASE WHEN v_bad.changed THEN 'changed private rows; ' ELSE 'leaked; ' END,
                 coalesce(v_bad.kind, '-'), left(v_bad.r, 300)) END);
    END IF;
  END LOOP;
END;
$$;
