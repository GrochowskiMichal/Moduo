# OPS-3 · Baseline migration (PROPOSAL, needs Maciej + Mike)

**Status:** proposed 2026-10-09. Nothing is built. Touches `supabase/migrations/`, which is Tier 2, so both of us agree before any code.

## Problem

`supabase db reset` cannot build the database from the repo: 22 of prod's tables and 10 of its functions are created by no migration file ([OPS-2 inventory](../docs/reviews/ops-2-schema-reconciliation.md)). The local stack works around it by loading a schema-only snapshot of prod ([docs/local-dev.md](../docs/local-dev.md)). That works, but:

- every machine needs prod access (a logged-in Supabase CLI) to get started;
- CI can't run SQL tests, and a broken migration is found only on prod or locally;
- Supabase preview branches (a throwaway DB per PR) are impossible without a resettable repo.

## Proposal

1. **Freeze point:** on a release-train day, with every repo migration applied to prod and no migration PR open.
2. **Capture:** `supabase db dump --linked --schema public,private,stripe` plus prod's storage policies and `auth.users` triggers (exactly what `scripts/local/stack.sh` loads today), saved as `supabase/migrations/<stamp>_baseline.sql`. `<stamp>` is that day's timestamp, so it sorts after every existing file.
3. **Archive:** move the existing 90+ files to `supabase/migrations_archive/` (kept for history and `entire why`; never applied). The baseline becomes the first file.
4. **Mark prod:** insert the baseline's version into prod's `supabase_migrations.schema_migrations` so prod treats it as already applied. This is one metadata row, no schema change.
5. **Switch the tooling:** turn `[db.migrations]` and `[db.seed]` back on in `config.toml`; `bun run local:reset` becomes plain `supabase db reset`; the snapshot step is deleted.
6. **Guard:** a test in `bun run verify` that fails if a migration sorts before the baseline, and a CI job that runs `supabase db reset` on PRs touching `supabase/`.

## Decisions for us

- **Q1. Who runs the freeze?** Recommendation: whoever runs the next release train, with the other one aware.
- **Q2. Also enable Supabase preview branches per PR?** Recommendation: not yet. It costs money per branch-hour on Pro; local reset covers us.
- **Q3. Keep the archive in the repo, or delete it?** Recommendation: keep it. It is cheap, and `entire why` and the old decision links point into it.

## Risk

Low for prod: step 4 writes one metadata row; no DDL runs on prod. The real risk is a baseline that drifts from prod (e.g. a hand change on prod between dump and commit). The freeze point and an `bun run db:reconcile` run right after capture cover it.

## Size

One `/s2` block, about 2 hours, plus Mike's review.
