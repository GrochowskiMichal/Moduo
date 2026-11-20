#!/usr/bin/env bash
# Tests for guard-prod-db.sh: asks by default, allows only with the local opt-in,
# stays silent for unrelated Bash.
#   bash .claude/hooks/guard-prod-db.test.sh   (also run by scripts/agent/hooks.test.ts)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/guard-prod-db.sh"
fails=0

decide() { # decide <tool> <command> [optin] → the hook's decision, or "none"
  local out
  out=$(jq -n --arg t "$1" --arg c "$2" '{tool_name: $t, tool_input: {command: $c}}' |
    MODUO_SUPABASE_NO_PROMPT="${3:-}" bash "$hook" 2>/dev/null)
  [ -z "$out" ] && { echo none; return; }
  jq -r '.hookSpecificOutput.permissionDecision' <<<"$out"
}
expect() { # expect <want> <tool> <command> <optin> <label>
  local got
  got=$(decide "$2" "$3" "$4")
  if [ "$got" = "$1" ]; then echo "ok   $5"; else echo "FAIL $5 (got $got, want $1)"; fails=$((fails + 1)); fi
}

# MCP tools: asked by default, allowed with the opt-in, still asked for any other value.
expect ask mcp__supabase__execute_sql 'select 1' '' 'MCP execute_sql asks'
expect ask mcp__claude_ai_Supabase__apply_migration '' '' 'claude.ai connector apply_migration asks'
expect ask mcp__supabase__deploy_edge_function '' '' 'deploy_edge_function asks'
expect none mcp__supabase__execute_sql 'select 1' 1 'opt-in lifts the ask for execute_sql'
expect none mcp__supabase__apply_migration '' 1 'opt-in lifts the ask for apply_migration'
expect ask mcp__supabase__execute_sql 'select 1' true 'only "1" opts in'

# Bash: the cloud-writing CLI commands.
expect ask Bash 'supabase db push' '' 'db push asks'
expect ask Bash 'bunx supabase db push --include-all' '' 'db push through bunx asks'
expect ask Bash 'supabase functions deploy moduo-mcp' '' 'functions deploy asks'
expect ask Bash 'supabase db query --linked "select 1"' '' 'db query --linked asks'
expect ask Bash 'supabase db query -f x.sql --linked' '' 'db query … --linked asks'
expect none Bash 'supabase db push' 1 'opt-in lifts the ask for db push'
# Never "allow": a compound command must still go through the normal rules.
expect none Bash 'supabase db push && rm -rf /tmp/x' 1 'opt-in never auto-allows a compound command'

# Bash: everything else is left to the normal flow.
expect none Bash 'supabase db query "select 1"' '' 'local db query is not gated'
expect none Bash 'supabase start' '' 'supabase start is not gated'
expect none Bash 'git status' '' 'unrelated command'
# A command that only mentions one (a grep) is still asked about: matching errs
# toward a prompt, never toward a silent push.
expect ask Bash 'grep -n "supabase db push" docs/release.md' '' 'a mention errs toward asking'

if [ "$fails" -eq 0 ]; then echo "guard-prod-db: all passed"; else echo "guard-prod-db: $fails failed"; exit 1; fi
