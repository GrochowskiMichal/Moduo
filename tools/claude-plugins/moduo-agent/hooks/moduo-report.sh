#!/usr/bin/env bash
# Moduo agent presence (agents phase 0, dogfood): SessionStart reports "online"
# with the session title, Stop reports "idle", on the Moduo task this worktree
# claimed. The claim is .claude/MODUO_TASK (gitignored), written by the
# moduo-agent skill when /s2 takes a block's task:
#   task=MOD-123   state=working   step=4   steps=7      (one key=value a line)
# Posts tasks_session_status to the moduo-mcp connector (state working, the
# agent name from MODUO_AGENT_NAME), in the background, so the hook returns at
# once. The step is sent again because every report replaces the last one's.
#   bash moduo-report.sh SessionStart|Stop   (hook input on stdin, ignored)
# Silent no-op when MODUO_MCP_KEY is unset, when nothing is claimed, and once
# the last state isn't "working": needs_you, ready and failed stay on the task
# (a "working" report after ready or failed would start a new run).
# Never blocks a session and never prints. MODUO_MCP_URL overrides the
# connector, for the tests only: presence always goes to the dogfood workspace.
#   Tests: moduo-report.test.sh (run by scripts/agent/moduo-report.test.ts).

cat >/dev/null 2>&1
[ -n "${MODUO_MCP_KEY:-}" ] || exit 0
command -v jq >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 || exit 0

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
claim="$dir/.claude/MODUO_TASK"
[ -f "$claim" ] || exit 0
val() { sed -n "s/^$1=//p" "$claim" | head -1 | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
task=$(val task)
state=$(val state)
[ -n "$task" ] || exit 0
[ -z "$state" ] || [ "$state" = working ] || exit 0

case "${1:-}" in
  SessionStart)
    title=$(head -c 200 "$dir/.claude/SESSION_TITLE" 2>/dev/null | tr -d '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    note="Online${title:+ · $title}"
    ;;
  Stop) note="Idle · waiting for the next turn" ;;
  *) exit 0 ;;
esac

body=$(jq -nc \
  --arg task "$task" --arg note "$note" --arg agent "${MODUO_AGENT_NAME:-}" \
  --arg step "$(val step)" --arg steps "$(val steps)" '
  {task_id: $task, state: "working", note: $note}
  + (if $agent != "" then {agent: $agent} else {} end)
  + (if ($step | test("^[0-9]{1,3}$")) and ($steps | test("^[0-9]{1,3}$"))
     then {step: ($step | tonumber), steps: ($steps | tonumber)} else {} end)
  | {jsonrpc: "2.0", id: 1, method: "tools/call",
     params: {name: "tasks_session_status", arguments: .}}') || exit 0

url="${MODUO_MCP_URL:-https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/moduo-mcp}"
# The key goes in on stdin (-H @-), never in the process list.
(
  printf 'Authorization: Bearer %s\n' "$MODUO_MCP_KEY" |
    curl -sS -o /dev/null --max-time 5 -X POST "$url" -H @- \
      -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
      --data "$body" >/dev/null 2>&1
) </dev/null >/dev/null 2>&1 &
exit 0
