-- AT-1: run the purge-deleted Edge Function once a day, 04:23 UTC (an hour
-- after email-outbox-purge). pg_net sends the request; pg_cron keeps the time.
--
-- Its own migration because it starts deleting: apply it only after
--   1. 20261008210500_attachments_storage.sql is applied,
--   2. the function is deployed and the function secret PURGE_DELETED_SECRET and
--      the Vault secret `purge_deleted_secret` hold the same value,
--   3. a dry run (POST {"dry_run": true} with the header) returned the counts
--      you expect.
-- Without the Vault secret the header is empty and the function answers 401,
-- so nothing is deleted.
--
-- cron.schedule with an existing job name replaces that job, so re-running
-- this is safe.

SELECT cron.schedule(
  'purge-deleted',
  '23 4 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/purge-deleted',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-purge-deleted-secret',
      coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'purge_deleted_secret'), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
  $cron$
);
