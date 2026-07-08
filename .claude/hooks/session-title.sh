#!/usr/bin/env bash
# Claude Code SessionStart hook — session naming convention.
# If this worktree has a .claude/SESSION_TITLE file (written by Claude the
# moment the session's purpose is clear — see CLAUDE.md "Session naming"),
# emit it as the session title via hookSpecificOutput. Applies on startup and
# on every resume, so a title written mid-session lands on the next resume.
# Silent no-op when the file is absent or empty; never blocks a session.

f="${CLAUDE_PROJECT_DIR:-.}/.claude/SESSION_TITLE"
if [ -f "$f" ]; then
  title=$(head -c 200 "$f" | tr -d '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ -n "$title" ]; then
    if command -v jq >/dev/null 2>&1; then
      esc=$(printf '%s' "$title" | jq -Rs .)
    else
      esc="\"$(printf '%s' "$title" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')\""
    fi
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","sessionTitle":%s},"suppressOutput":true}\n' "$esc"
  fi
fi
exit 0
