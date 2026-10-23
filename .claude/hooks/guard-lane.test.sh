#!/usr/bin/env bash
# Tests for guard-lane.sh (HV-1, AC6): bypass only inside the lane sandbox; prod deploys denied in lanes.
#   bash .claude/hooks/guard-lane.test.sh   (also run by scripts/agent/hooks.test.ts)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/guard-lane.sh"
fails=0
unset MODUO_LANE MODUO_LANE_SANDBOX MODUO_ALLOW_BYPASS

expect() { # expect <code> <mode> <tool> <command> <label>   (env from the caller)
  jq -n --arg m "$2" --arg t "$3" --arg c "$4" '{permission_mode: $m, tool_name: $t, tool_input: {command: $c}}' |
    bash "$hook" 2>/dev/null
  local got=$?
  if [ "$got" = "$1" ]; then echo "ok   $5"; else echo "FAIL $5 (exit $got, want $1)"; fails=$((fails + 1)); fi
}

# Modes outside a lane.
expect 0 auto Bash 'wrangler deploy' 'auto mode, no lane: deploy left to the other guards'
expect 0 default Edit '' 'default mode edit'
expect 2 bypassPermissions Bash 'ls' 'bypass outside the sandbox'
expect 2 bypassPermissions Edit '' 'bypass outside the sandbox, edit'
MODUO_LANE_SANDBOX=1 expect 0 bypassPermissions Bash 'ls' 'bypass inside the sandbox'
MODUO_ALLOW_BYPASS=1 expect 0 bypassPermissions Bash 'ls' 'personal stopgap'

# In a lane (always inside the sandbox).
lane() { MODUO_LANE=1 MODUO_LANE_SANDBOX=1 expect "$1" bypassPermissions "$2" "$3" "$4"; }
lane 0 Bash 'bun run verify' 'verify'
lane 0 Bash 'git push -u origin t/mike/hv-1-rails' 'task branch push'
lane 0 Bash 'gh pr create --draft --base mike' 'draft PR'
lane 0 Bash 'grep -n deploy docs/release.md' 'the word deploy alone'
lane 0 Bash 'supabase db query "select 1"' 'local db query'
lane 0 Bash 'git push origin t/mike/v2-notes' 'branch whose name has v2'
lane 0 mcp__supabase__list_tables '' 'read-only MCP'
lane 2 Bash 'wrangler deploy' 'wrangler deploy'
lane 2 Bash 'cd infra/turbo-cache && bunx wrangler deploy --env prod' 'bunx wrangler deploy in a chain'
lane 2 Bash 'npx wrangler pages deploy dist' 'wrangler pages deploy'
lane 2 Bash 'wrangler versions deploy' 'wrangler versions deploy'
lane 2 Bash 'wrangler rollback' 'wrangler rollback'
lane 2 Bash 'supabase db push' 'supabase db push'
lane 2 Bash 'supabase functions deploy moduo-mcp' 'supabase functions deploy'
lane 2 Bash 'supabase db query --linked "select 1"' 'linked db query'
lane 2 Bash 'supabase link --project-ref abc' 'supabase link'
lane 2 Bash 'gh workflow run deploy-prod.yml -f tag=v1.2.0' 'gh workflow run'
lane 2 Bash 'gh release create v1.2.0' 'gh release create'
lane 2 Bash 'gh api repos/o/r/actions/workflows/1/dispatches -f ref=develop' 'workflow dispatch API'
lane 2 Bash 'git push origin v1.2.0' 'tag push'
lane 2 Bash 'git push --tags' 'push all tags'
lane 2 Bash 'git push origin refs/tags/v1.2.0' 'tag push by ref'
lane 2 mcp__supabase__apply_migration '' 'MCP migration'
lane 2 mcp__claude_ai_Supabase__execute_sql '' 'MCP execute_sql on another server'
lane 2 mcp__supabase__deploy_edge_function '' 'MCP function deploy'

if [ "$fails" = 0 ]; then echo "guard-lane: all passed"; else echo "guard-lane: $fails failed"; exit 1; fi
