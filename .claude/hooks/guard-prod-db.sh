#!/usr/bin/env bash
# PreToolUse: ask the human before anything that writes to a Supabase project.
#   - Any Supabase MCP server's apply_migration / execute_sql / deploy_edge_function,
#     whichever connector (project .mcp.json or a claude.ai connector) it comes from.
#   - Bash: `supabase db push`, `supabase db query … --linked`, `supabase functions deploy`.
# Everything else gets no output, so the normal permission flow applies.
#
# The gate lives here, not in settings.json `permissions.ask`: an ask rule can't be
# lifted per person (it outranks every allow, and a hook's "allow" too), while this
# can. A developer who wants no prompt sets MODUO_SUPABASE_NO_PROMPT=1 in their own
# gitignored .claude/settings.local.json (`"env": {...}`); everyone else is asked.
input=$(cat)
tool=$(jq -r '.tool_name // "this tool"' <<<"$input" 2>/dev/null)
reason="$tool writes to a Supabase project. Confirm the target project and the change before it runs."

if [ "$tool" = "Bash" ]; then
  cmd=$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null)
  if grep -Eq '(^|[^[:alnum:]_-])supabase[[:space:]]+(db[[:space:]]+push|functions[[:space:]]+deploy)' <<<"$cmd" ||
    grep -Eq '(^|[^[:alnum:]_-])supabase[[:space:]]+db[[:space:]]+query([[:space:]].*)?--linked' <<<"$cmd"; then
    reason="This supabase command writes to the linked (cloud) project. Confirm the target project and the change before it runs."
  else
    exit 0
  fi
fi

# The opt-in only lifts this hook's forced ask; it never says "allow". A Bash command
# that merely contains `supabase db push` can carry anything else (`… && rm -rf x`),
# so the person's own permission rules still decide every call.
[ "${MODUO_SUPABASE_NO_PROMPT:-}" = "1" ] && exit 0
jq -cn --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
exit 0
