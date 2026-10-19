#!/usr/bin/env bash
# PreToolUse (Bash; filters itself to `git … push`): protect the long-lived branches and block bare
# force-pushes. AGENTS.md rules 1 and 8. Exit 2 = block, stderr = the reason Claude sees.
#   develop     never pushed directly (it changes through PRs; the ruleset enforces it server-side too)
#   mike/maciej pushed directly only for the develop merge-back (/s3 6b); never deleted or force-pushed
#   all three   never deleted
# Production ships from vX.Y.Z tags only (guard-release.sh), so there are no mirror branches to guard.
# Tests: .claude/hooks/guard-git.test.sh.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
printf '%s' "$cmd" | grep -Eq 'git( +-C +[^ ]+| +-c +[^ ]+)* +push( |$)' || exit 0

# Only the push's own arguments: from "push" to the next &&, ;, | or newline.
seg="${cmd#*push}"
seg="${seg%%&&*}"; seg="${seg%%;*}"; seg="${seg%%|*}"; seg="${seg%%$'\n'*}"

is_long_lived() { case "${1#refs/heads/}" in develop|mike|maciej) return 0 ;; esac; return 1; }

deleting=0
printf '%s' "$seg" | grep -Eq -- '(^| )(--delete|-d)( |$)' && deleting=1
forcing=0
printf '%s' "$seg" | grep -Eq -- '(^| )(-[a-zA-Z]*f[a-zA-Z]*|--force|--force-with-lease(=[^ ]*)?|--force-if-includes)( |$)|(^| )\+[^ ]' && forcing=1

set -f # don't glob-expand the tokens below
for t in $seg; do
  t="${t//\"/}"; t="${t//\'/}"
  case "$t" in
    *refs/entire*|--mirror|--all)
      echo "Blocked: this would publish Entire session transcripts (refs/entire). The repo is public; checkpoints stay local (docs/entire.md)." >&2
      exit 2 ;;
  esac
  dst="${t##*:}"; dst="${dst#+}"
  is_long_lived "$dst" || continue
  if [ "$deleting" = 1 ] || case "$t" in :*) true ;; *) false ;; esac; then
    echo "Blocked: deleting '$dst'. develop, mike and maciej are long-lived; never delete them." >&2
    exit 2
  fi
  if [ "$forcing" = 1 ]; then
    echo "Blocked: force-push to '$dst'. develop, mike and maciej are never force-pushed; merge instead." >&2
    exit 2
  fi
  if [ "${dst#refs/heads/}" = develop ]; then
    echo "Blocked: direct push to 'develop'. Push your t/<owner>/<task> branch and land it through a PR (gh pr create, then gh pr merge --merge)." >&2
    exit 2
  fi
done
if printf '%s' "$seg" | grep -Eq -- '(^| )(-[a-zA-Z]*f[a-zA-Z]*|--force)( |$)|(^| )\+[^ ]'; then
  echo "Blocked: bare force-push. Use --force-with-lease, and only on your own task branch." >&2
  exit 2
fi
exit 0
