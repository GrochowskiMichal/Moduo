-- Probe for supabase/migrations/20261008210500_attachments_storage.sql (AT-1,
-- specs/attachments.md block 1). Run it on a throwaway Postgres 17 database
-- that holds nothing else, in one psql session:
--
--   createdb -h /tmp -p 54371 -U postgres at1
--   psql -h /tmp -p 54371 -U postgres -d at1 -v ON_ERROR_STOP=1 -q \
--     -f supabase/probes/tasks-assignee.stub.sql \
--     -f supabase/migrations/20261008150000_tasks_assignee_creator.sql \
--     -f supabase/probes/tasks-queue.stub.sql \
--     -f supabase/probes/tasks-queue.seed.sql \
--     -f supabase/migrations/20261008171500_tasks_personal_queue.sql \
--     -f supabase/probes/attachments.stub.sql \
--     -f supabase/migrations/20261008210500_attachments_storage.sql \
--     -f supabase/probes/attachments.probe.sql
--
-- The seed's world: workspace W owned by Olga (O) with members Ada (A), Bea
-- (B), Xavier (X) and the viewer Vera (V); Nell (N) owns WN. Bucket SB is
-- shared with the workspace, PB is Bea's private bucket. Every check stops
-- the run with its message; a clean run ends with "PASS: all".

SET client_min_messages = notice;

