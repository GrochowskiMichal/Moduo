-- Drop four columns nothing reads or writes.
--
-- - `profiles.local_user_id`, `recovery_seed_hash`, `cloud_linked`: from the May
--   plan to bind a desktop install to a cloud account with a BIP-39 recovery seed
--   (docs/web+desktop_plan.md). It was never built. No app, desktop or Edge
--   Function code has ever written them; only the generated types and a column
--   grant (20261006120000) name them. The open TX-9a branch re-states that grant
--   (its 20261015173736 file): trim it to display_name/avatar_url before it lands,
--   or it fails on these missing columns.
-- - `user_integrations.zoom_account_id`: never written. The Zoom connect flow
--   stores its tokens in other columns and lists the ones it writes.
--
-- Probed on prod 2026-10-23 before writing this: every row holds NULL (or
-- `cloud_linked` false). No function body, policy, view, index, constraint or
-- cron job references them. Dropping a column also drops its column grants.
-- `email_subscriptions.confirmed_at` / `unsubscribed_at` stay: TX-10's
-- build-updates confirm and unsubscribe write them. Re-runnable.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS local_user_id,
  DROP COLUMN IF EXISTS recovery_seed_hash,
  DROP COLUMN IF EXISTS cloud_linked;
ALTER TABLE public.user_integrations DROP COLUMN IF EXISTS zoom_account_id;
