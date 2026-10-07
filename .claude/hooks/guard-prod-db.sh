#!/usr/bin/env bash
# PreToolUse (any Supabase MCP server's apply_migration / execute_sql /
# deploy_edge_function): always ask the human first, whichever connector
# (project .mcp.json or a claude.ai connector) the tool comes from.
tool=$(jq -r '.tool_name // "this tool"' 2>/dev/null)
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s writes to a Supabase project. Confirm the target project and the change before it runs."}}\n' "$tool"
exit 0
