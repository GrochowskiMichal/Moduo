/**
 * Edge Function: purge-deleted (AT-1, specs/attachments.md §6; shared with TV-U6)
 *
 * The daily trash purge: attachments trashed more than 30 days ago (and
 * abandoned or failed uploads, files of deleted workspaces, orphaned objects),
 * then tasks and buckets trashed more than 30 days ago, then a recount of every
 * storage pool. The work is in ../_shared/purge-deleted.ts.
 *
 * Called by pg_cron (migration 20261008210600_purge_deleted_schedule.sql) with
 * the header `x-purge-deleted-secret`, read from Vault (`purge_deleted_secret`)
 * and compared here with the function secret PURGE_DELETED_SECRET. No user JWT:
 * deploy with --no-verify-jwt.
 *
 *   POST {}                 → 200 { dryRun: false, attachments, objects, orphanObjects, tasks, buckets, poolsRecounted }
 *   POST { "dry_run": true } → 200 { dryRun: true, preview: { attachments, orphan_objects, tasks, buckets } }
 *   401 wrong secret · 503 secret not configured · 500 { error, step, partial }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { PurgeError, purgeDeleted, secretMatches } from "../_shared/purge-deleted.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("PURGE_DELETED_SECRET") ?? "";
  if (!expected) return json({ error: "PURGE_DELETED_SECRET is not set" }, 503);
  if (!secretMatches(req.headers.get("x-purge-deleted-secret") ?? "", expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dry_run === true;
  } catch {
    // An empty body is a normal run.
  }

  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", getDefaultSecretKey(), {
    auth: { persistSession: false },
  });

  try {
    const result = await purgeDeleted(db, { dryRun });
    console.log(JSON.stringify({ purge: result }));
    return json(result);
  } catch (err) {
    if (err instanceof PurgeError) {
      console.error(JSON.stringify({ purge_failed: err.step, message: err.message, partial: err.partial }));
      return json({ error: err.message, step: err.step, partial: err.partial }, 500);
    }
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
