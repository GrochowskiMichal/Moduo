#!/usr/bin/env bash
# PreToolUse (Bash; filters itself to `git … push`): block direct pushes to
# protected branches and bare force-pushes. AGENTS.md rules 1 and 8. Exit 2 =
# block, stderr = the reason Claude sees. Pushing your own t/<owner>/<task> or
# personal branch is allowed.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
printf '%s' "$cmd" | grep -Eq 'git( +-C +[^ ]+| +-c +[^ ]+)* +push( |$)' || exit 0

# Only the push's own arguments: from "push" to the next &&, ;, | or newline.
seg="${cmd#*push}"
seg="${seg%%&&*}"; seg="${seg%%;*}"; seg="${seg%%|*}"; seg="${seg%%$'\n'*}"

set -f # don't glob-expand the tokens below
for t in $seg; do
  case "$t" in
    *refs/entire*|--mirror|--all)
      echo "Blocked: this would publish Entire session transcripts (refs/entire). The repo is public; checkpoints stay local (docs/entire.md)." >&2
      exit 2 ;;
  esac
  case "${t##*:}" in
    main|develop|prod-app|staging-app|refs/heads/main|refs/heads/develop|refs/heads/prod-app|refs/heads/staging-app)
      echo "Blocked: direct push to '${t##*:}'. Push your t/<owner>/<task> branch and land it through a PR (gh pr create, then gh pr merge --merge)." >&2
      exit 2 ;;
  esac
done
if printf '%s' "$seg" | grep -Eq -- '(^| )(-[a-zA-Z]*f[a-zA-Z]*|--force)( |$)|(^| )\+[^ ]'; then
  echo "Blocked: bare force-push. Use --force-with-lease, and only on your own task branch." >&2
  exit 2
fi
exit 0
