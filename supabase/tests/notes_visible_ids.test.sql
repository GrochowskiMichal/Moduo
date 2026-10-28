-- GS-2: notes__visible_ids(ws, actor) is the set form of
-- can_access('note', id, 'view', actor) (specs/global-search.md Assumption 6,
-- AC3, AC4). Search filters on it before its limit, so it must agree with the
-- per-row rule on every note, for every person.
--
-- A property test: three workspaces, each a random tree of 90 notes (roots,
-- inherit children, custom children, a few trashed), random grants (a member
-- at freebusy, view, edit or full; the whole workspace at view or edit) and
-- four people plus an outsider:
--   O  the owner
--   A  a member
--   V  a viewer
--   N  a member whose role lost notes.view (the module ceiling)
--   X  someone outside the workspace (a grant to them still shows nothing)

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'V', 'N', 'X']) AS n;

DO $$
DECLARE
  v_round int;
  v_ws uuid;
  v_ids uuid[];
  v_people text[] := ARRAY['O', 'A', 'V', 'N', 'X'];
  v_authors text[] := ARRAY['O', 'A', 'V', 'N'];
  v_who text;
  v_parent uuid;
  v_id uuid;
  v_mismatch int;
  v_seen int;
  v_level text;
BEGIN
  FOR v_round IN 1..3 LOOP
    PERFORM setseed(0.1 * v_round);
    v_ws := test.id('W' || v_round);
    INSERT INTO public.workspaces (id, owner_id, name) VALUES (v_ws, test.id('O'), 'Search round ' || v_round);
    INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
      (v_ws, test.id('A'), 'member'), (v_ws, test.id('V'), 'viewer'), (v_ws, test.id('N'), 'member');

    v_ids := ARRAY[]::uuid[];
    FOR i IN 1..90 LOOP
      v_id := test.id('W' || v_round || ':n' || i);
      v_parent := CASE WHEN i > 1 AND random() < 0.7
                       THEN v_ids[1 + floor(random() * array_length(v_ids, 1))::int] END;
      INSERT INTO public.notes (id, workspace_id, created_by, title, parent_id)
      VALUES (v_id, v_ws, test.id(v_authors[1 + floor(random() * 4)::int]), 'Note ' || i, v_parent);
      -- share_note_before makes every child inherit; some go their own way.
      IF v_parent IS NOT NULL AND random() < 0.25 THEN
        UPDATE public.notes SET share_mode = 'custom' WHERE id = v_id;
      END IF;
      IF random() < 0.08 THEN
        UPDATE public.notes SET deleted_at = now() WHERE id = v_id;
      END IF;
      v_ids := v_ids || v_id;
    END LOOP;

    -- Grants from scratch: the workspace grant share_note_after added is random too.
    DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = ANY (v_ids);
    FOREACH v_id IN ARRAY v_ids LOOP
      IF random() < 0.3 THEN
        INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
        VALUES (v_ws, 'note', v_id, 'workspace', NULL, CASE WHEN random() < 0.5 THEN 'view' ELSE 'edit' END, test.id('O'));
      END IF;
      FOREACH v_who IN ARRAY v_people LOOP
        IF random() < 0.15 THEN
          v_level := (ARRAY['freebusy', 'view', 'edit', 'full'])[1 + floor(random() * 4)::int];
          INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
          VALUES (v_ws, 'note', v_id, 'member', test.id(v_who), v_level, test.id('O'));
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

-- N's role loses notes.view in every round (the trigger would put it back).
SET LOCAL session_replication_role = replica;
UPDATE public.workspace_members
   SET perms = ARRAY(SELECT p FROM unnest(perms) p WHERE p NOT LIKE 'notes.%')
 WHERE user_id = test.id('N') AND workspace_id IN (test.id('W1'), test.id('W2'), test.id('W3'));
SET LOCAL session_replication_role = origin;

DO $$
DECLARE
  v_round int;
  v_ws uuid;
  v_who text;
  v_mismatch int;
  v_seen int;
  v_total int;
