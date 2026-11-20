#!/usr/bin/env bash
# Tests for guard-glob.sh (HV-1, AC9): unquoted globs that match nothing are blocked with the
# quoted command; quoted, matching or non-glob words pass.
#   bash .claude/hooks/guard-glob.test.sh   (also run by scripts/agent/hooks.test.ts)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/guard-glob.sh"
fails=0
cwd="$(mktemp -d)"
trap 'rm -rf "$cwd"' EXIT
touch "$cwd/a.ts" "$cwd/b.ts"
mkdir "$cwd/docs" && touch "$cwd/docs/x.md"

run() { jq -n --arg c "$1" --arg d "$cwd" '{tool_input: {command: $c}, cwd: $d}' | bash "$hook" 2>&1; }
expect() { # expect <code> <command> <label>
  run "$2" >/dev/null
  local got=$?
  if [ "$got" = "$1" ]; then echo "ok   $3"; else echo "FAIL $3 (exit $got, want $1)"; fails=$((fails + 1)); fi
}
expect_fix() { # expect_fix <command> <fixed command> <label>
  local out
  out=$(run "$1")
  if printf '%s' "$out" | tail -1 | grep -qxF -- "$2"; then echo "ok   $3"; else
    echo "FAIL $3 (got: $out)"; fails=$((fails + 1)); fi
}

# Allowed.
expect 0 'git status' 'no glob at all'
expect 0 "grep -rn foo --include='*.md' ." 'quoted --include'
expect 0 'grep -rn foo --include="*.md" .' 'double-quoted --include'
expect 0 'grep -rn foo --include=\*.md .' 'escaped glob'
expect 0 'ls *.ts' 'glob that matches files'
expect 0 'ls docs/*.md' 'glob with a directory that matches'
expect 0 'cat <<EOF
*.nothing --include=*.md
EOF' 'heredoc body'
expect 0 "cat <<'EOF' > f.txt
what?
EOF
echo done" 'quoted heredoc then a command'
expect 0 'echo hi # what?' 'comment'
expect 0 '[[ $f == *.md ]] && echo yes' 'pattern inside [[ ]]'
expect 0 'echo $(( 2 * 3 ))' 'arithmetic'
expect 0 'for f in $dir/*.nothing; do echo "$f"; done' 'word with a variable'
expect 0 'case $x in *.md) echo md ;; esac' 'case patterns'
expect 0 'noglob grep x --include=*.md .' 'noglob'
expect 0 'X=*.nothing env' 'assignment'
expect 0 'cd sub && ls *.nothing' 'plain glob after cd is not judged'
expect 0 '[ -f a.ts ] && echo ok' 'test brackets'
expect 0 'gh pr list --json number,title' 'no glob characters'

# Blocked.
expect 2 'grep -rn foo --include=*.md .' 'unquoted --include'
expect 2 'rg foo --glob=*.tsx' 'unquoted --glob'
expect 2 'ls *.nothing' 'glob that matches nothing'
expect 2 'curl https://example.com/a?b=c' 'unquoted ? in a URL'
expect 2 'git add a.ts && grep -n x --include=*.md -r .' 'second command in a chain'
expect 2 'echo $(grep -r x --include=*.md .)' 'inside a command substitution'
expect 2 'cd sub && grep -rn x --include=*.md .' '--opt=glob after cd'

# The printed fix quotes only the pattern.
expect_fix 'grep -rn foo --include=*.md .' "grep -rn foo --include='*.md' ." 'fix for --include'
expect_fix 'ls *.nothing docs/*.md' "ls '*.nothing' docs/*.md" 'fix quotes only the failing word'
expect_fix 'grep -rn x --include=*.md --exclude=*.lock .' "grep -rn x --include='*.md' --exclude='*.lock' ." 'fix for two words'

if [ "$fails" = 0 ]; then echo "guard-glob: all passed"; else echo "guard-glob: $fails failed"; exit 1; fi
