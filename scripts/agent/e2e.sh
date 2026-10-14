#!/usr/bin/env bash
# Run Playwright against the shared local Supabase stack, one run at a time on
# this Mac, through scripts/agent/quiet.sh (exit code, failures, short tail).
#
# Every spec signs in as the same seed person in the same workspace, so two
# worktrees running e2e at once read each other's rows. This takes a
# machine-wide lock first (an atomic `mkdir`: macOS has no flock) and waits its
# turn, printing who holds it. The run starts this worktree's own dev server on
# its own port (playwright.config.ts, scripts/agent/e2e-env.ts).
#
# Usage: scripts/agent/e2e.sh <playwright args…>
#   scripts/agent/e2e.sh tests/capture.spec.ts            # one spec
#   scripts/agent/e2e.sh tests/offline.spec.ts --repeat-each=5
#   scripts/agent/e2e.sh                                  # the whole e2e project
# Without --project it adds --project=e2e (perf and visual need their own setup).
# Waiting for a long run can outlast one tool call: run it in the background.
#
# Env: E2E_LOCK_TIMEOUT  seconds to wait for the lock (default 2700)
#      E2E_PORT          pin the dev-server port (default: derived from the path)
#      E2E_BASE_URL      test a server you started yourself (no server starts)
# See docs/agents/chat-v2-build.md ("The local stack") for why DOCKER_CONTEXT.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$here/../.." && pwd -P)"
cd "$root" || exit 2

LOCK="${TMPDIR:-/tmp}"; LOCK="${LOCK%/}/moduo-e2e.lock"
RECLAIM="$LOCK.reclaim"
TIMEOUT="${E2E_LOCK_TIMEOUT:-2700}"
POLL=2        # seconds between lock attempts
NOTICE=30     # seconds between "still waiting" lines
STALE_UNSET=10 # a lock dir with no pid file this long was abandoned mid-creation

say() { echo "e2e: $*"; }

# ---- the local stack: this must be reachable, and the app must point at it ----
if ! supabase status -o json >/dev/null 2>&1; then
  if [ -z "${DOCKER_CONTEXT:-}" ] && docker context ls --format '{{.Name}}' 2>/dev/null | grep -qx orbstack \
    && DOCKER_CONTEXT=orbstack supabase status -o json >/dev/null 2>&1; then
    export DOCKER_CONTEXT=orbstack # the stack runs under OrbStack; `default` is Docker Desktop
  else
    say "the local Supabase stack isn't reachable (supabase status failed). Don't run local:up; tell the orchestrator."
    exit 2
  fi
fi
if [ -z "${E2E_BASE_URL:-}" ] && [ "$(bun scripts/local/env.ts which 2>/dev/null)" != "local" ]; then
  say "this worktree's .env.local points at the cloud project. Run 'bun run env:local' first (DOCKER_CONTEXT=orbstack if it can't find the stack)."
  exit 2
fi

# ---- the machine-wide lock ----
now() { date +%s; }
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; } # 0 when it is gone
proc_start() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//'; }
nice_tree() { case "$1" in */worktrees/*) echo "${1#*/worktrees/}" ;; *) echo "$1" ;; esac; }

# 0 alive · 1 dead · 2 no pid file yet (being created, or abandoned)
holder_state() {
  local pid start
  pid="$(cat "$LOCK/pid" 2>/dev/null)"
  [ -n "$pid" ] || return 2
  start="$(cat "$LOCK/start" 2>/dev/null)"
  [ -n "$start" ] && [ "$(proc_start "$pid")" = "$start" ] && return 0
  return 1
}

reclaim_if_stale() {
  # Only one waiter at a time judges a lock, so nobody deletes a lock another
  # waiter just took after the old holder died.
  if ! mkdir "$RECLAIM" 2>/dev/null; then
    [ $(( $(now) - $(mtime "$RECLAIM") )) -gt 30 ] && rmdir "$RECLAIM" 2>/dev/null # its owner died mid-judgement
    return 1
  fi
  holder_state
  local st=$? born
  born="$(mtime "$LOCK")"
  if [ "$st" -eq 1 ] || { [ "$st" -eq 2 ] && [ "$born" -gt 0 ] && [ $(( $(now) - born )) -gt "$STALE_UNSET" ]; }; then
    say "removing a stale lock (held by $(nice_tree "$(cat "$LOCK/worktree" 2>/dev/null)"), its process is gone)"
    rm -rf "$LOCK"
  fi
  rmdir "$RECLAIM" 2>/dev/null
}

release() {
  if [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ]; then rm -rf "$LOCK"; fi
}

acquire() {
  local deadline=$(( $(now) + TIMEOUT )) next_notice=0 since holder
  while :; do
    if mkdir "$LOCK" 2>/dev/null; then
      # `pid` goes in last and is the "lock is complete" marker.
      proc_start "$$" >"$LOCK/start"
      printf '%s\n' "$root" >"$LOCK/worktree"
      printf '%s\n' "$*" | cut -c1-120 >"$LOCK/cmd"
      now >"$LOCK/since"
      printf '%s\n' "$$" >"$LOCK/pid.tmp" && mv "$LOCK/pid.tmp" "$LOCK/pid"
      return 0
    fi
    holder="$(cat "$LOCK/worktree" 2>/dev/null)"
    if [ -n "$holder" ] && [ "$(now)" -ge "$next_notice" ]; then
      since="$(cat "$LOCK/since" 2>/dev/null || now)"
      say "waiting for $(nice_tree "$holder")'s e2e run ($(cat "$LOCK/cmd" 2>/dev/null), running $(( ($(now) - since) / 60 ))m)"
      next_notice=$(( $(now) + NOTICE ))
    fi
    reclaim_if_stale
    if [ "$(now)" -ge "$deadline" ]; then
      say "gave up after ${TIMEOUT}s; the lock is still held (pid $(cat "$LOCK/pid" 2>/dev/null)). Run again, or raise E2E_LOCK_TIMEOUT."
      exit 75
    fi
    sleep "$POLL"
  done
}

kill_tree() {
  local p
  for p in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$p"; done
  kill -TERM "$1" 2>/dev/null
}

child=""
on_signal() { [ -n "$child" ] && kill_tree "$child"; release; exit "$1"; }
trap release EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM HUP

args=("$@")
has_project=0
for a in "$@"; do
  case "$a" in --project | --project=*) has_project=1 ;; esac
done
[ "$has_project" -eq 1 ] || args+=("--project=e2e")

acquire "$@"
say "lock taken ($(bun scripts/agent/e2e-env.ts 2>/dev/null | head -n 1 | sed 's/^/this worktree: /'))"
"$here/quiet.sh" e2e bunx playwright test "${args[@]}" &
child=$!
wait "$child"
code=$?
exit "$code"