CREATE FUNCTION probe.ok(p_cond boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END;
$$;

-- Run a statement as a person; return 'ok' or the error message.
CREATE FUNCTION probe.try_as(p_user text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r text := 'ok';
BEGIN
  IF p_user IS NULL THEN PERFORM probe.as_system(); ELSE PERFORM probe.as_user(p_user); END IF;
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    r := SQLERRM;
  END;
  PERFORM probe.as_system();
  RETURN r;
END;
$$;

-- Begin an upload as a person; the new row (or an exception).
CREATE FUNCTION probe.begin(p_user text, p_task text, p_name text, p_size bigint,
                            p_preview text DEFAULT NULL, p_ws text DEFAULT 'W')
RETURNS public.attachments LANGUAGE plpgsql AS $$
DECLARE
  v public.attachments;
BEGIN
  PERFORM probe.as_user(p_user);
  v := public.attachments_op_begin(probe.id(p_ws), 'task', probe.id(p_task), p_name,
                                   'image/png', p_size, p_preview, 800, 600);
  PERFORM probe.as_system();
  RETURN v;
END;
$$;

CREATE FUNCTION probe.finalize(p_user text, p_id uuid) RETURNS public.attachments LANGUAGE plpgsql AS $$
DECLARE
  v public.attachments;
BEGIN
  PERFORM probe.as_user(p_user);
  v := public.attachments_op_finalize(p_id);
  PERFORM probe.as_system();
  RETURN v;
END;
$$;

-- Write an object the way the Storage API does: as the signed-in person, under
-- the storage.objects policies. Returns 'ok' or the SQLSTATE.
CREATE FUNCTION probe.upload(p_user text, p_path text, p_size bigint) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_uid uuid := probe.id(p_user);
  r text := 'ok';
BEGIN
  PERFORM probe.as_user(p_user);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
    VALUES ('attachments', p_path, v_uid, v_uid::text, jsonb_build_object('size', p_size));
  EXCEPTION WHEN OTHERS THEN
    r := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM probe.as_system();
  RETURN r;
END;
$$;

-- How many objects at this path a person can read (sign a link for).
CREATE FUNCTION probe.can_read(p_user text, p_path text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  PERFORM probe.as_user(p_user);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'attachments' AND name = p_path;
  RESET ROLE;
  PERFORM probe.as_system();
  RETURN n > 0;
END;
$$;

-- How many attachment rows a person sees through RLS.
CREATE FUNCTION probe.rows_seen(p_user text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  PERFORM probe.as_user(p_user);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.attachments;
  RESET ROLE;
  PERFORM probe.as_system();
  RETURN n;
END;
$$;

CREATE FUNCTION probe.used(p_owner text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT bytes_used FROM public.storage_usage WHERE owner_id = probe.id(p_owner)), 0)
$$;
CREATE FUNCTION probe.att(p_id uuid) RETURNS public.attachments LANGUAGE sql STABLE AS $$
  SELECT a.* FROM public.attachments a WHERE a.id = p_id
$$;
CREATE FUNCTION probe.alerts(p_level int) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.module_activity WHERE op = 'attachments.storage_' || p_level
$$;

-- A full upload: begin, put the bytes, finalize. Returns the row.
CREATE FUNCTION probe.attach(p_user text, p_task text, p_size bigint, p_ws text DEFAULT 'W')
RETURNS public.attachments LANGUAGE plpgsql AS $$
DECLARE
  v public.attachments;
BEGIN
  v := probe.begin(p_user, p_task, 'shot.png', p_size, NULL, p_ws);
  PERFORM probe.ok(probe.upload(p_user, v.object_path, p_size) = 'ok', 'attach: upload ' || p_task);
  RETURN probe.finalize(p_user, v.id);
END;
$$;

GRANT USAGE ON SCHEMA probe TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA probe TO anon, authenticated, service_role;

-- ── The world ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM probe.new_task('T1 shared', 'A', 'A', 'SB');
  PERFORM probe.new_task('T2 Bea private', 'B', 'B', 'PB');
  PERFORM probe.new_task('T3 shared', 'A', 'A', 'SB');
  PERFORM probe.new_task('TN Nell', 'N', 'N', 'NB', 'WN');
  PERFORM probe.new_task('TD deleted', 'A', 'A', 'SB');
  UPDATE public.tasks SET deleted_at = now() WHERE id = probe.id('TD deleted');
END;
$$;

-- ── 1. Grants ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM probe.ok(NOT has_function_privilege('anon', 'public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer)', 'EXECUTE')
               AND has_function_privilege('authenticated', 'public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer)', 'EXECUTE'),
                   'grants: begin is for signed-in people only');
  PERFORM probe.ok(NOT has_function_privilege('anon', 'public.storage_status(uuid)', 'EXECUTE'),
                   'grants: anon can''t read a pool');
  PERFORM probe.ok(NOT has_function_privilege('authenticated', 'public.storage__limits_for_owner(uuid)', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.storage_usage__add(uuid, bigint)', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.attachments__purge_rows(uuid[])', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.tasks__purge_expired(integer)', 'EXECUTE')
               AND NOT has_function_privilege('authenticated', 'public.storage_usage__reconcile()', 'EXECUTE')
               AND NOT has_function_privilege('anon', 'public.attachments__orphan_objects(integer)', 'EXECUTE'),
                   'grants: server-only helpers are closed to both client roles');
  PERFORM probe.ok(has_function_privilege('service_role', 'public.attachments__purge_candidates(integer)', 'EXECUTE')
               AND has_function_privilege('service_role', 'public.tasks__purge_expired(integer)', 'EXECUTE'),
                   'grants: the purge (service role) can run its helpers');
  PERFORM probe.ok(NOT has_table_privilege('authenticated', 'public.attachments', 'INSERT')
               AND NOT has_table_privilege('authenticated', 'public.attachments', 'UPDATE')
               AND NOT has_table_privilege('authenticated', 'public.attachments', 'DELETE')
               AND NOT has_table_privilege('anon', 'public.attachments', 'SELECT')
               AND NOT has_table_privilege('authenticated', 'public.storage_usage', 'SELECT'),
                   'grants: no direct writes, no pool reads');
  PERFORM probe.ok((SELECT NOT public AND file_size_limit = 524288000 AND type = 'STANDARD'
                    FROM storage.buckets WHERE id = 'attachments'),
                   'bucket: private, 500 MiB, STANDARD');
END;
$$;

-- ── 2. Limits per plan ───────────────────────────────────────────────────────
DO $$
DECLARE
  l record;
  mib constant bigint := 1048576;
  gib constant bigint := 1073741824;
BEGIN
  SELECT * INTO l FROM public.storage__limits_for_owner(probe.id('O'));
  PERFORM probe.ok(l.tier = 'free' AND l.per_file_bytes = 20 * mib AND l.total_bytes = 2 * gib,
                   'limits: Free = 20 MB per file, 2 GB pool');
  UPDATE public.profiles SET plan_tier = 'pro' WHERE id = probe.id('O');
  SELECT * INTO l FROM public.storage__limits_for_owner(probe.id('O'));
  PERFORM probe.ok(l.per_file_bytes = 50 * mib AND l.total_bytes = 50 * gib,
                   'limits: Pro = 50 GB pool; 200 MB per file held at the 50 MB platform cap');
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = probe.id('O');
  SELECT * INTO l FROM public.storage__limits_for_owner(probe.id('O'));
  PERFORM probe.ok(l.total_bytes = 100 * gib, 'limits: Duo = 100 GB pool');
  UPDATE public.profiles SET plan_tier = 'team' WHERE id = probe.id('O');
  SELECT * INTO l FROM public.storage__limits_for_owner(probe.id('O'));
  PERFORM probe.ok(l.total_bytes = 150 * gib, 'limits: Team without a subscription row = 3 seats × 50 GB');
  INSERT INTO stripe.subscriptions (id, items) VALUES ('sub_o', '{"data":[{"quantity":5}]}');
  UPDATE public.profiles SET stripe_subscription_id = 'sub_o' WHERE id = probe.id('O');
  SELECT * INTO l FROM public.storage__limits_for_owner(probe.id('O'));
  PERFORM probe.ok(l.total_bytes = 250 * gib, 'limits: Team with 5 paid seats = 250 GB');
  UPDATE public.profiles SET plan_tier = 'founder' WHERE id = probe.id('O');
  SELECT * INTO l FROM public.storage__limits_for_owner(probe.id('O'));
  PERFORM probe.ok(l.total_bytes = 1024 * gib AND l.per_file_bytes = 50 * mib,
                   'limits: Founder = 1 TB pool, Team per file (held at the platform cap)');
  SELECT * INTO l FROM public.storage__limits_for_owner(gen_random_uuid());
  PERFORM probe.ok(l.tier = 'free' AND l.total_bytes = 2 * gib, 'limits: no profile reads as Free');
  UPDATE public.profiles SET plan_tier = 'free', stripe_subscription_id = NULL WHERE id = probe.id('O');
END;
$$;

-- ── 3. Begin: access, limits, names ──────────────────────────────────────────
DO $$
DECLARE
  v public.attachments;
  e text;
BEGIN
  v := probe.begin('A', 'T1 shared', 'Screen Shot.PNG', 1000, 'image/webp');
  PERFORM probe.ok(v.status = 'pending' AND v.uploader_id = probe.id('A')
               AND v.object_path = probe.id('W')::text || '/' || v.id::text || '/original.png'
               AND v.preview_path = probe.id('W')::text || '/' || v.id::text || '/preview.webp'
               AND v.entity_type = 'task' AND v.workspace_id = probe.id('W') AND v.width = 800,
                   'begin: a pending row with {workspace}/{id}/original.{ext} and preview paths');
  PERFORM probe.ok(probe.used('O') = 0, 'begin: a pending file isn''t counted as used');

  v := probe.begin('A', 'T1 shared', E'no\textension\u0007', 10);
  PERFORM probe.ok(v.file_name = 'noextension' AND v.object_path LIKE '%/original.bin',
                   'begin: control characters stripped; no extension stores as .bin');
  v := probe.begin('A', 'T1 shared', '   ', 10);
  PERFORM probe.ok(v.file_name = 'file', 'begin: a blank name becomes "file"');

  e := probe.try_as('V', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'no_edit_access', 'begin: a viewer can''t add files (' || e || ')');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('T2 Bea private')));
  PERFORM probe.ok(e = 'entity_not_found', 'begin: a task you can''t see answers not found (' || e || ')');
  e := probe.try_as('N', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'entity_not_found', 'begin: an outsider gets not found (' || e || ')');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('TD deleted')));
  PERFORM probe.ok(e = 'entity_not_found', 'begin: a task in the trash takes no files (' || e || ')');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 10)$q$,
                                probe.id('WN'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'entity_not_found', 'begin: the task must be in the named workspace (' || e || ')');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'note', %L, 'a.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'unsupported_entity', 'begin: only tasks take files for now (' || e || ')');
  e := probe.try_as(NULL, format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 10)$q$,
                                 probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'not_signed_in', 'begin: system or key calls are refused (' || e || ')');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 0)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'invalid_size', 'begin: a zero size is refused');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'a.png', 'image/png', 10, 'image/gif')$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'invalid_preview_mime', 'begin: previews are WebP, PNG or JPEG only');

  -- Free: 20 MB per file.
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'big.mov', 'video/quicktime', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 20 * 1048576 + 1));
  PERFORM probe.ok(e = 'attachment_too_large', 'begin: over the per-file limit is refused before any bytes (' || e || ')');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'ok.mov', 'video/quicktime', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 20 * 1048576));
  PERFORM probe.ok(e = 'ok', 'begin: exactly the per-file limit is allowed');