BEGIN
  FOR v_round IN 1..3 LOOP
    v_ws := test.id('W' || v_round);
    SELECT count(*) INTO v_total FROM public.notes WHERE workspace_id = v_ws;
    FOREACH v_who IN ARRAY ARRAY['O', 'A', 'V', 'N', 'X'] LOOP
      SELECT count(*) FILTER (WHERE (n.id = ANY (vis.ids)) IS DISTINCT FROM
                                    public.can_access('note', n.id, 'view', test.id(v_who))),
             count(*) FILTER (WHERE n.id = ANY (vis.ids))
        INTO v_mismatch, v_seen
        FROM public.notes n
        CROSS JOIN (SELECT public.notes__visible_ids(v_ws, test.id(v_who)) AS ids) vis
       WHERE n.workspace_id = v_ws;
      PERFORM test.ok(v_mismatch = 0,
        format('round %s, %s: the visible set equals can_access on every note (%s of %s seen)',
               v_round, v_who, v_seen, v_total),
        v_mismatch || ' notes disagree');
      IF v_who = 'A' THEN
        PERFORM test.ok(v_seen > 0 AND v_seen < v_total,
          format('round %s: a member sees some notes and not others, so the check means something', v_round),
          v_seen || ' of ' || v_total);
      ELSIF v_who IN ('N', 'X') THEN
        PERFORM test.ok(v_seen = 0,
          format('round %s, %s: no notes ceiling or no membership sees nothing, grants or not', v_round, v_who),
          v_seen::text);
      END IF;
    END LOOP;

    PERFORM test.ok(
      (SELECT count(*) FROM unnest(public.notes__visible_ids(v_ws, test.id('A'))) i
        JOIN public.notes n ON n.id = i WHERE n.workspace_id <> v_ws) = 0,
      format('round %s: only this workspace''s notes are in the set', v_round));
  END LOOP;

  -- Inherited sharing, both ways, spelled out once beside the random trees.
  PERFORM test.ok(coalesce(cardinality(public.notes__visible_ids(test.id('W1'), NULL)), 0) = 0,
    'no actor, no notes');
END;
$$;

-- A hand-built chain: R (shared with A) > C1 (inherit) > C2 (inherit) > C3 (custom, private),
-- and P (private) > Q (inherit).
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WH'), test.id('O'), 'Hand-built');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('WH'), test.id('A'), 'member');
INSERT INTO public.notes (id, workspace_id, created_by, title, parent_id) VALUES
  (test.id('R'), test.id('WH'), test.id('O'), 'Root', NULL),
  (test.id('P'), test.id('WH'), test.id('O'), 'Private', NULL);
INSERT INTO public.notes (id, workspace_id, created_by, title, parent_id) VALUES
  (test.id('C1'), test.id('WH'), test.id('O'), 'Child', test.id('R')),
  (test.id('Q'), test.id('WH'), test.id('O'), 'Under private', test.id('P'));
INSERT INTO public.notes (id, workspace_id, created_by, title, parent_id) VALUES
  (test.id('C2'), test.id('WH'), test.id('O'), 'Grandchild', test.id('C1'));
INSERT INTO public.notes (id, workspace_id, created_by, title, parent_id) VALUES
  (test.id('C3'), test.id('WH'), test.id('O'), 'Own way', test.id('C2'));
UPDATE public.notes SET share_mode = 'custom' WHERE id = test.id('C3');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('R'), test.id('P'), test.id('C1'), test.id('C2'), test.id('C3'), test.id('Q'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('WH'), 'note', test.id('R'), 'member', test.id('A'), 'view', test.id('O'));

DO $$
DECLARE
  v uuid[] := public.notes__visible_ids(test.id('WH'), test.id('A'));
BEGIN
  PERFORM test.ok(test.id('R') = ANY (v) AND test.id('C1') = ANY (v) AND test.id('C2') = ANY (v),
    'notes that inherit from a shared root are visible, two levels down');
  PERFORM test.ok(NOT (test.id('C3') = ANY (v)),
    'a child with its own (private) sharing is not');
  PERFORM test.ok(NOT (test.id('P') = ANY (v)) AND NOT (test.id('Q') = ANY (v)),
    'a note inheriting from a parent you can''t see is not visible either');
  PERFORM test.ok(cardinality(public.notes__visible_ids(test.id('WH'), test.id('O'))) = 6,
    'the creator sees the whole tree');
END;
$$;

-- Server-only: it takes the actor as an argument.
SELECT test.ok(NOT has_function_privilege('anon', 'public.notes__visible_ids(uuid, uuid)', 'EXECUTE')
           AND NOT has_function_privilege('authenticated', 'public.notes__visible_ids(uuid, uuid)', 'EXECUTE')
           AND has_function_privilege('service_role', 'public.notes__visible_ids(uuid, uuid)', 'EXECUTE'),
  'notes__visible_ids is server-only (service_role, never anon or authenticated)');
