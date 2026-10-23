#!/usr/bin/env bash
# Local Supabase stack for Moduo: Postgres, Auth, Storage, Realtime, Edge
# Functions and Mailpit on this machine, in Docker. See docs/local-dev.md.
#
#   bun run local:up        start the stack; bootstrap the DB the first time
#   bun run local:reset     wipe the local DB and rebuild it from the snapshot
#                           (shared by every session: needs MODUO_SHARED_STACK_OK=1)
#   bun run local:snapshot  refresh the schema snapshot from prod (read-only)
#   bun run local:down      stop the stack (data kept; needs MODUO_SHARED_STACK_OK=1)
#   bun run local:status    URLs and keys
#   stack.sh ci             GitHub Actions only (checks.yml db-test): a throwaway
#                           stack in the runner, built from the cached snapshot
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
need jq "brew install jq"
docker info >/dev/null 2>&1 || { open -ga OrbStack 2>/dev/null || true; sleep 5; docker info >/dev/null 2>&1 || { echo "✗ Docker is not running. Open OrbStack." >&2; exit 1; }; }

snapshot() {
  # Into a fresh folder, swapped in only when every file is there: a dump that
  # fails half-way must not leave new files next to an old snapshot-at.
  local tmp="$SNAP.new"
  rm -rf "$tmp"; mkdir -p "$tmp"
  echo "→ Dumping prod schema (structure only, no rows) into $SNAP/ …"
  supabase link --project-ref "$PROD_REF" >/dev/null
  supabase db dump --linked --schema public,private,stripe -f "$tmp/public.sql"
  supabase db dump --linked --schema storage -f "$tmp/storage.sql"
  supabase db dump --linked --schema auth -f "$tmp/auth.sql"
  supabase db dump --linked --schema realtime -f "$tmp/realtime.sql"
  # What a schema dump leaves out, read from prod's catalog (read-only): the
  # extensions; the migration versions prod has applied, so bootstrap replays
  # exactly the others; the API roles' settings (PostgREST's db_pre_request);
  # the storage buckets; Realtime publication membership; the pg_cron jobs.
  prod_rows "select format('create schema if not exists %1\$I; create extension if not exists %2\$I with schema %1\$I;', extnamespace::regnamespace, extname) as sql from pg_extension where extnamespace <> 'pg_catalog'::regnamespace order by extname" > "$tmp/extensions.sql"
  prod_rows "select version || ' ' || coalesce(name, '') as sql from supabase_migrations.schema_migrations order by 1" > "$tmp/applied-migrations"
  prod_rows "select format('alter role %I set %s = %L;', rolname, split_part(cfg, '=', 1), substr(cfg, strpos(cfg, '=') + 1)) as sql from pg_roles, unnest(rolconfig) cfg where rolname in ('authenticator', 'anon', 'authenticated', 'service_role') and cfg not like 'session_preload_libraries=%' order by 1" > "$tmp/roles.sql"
  prod_rows "select format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %L, %L, %L) on conflict (id) do nothing;', id, name, public, file_size_limit, allowed_mime_types) as sql from storage.buckets order by id" > "$tmp/buckets.sql"
  prod_rows "select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename) as sql from pg_publication_tables where pubname = 'supabase_realtime' order by 1" > "$tmp/publication.sql"
  prod_rows "select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command) as sql from cron.job order by jobname" > "$tmp/cron.sql"
  date -u +%Y%m%d%H%M%S > "$tmp/snapshot-at"
  rm -rf "$SNAP.old"; [[ -d "$SNAP" ]] && mv "$SNAP" "$SNAP.old"
  mv "$tmp" "$SNAP"; rm -rf "$SNAP.old"
  echo "✓ Snapshot taken at $(cat "$SNAP/snapshot-at") UTC"
}

# One SQL statement per row of a read-only query on prod; no rows is an empty file, a failed
# query fails the snapshot. The CLI prints a bare array of rows, or wraps it in
# {"rows": …} when it detects an AI agent (a Claude session), so take either.
prod_rows() {
  local out; out="$(supabase db query --linked --output-format json "$1")"
  jq -r 'if type == "array" then .[] else .rows[]? end | .sql' <<< "$out"
}

