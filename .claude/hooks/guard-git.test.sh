#!/usr/bin/env bash
# Tests for guard-git.sh (REL-6): long-lived branches protected, mirror branches no longer special.
#   bash .claude/hooks/guard-git.test.sh   (also run by scripts/agent/hooks.test.ts)
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
expect 2 '(git push --force origin t/mike/x)' 'force inside a subshell'
expect 2 'bash -c "git push --force origin t/mike/x"' 'force inside bash -c'
expect 2 '/usr/bin/git push --force origin t/mike/x' 'force through an absolute git path'
expect 2 '(git push origin refs/entire/checkpoints/v1)' 'Entire refs inside a subshell'
expect 2 '(cd x && git push origin develop)' 'push to develop inside a subshell'
expect 2 'echo $(git push origin develop)' 'push to develop inside a substitution'
expect 2 'git push origin "$(git branch --show-current)" --force' 'force after a substitution'
expect 2 'git push origin ${B} --force' 'force after a variable'
expect 2 'git push origin "$(git branch --show-current)" --mirror' 'mirror after a substitution'
expect 2 'git push origin "$(git branch --show-current)" refs/entire/checkpoints/v1' 'Entire refs after a substitution'
expect 2 'git push origin HEAD@{0}:develop' 'reflog source to develop'
expect 0 'git push -u origin "$(git branch --show-current)"' 'current branch by substitution'
cwd="$personal"
expect 2 'git push --force-with-lease' 'lease force, no refspec, while on mike'
expect 2 'git push origin HEAD:refs/heads/develop' 'HEAD to develop from mike'
expect 0 'git push' 'plain push while on mike (merge-back)'

# Branch switches in the main checkout (HV-1): blocked only while another Claude session works there.
git init -q "$tmp/main" && main=$(cd "$tmp/main" && pwd -P) && git -C "$main" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$main" branch t/mike/other
git -C "$main" worktree add -q "$tmp/wt" -b t/mike/wt
cwd="$main"
other=$(printf '424242\t%s' "$main")
GUARD_GIT_CLAUDE_CWDS="" expect 0 'git checkout t/mike/other' 'switch in main, no other session'
GUARD_GIT_CLAUDE_CWDS="$other" expect 2 'git checkout t/mike/other' 'checkout branch in main, another session there'
GUARD_GIT_CLAUDE_CWDS="$(printf '424242\t%s/apps/app' "$main")" expect 2 'git switch t/mike/other' 'switch, another session in a subfolder'
GUARD_GIT_CLAUDE_CWDS="$other" expect 2 'git checkout -b t/mike/new' 'checkout -b in main'
GUARD_GIT_CLAUDE_CWDS="$other" expect 2 'git status && git switch -c t/mike/new' 'switch -c in a chain'
GUARD_GIT_CLAUDE_CWDS="$other" expect 2 'git checkout -' 'checkout previous branch'
GUARD_GIT_CLAUDE_CWDS="$other" expect 0 'git checkout -- README.md' 'file restore in main'
GUARD_GIT_CLAUDE_CWDS="$other" expect 0 'git checkout t/mike/other -- README.md' 'file from another branch'
GUARD_GIT_CLAUDE_CWDS="$other" expect 0 'git checkout README.md' 'path that is not a branch'
GUARD_GIT_CLAUDE_CWDS="$other" expect 0 'git switch --help' 'help'
GUARD_GIT_CLAUDE_CWDS="$(printf '424242\t%s' "$tmp/wt")" expect 0 'git checkout t/mike/other' 'other session only in a worktree'
git -C "$main" worktree add -q "$main/.claude/worktrees/nested" -b t/mike/nested
GUARD_GIT_CLAUDE_CWDS="$(printf '424242\t%s/.claude/worktrees/nested' "$main")" expect 0 'git checkout t/mike/other' 'other session in a worktree nested in the main folder'
GUARD_GIT_CLAUDE_CWDS="$(printf '424242\t%s-old' "$main")" expect 0 'git checkout t/mike/other' 'sibling folder with the same prefix'
GUARD_GIT_CLAUDE_CWDS="$(printf '%s\t%s' "$$" "$main")" expect 0 'git checkout t/mike/other' 'only this session (an ancestor) is there'
cwd="$tmp/wt"
GUARD_GIT_CLAUDE_CWDS="$other" expect 0 'git switch t/mike/other' 'switch inside a linked worktree'
cwd="$task"
GUARD_GIT_CLAUDE_CWDS="$(printf '424242\t%s' "$main")" expect 2 "git -C $main checkout t/mike/other" 'git -C into the main checkout'

if [ "$fails" = 0 ]; then echo "guard-git: all passed"; else echo "guard-git: $fails failed"; exit 1; fi
