#!/usr/bin/env bash
# PostToolUse (Edit|Write), runs async: after a UI edit, re-run the design gates
# (lint:tw + lint:css). AGENTS.md rule 3. On a violation it exits 2, which wakes
# Claude with the report; otherwise it stays silent.
f=$(jq -r '.tool_input.file_path // ""' 2>/dev/null)
case "$f" in
  */src/*.ts|*/src/*.tsx|*/src/*.css) ;;
  *) exit 0 ;;
esac
case "$f" in *.test.ts|*.test.tsx|*.stories.tsx) exit 0 ;; esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# One run at a time: a burst of edits shouldn't stack up lint processes.
lock="${TMPDIR:-/tmp}/moduo-design-gate.$(printf '%s' "$PWD" | cksum | cut -d' ' -f1).lock"
mkdir "$lock" 2>/dev/null || exit 0
trap 'rmdir "$lock"' EXIT
if ! out=$( { bun run lint:tw && bun run lint:css; } 2>&1 ); then
  {
    echo "Design gate failed after editing ${f#"${CLAUDE_PROJECT_DIR:-}"/}. Route the value through a token in src/styles/tokens.css (rules: docs/DESIGN_RULES.md) and use the nearest scale utility:"
    printf '%s\n' "$out" | tail -40
  } >&2
  exit 2
fi
exit 0
