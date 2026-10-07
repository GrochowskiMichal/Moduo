-- founders_interest is server-only: the admin issue-founder-coupon Edge Function writes it
-- with the service-role key, which bypasses RLS. RLS is on with no policies, so PostgREST
-- already denied every client read and write, but anon and authenticated still held every
-- table privilege, including TRUNCATE, which RLS does not gate (docs/gotchas.md).
--
-- Applied to prod 2026-10-07 as version 20261007000830. The table has no CREATE in this repo
-- (dashboard migration 20260512101202_founders_interest_table).
revoke all on table public.founders_interest from public, anon, authenticated;
