#!/usr/bin/env bash
# Local Supabase stack for Moduo: Postgres, Auth, Storage, Realtime, Edge
# Functions and Mailpit on this machine, in Docker. See docs/local-dev.md.
#
#   bun run local:up        start the stack; bootstrap the DB the first time
#   bun run local:reset     wipe the local DB and rebuild it from the snapshot
#   bun run local:snapshot  refresh the schema snapshot from prod (read-only)
#   bun run local:down      stop the stack (data kept)
#   bun run local:status    URLs and keys
#
# Why not `supabase db reset`: the repo cannot rebuild the DB from
# supabase/migrations (22 prod tables have no migration; see
# docs/gotchas/supabase.md). Until a baseline migration lands, the local DB is
# built from a schema-only snapshot of prod (no rows) kept outside the repo in
# ~/.cache/moduo/supabase-snapshot (shared by every worktree), then any repo migration newer than the snapshot is applied
# on top so you can test your own migration before it goes anywhere.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SNAP="${MODUO_SNAPSHOT_DIR:-$HOME/.cache/moduo/supabase-snapshot}"  # shared by all worktrees; never committed
PROD_REF="wtoonrvuqumihpkbvwvs"
DB_URL="postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres"
PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -X)

need() { command -v "$1" >/dev/null || { echo "✗ $1 is missing. $2" >&2; exit 1; }; }
need docker "Install OrbStack: brew install --cask orbstack, then open it once."
need supabase "brew install supabase/tap/supabase"
need psql "brew install libpq && brew link --force libpq"
docker info >/dev/null 2>&1 || { open -ga OrbStack 2>/dev/null || true; sleep 5; docker info >/dev/null 2>&1 || { echo "✗ Docker is not running. Open OrbStack." >&2; exit 1; }; }

snapshot() {
  mkdir -p "$SNAP"
  echo "→ Dumping prod schema (structure only, no rows) into $SNAP/ …"
  supabase link --project-ref "$PROD_REF" >/dev/null
  supabase db dump --linked --schema public,private,stripe -f "$SNAP/public.sql"
  supabase db dump --linked --schema storage -f "$SNAP/storage.sql"
  supabase db dump --linked --schema auth -f "$SNAP/auth.sql"
  date -u +%Y%m%d%H%M%S > "$SNAP/snapshot-at"
  echo "✓ Snapshot taken at $(cat "$SNAP/snapshot-at") UTC"
}

bootstrap() {
  [[ -f "$SNAP/public.sql" ]] || snapshot
  echo "→ Loading the schema snapshot …"
  "${PSQL[@]}" <<'SQL'
create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists pgcrypto with schema extensions;
SQL
  "${PSQL[@]}" -f "$SNAP/public.sql"
  # Storage tables/functions already exist locally; take only prod's policies.
  awk '/^CREATE POLICY/{p=1} p{print} p&&/;[[:space:]]*$/{p=0}' "$SNAP/storage.sql" | "${PSQL[@]}"
  # Same for auth: only prod's triggers on auth.* (signup → profile, …).
  grep -E '^CREATE (OR REPLACE )?TRIGGER' "$SNAP/auth.sql" | "${PSQL[@]}"
  # Repo migrations newer than the snapshot = work not on prod yet.
  local at; at="$(cat "$SNAP/snapshot-at" 2>/dev/null || echo 0)"
  for f in supabase/migrations/*.sql; do
    local v; v="$(basename "$f" | cut -d_ -f1)"
    if [[ "$v" > "$at" ]]; then echo "  + $f"; "${PSQL[@]}" -f "$f"; fi
  done
  "${PSQL[@]}" -f supabase/seed.sql
  "${PSQL[@]}" -c "create table if not exists public._local_bootstrapped(at timestamptz default now()); insert into public._local_bootstrapped default values;"
  echo "✓ Local DB ready. Sign in as dev@moduo.local / localdev (Mailpit: http://127.0.0.1:54324)."
}

bootstrapped() { "${PSQL[@]}" -tAc "select to_regclass('public._local_bootstrapped') is not null" 2>/dev/null | grep -q t; }

case "${1:-up}" in
  up)
    supabase start
    bootstrapped || bootstrap
    bun scripts/local/env.ts local
    ;;
  reset)
    supabase stop --no-backup
    supabase start
    bootstrap
    bun scripts/local/env.ts local
    ;;
  snapshot) snapshot ;;
  down) supabase stop ;;
  status) supabase status ;;
  functions)
    [[ -f supabase/functions/.env ]] || cp supabase/functions/.env.example supabase/functions/.env
    supabase functions serve --env-file supabase/functions/.env --import-map supabase/functions/deno.json
    ;;
  *) echo "usage: stack.sh up|reset|snapshot|down|status|functions" >&2; exit 2 ;;
esac
