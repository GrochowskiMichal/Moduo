#!/usr/bin/env bash
# Tests for session-start.sh (HV-1, AC1): the base check, never the old reading list, the main-checkout
# warning only in the main checkout, and the bypass warning only outside the lane sandbox.
#   bash .claude/hooks/session-start.test.sh   (also run by scripts/agent/hooks.test.ts)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/session-start.sh"
fails=0
unset MODUO_LANE_SANDBOX MODUO_ALLOW_BYPASS
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
g() { git -C "$1" -c user.email=t@t -c user.name=t "${@:2}"; }

# A remote with mike, a main checkout two commits behind it, and a worktree on a task branch.
git init -q --bare "$tmp/origin.git"
git init -q "$tmp/main" && main=$(cd "$tmp/main" && pwd -P)
g "$main" commit -q --allow-empty -m one
g "$main" remote add origin "$tmp/origin.git"
g "$main" checkout -q -b mike
g "$main" commit -q --allow-empty -m two && g "$main" commit -q --allow-empty -m three
g "$main" push -q origin mike
g "$main" reset -q --hard HEAD~2
g "$main" fetch -q origin
g "$main" worktree add -q "$main/.claude/worktrees/wt" -b t/mike/wt origin/mike
wt="$main/.claude/worktrees/wt"

run() { jq -n --arg d "$1" --arg m "$2" '{cwd: $d, permission_mode: $m}' | bash "$hook" 2>&1; }
check() { # check <has|lacks> <text> <output> <label>
  local hit=1
  printf '%s' "$3" | grep -qF -- "$2" && hit=0
  if { [ "$1" = has ] && [ "$hit" = 0 ]; } || { [ "$1" = lacks ] && [ "$hit" = 1 ]; }; then echo "ok   $4"; else
    echo "FAIL $4 ($1 '$2')"; fails=$((fails + 1)); fi
}

out=$(run "$main" auto)
check has "STALE BASE" "$out" 'main checkout behind mike: base check'
check has "2 commit(s) behind origin/mike" "$out" 'behind count'
check has "MAIN CHECKOUT" "$out" 'warns in the main checkout'
check lacks "Before building, read" "$out" 'no reading list (main)'
check lacks "docs/decisions.md" "$out" 'no decisions index in the list'
check lacks "BYPASS" "$out" 'no bypass warning in auto mode'

out=$(run "$wt" auto)
check has "Base current with origin/mike" "$out" 'worktree current with mike'
check lacks "MAIN CHECKOUT" "$out" 'no main-checkout warning in a worktree'
check lacks "Before building, read" "$out" 'no reading list (worktree)'

out=$(run "$wt" bypassPermissions)
check has "BYPASS OUTSIDE THE SANDBOX" "$out" 'bypass outside the sandbox warns'
out=$(MODUO_LANE_SANDBOX=1 run "$wt" bypassPermissions)
check lacks "BYPASS" "$out" 'bypass inside the sandbox is quiet'

code=$(jq -n --arg d "$wt" '{cwd: $d}' | bash "$hook" >/dev/null 2>&1; echo $?)
check has 0 "$code" 'always exits 0'

if [ "$fails" = 0 ]; then echo "session-start: all passed"; else echo "session-start: $fails failed"; exit 1; fi
