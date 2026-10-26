#!/usr/bin/env bash
# PreToolUse (Bash, edits and MCP): the rails for permission modes and unattended lanes. HV-1, AC6.
#   1. Bypass permissions runs only inside the srt lane sandbox (scripts/agent/lane.sh sets
#      MODUO_LANE_SANDBOX=1). Interactive sessions use auto mode; a session started in bypass outside
#      the sandbox is stopped at its first tool call. Stopgap for one machine:
#      MODUO_ALLOW_BYPASS=1 in your own gitignored .claude/settings.local.json ("env").
#   2. In a lane (MODUO_LANE=1) production deploys and pushes to prod are denied: wrangler deploys and
#      rollbacks (also through scripts/release/canary.ts), supabase writes to the linked project, gh workflow runs, releases and dispatches,
#      tag pushes, and any Supabase MCP write. .claude/settings.lane.json denies the same commands
#      first; this hook catches the spellings a permission rule can't (chains, bunx/npx, other MCP names).
# Exit 2 = block, stderr = the reason Claude sees. Tests: .claude/hooks/guard-lane.test.sh.
command -v jq >/dev/null 2>&1 || { echo "guard-lane.sh: jq is missing (brew install jq)." >&2; exit 1; }
input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")
mode=$(jq -r '.permission_mode // ""' <<<"$input")

block() { echo "Blocked: $1" >&2; exit 2; }

if [ "$mode" = "bypassPermissions" ] && [ "${MODUO_LANE_SANDBOX:-}" != "1" ] && [ "${MODUO_ALLOW_BYPASS:-}" != "1" ]; then
  block "this session runs in bypass permissions outside the lane sandbox. Interactive sessions use auto mode: switch the mode (Shift+Tab, or the mode picker in the app) and set it as your default with \`bun run agent:auto-mode\`. Unattended lanes run bypass only inside srt: \`bash scripts/agent/lane.sh \"<prompt>\"\`."
fi

[ "${MODUO_LANE:-}" = "1" ] || exit 0

lane_block() { block "$1 is a production change, and lanes never ship. Leave it for a person: finish the block, push the task branch, and say what needs deploying in the report."; }

case "$tool" in
  mcp__*__apply_migration | mcp__*__execute_sql | mcp__*__deploy_edge_function | mcp__*__merge_branch | mcp__*__reset_branch | mcp__*__create_edge_function_secret)
    lane_block "$tool" ;;
  Bash) ;;
  *) exit 0 ;;
esac

cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
b='(^|[^[:alnum:]_.-])'
patterns=(
  "${b}wrangler[[:space:]]+((pages|versions)[[:space:]]+)?deploy"
  "${b}wrangler[[:space:]]+(rollback|secret[[:space:]]+put|versions[[:space:]]+upload)"
  "${b}scripts/release/canary\.ts[[:space:]]+(run|abort)"
  "${b}supabase[[:space:]]+(db[[:space:]]+push|functions[[:space:]]+deploy|secrets[[:space:]]+set|link)"
  "${b}supabase[[:space:]]+db[[:space:]]+query([[:space:]].*)?--linked"
  "${b}gh[[:space:]]+(workflow[[:space:]]+run|release[[:space:]]+create)"
  "${b}gh[[:space:]]+api([[:space:]].*)?/dispatches"
  "${b}git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+)*[[:space:]]+push([[:space:]].*)?[[:space:]](--tags|--follow-tags|(refs/tags/|tags/)?v[0-9])"
)
for p in "${patterns[@]}"; do
  if grep -Eq -- "$p" <<<"$cmd"; then lane_block "\`$(grep -Eo -- "$p" <<<"$cmd" | head -1 | sed -E 's/^[^[:alnum:]]//')\`"; fi
done
exit 0
