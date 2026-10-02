-- TASK-4 (zod-enum-foundation): normalize data BEFORE any contract enforcement.
--
-- Ordered migration 1 of 2. Second file: 20260817130000 reassert grants+RLS+types.
-- Read-only + idempotent: every statement is safe to re-apply.
--
-- Live catalog facts (task-3 preflight probes, 2026-08-14/17):
--   - plan_tier enum labels: free | pro | team | founder   (SINGULAR — canonical is `founder`)
--   - profiles distinct values: pro × 4, team × 1 (no `founders` rows; no `free` rows)
--   - email_accounts.provider (live rows): custom
--   - calendar_accounts.provider (live rows): ics, moduo
--   - email/calendar status columns hold presente values within active|reauth_required|error (validated by task-3 fixture probes)
--
-- Legacy spellings mapped here (keep reading apps' compatibility in workspace-mappers.ts):
--   imap  → custom      (email_accounts.provider)
--   (No plan_tier normalization needed: enum already singular `founder`.)

DO $$
BEGIN
  -- 1. Email provider bridge: imap is the legacy spelling; canonical is custom.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'email_accounts' AND column_name = 'provider'
  ) THEN
    UPDATE public.email_accounts
       SET provider = 'custom'
     WHERE lower(btrim(provider)) = 'imap';
  END IF;

  -- 2. plan_tier: verify canonical live label remains the singular `founder`.
  --    Do not CREATE TYPE (pre-migration-era enum already exists live); do not
  --    destructively remove values. Only fail loudly if the catalog changed.
  IF to_regtype('public.plan_tier') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'plan_tier' AND e.enumlabel = 'founder'
    ) THEN
      RAISE EXCEPTION 'plan_tier enum no longer contains the canonical live label `founder` — reconcile live catalog before continuing';
    END IF;
  END IF;
END
$$;
