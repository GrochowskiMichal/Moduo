---
paths: ["supabase/migrations/**"]
incident: "A CREATE TABLE IF NOT EXISTS for calendar_events would have no-op'd over a dashboard-era table and left every new column missing (CAL-2); a re-run backfill would have pushed filed notes back into the Inbox (NR-1)"
expires: 2027-01-31
---

# Migrations: legacy tables, enums, backfills

Compiled from the UI and notes gotchas (HV-14b); the main rule is `.claude/rules/supabase.md`.

- Some tables predate migrations (`calendar_events`, `dashboard_layouts` were made in the dashboard): grep the generated types (`apps/app/src/lib/runtime.db.ts` and the types it imports) before writing `CREATE TABLE IF NOT EXISTS`, and extend an existing table in place (dashboard-era policy names are unknown: drop them through a `pg_policies` loop).
- `ALTER TYPE … ADD VALUE` must commit before anything uses the value: give it its own migration ahead of the one that references it.
- A backfill must not re-run: put a column add and its backfill (or a table and its seed) in a first-run-only `DO` block keyed on the column or table not existing yet.
- A soft-delete that cascades to links stamps them with its own `deleted_at`, and its restore revives only links with that stamp (`contacts_op_restore`); re-adding every link would resurrect ones removed earlier on purpose.
