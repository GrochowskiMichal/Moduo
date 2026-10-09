-- DB-SP-1 · Pin search_path on the 12 functions the security advisor flags
-- (function_search_path_mutable, lint 0011).
--
-- None of these is SECURITY DEFINER and none can be shadowed in practice
-- (they only call pg_catalog built-ins, which Postgres searches first), so
-- this is hygiene, not a hole. It clears the advisor so a genuinely new
-- finding stands out.
--
-- Probed on prod 2026-10-09: all 12 have proconfig = NULL.
--
--   public (ours, 9): pure IMMUTABLE SQL helpers plus one trigger. None
--     references a table or another function by an unqualified name, so the
--     strictest setting, search_path = '', is safe.
--   stripe (Stripe Sync Engine's, 3): set_updated_at, set_updated_at_metadata
--     and check_rate_limit. check_rate_limit qualifies "stripe"."_rate_limits"
--     everywhere except the ON CONFLICT row alias, which names the INSERT
--     target and needs no lookup. The engine recreates these functions with
--     CREATE OR REPLACE on an upgrade, which drops this setting; if the
--     advisor re-flags them after one, re-run the stripe half of this file.
--
-- ALTER FUNCTION … SET only edits proconfig: the body, volatility, owner and
-- grants stay as they are (unlike DROP + CREATE, see supabase/AGENTS.md). An
-- IMMUTABLE SQL function carrying a SET clause can no longer be inlined by
-- the planner; every caller here passes values, not columns in a hot scan.
--
-- Each signature goes through to_regprocedure, so a database without the
-- stripe schema (the repo cannot bootstrap one yet) skips it instead of
-- failing. The lock timeout makes a blocked apply fail fast.

set local lock_timeout = '5s';

do $$
declare
  v_sig text;
  v_oid regprocedure;
begin
  foreach v_sig in array array[
    'public.plan_tier_rank(text)',
    'public.spine_pair_key(text, uuid, text, uuid)',
    'public.contacts__emails_to_jsonb(text[], text)',
    'public.contacts__primary_value(jsonb)',
    'public.grant_level_rank(text)',
    'public.share_note_before()',
    'public.attachments__bytes(text, timestamp with time zone, bigint, bigint)',
    'public.attachments__platform_file_cap()',
    'public.attachments__preview_cap()',
    'stripe.set_updated_at()',
    'stripe.set_updated_at_metadata()',
    'stripe.check_rate_limit(text, integer, integer)'
  ]
  loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise notice 'skipped %: not present', v_sig;
    else
      execute format('alter function %s set search_path = ''''', v_oid);
    end if;
  end loop;
end
$$;
