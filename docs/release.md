# Release runbook

How a change gets from `develop` to prod: database, Edge Functions, web, desktop, then a check of what is live. Why it works this way: [decisions/workflow.md](./decisions/workflow.md) (2026-10-17, 2026-10-14, 2026-10-09). Traps: [gotchas/supabase.md](./gotchas/supabase.md), [gotchas/build-ci.md](./gotchas/build-ci.md).

Every prod database or function action asks a human first (`guard-prod-db.sh`). Record each release in [specs/BUILD_LOG.md](../specs/BUILD_LOG.md) (the Chat v2 release record is the model).

## 1. When a train runs

Blocks land on the personal branch, then sync to `develop` in batches. Prod ships as a **train**, on the first of: two syncs on `develop`, two weeks, or a fix a real user is blocked by (that one goes alone, the same day).

**Risky trains ship small.** Anything touching billing, auth, account deletion, RLS/policies or `moduo-mcp` (Tier 2) is its own small train, never bundled into a large one.

## 2. Database migrations

Prod's migration history does not match the repo folder (files renamed after applying, some applied in the SQL editor), so **never `supabase db push` from the repo folder**, and don't use MCP `apply_migration` (it stamps the apply time, not the file version).

Before either path:

- Test on the local stack (`bun run local:reset`).
- **Check prod's real function bodies first.** A migration that `CREATE OR REPLACE`s a function must start from prod's `pg_get_functiondef`, not from this branch's newest file, or it silently drops another branch's change. Restate grants by name.
- Stamp files in the order they will be applied.

**Many files (a train): a scratch-folder push.**

1. Make a scratch folder with `supabase/migrations/` holding only the release files, plus one empty placeholder file per version prod already has.
2. Dry run: `supabase db push --include-all --skip-vault --dry-run`. It must list only the release files.
3. Push: `supabase db push --include-all --skip-vault`. Always `--skip-vault`: without it the CLI writes `config.toml`'s Vault secrets to prod.

**One or two files: a direct query, in one transaction.**

```sql
BEGIN;
-- the migration file's contents
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('<version>', '<name>', ARRAY[]::text[]);
COMMIT;
```

Run it with `supabase db query --linked -f <file>`, so the history row carries the file's version.

**After either path, verify:** `schema_migrations` has the new versions; catalog checks for what the migration adds (`pg_proc` signatures and argument counts, `pg_constraint`, `pg_policies`, grants via `has_function_privilege`); and the release's own read-only checks of the data it converts.

## 3. Edge Functions

Deploy each changed function with `supabase functions deploy <name>`, in dependency order (a function a migration queues work for goes first; see the Chat v2 record).

A **shared function such as `moduo-mcp` deploys from a merge of `maciej` + `mike`** (every branch that has deployed it), or one person's tools disappear. When a migration and a function depend on each other, follow the order the block's record names (NR-8: `moduo-mcp` before or with the web release).

## 4. Web

`develop` is mirrored to `staging-app` once `checks` passes on the push (`sync-staging-app.yml`). To ship, run **Promote to production** (`promote-to-prod.yml`, manual):

- target `app`: `staging-app` → `prod-app` (app.moduo.app);
- target `landing`: `staging-landing` → `prod-landing` (moduo.app).

Vercel deploys on the push.

## 5. Desktop

The desktop app bundles its own copy of the UI at build time, so a web change reaches desktop users only when a desktop build ships. Run it on every train that changes the app, after the promote.

- **Desktop Release (production)** (`desktop-release-prod.yml`, manual) builds from `prod-app`: the signed Mac universal `.dmg` and the Windows NSIS installer. It publishes them, with `latest.json` for the in-app updater, to the rolling `prod-latest` release in the separate repo **GrochowskiMichal/moduo-releases**.
- **Notarization:** `build-mac` waits up to 20 minutes for Apple and staples. `notarize-mac` runs only when Apple was slower; "skipped" is normal when `build-mac`'s log says the staple worked (the 2026-10-16 run). A skipped `notarize-mac` with no staple in `build-mac` is a problem.
- **Not the source of truth:** the main repo's own `prod-latest` release (last published 2026-10-05) is stale; don't judge what's live from it.
- **Bump `VERSION` first.** Production ships the `VERSION` file as is (staging adds `-rc.<run>`), and the updater only installs a higher version, so a production run on an unchanged `VERSION` fails in its `version` job before any build starts. Bump it on `develop` and promote, then run the release. After a run has published, use **Re-run failed jobs**, not "Re-run all jobs": a full re-run asks for the same version again and the check refuses it.

## 6. Verify what's live

- **Web:** the commit is an ancestor of `origin/prod-app` (`git merge-base --is-ancestor <sha> origin/prod-app`), and a string new in this release appears in the live JS bundle on app.moduo.app.
- **Database:** `select version, name from supabase_migrations.schema_migrations order by version desc limit 20;`
- **Functions:** `supabase functions list` (version and updated time per function); call one new tool through the connector.
- **Desktop:** `gh release download prod-latest -R GrochowskiMichal/moduo-releases -p latest.json -O -`. Its `version` and "production build from commit …" note name the build.
