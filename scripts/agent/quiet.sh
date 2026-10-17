#!/usr/bin/env bash
# Run a noisy command (verify, tests, e2e) and print only what an agent needs:
# the exit code, the failure lines and a short tail. The full log stays on disk.
# Usage: scripts/agent/quiet.sh <label> <command…>
#   scripts/agent/quiet.sh verify bun run verify
#   scripts/agent/quiet.sh unit bun run --cwd apps/app test src/features/chat
#   scripts/agent/quiet.sh e2e bunx playwright test --config e2e/playwright.config.ts e2e/tests/chat-stream.spec.ts --reporter=line
set -o pipefail
label="${1:?label}"; shift
dir="${TMPDIR:-/tmp}/moduo-quiet"; mkdir -p "$dir"
log="$dir/${label}-$(date +%Y%m%d-%H%M%S)-$$.log"
start=$(date +%s)
"$@" >"$log" 2>&1
code=$?
secs=$(( $(date +%s) - start ))
if [ "$code" -eq 0 ]; then
  echo "✓ ${label} passed in ${secs}s · full log: ${log}"
  grep -E -i "(tests?|files?|specs?)[^|]{0,40}passed|passed \(|[0-9]+ passed" "$log" | tail -n 3
else
  echo "✗ ${label} failed (exit ${code}) in ${secs}s · full log: ${log}"
  grep -n -E "error TS[0-9]+|✗|×|FAIL|✘|Error:|AssertionError|Expected|Received|Found [0-9]+ error|failed|ERR!" "$log" | head -n 60
  echo "--- last 25 lines"
  tail -n 25 "$log"
fi
exit "$code"
