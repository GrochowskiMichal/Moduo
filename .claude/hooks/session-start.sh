#!/usr/bin/env bash
# Claude Code SessionStart hook — Moduo preflight.
# stdout is injected into the session's context. ALWAYS non-blocking: it only
# ever prints and exits 0, so it can never prevent a session from starting.
# Its job: make the stale-base failure mode visible at second zero, and warn when the session
# works in the shared main checkout or runs bypass outside the lane sandbox (HV-1, AC1, AC6).
# No reading list: path rules and the indexes load when the work needs them.
# Tests: .claude/hooks/session-start.test.sh.
input=""
[ -t 0 ] || input=$(cat 2>/dev/null)
dir=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)
mode=$(printf '%s' "$input" | jq -r '.permission_mode // ""' 2>/dev/null)
[ -n "$dir" ] && [ -d "$dir" ] && cd "$dir"

# Personal base: the owner in t/<owner>/…, or the personal branch itself;
# otherwise whichever personal branch HEAD is least behind.
branch=$(git branch --show-current 2>/dev/null)
owner=""
case "$branch" in
  t/mike/*|mike) owner="mike" ;;
  t/maciej/*|maciej) owner="maciej" ;;
esac
if [ -z "$owner" ]; then
  best=""
  for cand in mike maciej; do
    git rev-parse --verify --quiet "origin/$cand" >/dev/null 2>&1 || continue
    n=$(git rev-list --count "HEAD..origin/$cand" 2>/dev/null || echo 999999)
    if [ -z "$best" ] || [ "$n" -lt "$best" ]; then best="$n"; owner="$cand"; fi
  done
fi
owner="${owner:-maciej}"
base=""
if git rev-parse --verify --quiet "origin/$owner" >/dev/null 2>&1; then
  base="origin/$owner"
elif git rev-parse --verify --quiet "$owner" >/dev/null 2>&1; then
  base="$owner"
fi

echo "## Moduo session preflight"
echo
if [ -n "$base" ]; then
  behind=$(git rev-list --count "HEAD..$base" 2>/dev/null || echo "")
  ahead=$(git rev-list --count "$base..HEAD" 2>/dev/null || echo "")
  if [ -n "$behind" ] && [ "$behind" != "0" ]; then
    echo "⚠️ STALE BASE — this branch is $behind commit(s) behind $base (${ahead:-?} ahead)."
    echo "   AGENTS.md, specs and tokens.css may be outdated. Reconcile with $base before"
    echo "   editing. Cut task branches off the latest personal branch, never develop;"
    echo "   integrate with a merge commit, never a fast-forward."
  else
    echo "✓ Base current with $base (${ahead:-0} ahead, 0 behind)."
  fi
else
  echo "• No personal base branch found to compare against — confirm this branch is cut"
  echo "  off mike or maciej, not develop."
fi
gitdir=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null)
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -n "$gitdir" ] && [ "$gitdir" = "$common" ]; then
  echo
  echo "⚠️ MAIN CHECKOUT — this session works in the shared main checkout ($(git rev-parse --show-toplevel 2>/dev/null))."
  echo "   Another session can switch its branch under you. Work in your own worktree:"
  echo "   bun run wt <name> (or git worktree add). guard-git.sh blocks branch switches here"
  echo "   while other Claude sessions work in it."
fi
if [ "$mode" = "bypassPermissions" ] && [ "${MODUO_LANE_SANDBOX:-}" != "1" ] && [ "${MODUO_ALLOW_BYPASS:-}" != "1" ]; then
  echo
  echo "⚠️ BYPASS OUTSIDE THE SANDBOX — interactive sessions use auto mode (Shift+Tab or the app's"
  echo "   mode picker; make it your default with bun run agent:auto-mode). guard-lane.sh stops every"
  echo "   tool call until then. Unattended lanes: bash scripts/agent/lane.sh \"<prompt>\"."
fi
echo
echo "Build → /s2 (claims the next ready block) · plan → /s1 · finish → /s3."
exit 0
