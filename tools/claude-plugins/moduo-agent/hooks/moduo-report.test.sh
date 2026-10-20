#!/usr/bin/env bash
# Tests for moduo-report.sh: when presence posts, what it posts, and that the
# key never reaches the command line.
#   bash tools/claude-plugins/moduo-agent/hooks/moduo-report.test.sh
#   (also run by scripts/agent/moduo-report.test.ts)
# A fake curl on PATH records each request instead of sending it.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/moduo-report.sh"
fails=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/proj/.claude"
cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
{ printf 'ARGS %s\n' "$*"; printf 'STDIN %s\n' "$(cat)"; } >"$FAKE_CURL_OUT.tmp"
mv "$FAKE_CURL_OUT.tmp" "$FAKE_CURL_OUT"
EOF
chmod +x "$tmp/bin/curl"
out="$tmp/request"
key="moduo_sk_$(printf '0%.0s' $(seq 48))"

run() { # run <event> [env…]: runs the hook, waits up to $tries tenths of a second for a request
  local event="$1"; shift
  rm -f "$out"
  echo '{}' | env PATH="$tmp/bin:$PATH" CLAUDE_PROJECT_DIR="$tmp/proj" FAKE_CURL_OUT="$out" \
    MODUO_MCP_URL="http://127.0.0.1:9/mcp" "$@" bash "$hook" "$event" >"$tmp/stdout" 2>&1
  for _ in $(seq "${tries:-100}"); do [ -f "$out" ] && break; sleep 0.1; done
}
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
expect_none() { if [ ! -f "$out" ]; then ok "$1"; else bad "$1 (posted)"; fi; }
expect_args() { # expect_args <jq filter on the tool arguments> <label>
  if [ -f "$out" ] && sed -n 's/.*--data //p' "$out" | jq -e ".params.arguments | $1" >/dev/null 2>&1; then
    ok "$2"
  else
    bad "$2 ($(cat "$out" 2>/dev/null))"
  fi
}
claim() { printf '%s\n' "$@" >"$tmp/proj/.claude/MODUO_TASK"; }

# No key, no claim, or nothing left to report: nothing is sent (a stray post would land within 0.5 s).
tries=5
claim task=MOD-7 state=working
run Stop MODUO_MCP_KEY=
expect_none 'no key: no-op'
rm -f "$tmp/proj/.claude/MODUO_TASK"
run Stop MODUO_MCP_KEY="$key"
expect_none 'no claimed task: no-op'
for s in needs_you ready failed; do
  claim task=MOD-7 "state=$s"
  run Stop MODUO_MCP_KEY="$key"
  expect_none "last state $s: left alone"
done
claim task=MOD-7 state=working
run PreToolUse MODUO_MCP_KEY="$key"
expect_none 'other events: no-op'

# Online on start, with the session title and the agent's name.
tries=100 # a post can take seconds while other suites load the machine
claim task=MOD-7 state=working step=4 steps=7
printf '[Agents P0] Dogfood\n' >"$tmp/proj/.claude/SESSION_TITLE"
run SessionStart MODUO_MCP_KEY="$key" MODUO_AGENT_NAME="MichaśAI"
expect_args '.task_id == "MOD-7" and .state == "working" and .note == "Online · [Agents P0] Dogfood"' 'start: online + title'
expect_args '.agent == "MichaśAI"' 'start: agent name from MODUO_AGENT_NAME'
expect_args '.step == 4 and .steps == 7' 'start: keeps step n of m'
if [ -s "$tmp/stdout" ]; then bad 'start: prints nothing'; else ok 'start: prints nothing'; fi
if grep -q "STDIN Authorization: Bearer $key" "$out" && ! grep -q "ARGS.*$key" "$out"; then
  ok 'key sent on stdin, not in the arguments'
else
  bad 'key sent on stdin, not in the arguments'
fi

# Idle on stop; a claim without a state or step still reports.
claim task=MOD-8
rm -f "$tmp/proj/.claude/SESSION_TITLE"
run Stop MODUO_MCP_KEY="$key"
expect_args '.task_id == "MOD-8" and .note == "Idle · waiting for the next turn"' 'stop: idle'
expect_args 'has("agent") | not' 'stop: no agent name → the key name'
expect_args 'has("step") | not' 'stop: no step → none sent'
run SessionStart MODUO_MCP_KEY="$key"
expect_args '.note == "Online"' 'start without a title: online'

if [ "$fails" = 0 ]; then echo "moduo-report: all passed"; else echo "moduo-report: $fails failed"; exit 1; fi
