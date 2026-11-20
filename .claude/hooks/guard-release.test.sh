#!/usr/bin/env bash
# Tests for guard-release.sh (AC6): blocks without a marker, allows once with it, consumes it.
#   bash .claude/hooks/guard-release.test.sh   (also run by scripts/agent/hooks.test.ts)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/guard-release.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
git -C "$root" init -q
export CLAUDE_PROJECT_DIR="$root"
markers="$root/.claude/release-approved"
fails=0

run() { # run <command> → the hook's exit code
  jq -n --arg c "$1" --arg d "$root" '{tool_input: {command: $c}, cwd: $d}' | bash "$hook" 2>/dev/null
}
expect() { # expect <code> <command> <label>
  local got
  run "$2"; got=$?
  if [ "$got" = "$1" ]; then echo "ok   $3"; else echo "FAIL $3 (exit $got, want $1)"; fails=$((fails + 1)); fi
}
approve() { mkdir -p "$markers" && touch "$markers/$1"; }

# Not a release: allowed.
expect 0 'git status' 'unrelated command'
expect 0 'git push -u origin t/mike/rel-3-ship' 'task branch push'
expect 0 'git push origin release/v1.2.0' 'release branch push'
expect 0 'gh workflow run app-staging.yml' 'staging workflow'
expect 0 'git push origin --delete v9.9.9' 'tag deletion'
expect 0 'git push origin :refs/tags/v9.9.9' 'tag deletion (refspec)'
expect 0 'git push origin v2-redesign' 'branch that starts with v and a digit'
expect 0 'gh workflow run app-staging.yml -f note=v1.2.0' 'staging workflow with a version in a field'

# No marker: blocked.
expect 2 'git push origin v1.2.0' 'tag push'
expect 2 'git push origin refs/tags/v1.2.0' 'tag push (refs/tags)'
expect 2 'git fetch && git push origin "v1.2.0"' 'tag push, quoted, chained'
expect 2 'git push --tags' 'push --tags'
expect 2 'git push --follow-tags origin develop' 'push --follow-tags'
expect 2 'gh workflow run deploy-prod.yml -f tag=v1.2.0 -f target=web' 'deploy-prod'
expect 2 'gh workflow run "Desktop Release (production)" -f tag=v1.2.0' 'desktop-release-prod by name'
expect 2 'gh workflow run desktop-release-prod.yml' 'desktop-release-prod without a tag'
expect 2 'gh workflow run release' 'release'
expect 2 'gh api repos/o/r/actions/workflows/deploy-prod.yml/dispatches -f ref=develop' 'API dispatch'
expect 2 'gh api repos/o/r/actions/workflows/123456/dispatches -f ref=develop' 'API dispatch by ID'
expect 2 'git push origin tags/v1.2.0' 'tag push (tags/)'
expect 2 "git push origin 'refs/tags/*'" 'glob refspec'
expect 2 "git push origin 'refs/tags/v*:refs/tags/v*'" 'glob src:dst refspec'
expect 2 'git push --mirror origin' 'push --mirror'
expect 2 't=v1.2.0; git push origin "$t"' 'tag in a variable'
expect 2 $'git push origin \\\n  v1.2.0' 'line continuation'
expect 2 'git --no-pager push origin v1.2.0' 'git global option'
expect 2 'git -C "/a b" push origin v1.2.0' 'git -C with a space'
expect 2 'gh workflow run 123456 -f tag=v1.2.0' 'workflow by numeric ID'
expect 2 'gh --repo=o/r workflow run deploy-prod.yml -f tag=v1.2.0' 'gh --repo= before workflow'

# A marker for another version doesn't count.
approve 1.2.1
expect 2 'git push origin v1.2.0' 'marker for another version'

# A stale marker doesn't count.
approve 1.2.0
touch -t 202001010000 "$markers/1.2.0"
expect 2 'git push origin v1.2.0' 'stale marker'

# With a fresh marker: allowed once, and the marker is consumed.
approve 1.2.0
expect 0 'git push origin v1.2.0' 'tag push with marker'
if [ -e "$markers/1.2.0" ]; then echo "FAIL marker consumed"; fails=$((fails + 1)); else echo "ok   marker consumed"; fi
expect 2 'git push origin v1.2.0' 'second push after consumption'

approve 1.2.0
expect 0 'gh workflow run deploy-prod.yml -f tag=v1.2.0 -f target=web' 'deploy-prod with marker'
expect 2 'gh workflow run deploy-prod.yml -f tag=v1.2.0 -f target=web' 'deploy-prod again'

# The marker is also found through the command's checkout, not only CLAUDE_PROJECT_DIR.
approve 1.2.0
CLAUDE_PROJECT_DIR=/nonexistent expect 0 'git push origin v1.2.0' 'marker found through cwd'

[ "$fails" = 0 ] && echo "guard-release: all passed" || { echo "guard-release: $fails failed"; exit 1; }
