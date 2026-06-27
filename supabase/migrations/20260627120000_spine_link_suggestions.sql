-- Connective-tissue spine — block CT-6: deterministic auto-suggested links.
-- (specs/connective-tissue.md block 6, AC11; .design/connective-tissue/
-- DESIGN_BRIEF.md flow 4.)
--
-- The quiet "Link?" strip never invents a relationship from a model — every
-- suggestion rests on a DETERMINISTIC signal computed here, server-side. This
-- migration adds the read that gathers candidates (`links_suggest`) and the op
-- that remembers a "no" (`links_op_decline_suggestion`). The SCORING, ranking,
-- max-one-at-rest pick, and accept-input shaping live in TS
-- (src/features/spine/suggest.ts) — the unit-tested half (Assumption 10). There
-- is NO auto-apply path: accepting calls the existing `links_op_create` with
-- origin='suggest'; nothing is linked without a tap (AC11).
--
-- Signals that have real tables TODAY:
--   * shared-tag    — focus + candidate share >=1 tag (public.tag_links).
--   * address-match — a contact's email domain matches a company's `domains`
--                     (contact<->company), suggesting a 'works-at' link.
-- A third signal, time-window, is applied ONLY as a score booster (near_in_time)
-- on a candidate a real signal already surfaced — a pure time coincidence is
-- never a standalone suggestion (anti-theater; spine BRIEF Q4).
--
-- Deferred-but-recorded: the email-message `email_refs.from_addr` <-> contact /
-- company flavor of address-match needs `email_refs`, a Wave 1/2 desktop->Supabase
-- sync prerequisite (data-layers §6) that does NOT exist yet. A LANGUAGE sql
-- function validates its table refs at CREATE time, so referencing the missing
-- table would break this migration; that signal slots into `links_suggest` when
-- `email_refs` lands. Its absence does not block the spine (Assumption 7).

