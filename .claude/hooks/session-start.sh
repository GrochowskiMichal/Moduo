#!/usr/bin/env bash
# Claude Code SessionStart hook — Moduo preflight.
# stdout is injected into the session's context. ALWAYS non-blocking: it only
# ever prints and exits 0, so it can never prevent a session from starting.
# Its job: make the stale-base failure mode visible at second zero and point at
# the short session-start reading list (AGENTS.md §Session start).

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
    echo "   editing. Cut task branches off the latest personal branch, never main/develop;"
    echo "   integrate with a merge commit, never a fast-forward."
  else
    echo "✓ Base current with $base (${ahead:-0} ahead, 0 behind)."
  fi
else
  echo "• No personal base branch found to compare against — confirm this branch is cut"
  echo "  off mike or maciej, not main/develop."
fi
echo
echo "Before building, read: docs/decisions.md · docs/gotchas.md · specs/BUILD_ORDER.md"
echo "(all short indexes). Open docs/gotchas/<area>.md for the area you will touch."
echo "Build → /s2 (claims the next ready block) · plan → /s1 · finish → /s3."
exit 0
