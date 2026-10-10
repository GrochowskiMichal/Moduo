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
# Operator mode (AGENTS.md §Working posture): docs/local/OPERATOR holds `designer`
# (default) or `engineer`; MODUO_OPERATOR overrides it for one shell.
mode="${MODUO_OPERATOR:-}"
if [ -z "$mode" ] && [ -f docs/local/OPERATOR ]; then
  mode=$(head -1 docs/local/OPERATOR | tr -d '[:space:]')
fi
case "$mode" in engineer|designer) ;; *) mode="designer" ;; esac
echo "Operator mode: $mode (docs/local/OPERATOR; see AGENTS.md §Working posture)."
echo
echo "Before building, read docs/gotchas.md (index) and docs/gotchas/<area>.md for the area"
echo "you will touch, plus the last five entries of docs/decisions/<area>.md. What is ready"
echo "to build: bun run next (block state comes from PRs, not from checkboxes)."
echo "Build → /s2 <ID> (claims it with a draft PR, lands it) · plan → /s1 · wrap → /s3."
exit 0
