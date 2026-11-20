#!/usr/bin/env bash
# PreToolUse (Bash; filters itself to `git … push`): protect the long-lived branches and block bare
# force-pushes. AGENTS.md rules 1, 8 and 9. Exit 2 = block, stderr = the reason Claude sees.
#   develop     never pushed directly (it changes through PRs; a GitHub ruleset holds this too)
#   mike/maciej pushed directly only for the develop merge-back (/s3 6b); never deleted or force-pushed
#   all three   never deleted
#   anywhere    no bare force-push (--force-with-lease is fine on your own task branch), no refs/entire,
#               no --mirror/--all/--prune
# Production ships from vX.Y.Z tags only (guard-release.sh), so there are no mirror branches to guard.
# Every `git push` in a chained or multi-line command is checked.
# Also (HV-1): no `git checkout <branch>` / `git switch` in the main checkout while another Claude
# session has it as its working directory (on 23 Oct a switch moved the branch under a running
# session). File restores (`git checkout -- <path>`) stay allowed. Tests: .claude/hooks/guard-git.test.sh.
command -v jq >/dev/null 2>&1 || { echo "guard-git.sh: jq is missing (brew install jq)." >&2; exit 1; }
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

block() { echo "Blocked: $1" >&2; exit 2; }
is_long_lived() { case "$1" in develop|mike|maciej) return 0 ;; esac; return 1; }

# "pid<TAB>cwd" for every running Claude process. GUARD_GIT_CLAUDE_CWDS stands in for lsof in tests.
claude_cwds() {
  if [ -n "${GUARD_GIT_CLAUDE_CWDS+x}" ]; then printf '%s\n' "$GUARD_GIT_CLAUDE_CWDS"; return; fi
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -a -c claude -d cwd -Fpn 2>/dev/null | awk '/^p/ {p = substr($0, 2)} /^n/ {print p "\t" substr($0, 2)}'
}
# The PIDs above this hook (its own session), so only *other* sessions count.
ancestors() {
  local p=$$
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do echo "$p"; p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); done
}

if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+)*[[:space:]]+(checkout|switch)([[:space:]]|$)'; then
  sw_pieces=$(printf '%s' "$cmd" | perl -0pe 's/\\\n/ /g; s/[(){}\x60]/ /g; s/&&|\|\||;|\|/\n/g')
  while IFS= read -r piece; do
    sub=$(printf '%s' "$piece" | perl -ne 'print "$2\t$3\n" if /(?:^|[\s"\x27\/])git((?:\s+-[Cc]\s+\S+)*)\s+(checkout|switch)(?:\s+(.*))?$/')
    [ -n "$sub" ] || continue
    verb=${sub%%$'\t'*}; rest=${sub#*$'\t'}
    dir=$(printf '%s' "$piece" | perl -ne 'print $1 if /(?:^|[\s"\x27\/])git(?:\s+-c\s+\S+)*\s+-C\s+(\S+)/')
    dir="${dir//\"/}"; dir="${dir//\'/}"; dir="${dir:-${cwd:-.}}"
    # A branch switch? `switch` always is (but not --help); `checkout` is unless it restores paths.
    switching=0
    if [ "$verb" = switch ]; then
      case " $rest " in *" -h "* | *" --help "*) ;; *) switching=1 ;; esac
    else
      case " $rest " in
        *" -- "* | *" -p "* | *" --patch "* | " . " | " ") ;;
        *" - "* | *" -b "* | *" -B "* | *" --detach "* | *" --orphan "*) switching=1 ;;
        *)
          target=""; set -f; set -- $rest; set +f
          for a in "$@"; do case "$a" in -*) ;; *) target=${a//\"/}; target=${target//\'/}; break ;; esac; done
          [ "$#" -ge 1 ] && [ -n "${target:-}" ] && [ "$target" = "${@: -1}" ] &&
            git -C "$dir" rev-parse --verify --quiet "$target^{commit}" >/dev/null 2>&1 && switching=1 ;;
      esac
    fi
    [ "$switching" = 1 ] || continue
    gitdir=$(git -C "$dir" rev-parse --path-format=absolute --git-dir 2>/dev/null) || continue
    common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
    [ "$gitdir" = "$common" ] || continue # a linked worktree: its branch is its own
    top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || continue
    mine=$(ancestors)
    others=0
    while IFS=$'\t' read -r pid pcwd; do
      [ -n "$pid" ] || continue
      # Its own checkout decides: worktrees under .claude/worktrees/ sit inside the main folder.
      if [ -d "$pcwd" ]; then
        [ "$(git -C "$pcwd" rev-parse --show-toplevel 2>/dev/null)" = "$top" ] || continue
      else
        case "$pcwd" in "$top" | "$top"/*) ;; *) continue ;; esac
      fi
      printf '%s\n' "$mine" | grep -qx "$pid" && continue
      others=$((others + 1))
    done <<<"$(claude_cwds)"
    [ "$others" -gt 0 ] &&
      block "switching branches in the main checkout ($top) while $others other Claude session(s) work in it moves the branch under them. Work in your own worktree instead: \`bun run wt <name>\` (or \`git worktree add ../<name> -b t/<owner>/<kebab> origin/<owner>\`)."
  done <<<"$sw_pieces"
fi

printf '%s' "$cmd" | grep -q 'push' || exit 0

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
