#!/usr/bin/env bash
# PreToolUse (Bash; filters itself to `git … push`): block direct pushes to protected branches and
# bare force-pushes. AGENTS.md rules 1 and 8. Exit 2 = block, stderr = the reason
# Claude sees. Pushing your own t/<owner>/<task> or personal branch is allowed.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
printf '%s' "$cmd" | grep -Eq 'git( +-C +[^ ]+| +-c +[^ ]+)* +push( |$)' || exit 0

set -f # don't glob-expand the tokens below
for t in $cmd; do
  case "${t##*:}" in
    main|develop|prod-app|staging-app|refs/heads/main|refs/heads/develop|refs/heads/prod-app|refs/heads/staging-app)
      echo "Blocked: direct push to '${t##*:}'. Push your t/<owner>/<task> branch and land it through a PR (gh pr create, then gh pr merge --merge)." >&2
      exit 2 ;;
  esac
done
after_push="${cmd#*push}"  # only flags and refspecs given to push itself
if printf '%s' "$after_push" | grep -Eq -- '(^| )(-[a-zA-Z]*f[a-zA-Z]*|--force)( |$)|(^| )\+[^ ]'; then
  echo "Blocked: bare force-push. Use --force-with-lease, and only on your own task branch." >&2
  exit 2
fi
exit 0
