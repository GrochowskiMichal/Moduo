-- TASK-4 (zod-enum-foundation): stable-domain CHECK contracts + RPC grants/RLS reassertion.
--
-- Ordered migration 2 of 2, runs after 20260817120000_domain_contracts_normalize.sql.
-- Idempotent: every constraint uses NOT VALID + VALIDATE so live MTV rows are never
-- touched destructively, and every grant reasserts the established posture.
--
-- Canonical vocabularies (mirrors supabase/functions/_shared/contracts/vocabularies.ts):
--   workspace_members.role              owner | admin | member | viewer
--   workspace_members.permissions_notes read | write | none
--   workspace_members.permissions_tasks read | write | none
--   email_accounts.provider             gmail | outlook | icloud | custom  (imap bridged in normalize task)
--   email_accounts.status               active | reauth_required | error
--   calendar_accounts.provider          google | microsoft | caldav | ics | moduo
--   calendar_accounts.status            ok | error
--   profiles.plan_tier                  already a native enum: free | pro | team | founder (live-verified 2026-08-14)
--
-- Deploy notes: NOT VALID adds instantly (no table scan); VALIDATE scans once and is
-- a no-op on already-valid constraints, so a re-run of this file is safe.

DO $$
BEGIN
  -- ── workspace_members role/permissions ──────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workspace_members' AND column_name='role')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_role_contract') THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_role_contract
      CHECK (role IN ('owner','admin','member','viewer')) NOT VALID;
  END IF;
  ALTER TABLE public.workspace_members VALIDATE CONSTRAINT workspace_members_role_contract;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workspace_members' AND column_name='permissions_notes')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_permissions_notes_contract') THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_permissions_notes_contract
      CHECK (permissions_notes IN ('read','write','none')) NOT VALID;
  END IF;
  ALTER TABLE public.workspace_members VALIDATE CONSTRAINT workspace_members_permissions_notes_contract;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workspace_members' AND column_name='permissions_tasks')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_permissions_tasks_contract') THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_permissions_tasks_contract
      CHECK (permissions_tasks IN ('read','write','none')) NOT VALID;
  END IF;
  ALTER TABLE public.workspace_members VALIDATE CONSTRAINT workspace_members_permissions_tasks_contract;

  -- ── email_accounts ──────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_accounts' AND column_name='provider')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_accounts_provider_contract') THEN
    ALTER TABLE public.email_accounts
      ADD CONSTRAINT email_accounts_provider_contract
      CHECK (provider IN ('gmail','outlook','icloud','custom')) NOT VALID;
  END IF;
  ALTER TABLE public.email_accounts VALIDATE CONSTRAINT email_accounts_provider_contract;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_accounts' AND column_name='status')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_accounts_status_contract') THEN
    ALTER TABLE public.email_accounts
      ADD CONSTRAINT email_accounts_status_contract
      CHECK (status IN ('active','reauth_required','error')) NOT VALID;
  END IF;
  ALTER TABLE public.email_accounts VALIDATE CONSTRAINT email_accounts_status_contract;

  -- ── calendar_accounts ───────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calendar_accounts' AND column_name='provider')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_accounts_provider_contract') THEN
    ALTER TABLE public.calendar_accounts
      ADD CONSTRAINT calendar_accounts_provider_contract
      CHECK (provider IN ('google','microsoft','caldav','ics','moduo')) NOT VALID;
  END IF;
  ALTER TABLE public.calendar_accounts VALIDATE CONSTRAINT calendar_accounts_provider_contract;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calendar_accounts' AND column_name='status')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_accounts_status_contract') THEN
    ALTER TABLE public.calendar_accounts
      ADD CONSTRAINT calendar_accounts_status_contract
      CHECK (status IN ('ok','error')) NOT VALID;
  END IF;
  ALTER TABLE public.calendar_accounts VALIDATE CONSTRAINT calendar_accounts_status_contract;
END
$$;

-- ── RPC grants/RLS posture stays intact ────────────────────────────────────────
-- Re-assert the established grants on user-facing ops. CREATE OR REPLACE FUNCTION
-- is not possible here without the full body, so grants are re-stated explicitly;
-- REVOKEs keep anon/PUBLIC locked out (Supabase grants EXECUTE to PUBLIC by default).
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'workspace_op_remove_member(uuid)',
    'workspace_op_set_member_role(uuid, text, text, text)',
    'workspace_op_transfer_ownership(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END
$$;
