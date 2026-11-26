#!/usr/bin/env bash
# Run a noisy command (verify, tests, e2e) and print only what an agent needs:
# the exit code, the failure lines and a short tail. The full log stays on disk.
# Usage: scripts/agent/quiet.sh <label> <command…>
#   scripts/agent/quiet.sh verify bun run verify:full      (what `bun run verify` does for an agent)
#   scripts/agent/quiet.sh unit bun run --cwd apps/app test src/features/chat
#   scripts/agent/quiet.sh e2e bunx playwright test --config e2e/playwright.config.ts e2e/tests/chat-stream.spec.ts --reporter=line
set -o pipefail
label="${1:?label}"; shift
dir="${TMPDIR:-/tmp}/moduo-quiet"; mkdir -p "$dir"
# A verify log is about 270 KB: keep a week of them.
find "$dir" -name '*.log' -mtime +7 -delete 2>/dev/null
log="$dir/${label}-$(date +%Y%m%d-%H%M%S)-$$.log"
start=$(date +%s)
"$@" >"$log" 2>&1
code=$?
secs=$(( $(date +%s) - start ))
# Lint warnings are a burn-down budget, not the failure: they stay in the log. Long lines are cut.
trim() { grep -v -E ": warning |failedTests\": 0|failedFiles\": 0" | cut -c1-300; }
if [ "$code" -eq 0 ]; then
  echo "✓ ${label} passed in ${secs}s · full log: ${log}"
  grep -E -i "(tests?|files?|specs?)[^|]{0,40}passed|passed \(|[0-9]+ passed" "$log" | tail -n 3
else
  echo "✗ ${label} failed (exit ${code}) in ${secs}s · full log: ${log}"
  # A Turborepo run names its failed tasks at the end ("Failed:    //#lint:ratchets", more on the
  # lines under it). Each task's own lines carry its name as a prefix, so print the end of those:
  # the cause is there, not in the last lines of the whole log.
  failed=$(awk '/^ *Failed: /{on=1; sub(/^ *Failed: */, ""); print; next} on && /^ +[^ ]/{sub(/^ +/, ""); print; next} {on=0}' "$log")
  if [ -n "$failed" ]; then
    while IFS= read -r task; do
      [ -n "$task" ] || continue
      echo "--- ${task}: its last 40 lines"
      grep -F -- "${task/\#/:}:" "$log" | trim | tail -n 40
    done <<<"$failed"
  else
    grep -n -E "error TS[0-9]+|<error |✗|×|✖|FAIL|✘|Error:|AssertionError|Expected|Received|Found [0-9]+ error|failed|ERR!|needs formatting|: error|ERROR" "$log" | trim | head -n 60
    echo "--- last 25 lines"
    tail -n 25 "$log" | cut -c1-300
  fi
fi
exit "$code"
