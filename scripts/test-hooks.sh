#!/usr/bin/env bash
# Fixture tests for the Claude Code guard hooks in .claude/hooks/. Each guard
# reads a tool call as JSON on stdin and blocks with exit 2. These tests feed
# known-good and known-bad calls and check the verdict, so the harness rules in
# AGENTS.md are proven by CI instead of by a human checklist.
#   bun run test:hooks
set -u
cd "$(dirname "$0")/.." || exit 1
export CLAUDE_PROJECT_DIR="$PWD"
H=.claude/hooks
pass=0; fail=0; skip=0
ok()   { pass=$((pass+1)); echo "PASS  $1"; }
bad()  { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
skp()  { skip=$((skip+1)); echo "SKIP  $1"; }

# expect <name> <expected-exit> <hook> <json>
expect() {
  local name="$1" want="$2" hook="$3" json="$4" got
  printf '%s' "$json" | bash "$hook" >/dev/null 2>&1; got=$?
  if [ "$got" = "$want" ]; then ok "$name"; else bad "$name" "exit $got, expected $want"; fi
}
bashcall() { printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(printf '%s' "$1" | jq -Rs .)"; }

echo "## guard-git.sh"
expect "blocks a push to develop"            2 $H/guard-git.sh "$(bashcall 'git push origin develop')"
expect "blocks a push to main via refspec"   2 $H/guard-git.sh "$(bashcall 'git push origin HEAD:main')"
expect "blocks a push to prod-app"           2 $H/guard-git.sh "$(bashcall 'git push -u origin prod-app')"
expect "blocks publishing refs/entire"       2 $H/guard-git.sh "$(bashcall 'git push origin refs/entire/abc')"
expect "blocks a bare force-push"            2 $H/guard-git.sh "$(bashcall 'git push --force origin t/mike/x')"
expect "blocks -f"                           2 $H/guard-git.sh "$(bashcall 'git push -f origin t/mike/x')"
expect "allows a task-branch push"           0 $H/guard-git.sh "$(bashcall 'git push -u origin t/mike/x')"
expect "allows --force-with-lease"           0 $H/guard-git.sh "$(bashcall 'git push --force-with-lease origin t/mike/x')"
expect "allows a push to the personal branch" 0 $H/guard-git.sh "$(bashcall 'git push origin mike')"
expect "ignores a non-push command"          0 $H/guard-git.sh "$(bashcall 'git status && echo develop')"
expect "allows develop after && (not this push)" 0 $H/guard-git.sh "$(bashcall 'git push origin t/mike/x && git checkout develop')"

echo "## guard-secrets.sh"
if command -v gitleaks >/dev/null 2>&1; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT INT TERM
  git -C "$tmp" init -q && git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
  # Built at runtime so no secret-shaped literal sits in this file.
  key="sk_live_$(openssl rand -hex 16)"
  printf 'const stripe = "%s";\n' "$key" > "$tmp/config.ts"
  git -C "$tmp" add config.ts
  ( export CLAUDE_PROJECT_DIR="$tmp"; cd "$tmp" && printf '%s' "$(bashcall 'git commit -m x')" | bash "$OLDPWD/$H/guard-secrets.sh" >/dev/null 2>&1 ); got=$?
  [ "$got" = 2 ] && ok "blocks a commit with a staged live key" || bad "blocks a commit with a staged live key" "exit $got"
  printf 'const stripe = process.env.STRIPE_KEY;\n' > "$tmp/config.ts"; git -C "$tmp" add config.ts
  ( export CLAUDE_PROJECT_DIR="$tmp"; cd "$tmp" && printf '%s' "$(bashcall 'git commit -m x')" | bash "$OLDPWD/$H/guard-secrets.sh" >/dev/null 2>&1 ); got=$?
  [ "$got" = 0 ] && ok "allows a clean commit" || bad "allows a clean commit" "exit $got"
  expect "ignores a non-commit command" 0 $H/guard-secrets.sh "$(bashcall 'git status')"
else
  skp "guard-secrets (gitleaks not installed: brew install gitleaks)"
fi

echo "## guard-design-tokens.sh"
expect "ignores a test file"    0 $H/guard-design-tokens.sh '{"tool_input":{"file_path":"'"$PWD"'/src/x.test.tsx"}}'
expect "ignores a non-src file" 0 $H/guard-design-tokens.sh '{"tool_input":{"file_path":"'"$PWD"'/docs/x.md"}}'
if [ "${HOOK_TESTS_FAST:-}" = "1" ]; then
  skp "design gate on a raw hex class (HOOK_TESTS_FAST=1)"
else
  probe="src/__hook_probe__.tsx"
  trap 'rm -f "$probe"; rm -rf "${tmp:-}" "${ltmp:-}"' EXIT INT TERM
  printf 'export const Probe = () => <div className="bg-[#ff0000]" />;\n' > "$probe"
  # A private TMPDIR so another session's design-gate lock can't make the hook exit 0 early.
  ltmp=$(mktemp -d)
  printf '{"tool_input":{"file_path":"%s/%s"}}' "$PWD" "$probe" | TMPDIR="$ltmp" bash $H/guard-design-tokens.sh >/dev/null 2>&1; got=$?
  rm -f "$probe"
  [ "$got" = 2 ] && ok "wakes Claude on a raw hex class" || bad "wakes Claude on a raw hex class" "exit $got"
fi

echo "## guard-prod-db.sh"
outp=$(printf '{"tool_name":"mcp__supabase__execute_sql","tool_input":{}}' | bash $H/guard-prod-db.sh 2>/dev/null)
printf '%s' "$outp" | jq -e '.hookSpecificOutput.permissionDecision == "ask"' >/dev/null 2>&1 \
  && ok "asks before a Supabase write" || bad "asks before a Supabase write" "$outp"

echo "## session-title.sh"
tdir=$(mktemp -d); mkdir -p "$tdir/.claude"; printf '[Harness] probe\n' > "$tdir/.claude/SESSION_TITLE"
outp=$(CLAUDE_PROJECT_DIR="$tdir" bash $H/session-title.sh); rm -rf "$tdir"
printf '%s' "$outp" | jq -e '.hookSpecificOutput.sessionTitle == "[Harness] probe"' >/dev/null 2>&1 \
  && ok "applies .claude/SESSION_TITLE" || bad "applies .claude/SESSION_TITLE" "$outp"

echo
echo "hooks: $pass passed, $fail failed, $skip skipped"
[ "$fail" = 0 ]