bootstrap() {
  [[ -f "$SNAP/public.sql" ]] || snapshot
  echo "→ Loading the schema snapshot …"
  "${PSQL[@]}" <<'SQL'
create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists pgcrypto with schema extensions;
SQL
  [[ -f "$SNAP/extensions.sql" ]] && "${PSQL[@]}" -f "$SNAP/extensions.sql"
  # The dump writes every grant relative to Postgres's built-in default (owner
  # and PUBLIC), but Supabase's default privileges here would add anon,
  # authenticated and service_role to every object it creates, so ~570
  # functions prod keeps from anon became callable by it (chat_privacy.test.sql
  # "never anon"). Lift those defaults while the dump loads; its explicit
  # grants then match prod, and its own ALTER DEFAULT PRIVILEGES lines at the
  # end put the defaults back for the migrations that follow. The dump loads as
  # supabase_admin, whose own defaults would leak the same way (its grants move
  # to postgres with each ALTER … OWNER TO), so lift those too and restore them
  # after the load: anon kept INSERT, UPDATE and DELETE on workspaces and
  # ~25 db:test files failed on a fresh stack (HV-4).
  "${PSQL[@]}" <<'SQL'
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role;
SQL
  "${PSQL[@]}" -f "$SNAP/public.sql"
  "${PSQL[@]}" <<'SQL'
alter default privileges for role supabase_admin in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
SQL
  # Storage tables/functions already exist locally; take only prod's policies.
  awk '/^CREATE POLICY/{p=1} p{print} p&&/;[[:space:]]*$/{p=0}' "$SNAP/storage.sql" | "${PSQL[@]}"
  # Same for auth: only prod's triggers on auth.* (signup → profile, …).
  grep -E '^CREATE (OR REPLACE )?TRIGGER' "$SNAP/auth.sql" | "${PSQL[@]}"
  realtime_policies
  for f in roles.sql buckets.sql publication.sql; do
    [[ -f "$SNAP/$f" ]] && "${PSQL[@]}" -f "$SNAP/$f"
  done
  # Prod's cron jobs, switched off: tests read their schedules, and nothing
  # here should run them (or call prod's functions on a timer).
  # One transaction, so the scheduler never sees a job switched on.
  if [[ -f "$SNAP/cron.sql" ]]; then
    "${PSQL[@]}" -1 -f "$SNAP/cron.sql" -c "update cron.job set active = false" >/dev/null
  fi
  # Repo migrations prod hasn't applied = work not on prod yet. Prod recorded
  # some files under another version than their name (create_tasks_module), so
  # a file counts as applied when its version or its name is in prod's list.
  # Three files older than 2026-10-10 went in by hand under other names
  # (contacts_v2 as contacts_v2_schema + _ops, …); every file before that is on
  # prod in some form, so those are never replayed. A
  # snapshot without applied-migrations (taken before HV-4) falls back to
  # "newer than the snapshot", which misses a file applied after the dump
  # under an older version.
  local at; at="$(cat "$SNAP/snapshot-at" 2>/dev/null || echo 0)"
  for f in supabase/migrations/*.sql; do
    local v n; v="$(basename "$f" | cut -d_ -f1)"; n="$(basename "$f" .sql | cut -d_ -f2-)"
    if [[ -f "$SNAP/applied-migrations" ]]; then
      [[ "$v" < 20261010000000 ]] && continue
      awk -v v="$v" -v n="$n" '$1 == v || $2 == n { hit = 1 } END { exit !hit }' "$SNAP/applied-migrations" && continue
    else
      [[ "$v" > "$at" ]] || continue
    fi
    echo "  + $f"; "${PSQL[@]}" -f "$f"
  done
  "${PSQL[@]}" -f supabase/seed.sql
  "${PSQL[@]}" -c "create table if not exists public._local_bootstrapped(at timestamptz default now()); insert into public._local_bootstrapped default values;"
  echo "✓ Local DB ready. Sign in as dev@moduo.local / localdev (Mailpit: http://127.0.0.1:54324)."
}

# Prod's policies on realtime.messages (who may read and write chat and notes
# channels): the chat ones come from migrations older than any snapshot, so a
# snapshot without them leaves Realtime closed and chat_privacy.test.sql
# failing. A snapshot from before realtime.sql existed fetches just that file.
# Each policy is dropped first: a migration newer than the snapshot may
# create one the dump already has.
realtime_policies() {
  if [[ ! -f "$SNAP/realtime.sql" ]]; then
    supabase link --project-ref "$PROD_REF" >/dev/null
    supabase db dump --linked --schema realtime -f "$SNAP/realtime.sql"
  fi
  awk '/^CREATE POLICY/{p=1} p{print} p&&/;[[:space:]]*$/{p=0}' "$SNAP/realtime.sql" \
    | sed -E 's/^CREATE POLICY ("[^"]+") ON ([^ ]+)/DROP POLICY IF EXISTS \1 ON \2; CREATE POLICY \1 ON \2/' \
    | "${PSQL[@]}"
}

bootstrapped() { "${PSQL[@]}" -tAc "select to_regclass('public._local_bootstrapped') is not null" 2>/dev/null | grep -q t; }

# The stack is shared: every worktree, Claude session and dev server on this
# Mac uses the same database. Wiping it (reset) or stopping it (down) breaks
# their test data and running servers, so both ask for an explicit go-ahead.
shared_stack_guard() {
  [[ "${MODUO_SHARED_STACK_OK:-}" == "1" ]] && return 0
  local servers; servers="$({ pgrep -f 'rsbuild dev' 2>/dev/null || true; } | wc -l | tr -d ' ')"
  cat >&2 <<MSG
✗ Refusing to $2 the local Supabase stack: it is shared by every session and
  agent on this Mac (dev servers running now: ${servers}). $3
  - To test a migration, apply it on top instead, without wiping anything:
      psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -1 -f <file>
  - Only when the user has confirmed no other session needs the stack:
      MODUO_SHARED_STACK_OK=1 bun run local:$1
MSG
  exit 1
}

case "${1:-up}" in
  up)
    supabase start
    # An existing stack gets prod's realtime policies too (idempotent).
    if bootstrapped; then realtime_policies; else bootstrap; fi
    bun scripts/local/env.ts local
    ;;
  reset)
    shared_stack_guard reset wipe "A reset wipes every row and every migration other sessions applied."
    supabase stop --no-backup
    supabase start
    bootstrap
    bun scripts/local/env.ts local
    ;;
  snapshot) snapshot ;;
  down)
    shared_stack_guard down stop "Stopping it breaks other sessions' running dev servers and tests (data is kept)."
    supabase stop
    ;;
  status) supabase status ;;
  ci)
    # checks.yml's db-test job: start only what the SQL tests read (Postgres,
    # plus Auth, Storage and Realtime, whose services create their schemas),
    # then build the DB like a reset does. The snapshot comes from the
    # db-snapshot workflow's cache (MODUO_SNAPSHOT_DIR); without it this fails
    # instead of dumping prod. It refuses anything but a fresh runner, so it can
    # never load the snapshot over this Mac's shared stack.
    [[ "${GITHUB_ACTIONS:-}" == "true" ]] || { echo "✗ stack.sh ci runs only in GitHub Actions." >&2; exit 1; }
    for f in public.sql auth.sql storage.sql realtime.sql extensions.sql roles.sql buckets.sql publication.sql cron.sql applied-migrations snapshot-at; do
      [[ -f "$SNAP/$f" ]] || { echo "✗ $SNAP/$f is missing: run the db-snapshot workflow (Actions → db-snapshot → Run workflow)." >&2; exit 1; }
    done
    supabase start --workdir "$ROOT" \
      -x imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
    if bootstrapped; then echo "✗ $DB_URL is already bootstrapped: not a fresh runner." >&2; exit 1; fi
    bootstrap
    ;;
  functions)
    [[ -f supabase/functions/.env ]] || cp supabase/functions/.env.example supabase/functions/.env
    supabase functions serve --env-file supabase/functions/.env --import-map supabase/functions/deno.json
    ;;
  *) echo "usage: stack.sh up|reset|snapshot|down|status|functions|ci" >&2; exit 2 ;;
esac
