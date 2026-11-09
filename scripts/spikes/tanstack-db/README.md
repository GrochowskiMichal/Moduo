# Spike: TanStack DB as the Tasks store (throwaway)

A custom Supabase sync collection for `tasks` (Realtime first and buffered, keyset pages since a persisted watermark, newer-only live events, soft deletes) in SQLite persistence (OPFS + wa-sqlite), with edits through `@tanstack/offline-transactions` → `tasks_op_update`, plus live queries for a project view and search. Nothing in `apps/app/src` imports it. This folder is not a workspace; its packages install here.

    (cd scripts/spikes/tanstack-db && bun install)
    bun run local:up && bun run perf:seed
    MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --config scripts/spikes/tanstack-db/rsbuild.config.ts --host 127.0.0.1 --port 8395
    (cd apps/app && MODUO_TARGET=web ../../node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131)
    bun scripts/spikes/tanstack-db/measure.ts spike   # or: app

The verdict and the numbers are in the local notes (docs/local/spike-tanstack-db-tasks.md, gitignored).
