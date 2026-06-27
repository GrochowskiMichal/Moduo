-- Connective-tissue spine — block CT-6: deterministic auto-suggested links.
-- (specs/connective-tissue.md block 6, AC11; .design/connective-tissue/DESIGN_BRIEF.md flow 4.)
--
-- "Load-bearing, not text-match theater" (spine BRIEF Q4): suggestions come from
-- DETERMINISTIC, non-ML signals only, computed server-side, and are NEVER
-- auto-applied — they surface a one-tap strip. This migration adds:
--   * links_suggest(...)               — the read: ranked candidate facts for a
--                                        focus entity, already excluding self /
--                                        already-linked / previously-declined.
--   * links_op_decline_suggestion(...) — "remember my no": records a decline so a
--                                        pair is never re-offered.
-- Accepting a suggestion is just `links_op_create(..., origin => 'suggest')`
-- (CT-1) — no new accept op. The `link_suggestion_declines` table + the
-- `spine_pair_key` / `spine_op__guard` helpers were created in CT-1.
--
-- Signals at alpha (each a real affinity, weighted client-side in suggest.ts):
--   1. shared-tag    — two entities share >=1 `tag_links` tag (strength = count).
--   2. email-domain  — a contact's email domain matches a company's `domains[]`
--                      (→ a `works-at` link). This is AC11's "address-match" at
--                      alpha; the `email_refs.from_addr`↔contact variant lands
--                      with email sync (Wave 5).
--   3. time-window   — co-activity within ±30min in `module_activity` (the
--                      weakest signal; weighted lowest; cut post-alpha if its
--                      real-data precision can't beat coin-flip — BRIEF Q4).
--
-- Permission: suggesting is gated at edit+ (via spine_op__guard) — the strip is a
-- link gesture, and a viewer can't accept, so a viewer is shown nothing. Callers
-- degrade gracefully (try/catch → no strip) so a failed read never breaks a hub.

-- The time-window self-join's ±window neighbour scan is already served by the
-- existing `module_activity_workspace_idx (workspace_id, created_at DESC)` from
-- 20260612150000 — a btree scans either direction, so no new index is needed.

-- ── links.suggest (read) ─────────────────────────────────────────────────────
-- Returns RAW per-signal candidate rows (one row per (other entity, signal)).
-- The pure-TS `scoreSuggestions` aggregates + weights + ranks them. Out-params
-- are uniquely named (other_*, signal, suggested_kind, strength) and every body
-- reference is table-qualified, so the RETURNS TABLE ambiguity trap can't bite.
CREATE OR REPLACE FUNCTION public.links_suggest(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  other_type     text,
  other_id       uuid,
  other_label    text,
  other_icon     text,
  signal         text,
  suggested_kind text,
  strength       int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only editors get suggestions (the strip is a link gesture; accept needs edit).
  PERFORM public.spine_op__guard(p_workspace_id);

  RETURN QUERY
  WITH
  -- Signal 1: shared tags — strength = number of tags shared with the focus.
  shared_tag AS (
    SELECT
      tl2.entity_type       AS other_type,
      tl2.entity_id         AS other_id,
      'shared-tag'::text    AS signal,
      'references'::text    AS suggested_kind,
      count(*)::int         AS strength
    FROM public.tag_links tl1
    JOIN public.tag_links tl2
      ON tl2.workspace_id = tl1.workspace_id
     AND tl2.tag_id = tl1.tag_id
     AND NOT (tl2.entity_type = tl1.entity_type AND tl2.entity_id = tl1.entity_id)
    WHERE tl1.workspace_id = p_workspace_id
      AND tl1.entity_type = p_entity_type
      AND tl1.entity_id = p_entity_id
    GROUP BY tl2.entity_type, tl2.entity_id
  ),
  -- Signal 2: email-domain match between a contact and a company (→ works-at).
  email_domain AS (
    -- focus is a contact → companies whose domains[] include its email domain
    SELECT
      'company'::text       AS other_type,
      co.id                 AS other_id,
      'email-domain'::text  AS signal,
      'works-at'::text      AS suggested_kind,
      1::int                AS strength
    FROM public.contacts c
    CROSS JOIN LATERAL unnest(c.emails) AS ce(addr)
    JOIN public.companies co
      ON co.workspace_id = c.workspace_id
     AND co.deleted_at IS NULL
     AND lower(split_part(ce.addr, '@', 2)) = ANY (SELECT lower(d) FROM unnest(co.domains) AS d)
    WHERE p_entity_type = 'contact'
      AND c.workspace_id = p_workspace_id
      AND c.id = p_entity_id
      AND c.deleted_at IS NULL
      AND position('@' IN ce.addr) > 0
    GROUP BY co.id

    UNION

    -- focus is a company → contacts whose email domain is in its domains[]
    SELECT
      'contact'::text       AS other_type,
      c.id                  AS other_id,
      'email-domain'::text  AS signal,
      'works-at'::text      AS suggested_kind,
      1::int                AS strength
    FROM public.companies co
    JOIN public.contacts c
      ON c.workspace_id = co.workspace_id
     AND c.deleted_at IS NULL
    CROSS JOIN LATERAL unnest(c.emails) AS ce(addr)
    WHERE p_entity_type = 'company'
      AND co.workspace_id = p_workspace_id
      AND co.id = p_entity_id
      AND co.deleted_at IS NULL
      AND position('@' IN ce.addr) > 0
      AND lower(split_part(ce.addr, '@', 2)) = ANY (SELECT lower(d) FROM unnest(co.domains) AS d)
    GROUP BY c.id
  ),
  -- Signal 3: ±30-minute co-activity in the workspace's activity trail.
  time_window AS (
    SELECT
      ma2.entity_type       AS other_type,
      ma2.entity_id         AS other_id,
      'time-window'::text   AS signal,
      'references'::text    AS suggested_kind,
      1::int                AS strength
    FROM public.module_activity ma1
    JOIN public.module_activity ma2
      ON ma2.workspace_id = ma1.workspace_id
     AND NOT (ma2.entity_type = ma1.entity_type AND ma2.entity_id = ma1.entity_id)
     AND ma2.created_at BETWEEN ma1.created_at - interval '30 minutes'
                            AND ma1.created_at + interval '30 minutes'
    WHERE ma1.workspace_id = p_workspace_id
      AND ma1.entity_type = p_entity_type
      AND ma1.entity_id = p_entity_id
      AND ma1.created_at > now() - interval '30 days'
    GROUP BY ma2.entity_type, ma2.entity_id
  ),
  candidates AS (
    SELECT * FROM shared_tag
    UNION ALL SELECT * FROM email_domain
    UNION ALL SELECT * FROM time_window
  )
  SELECT
    cand.other_type,
    cand.other_id,
    e.label  AS other_label,
    e.icon   AS other_icon,
    cand.signal,
    cand.suggested_kind,
    cand.strength
  FROM candidates cand
  -- Only real, live registry entities are suggestable (gives label + icon, and
  -- excludes tombstoned targets — AC11 / the edge-case matrix).
  JOIN public.entities e
    ON e.workspace_id = p_workspace_id
   AND e.entity_type = cand.other_type
   AND e.entity_id = cand.other_id
   AND e.deleted_at IS NULL
  -- Never suggest a pair that already has a live link (any direction, any kind).
  WHERE NOT EXISTS (
          SELECT 1 FROM public.entity_links el
          WHERE el.workspace_id = p_workspace_id
            AND el.deleted_at IS NULL
            AND el.pair_key = public.spine_pair_key(p_entity_type, p_entity_id, cand.other_type, cand.other_id)
        )
    -- Never re-offer a declined pair (direction-agnostic).
    AND NOT EXISTS (
          SELECT 1 FROM public.link_suggestion_declines d
          WHERE d.workspace_id = p_workspace_id
            AND d.pair_key = public.spine_pair_key(p_entity_type, p_entity_id, cand.other_type, cand.other_id)
        )
  ORDER BY cand.strength DESC, e.label
  LIMIT coalesce(p_limit, 25);
END;
$$;

-- ── links.decline_suggestion ─────────────────────────────────────────────────
-- "Remember my no": records a decline so the pair is never suggested again.
-- Idempotent (the decline table's unique (workspace, pair_key) makes a repeat a
-- no-op). Direction-agnostic via spine_pair_key. A decline is a private
-- suppression — it is deliberately NOT logged to module_activity (a "no" is not
-- a workspace event and must never read as a notification).
CREATE OR REPLACE FUNCTION public.links_op_decline_suggestion(
  p_workspace_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_target_type text,
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pair_key text;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);

  IF p_source_type = p_target_type AND p_source_id = p_target_id THEN
    RAISE EXCEPTION 'A suggestion cannot be a self-pair.';
  END IF;

  v_pair_key := public.spine_pair_key(p_source_type, p_source_id, p_target_type, p_target_id);

  INSERT INTO public.link_suggestion_declines (workspace_id, pair_key, declined_by)
  VALUES (p_workspace_id, v_pair_key, auth.uid())
  ON CONFLICT (workspace_id, pair_key) DO NOTHING;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
-- Signed-in users only; anon explicitly revoked (Supabase's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE to anon on new functions, so REVOKE FROM PUBLIC
-- alone is not enough — the lesson of 20260612151000_intent_ops_revoke_anon.sql).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'links_suggest(uuid, text, uuid, integer)',
    'links_op_decline_suggestion(uuid, text, uuid, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;
