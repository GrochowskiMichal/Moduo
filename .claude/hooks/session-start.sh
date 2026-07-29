#!/usr/bin/env bash
# Claude Code SessionStart hook — Moduo preflight.
# stdout is injected into the session's context. ALWAYS non-blocking: it only
# ever prints and exits 0, so it can never prevent a session from starting.
# Its job: make the two failure modes the docs warn about (stale base, skipped
# knowledge files) visible at second zero, model-independently.

# Resolve the personal base branch (prefer local maciej, fall back to origin/maciej).
base=""
if git rev-parse --verify --quiet maciej >/dev/null 2>&1; then
  base="maciej"
elif git rev-parse --verify --quiet origin/maciej >/dev/null 2>&1; then
  base="origin/maciej"
fi

echo "## Moduo session preflight"
echo
if [ -n "$base" ]; then
  behind=$(git rev-list --count "HEAD..$base" 2>/dev/null || echo "")
  ahead=$(git rev-list --count "$base..HEAD" 2>/dev/null || echo "")
  if [ -n "$behind" ] && [ "$behind" != "0" ]; then
    echo "⚠️ STALE BASE — this branch is $behind commit(s) behind $base (${ahead:-?} ahead)."
    echo "   The auto-loaded AGENTS.md / specs / tokens.css may be outdated. Reconcile with"
    echo "   $base before editing. Cut task branches off the latest $base, never main/develop;"
    echo "   integrate into maciej with a merge commit, never a fast-forward."
  else
    echo "✓ Base current with $base (${ahead:-0} ahead, 0 behind)."
  fi
else
  echo "• No 'maciej'/'origin/maciej' base found to compare against — confirm this branch"
  echo "  is cut off the personal branch, not main/develop."
fi
echo
echo "Before building, read: docs/decisions.md · docs/gotchas.md · specs/BUILD_ORDER.md"
echo "(the live execution ledger — what's next, dependencies, parallel-session lanes)."
echo "Build work → /s2 (auto-picks the next ready block) · plan → /s1 · finish → /s3."
exit 0
