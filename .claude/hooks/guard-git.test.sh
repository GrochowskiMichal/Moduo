#!/usr/bin/env bash
# Tests for guard-git.sh (REL-6): long-lived branches protected, mirror branches no longer special.
#   bash .claude/hooks/guard-git.test.sh   (also run by scripts/release/guard-git.test.ts)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/guard-git.sh"
fails=0
# Two checkouts for pushes without a refspec: one on a task branch, one on mike.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for b in t/mike/x mike; do
  d="$tmp/${b//\//-}"; git init -q "$d" && git -C "$d" symbolic-ref HEAD "refs/heads/$b"
done
task="$tmp/t-mike-x"; personal="$tmp/mike"
cwd="$task"

expect() { # expect <code> <command> <label>   (runs in $cwd)
  local got
  jq -n --arg c "$2" --arg d "$cwd" '{tool_input: {command: $c}, cwd: $d}' | bash "$hook" 2>/dev/null
  got=$?
  if [ "$got" = "$1" ]; then echo "ok   $3"; else echo "FAIL $3 (exit $got, want $1)"; fails=$((fails + 1)); fi
}

# Allowed.
expect 0 'git status' 'not a push'
expect 0 'git push -u origin t/mike/rel-6-branches' 'task branch push'
expect 0 'git push --force-with-lease origin t/mike/rel-6-branches' 'lease force on a task branch'
expect 0 'git push origin mike' 'personal branch push (develop merge-back)'
expect 0 'git push origin HEAD:maciej' 'personal branch push via refspec'
expect 0 'git push origin --delete t/mike/old-task claude/foo-123' 'deleting task branches'
expect 0 'git push origin :t/mike/old-task' 'deleting a task branch (refspec)'
expect 0 'git push origin --delete prod-app staging-app prod-landing' 'deleting retired mirror branches'
expect 0 'git push origin --delete main' 'deleting main (retired)'
expect 0 'git push origin release/v1.3.0' 'release branch push'
expect 0 'git push origin develop-notes' 'branch whose name starts with develop'
expect 0 'git switch t/mike/push-fix && git push -u origin t/mike/push-fix' 'branch name containing push'
expect 0 'git commit -m "guard push develop" && git push -u origin t/mike/rel-6' 'commit message mentioning push develop'
expect 0 'git push --force-with-lease' 'lease force, no refspec, on a task branch'
expect 0 'git push --force-with-lease=refs/heads/t/mike/a:abc123 origin :refs/heads/t/mike/a' 'leased deletion of a task branch'
expect 0 'git push origin v1.2.0' 'tag push (guard-release.sh decides)'
expect 0 'git push' 'plain push on a task branch'

# Blocked.
expect 2 'git push origin develop' 'direct push to develop'
expect 2 'git push origin HEAD:refs/heads/develop' 'direct push to develop (full ref)'
expect 2 'git -C /x push origin "develop"' 'direct push to develop, quoted, with -C'
expect 2 'git push origin --delete mike' 'deleting mike'
expect 2 'git push origin -d maciej' 'deleting maciej (-d)'
expect 2 'git push origin :develop' 'deleting develop (refspec)'
expect 2 'git push origin --delete t/mike/x maciej' 'deleting maciej among others'
expect 2 'git push --force-with-lease origin mike' 'lease force on mike'
expect 2 'git push origin +maciej' 'plus-refspec force on maciej'
expect 2 'git push -f origin t/mike/x' 'bare force on a task branch'
expect 2 'git push --force origin t/mike/x' 'bare --force'
expect 2 'git push origin refs/entire/checkpoints' 'Entire refs'
expect 2 'git push --mirror origin' 'mirror push'
expect 2 'git fetch && git push origin develop' 'chained push to develop'
expect 2 'git commit -m "push fix" && git push origin develop' 'push to develop after a message mentioning push'
expect 2 'git push origin t/mike/x && git push origin develop' 'second push in a chain'
expect 2 'git push origin t/mike/x; git push --force origin maciej' 'force after a semicolon'
expect 2 $'git push origin \\\ndevelop' 'push to develop across a line continuation'
expect 2 $'git status\ngit push origin develop' 'push to develop on a second line'
expect 2 "git push origin '+HEAD:mike'" 'quoted plus-refspec on mike'
expect 2 'git push origin "+t/mike/x"' 'quoted plus-refspec on a task branch'
expect 2 'git push -qd origin maciej' 'combined short flags deleting maciej'
expect 2 'git push --prune origin "refs/heads/*:refs/heads/*"' 'prune'
expect 2 'git push --all origin' 'push --all'
expect 2 'git push -u -q origin develop' 'short flags before the refspec'
cwd="$personal"
expect 2 'git push --force-with-lease' 'lease force, no refspec, while on mike'
expect 2 'git push origin HEAD:refs/heads/develop' 'HEAD to develop from mike'
expect 0 'git push' 'plain push while on mike (merge-back)'

if [ "$fails" = 0 ]; then echo "guard-git: all passed"; else echo "guard-git: $fails failed"; exit 1; fi
