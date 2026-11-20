#!/usr/bin/env bash
# PreToolUse (Bash): a production release starts only through /ship (specs/release-v2.md, REL-3,
# AC6). Fails closed. Blocks, unless /ship wrote the one-time marker .claude/release-approved/<X.Y.Z>:
#   - `git … push` of a vX.Y… tag (by name, tags/…, refs/tags/…, src:dst)
#   - `gh … workflow run` of release, deploy-prod or Desktop Release (production), by file, name
#     or numeric ID, keyed by -f tag=vX.Y.Z
# Always blocks (no marker helps): pushes with --tags, --follow-tags, --mirror, a glob or a shell
# variable in the refspecs, and `gh api …/actions/workflows/…/dispatches`.
# An allowed command consumes its markers; a marker older than 60 minutes doesn't count.
# Deleting a tag (`--delete`/`-d`, `:refs/tags/v…`) ships nothing and is allowed.
# Only Claude's Bash tool passes through here: a person in a terminal is never blocked.
# Exit 2 = block, stderr = the reason Claude sees. Tested by guard-release.test.sh.
command -v jq >/dev/null 2>&1 || { echo "guard-release.sh: jq is missing (brew install jq)." >&2; exit 1; }
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)
printf '%s' "$cmd" | grep -Eq 'push|workflow|dispatches' || exit 0

roots=()
[ -n "${CLAUDE_PROJECT_DIR:-}" ] && roots+=("$CLAUDE_PROJECT_DIR")
top=$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null) && roots+=("$top")

block() {
  echo "Blocked: $1 A production release starts only through /ship, after the person answers its ship-now-or-hand-off question. Don't write the release marker yourself: ask the person to run /ship (or /ship vX.Y.Z for an open release PR). docs/release.md §1." >&2
  exit 2
}

# The fresh marker for a version, or nothing.
marker_for() {
  local root
  for root in "${roots[@]}"; do
    local m="$root/.claude/release-approved/$1"
    if [ -f "$m" ] && [ -n "$(find "$m" -mmin -60 2>/dev/null)" ]; then
      printf '%s\n' "$m"
      return 0
    fi
  done
  return 1
}

consume=()
need() { # need <version> <what>
  local m
  m=$(marker_for "$1") || block "$2 has no /ship approval for $1."
  consume+=("$m")
}

set -f # don't glob-expand the tokens below
# Join backslash-newline continuations, then look at each command on its own (split on &&, ||,
# ;, | and newlines).
pieces=$(printf '%s\n' "$cmd" | awk '{ if (sub(/\\$/, "")) { printf "%s ", $0 } else { print } }' \
  | awk '{ gsub(/&&|\|\||;|\|/, "\n"); print }')
while IFS= read -r seg; do
  [ -n "$seg" ] || continue

  # git, any global options, push.
  if printf '%s' "$seg" | grep -Eq '(^|[ (])git( [^ ]+)* push( |$)'; then
    args="${seg#* push}"
    deleting=0
    printf '%s' "$args" | grep -Eq -- '(^| )(-d|--delete)( |$)' && deleting=1
    for t in $args; do
      t="${t//\"/}"; t="${t//\'/}"
      case "$t" in
        --tags|--follow-tags|--mirror)
          block "\`git push $t\` would push release tags." ;;
        *'$'*|*'*'*|*'`'*)
          block "A push refspec with a variable or a glob ($t) can't be checked: push the tag by its literal name." ;;
      esac
      [ "$deleting" = 1 ] && continue
      case "$t" in :*) continue ;; esac # :refs/tags/v… deletes the tag
      dst="${t##*:}"; dst="${dst#+}"; dst="${dst#refs/}"; dst="${dst#tags/}"
      if printf '%s' "$dst" | grep -Eq '^v[0-9]+\.[0-9]+'; then
        need "${dst#v}" "Pushing the tag $dst"
      fi
    done
  fi

  if printf '%s' "$seg" | grep -Eq 'actions/workflows/[^ ]+/dispatches'; then
    block "Dispatching a workflow through the API is not allowed: use gh workflow run."
  fi

  # gh, any global options, workflow run.
  if printf '%s' "$seg" | grep -Eq '(^|[ (])gh( [^ ]+)* workflow( [^ ]+)* run( |$)'; then
    args="${seg#* workflow}"; args="${args#* run}"
    if printf '%s' "$args" | grep -Eq "(^|[ \"'=])(release|deploy-prod|desktop-release-prod)(\.ya?ml)?([ \"']|$)|Desktop Release \(production\)|(^|[ \"'])[0-9]+([ \"']|$)"; then
      tag=$(printf '%s' "$args" | grep -oE "(-f|-F|--field|--raw-field)[ =][\"']?tag=[\"']?v[0-9][^ \"']*" | head -1 | sed -E 's/.*tag=["'\'']?//')
      [ -n "$tag" ] || block "Running a production workflow (or one by numeric ID) without -f tag=vX.Y.Z."
      need "${tag#v}" "Running a production workflow for $tag"
    fi
  fi
done <<< "$pieces"

for m in "${consume[@]}"; do rm -f "$m"; done
exit 0