END;
$$;

-- The refusal carries the numbers the tile needs.
DO $$
DECLARE
  v_detail text;
BEGIN
  PERFORM probe.as_user('A');
  BEGIN
    PERFORM public.attachments_op_begin(probe.id('W'), 'task', probe.id('T1 shared'), 'big.mov',
                                        'video/quicktime', 30 * 1048576);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;
  PERFORM probe.as_system();
  PERFORM probe.ok((v_detail::jsonb ->> 'per_file_bytes')::bigint = 20 * 1048576
               AND (v_detail::jsonb ->> 'size_bytes')::bigint = 30 * 1048576
               AND v_detail::jsonb ->> 'tier' = 'free',
                   'begin: too large carries size, limit and plan in DETAIL');
END;
$$;

-- Pool: used + pending + this file must fit.
DO $$
DECLARE
  e text;
  v_detail text;
  gib constant bigint := 1073741824;
  mib constant bigint := 1048576;
BEGIN
  DELETE FROM public.attachments;  -- start the pool from empty
  INSERT INTO public.storage_usage (owner_id, bytes_used) VALUES (probe.id('O'), 2 * gib - 3 * mib)
  ON CONFLICT (owner_id) DO UPDATE SET bytes_used = excluded.bytes_used;
  PERFORM probe.begin('A', 'T1 shared', 'one.png', 2 * mib);
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'two.png', 'image/png', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 2 * mib));
  PERFORM probe.ok(e = 'storage_full', 'begin: pending uploads count against the pool (' || e || ')');
  PERFORM probe.as_user('B');
  BEGIN
    PERFORM public.attachments_op_begin(probe.id('W'), 'task', probe.id('T1 shared'), 'two.png', 'image/png', 2 * mib);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;
  PERFORM probe.as_system();
  PERFORM probe.ok((v_detail::jsonb ->> 'total_bytes')::bigint = 2 * gib
               AND (v_detail::jsonb ->> 'pending_bytes')::bigint = 2 * mib,
                   'begin: storage full carries used, pending and total in DETAIL');
  -- An abandoned upload (over 24 h) holds its space until the purge removes it.
  UPDATE public.attachments SET created_at = now() - interval '25 hours';
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'two.png', 'image/png', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 2 * mib));
  PERFORM probe.ok(e = 'storage_full', 'begin: an abandoned upload holds its space until purged (' || e || ')');
  DELETE FROM public.attachments;
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'two.png', 'image/png', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 2 * mib));
  PERFORM probe.ok(e = 'ok', 'begin: once purged the space is back');
  DELETE FROM public.attachments;
  UPDATE public.storage_usage SET bytes_used = 0 WHERE owner_id = probe.id('O');
END;
$$;

-- Unfinished uploads count at what is really stored, not what was declared.
DO $$
DECLARE
  v public.attachments;
  w public.attachments;
  e text;
  gib constant bigint := 1073741824;
  mib constant bigint := 1048576;
BEGIN
  UPDATE public.storage_usage SET bytes_used = 2 * gib - 30 * mib WHERE owner_id = probe.id('O');
  -- Declared 1 byte, stored 20 MB, never finalized.
  v := probe.begin('A', 'T1 shared', 'small.png', 1, 'image/png');
  PERFORM probe.ok(probe.upload('A', v.object_path, 20 * mib) = 'ok', 'unsettled: an oversized upload lands');
  PERFORM probe.ok(probe.upload('A', v.preview_path, 5 * mib) = 'ok', 'unsettled: and an oversized preview');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'next.png', 'image/png', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 6 * mib));
  PERFORM probe.ok(e = 'storage_full', 'unsettled: it counts at its stored 25 MB, not the declared byte (' || e || ')');
  -- Finalize fails it; the failed file still counts until the purge removes it.
  PERFORM probe.ok((probe.finalize('A', v.id)).status = 'failed', 'unsettled: finalize fails the tampered file');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'next.png', 'image/png', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 6 * mib));
  PERFORM probe.ok(e = 'storage_full', 'unsettled: a failed upload holds its bytes until purged (' || e || ')');
  DELETE FROM storage.objects WHERE name IN (v.object_path, v.preview_path);
  DELETE FROM public.attachments WHERE id = v.id;
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'next.png', 'image/png', %s)$q$,
                                probe.id('W'), probe.id('T1 shared'), 6 * mib));
  PERFORM probe.ok(e = 'ok', 'unsettled: purged, the space is back');
  DELETE FROM public.attachments;
  UPDATE public.storage_usage SET bytes_used = 0 WHERE owner_id = probe.id('O');
END;
$$;

-- One person can't hold the pool with abandoned uploads.
DO $$
DECLARE
  e text;