-- ── links.suggest (read) ─────────────────────────────────────────────────────
-- Deterministic candidate links for a focus entity. SECURITY INVOKER: runs as
-- the caller, so the member-SELECT RLS already on every joined table scopes the
-- read to workspaces the user can see — no privilege escalation, no cross-
-- workspace leak. Excludes: self, any already-live link for the unordered pair
-- (direction-agnostic via spine_pair_key), and any pair the user already
-- declined. Ordering is a cheap pre-rank; the authoritative ranking is in TS.
CREATE OR REPLACE FUNCTION public.links_suggest(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  target_type      text,
  target_id        uuid,
  label            text,
  icon             text,
  suggested_kind   text,
  shared_tag_count int,
  address_match    boolean,
  near_in_time     boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH focus AS (
    SELECT e.created_at
    FROM public.entities e
    WHERE e.workspace_id = p_workspace_id
      AND e.entity_type = p_entity_type
      AND e.entity_id = p_entity_id
  ),
  focus_tags AS (
    SELECT tl.tag_id
    FROM public.tag_links tl
    WHERE tl.workspace_id = p_workspace_id
      AND tl.entity_type = p_entity_type
      AND tl.entity_id = p_entity_id
  ),
  -- Signal 1: shared tags (count drives the score, capped client-side).
  tag_candidates AS (
    SELECT tl.entity_type AS target_type,
           tl.entity_id   AS target_id,
           count(DISTINCT tl.tag_id)::int AS shared_tag_count
    FROM public.tag_links tl
    JOIN focus_tags ft ON ft.tag_id = tl.tag_id
    WHERE tl.workspace_id = p_workspace_id
      AND NOT (tl.entity_type = p_entity_type AND tl.entity_id = p_entity_id)
    GROUP BY tl.entity_type, tl.entity_id
  ),
  -- Signal 2a: focus is a contact -> companies sharing its email domain.
  contact_domain AS (
    SELECT lower(split_part(c.email, '@', 2)) AS domain
    FROM public.contacts c
    WHERE p_entity_type = 'contact'
      AND c.id = p_entity_id
      AND c.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND c.email IS NOT NULL
      AND position('@' IN c.email) > 0
  ),
  address_from_contact AS (
    SELECT 'company'::text AS target_type, co.id AS target_id
    FROM public.companies co, contact_domain cd
    WHERE co.workspace_id = p_workspace_id
      AND co.deleted_at IS NULL
      AND cd.domain <> ''
      AND EXISTS (SELECT 1 FROM unnest(co.domains) AS d WHERE lower(d) = cd.domain)
  ),
  -- Signal 2b: focus is a company -> contacts whose email domain it owns.
  company_domains AS (
    SELECT array(SELECT lower(d) FROM unnest(co.domains) AS d) AS domains
    FROM public.companies co
    WHERE p_entity_type = 'company'
      AND co.id = p_entity_id
      AND co.workspace_id = p_workspace_id
      AND co.deleted_at IS NULL
  ),
  address_from_company AS (
    SELECT 'contact'::text AS target_type, c.id AS target_id
    FROM public.contacts c, company_domains cmd
    WHERE c.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND c.email IS NOT NULL
      AND position('@' IN c.email) > 0
      AND lower(split_part(c.email, '@', 2)) = ANY (cmd.domains)
  ),
  address_candidates AS (
    -- Source relations aliased so these projections stay table-qualified — the
    -- out-param names `target_type`/`target_id` would otherwise shadow a bare
    -- column ref under LANGUAGE sql (the notifications_list ambiguity trap;
    -- docs/gotchas.md).
    SELECT afc.target_type, afc.target_id FROM address_from_contact afc
    UNION
    SELECT afco.target_type, afco.target_id FROM address_from_company afco
  ),
  -- Candidate keys from each signal, unioned (kept table-qualified per above).
  candidate_keys AS (
    SELECT tc.target_type, tc.target_id FROM tag_candidates tc
    UNION
    SELECT ac.target_type, ac.target_id FROM address_candidates ac
  )
  SELECT
    e.entity_type AS target_type,
    e.entity_id   AS target_id,
    e.label,
    e.icon,
    CASE WHEN ac.target_id IS NOT NULL THEN 'works-at' ELSE 'references' END AS suggested_kind,
    coalesce(tc.shared_tag_count, 0) AS shared_tag_count,
    (ac.target_id IS NOT NULL) AS address_match,
    EXISTS (
      SELECT 1 FROM focus f
      WHERE e.created_at BETWEEN f.created_at - interval '24 hours'
                            AND f.created_at + interval '24 hours'
    ) AS near_in_time
  FROM candidate_keys ck
  JOIN public.entities e
    ON  e.workspace_id = p_workspace_id
    AND e.entity_type  = ck.target_type
    AND e.entity_id    = ck.target_id
    AND e.deleted_at IS NULL
  LEFT JOIN tag_candidates tc
    ON tc.target_type = ck.target_type AND tc.target_id = ck.target_id
  LEFT JOIN address_candidates ac
    ON ac.target_type = ck.target_type AND ac.target_id = ck.target_id
  WHERE
    NOT (ck.target_type = p_entity_type AND ck.target_id = p_entity_id)  -- never self
    AND NOT EXISTS (  -- not already linked (any live kind), direction-agnostic
      SELECT 1 FROM public.entity_links el
      WHERE el.workspace_id = p_workspace_id
        AND el.deleted_at IS NULL
        AND el.pair_key = public.spine_pair_key(p_entity_type, p_entity_id,
                                                ck.target_type, ck.target_id)
    )
    AND NOT EXISTS (  -- not already declined ("remember my no")
      SELECT 1 FROM public.link_suggestion_declines lsd
      WHERE lsd.workspace_id = p_workspace_id
        AND lsd.pair_key = public.spine_pair_key(p_entity_type, p_entity_id,
                                                 ck.target_type, ck.target_id)
    )
  ORDER BY coalesce(tc.shared_tag_count, 0) DESC,
           (ac.target_id IS NOT NULL) DESC,
           e.label ASC
  LIMIT coalesce(p_limit, 20);
$$;

-- ── links.decline_suggestion (op) ────────────────────────────────────────────
-- "Remember my no." Records a direction-agnostic decline so the pair is never
-- re-offered (AC11). Idempotent. Guarded by the shared spine permission gate
-- (a viewer cannot write declines). Intentionally writes NO module_activity
-- row: a decline is a personal preference, not a shared workspace event — AC4
-- enumerates link/comment/notification mutations, and a suppression is neither.
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
  v_pair_key := public.spine_pair_key(p_source_type, p_source_id, p_target_type, p_target_id);
  INSERT INTO public.link_suggestion_declines (workspace_id, pair_key, declined_by)
  VALUES (p_workspace_id, v_pair_key, auth.uid())
  ON CONFLICT (workspace_id, pair_key) DO NOTHING;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon/authenticated, so
-- REVOKE FROM PUBLIC alone leaves a function anon-executable — revoke anon
-- explicitly (the lesson of 20260612151000_intent_ops_revoke_anon.sql). The read
-- is also granted to service_role for the future MCP `links.suggest` surface
-- (block CT-7); the decline op stays member-only at alpha.
REVOKE ALL ON FUNCTION public.links_suggest(uuid, text, uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.links_suggest(uuid, text, uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.links_suggest(uuid, text, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.links_suggest(uuid, text, uuid, int) TO service_role;

REVOKE ALL ON FUNCTION public.links_op_decline_suggestion(uuid, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.links_op_decline_suggestion(uuid, text, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.links_op_decline_suggestion(uuid, text, uuid, text, uuid) TO authenticated;
