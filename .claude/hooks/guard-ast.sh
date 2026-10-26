#!/usr/bin/env bash
# PostToolUse, runs async: the ast-grep pack (tools/ast-grep, HV-12) on what just changed.
#   Edit|Write  the edited file.
#   Bash        the changed .ts/.tsx/.rs files under apps/ (agents edit by sed too),
#               reported only when the result differs from the last Bash report.
# A new match exits 2, which wakes Claude with the report; otherwise it stays silent.
# `bun run lint:ast` (verify, CI) is the gate; this is the early warning.
input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -f tools/ast-grep/lint.ts ] || exit 0

scoped() { grep -E '^apps/(app/src|desktop/src-tauri/src)/.*\.(ts|tsx|rs)$'; }

if [ "$tool" = "Bash" ]; then
  files=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | scoped | sort -u)
else
  f=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
  files=$(printf '%s\n' "${f#"$PWD"/}" | scoped)
fi
[ -n "$files" ] || exit 0

# shellcheck disable=SC2086 # one path per word: repo paths have no spaces
out=$(bun tools/ast-grep/lint.ts $files 2>&1) && exit 0

if [ "$tool" = "Bash" ]; then
  last="${TMPDIR:-/tmp}/moduo-ast-gate.$(printf '%s' "$PWD" | cksum | cut -d' ' -f1)"
  sum=$(printf '%s' "$out" | cksum)
  [ "$(cat "$last" 2>/dev/null)" = "$sum" ] && exit 0
  printf '%s' "$sum" >"$last"
fi
printf '%s\n' "$out" | tail -40 >&2
exit 2
