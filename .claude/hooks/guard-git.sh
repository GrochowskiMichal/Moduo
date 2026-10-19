#!/usr/bin/env bash
# PreToolUse (Bash; filters itself to `git … push`): protect the long-lived branches and block bare
# force-pushes. AGENTS.md rules 1, 8 and 9. Exit 2 = block, stderr = the reason Claude sees.
#   develop     never pushed directly (it changes through PRs; a GitHub ruleset holds this too)
#   mike/maciej pushed directly only for the develop merge-back (/s3 6b); never deleted or force-pushed
#   all three   never deleted
#   anywhere    no bare force-push (--force-with-lease is fine on your own task branch), no refs/entire,
#               no --mirror/--all/--prune
# Production ships from vX.Y.Z tags only (guard-release.sh), so there are no mirror branches to guard.
# Every `git push` in a chained or multi-line command is checked. Tests: .claude/hooks/guard-git.test.sh.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
printf '%s' "$cmd" | grep -q 'push' || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)

block() { echo "Blocked: $1" >&2; exit 2; }
is_long_lived() { case "$1" in develop|mike|maciej) return 0 ;; esac; return 1; }

# One line per simple command: join backslash continuations, split on && || ; | and newlines.
# Brackets and backticks become spaces (not breaks), so `(git push …)` is seen and the words after a
# `$(…)` stay with their push.
pieces=$(printf '%s' "$cmd" | perl -0pe 's/\\\n/ /g; s/[(){}\x60]/ /g; s/&&|\|\||;|\|/\n/g')

set -f # don't glob-expand the words below
while IFS= read -r piece; do
  # The push's own arguments, after `git [-C dir | -c k=v]… push`.
  args=$(printf '%s' "$piece" | perl -ne 'print "$2\n" if /(?:^|[\s"\x27\/])git((?:\s+-[Cc]\s+\S+)*)\s+push(?:\s+(.*))?$/' )
  printf '%s' "$piece" | perl -ne 'exit(/(?:^|[\s"\x27\/])git(?:\s+-[Cc]\s+\S+)*\s+push(?:\s|$)/ ? 0 : 1)' || continue
  dir=$(printf '%s' "$piece" | perl -ne 'print $1 if /(?:^|[\s"\x27\/])git(?:\s+-c\s+\S+)*\s+-C\s+(\S+)/')
  dir="${dir//\"/}"; dir="${dir//\'/}"

  deleting=0; forcing=0; leasing=0; skip=0; positional=()
  for t in $args; do
    t="${t//\"/}"; t="${t//\'/}"
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case "$t" in
      *refs/entire*) block "this would publish Entire session transcripts (refs/entire). The repo is public; checkpoints stay local (docs/entire.md)." ;;
      --mirror|--all) block "'$t' pushes every local ref, including Entire transcripts and stale branches. Push named branches." ;;
      --prune) block "'--prune' deletes remote branches in bulk. Delete named branches after review (scripts/release/branch-audit.ts)." ;;
      --delete) deleting=1 ;;
      --force) forcing=1 ;;
      --force-with-lease|--force-with-lease=*|--force-if-includes) leasing=1 ;;
      -o|--push-option|--repo|--receive-pack|--exec) skip=1 ;;
      --*) ;;
      -*)
        case "$t" in *d*) deleting=1 ;; esac
        case "$t" in *f*) forcing=1 ;; esac ;;
      *) positional+=("$t") ;;
    esac
  done

  current=$(git -C "${dir:-${cwd:-.}}" symbolic-ref --short -q HEAD 2>/dev/null)
  refspecs=("${positional[@]:1}")
  [ "${#refspecs[@]}" = 0 ] && refspecs=("$current")

  for r in "${refspecs[@]}"; do
    plus=0
    case "$r" in +*) plus=1; r="${r#+}" ;; esac
    src="$r"; dst="$r"
    case "$r" in *:*) src="${r%%:*}"; dst="${r##*:}" ;; esac
    [ "$dst" = HEAD ] && dst="$current"
    dst="${dst#refs/heads/}"
    if is_long_lived "$dst"; then
      { [ "$deleting" = 1 ] || { [ -z "$src" ] && [ "$r" != "$src" ]; }; } &&
        block "deleting '$dst'. develop, mike and maciej are long-lived; never delete them."
      { [ "$forcing" = 1 ] || [ "$leasing" = 1 ] || [ "$plus" = 1 ]; } &&
        block "force-push to '$dst'. develop, mike and maciej are never force-pushed; merge instead."
      [ "$dst" = develop ] &&
        block "direct push to 'develop'. Push your t/<owner>/<task> branch and land it through a PR (gh pr create, then gh pr merge --merge)."
    elif [ "$forcing" = 1 ] || [ "$plus" = 1 ]; then
      block "bare force-push. Use --force-with-lease, and only on your own task branch."
    fi
  done
done <<<"$pieces"
exit 0