BEGIN
  FOR i IN 1..50 LOOP
    PERFORM probe.begin('B', 'T1 shared', 'p' || i || '.png', 10);
  END LOOP;
  e := probe.try_as('B', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'p51.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'too_many_pending', 'begin: 50 unfinished uploads per person at most (' || e || ')');
  UPDATE public.attachments SET status = 'failed' WHERE uploader_id = probe.id('B');
  e := probe.try_as('B', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'p51.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'too_many_pending', 'begin: failed uploads count until purged (' || e || ')');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'mine.png', 'image/png', 10)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'ok', 'begin: another person isn''t held back by it');
  DELETE FROM public.attachments;
END;
$$;

-- ── 4. Storage policies and finalize ─────────────────────────────────────────
CREATE TABLE probe.f (k text PRIMARY KEY, id uuid);

DO $$
DECLARE
  v public.attachments;
  e text;
  n integer;
BEGIN
  v := probe.begin('A', 'T1 shared', 'shot.png', 5000, 'image/webp');
  INSERT INTO probe.f VALUES ('main', v.id);

  PERFORM probe.ok(probe.upload('B', v.object_path, 5000) = '42501',
                   'storage: someone else can''t write to your pending path');
  PERFORM probe.ok(probe.upload('A', probe.id('W')::text || '/' || gen_random_uuid()::text || '/original.png', 5) = '42501',
                   'storage: a path no pending row names is refused');
  PERFORM probe.ok(probe.upload('A', 'elsewhere/x.png', 5) = '42501',
                   'storage: nothing outside the protocol lands in the bucket');

  e := probe.try_as('A', format('SELECT public.attachments_op_finalize(%L)', v.id));
  PERFORM probe.ok(e = 'not_uploaded' AND (probe.att(v.id)).status = 'pending',
                   'finalize: before the bytes arrive it stays pending (' || e || ')');

  PERFORM probe.ok(probe.upload('A', v.object_path, 5000) = 'ok', 'storage: the uploader writes the original');
  PERFORM probe.ok(probe.upload('A', v.preview_path, 700) = 'ok', 'storage: and the preview');
  PERFORM probe.ok(probe.can_read('A', v.object_path) AND NOT probe.can_read('B', v.object_path),
                   'storage: a pending file is readable by its uploader only');

  -- Upsert retry: the uploader may overwrite a pending object, nobody else.
  PERFORM probe.as_user('B');
  SET LOCAL ROLE authenticated;
  UPDATE storage.objects SET metadata = '{"size": 1}' WHERE name = v.object_path;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  PERFORM probe.as_system();
  PERFORM probe.ok(n = 0, 'storage: someone else can''t overwrite a pending object');

  e := probe.try_as('B', format('SELECT public.attachments_op_finalize(%L)', v.id));
  PERFORM probe.ok(e = 'attachment_not_found', 'finalize: only the uploader finalizes (' || e || ')');

  v := probe.finalize('A', v.id);
  PERFORM probe.ok(v.status = 'ready' AND v.preview_bytes = 700 AND v.preview_path IS NOT NULL,
                   'finalize: ready, with the stored preview size');
  PERFORM probe.ok(probe.used('O') = 5700, 'ledger: a ready file counts original + preview against the owner');
  PERFORM probe.ok((probe.finalize('A', v.id)).status = 'ready' AND probe.used('O') = 5700,
                   'finalize: a retry returns the same row and counts nothing twice');

  PERFORM probe.ok(probe.upload('A', v.object_path, 5000) = '42501',
                   'storage: once ready the path takes no more writes');
  PERFORM probe.ok(probe.can_read('A', v.object_path) AND probe.can_read('B', v.object_path)
               AND probe.can_read('V', v.preview_path) AND probe.can_read('O', v.object_path),
                   'storage: everyone who can see the task can read (sign) it, viewers included');
  PERFORM probe.ok(NOT probe.can_read('N', v.object_path), 'storage: an outsider can''t');
END;
$$;

DO $$
DECLARE
  v public.attachments;
BEGIN
  -- Tampered size: declared 100, stored 999.
  v := probe.begin('A', 'T1 shared', 'liar.png', 100);
  PERFORM probe.upload('A', v.object_path, 999);
  v := probe.finalize('A', v.id);
  PERFORM probe.ok(v.status = 'failed' AND probe.used('O') = 5700,
                   'finalize: a stored size that differs from the declared one fails and counts nothing');
  -- A "preview" bigger than a preview can be.
  v := probe.begin('A', 'T1 shared', 'fat.png', 100, 'image/png');
  PERFORM probe.upload('A', v.object_path, 100);
  PERFORM probe.upload('A', v.preview_path, 10485761);
  PERFORM probe.ok((probe.finalize('A', v.id)).status = 'failed', 'finalize: an oversized preview fails the file');
  -- No preview uploaded: the tile shows the file type.
  v := probe.begin('A', 'T1 shared', 'nopreview.png', 300, 'image/jpeg');
  PERFORM probe.upload('A', v.object_path, 300);
  v := probe.finalize('A', v.id);
  PERFORM probe.ok(v.status = 'ready' AND v.preview_path IS NULL AND v.preview_mime IS NULL
               AND probe.used('O') = 6000,
                   'finalize: a missing preview is dropped from the row');
  INSERT INTO probe.f VALUES ('nopreview', v.id);
END;
$$;

-- Once finalized, the bytes can't change by any path: a signed-upload-URL
-- write runs outside the person's role (no policy sees it), so the guard
-- trigger is what refuses it. Here as the service role, which bypasses RLS.
DO $$
DECLARE
  v public.attachments := probe.att((SELECT id FROM probe.f WHERE k = 'main'));
  e text;
BEGIN
  e := probe.try_as(NULL, format($q$UPDATE storage.objects SET metadata = '{"size": 52428800}', version = 'v2' WHERE name = %L$q$, v.object_path));
  PERFORM probe.ok(e = 'attachment_object_locked', 'guard: a ready file''s bytes can''t be replaced, even outside RLS (' || e || ')');
  e := probe.try_as(NULL, format($q$UPDATE storage.objects SET name = 'x/y/original.png' WHERE name = %L$q$, v.object_path));
  PERFORM probe.ok(e = 'attachment_object_locked', 'guard: or moved');
  e := probe.try_as(NULL, format($q$UPDATE storage.objects SET updated_at = now() WHERE name = %L$q$, v.object_path));
  PERFORM probe.ok(e = 'ok', 'guard: bookkeeping that leaves the bytes alone is fine');
  e := probe.try_as(NULL, format($q$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('attachments', %L, '{"size": 1}')$q$,
                                 probe.id('W')::text || '/' || gen_random_uuid()::text || '/original.png'));
  PERFORM probe.ok(e = 'attachment_object_locked', 'guard: nothing lands on a path no pending row names');
  INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
  e := probe.try_as(NULL, $q$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('avatars', 'profiles/x/avatar.png', '{"size": 1}')$q$);
  PERFORM probe.ok(e = 'ok', 'guard: other buckets are untouched');
  PERFORM probe.ok((SELECT (metadata ->> 'size')::bigint FROM storage.objects WHERE name = v.object_path) = 5000,
                   'guard: the stored size is still the finalized one');
END;
$$;

-- RLS on the rows follows the task.
DO $$
BEGIN
  PERFORM probe.attach('B', 'T2 Bea private', 50);
  PERFORM probe.ok(probe.rows_seen('B') > probe.rows_seen('A') AND probe.rows_seen('A') > 0,
                   'rows: a file on a private task is only visible to who can see the task');
  PERFORM probe.ok(probe.rows_seen('N') = 0, 'rows: an outsider sees none');
END;
$$;

-- ── 5. Trash, restore, the ledger ────────────────────────────────────────────
DO $$
DECLARE
  v_main uuid := (SELECT id FROM probe.f WHERE k = 'main');
  v_np uuid := (SELECT id FROM probe.f WHERE k = 'nopreview');
  v public.attachments;
  e text;
  u0 bigint := probe.used('O');
BEGIN
  e := probe.try_as('V', format('SELECT public.attachments_op_delete(%L)', v_main));
  PERFORM probe.ok(e = 'no_edit_access', 'delete: a viewer can''t (' || e || ')');
  e := probe.try_as('N', format('SELECT public.attachments_op_delete(%L)', v_main));
  PERFORM probe.ok(e = 'attachment_not_found', 'delete: an outsider gets not found (' || e || ')');

  PERFORM probe.as_user('B');
  v := public.attachments_op_delete(v_main);
  PERFORM probe.as_system();
  PERFORM probe.ok(v.deleted_reason = 'user' AND v.deleted_at IS NOT NULL AND v.deleted_batch_id IS NOT NULL
               AND probe.used('O') = u0 - 5700,
                   'delete: in the trash at once and its space is free');
  PERFORM probe.ok(NOT probe.can_read('A', v.object_path), 'storage: a trashed file can''t be opened');

  -- The pool is full now; restoring still works and leaves it over the limit.
  UPDATE public.storage_usage SET bytes_used = 2147483648 WHERE owner_id = probe.id('O');
  PERFORM probe.as_user('A');
  v := public.attachments_op_restore(v_main);
  PERFORM probe.as_system();
  PERFORM probe.ok(v.deleted_at IS NULL AND v.deleted_reason IS NULL AND probe.used('O') = 2147483648 + 5700,
                   'restore: brings the file back even over the limit');
  PERFORM probe.ok(probe.alerts(95) = 1, 'alerts: a restore that takes the pool past 95% tells the owner');
  e := probe.try_as('A', format($q$SELECT public.attachments_op_begin(%L, 'task', %L, 'x.png', 'image/png', 1)$q$,
                                probe.id('W'), probe.id('T1 shared')));
  PERFORM probe.ok(e = 'storage_full', 'over limit: new uploads pause');
  PERFORM public.storage_usage__reconcile();
  PERFORM probe.ok(probe.used('O') = 6000 + 50, 'reconcile: recounts the pool from the rows');

  -- The task goes to the trash: its live files go with it (one batch).
  PERFORM probe.as_user('A');
  PERFORM public.attachments_op_delete(v_np);   -- deleted by hand first
  UPDATE public.tasks SET deleted_at = now() WHERE id = probe.id('T1 shared');
  PERFORM probe.as_system();
  PERFORM probe.ok((probe.att(v_main)).deleted_reason = 'task' AND (probe.att(v_np)).deleted_reason = 'user'
               AND probe.used('O') = 50,
                   'task trash: its files follow it; a file deleted earlier keeps its own reason');
  e := probe.try_as('A', format('SELECT public.attachments_op_restore(%L)', v_main));
  PERFORM probe.ok(e = 'restore_with_task', 'restore: a file trashed with its task comes back with the task (' || e || ')');
  e := probe.try_as('A', format('SELECT public.attachments_op_restore(%L)', v_np));
  PERFORM probe.ok(e = 'restore_with_task', 'restore: no file comes back onto a task in the trash (' || e || ')');

  -- Restore the task (an old build's whole-row save would do the same).
  PERFORM probe.as_user('A');
  UPDATE public.tasks SET deleted_at = NULL WHERE id = probe.id('T1 shared');
  PERFORM probe.as_system();
  PERFORM probe.ok((probe.att(v_main)).deleted_at IS NULL AND (probe.att(v_np)).deleted_reason = 'user'
               AND probe.used('O') = 5700 + 50,
                   'task restore: brings back its batch, not the file deleted by hand');
END;
$$;

-- The trash clock is the server's, and nothing comes back after 30 days.
DO $$
DECLARE
  v public.attachments;
  e text;
  t timestamptz;
BEGIN
  PERFORM probe.new_task('TC clock', 'A', 'A', 'SB');
  v := probe.attach('A', 'TC clock', 40);
  PERFORM probe.as_user('A');
  UPDATE public.tasks SET deleted_at = now() - interval '40 days' WHERE id = probe.id('TC clock');
  PERFORM probe.as_system();
  t := (probe.task('TC clock')).deleted_at;
  PERFORM probe.ok(t > now() - interval '1 minute', 'trash clock: a backdated delete is stamped with the server''s now');
  PERFORM probe.ok((probe.att(v.id)).deleted_at = t, 'trash clock: its files carry the same stamp');
  PERFORM probe.as_user('A');
  UPDATE public.tasks SET deleted_at = now() - interval '90 days' WHERE id = probe.id('TC clock');
  PERFORM probe.as_system();
  PERFORM probe.ok((probe.task('TC clock')).deleted_at = t, 'trash clock: a later write can''t move the stamp');
  UPDATE public.buckets SET deleted_at = now() - interval '40 days' WHERE id = probe.id('SB2');
  PERFORM probe.ok((SELECT deleted_at FROM public.buckets WHERE id = probe.id('SB2')) > now() - interval '1 minute',
                   'trash clock: buckets too');
  UPDATE public.buckets SET deleted_at = NULL WHERE id = probe.id('SB2');

  -- Past 30 days (as if the stamp were old): no restore of the file, and a
  -- task restore leaves its expired files in the trash for the purge.
  UPDATE public.attachments SET deleted_at = now() - interval '31 days' WHERE id = v.id;
  PERFORM probe.as_user('A');
  UPDATE public.tasks SET deleted_at = NULL WHERE id = probe.id('TC clock');
  PERFORM probe.as_system();
  PERFORM probe.ok((probe.att(v.id)).deleted_at IS NOT NULL, 'restore: a task restore leaves files past 30 days in the trash');
  UPDATE public.attachments SET deleted_reason = 'user' WHERE id = v.id;
  e := probe.try_as('A', format('SELECT public.attachments_op_restore(%L)', v.id));
  PERFORM probe.ok(e = 'attachment_expired', 'restore: a file past 30 days can''t come back (' || e || ')');
  DELETE FROM public.attachments WHERE id = v.id;
  DELETE FROM storage.objects WHERE name = v.object_path;
END;
$$;

-- Ownership transfer moves the workspace's files to the new owner's pool.
DO $$
BEGIN
  PERFORM public.storage_usage__reconcile();
  PERFORM probe.ok(probe.used('O') = 5750 AND probe.used('A') = 0, 'transfer: before');
  UPDATE public.workspaces SET owner_id = probe.id('A') WHERE id = probe.id('W');
  PERFORM probe.ok(probe.used('O') = 0 AND probe.used('A') = 5750, 'transfer: usage moves to the new owner');
  UPDATE public.workspaces SET owner_id = probe.id('O') WHERE id = probe.id('W');
  PERFORM probe.ok(probe.used('O') = 5750 AND probe.used('A') = 0, 'transfer: and back');
END;
$$;

-- ── 6. Alerts at 80% and 95% ─────────────────────────────────────────────────
DO $$
DECLARE
  gib constant bigint := 1073741824;
  mib constant bigint := 1048576;
  v public.attachments;
  n bigint;
BEGIN
  -- Start from no alerts (section 5's restore sent one).
  DELETE FROM public.module_activity WHERE op LIKE 'attachments.%';
  UPDATE public.storage_usage SET last_alert_level = 0 WHERE owner_id = probe.id('O');
  -- Free pool 2 GB: 80% = 1717986918.4 bytes. Sit just under it.
  UPDATE public.storage_usage SET bytes_used = (2 * gib * 0.8)::bigint - 5 * mib WHERE owner_id = probe.id('O');
  PERFORM probe.attach('A', 'T3 shared', 4 * mib);
  PERFORM probe.ok(probe.alerts(80) = 0, 'alerts: none under 80%');
  v := probe.attach('A', 'T3 shared', 2 * mib);
  PERFORM probe.ok(probe.alerts(80) = 1, 'alerts: crossing 80% writes one entry');
  PERFORM probe.ok((SELECT payload -> 'notify_user_ids' = jsonb_build_array(probe.id('O')::text)
                           AND actor_id = probe.id('A') AND entity_type = 'workspace'
                           AND (payload ->> 'level')::int = 80
                    FROM public.module_activity WHERE op = 'attachments.storage_80'),
                   'alerts: for the owner, attributed to whoever uploaded');
  PERFORM probe.attach('A', 'T3 shared', 1 * mib);
  PERFORM probe.ok(probe.alerts(80) = 1, 'alerts: not repeated while above 80%');

  -- The owner's bell has it; a member's doesn't.
  PERFORM probe.as_user('O');
  SELECT count(*) INTO n FROM public.notifications_list(probe.id('W')) WHERE op = 'attachments.storage_80';
  PERFORM probe.ok(n = 1, 'alerts: in the owner''s notifications');
  PERFORM probe.as_user('A');
  SELECT count(*) INTO n FROM public.notifications_list(probe.id('W')) WHERE op = 'attachments.storage_80';
  PERFORM probe.as_system();
  PERFORM probe.ok(n = 0, 'alerts: not in the uploader''s');

  UPDATE public.storage_usage SET bytes_used = (2 * gib * 0.95)::bigint - mib WHERE owner_id = probe.id('O');
  PERFORM probe.attach('A', 'T3 shared', 2 * mib);
  PERFORM probe.ok(probe.alerts(95) = 1 AND probe.alerts(80) = 1, 'alerts: crossing 95% writes one more');
  PERFORM probe.attach('A', 'T3 shared', 1 * mib);
  PERFORM probe.ok(probe.alerts(95) = 1, 'alerts: 95% not repeated');

  -- Deleting down under 75% re-arms both levels.
  UPDATE public.storage_usage SET bytes_used = (2 * gib * 0.75)::bigint + mib WHERE owner_id = probe.id('O');
  PERFORM probe.as_user('A');
  PERFORM public.attachments_op_delete(v.id);
  PERFORM probe.as_system();
  PERFORM probe.ok((SELECT last_alert_level FROM public.storage_usage WHERE owner_id = probe.id('O')) = 0,
                   'alerts: re-armed once usage is under 75%');
  UPDATE public.storage_usage SET bytes_used = (2 * gib * 0.8)::bigint - mib WHERE owner_id = probe.id('O');
  PERFORM probe.attach('A', 'T3 shared', 2 * mib);
  PERFORM probe.ok(probe.alerts(80) = 2, 'alerts: and fire again after re-arming');

  -- A jump straight past 95% sends the 95% one only.
  UPDATE public.storage_usage SET bytes_used = 0, last_alert_level = 0 WHERE owner_id = probe.id('O');
  UPDATE public.storage_usage SET bytes_used = (2 * gib * 0.95)::bigint WHERE owner_id = probe.id('O');
  PERFORM probe.attach('A', 'T3 shared', 1);
  PERFORM probe.ok(probe.alerts(95) = 2 AND probe.alerts(80) = 2, 'alerts: a jump past both sends 95% only');
  PERFORM public.storage_usage__reconcile();
END;
$$;

-- ── 7. storage_status ────────────────────────────────────────────────────────
DO $$
DECLARE
  s jsonb;
  e text;
BEGIN
  PERFORM probe.as_user('O');
  s := public.storage_status(probe.id('W'));
  PERFORM probe.ok(s ->> 'tier' = 'free' AND (s ->> 'is_owner')::boolean AND (s ->> 'owned_workspaces')::int = 1
               AND (s ->> 'total_bytes')::bigint = 2147483648 AND (s ->> 'used_bytes')::bigint = probe.used('O'),
                   'status: the owner sees the pool and how many workspaces share it');
  PERFORM probe.as_user('V');
  s := public.storage_status(probe.id('W'));
  PERFORM probe.as_system();
  PERFORM probe.ok(NOT (s ->> 'is_owner')::boolean AND s -> 'owned_workspaces' = 'null'::jsonb
               AND (s ->> 'per_file_bytes')::bigint = 20971520,
                   'status: a member sees the pool, not the owner''s workspace count');
  e := probe.try_as('N', format('SELECT public.storage_status(%L)', probe.id('W')));
  PERFORM probe.ok(e = 'workspace_not_found', 'status: an outsider gets nothing (' || e || ')');
END;
$$;

-- ── 8. Purge ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_exp public.attachments;
  v_recent public.attachments;
  v_pend public.attachments;
  v_orph public.attachments;
  v_ws public.attachments;
  v_restored public.attachments;
  c record;
  n integer;
BEGIN
  -- Trashed 31 days ago (expired), trashed yesterday (kept), an abandoned
  -- upload, a file whose task is gone, a file in a deleted workspace.
  v_exp := probe.attach('A', 'T3 shared', 10);
  v_recent := probe.attach('A', 'T3 shared', 11);
  v_restored := probe.attach('A', 'T3 shared', 12);
  PERFORM probe.as_user('A');
  PERFORM public.attachments_op_delete(v_exp.id);
  PERFORM public.attachments_op_delete(v_recent.id);
  PERFORM public.attachments_op_delete(v_restored.id);
  PERFORM probe.as_system();
  UPDATE public.attachments SET deleted_at = now() - interval '31 days' WHERE id IN (v_exp.id, v_restored.id);
  v_pend := probe.begin('A', 'T3 shared', 'abandoned.png', 13);
  UPDATE public.attachments SET created_at = now() - interval '25 hours' WHERE id = v_pend.id;
  PERFORM probe.new_task('TG gone', 'A', 'A', 'SB');
  v_orph := probe.attach('A', 'TG gone', 14);
  DELETE FROM public.tasks WHERE id = probe.id('TG gone');
  v_ws := probe.attach('N', 'TN Nell', 15, 'WN');

  UPDATE public.workspaces SET deleted_at = now() WHERE id = probe.id('WN');

  PERFORM probe.ok((SELECT count(*) FROM public.attachments__purge_candidates(500)
                    WHERE id IN (v_exp.id, v_pend.id, v_orph.id, v_ws.id, v_restored.id)) = 5
               AND NOT EXISTS (SELECT 1 FROM public.attachments__purge_candidates(500) WHERE id = v_recent.id),
                   'purge: expired, abandoned, orphaned and deleted-workspace files are candidates; recent trash isn''t');
  PERFORM probe.ok((SELECT string_agg(reason, ',' ORDER BY reason) FROM public.attachments__purge_candidates(500)
                    WHERE id IN (v_exp.id, v_pend.id, v_orph.id, v_ws.id))
                   = 'abandoned,expired,orphaned,workspace_deleted',
                   'purge: each candidate says why');
  PERFORM probe.ok((SELECT count(*) FROM public.attachments__purge_candidates(500) WHERE reason = 'failed') >= 2,
                   'purge: failed uploads are candidates');

  -- Restored between the listing and the delete: it stays.
  UPDATE public.attachments SET deleted_at = NULL, deleted_reason = NULL WHERE id = v_restored.id;
  n := public.attachments__purge_rows(ARRAY[v_exp.id, v_pend.id, v_orph.id, v_ws.id, v_restored.id, v_recent.id]);
  PERFORM probe.ok(n = 4 AND (probe.att(v_restored.id)).id IS NOT NULL AND (probe.att(v_recent.id)).id IS NOT NULL
               AND (probe.att(v_exp.id)).id IS NULL,
                   'purge: rows go only while still candidates (restored and recent stay)');
  PERFORM probe.ok(probe.used('N') = 0, 'purge: a deleted workspace''s files leave its owner''s pool');
  UPDATE public.workspaces SET deleted_at = NULL WHERE id = probe.id('WN');
END;
$$;

DO $$
BEGIN
  -- Stand-ins for objects whose rows went away (the guard refuses new ones).
  ALTER TABLE storage.objects DISABLE TRIGGER attachments_guard_object;
  INSERT INTO storage.objects (bucket_id, name, created_at, metadata) VALUES
    ('attachments', 'old/orphan/original.png', now() - interval '2 days', '{"size": 1}'),
    ('attachments', 'new/orphan/original.png', now(), '{"size": 1}');
  ALTER TABLE storage.objects ENABLE TRIGGER attachments_guard_object;
  PERFORM probe.ok((SELECT array_agg(name) FROM public.attachments__orphan_objects(500))
                   = ARRAY['old/orphan/original.png']
                   OR (SELECT bool_and(name <> 'new/orphan/original.png') AND bool_or(name = 'old/orphan/original.png')
                       FROM public.attachments__orphan_objects(500)),
                   'purge: objects no row names, older than a day, are orphans');
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.attachments__orphan_objects(500) o
                               JOIN public.attachments a ON a.object_path = o.name OR a.preview_path = o.name),
                   'purge: an object a row names is never an orphan');
END;
$$;

-- Tasks and buckets after 30 days.
DO $$
DECLARE
  v public.attachments;
  r jsonb;
  e text;
BEGIN
  PERFORM probe.new_task('P1 parent', 'A', 'A', 'SB2');
  PERFORM probe.new_task('P2 child', 'A', 'A', 'SB2');
  PERFORM probe.new_task('P3 blocker', 'A', 'A', 'SB');
  PERFORM probe.new_task('P4 with file', 'A', 'A', 'SB');
  PERFORM probe.new_task('P5 recent', 'A', 'A', 'SB');
  UPDATE public.tasks SET parent_id = probe.id('P1 parent') WHERE id = probe.id('P2 child');
  INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id)
  VALUES (probe.id('W'), probe.id('P3 blocker'), probe.id('P1 parent'));
  v := probe.attach('A', 'P4 with file', 20);
  PERFORM probe.as_user('A');
  UPDATE public.tasks SET deleted_at = now() WHERE id IN (probe.id('P1 parent'), probe.id('P4 with file'), probe.id('P5 recent'));
  PERFORM probe.as_system();
  -- Backdate (the server clock trigger would refuse it, as it should).
  ALTER TABLE public.tasks DISABLE TRIGGER trash_stamp_deleted_at;
  UPDATE public.tasks SET deleted_at = now() - interval '31 days'
  WHERE id IN (probe.id('P1 parent'), probe.id('P4 with file'));
  ALTER TABLE public.tasks ENABLE TRIGGER trash_stamp_deleted_at;
  UPDATE public.attachments SET deleted_at = now() - interval '31 days' WHERE id = v.id;

  PERFORM probe.ok((public.purge__preview() ->> 'tasks')::int >= 2, 'purge preview: counts without changing anything');
  PERFORM probe.ok((SELECT count(*) FROM public.tasks WHERE id = probe.id('P1 parent')) = 1, 'purge preview: nothing went');

  r := public.tasks__purge_expired(500);
  e := probe.try_as('A', format('UPDATE public.tasks SET deleted_at = NULL WHERE id = %L', probe.id('P4 with file')));
  PERFORM probe.ok(e = 'trash_expired', 'trash clock: a task trashed over 30 days ago can''t be restored (' || e || ')');
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = probe.id('P1 parent'))
               AND EXISTS (SELECT 1 FROM public.tasks WHERE id = probe.id('P4 with file'))
               AND EXISTS (SELECT 1 FROM public.tasks WHERE id = probe.id('P5 recent')),
                   'purge: a 30-day-old task goes; one whose file rows remain waits; a recent one stays');
  PERFORM probe.ok((SELECT parent_id FROM public.tasks WHERE id = probe.id('P2 child')) IS NULL,
                   'purge: a child of a purged parent stays, top-level');
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.task_relations WHERE blocked_task_id = probe.id('P1 parent'))
               AND NOT EXISTS (SELECT 1 FROM public.entity_links
                               WHERE deleted_at IS NULL AND (source_id = probe.id('P1 parent') OR target_id = probe.id('P1 parent'))),
                   'purge: its relations go and its links are tombstoned');
  PERFORM probe.ok(EXISTS (SELECT 1 FROM public.entities WHERE entity_id = probe.id('P1 parent') AND deleted_at IS NOT NULL),
                   'purge: its registry entry is tombstoned');

  PERFORM public.attachments__purge_rows(ARRAY[v.id]);
  r := public.tasks__purge_expired(500);
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = probe.id('P4 with file')),
                   'purge: once its file rows are gone the task goes too');

  -- Buckets: one empty, one a trashed task still points at, the system one.
  ALTER TABLE public.buckets DISABLE TRIGGER trash_stamp_deleted_at;
  UPDATE public.buckets SET deleted_at = now() - interval '31 days' WHERE id IN (probe.id('SB2'), probe.id('PB'));
  ALTER TABLE public.buckets ENABLE TRIGGER trash_stamp_deleted_at;
  UPDATE public.tasks SET bucket_id = probe.id('SB') WHERE bucket_id = probe.id('SB2');
  r := public.tasks__purge_expired(500);
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.buckets WHERE id = probe.id('SB2'))
               AND EXISTS (SELECT 1 FROM public.buckets WHERE id = probe.id('PB')),
                   'purge: an old empty bucket goes; one a task still points at waits');
  -- Put PB back for the next section (past 30 days a restore is refused).
  ALTER TABLE public.buckets DISABLE TRIGGER trash_stamp_deleted_at;
  UPDATE public.buckets SET deleted_at = NULL WHERE id = probe.id('PB');
  ALTER TABLE public.buckets ENABLE TRIGGER trash_stamp_deleted_at;
END;
$$;

-- ── 9. Account deletion ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_in_w public.attachments;
BEGIN
  v_in_w := probe.attach('X', 'T3 shared', 30);
  PERFORM probe.attach('N', 'TN Nell', 31, 'WN');
  -- Nell's account goes: her workspace and its rows cascade; Xavier's goes:
  -- his file in Olga's workspace stays, uploader cleared.
  DELETE FROM auth.users WHERE id IN (probe.id('N'), probe.id('X'));
  PERFORM probe.ok(NOT EXISTS (SELECT 1 FROM public.attachments WHERE workspace_id = probe.id('WN'))
               AND NOT EXISTS (SELECT 1 FROM public.storage_usage WHERE owner_id = probe.id('N')),
                   'account deletion: files of owned workspaces go with them (objects: the purge''s orphans)');
  PERFORM probe.ok((probe.att(v_in_w.id)).uploader_id IS NULL AND (probe.att(v_in_w.id)).status = 'ready',
                   'account deletion: a file in someone else''s workspace stays, uploader cleared');
END;
$$;

DO $$ BEGIN RAISE NOTICE 'PASS: all'; END $$;
