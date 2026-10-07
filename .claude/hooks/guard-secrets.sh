#!/usr/bin/env bash
# PreToolUse (Bash; filters itself to `git commit`): block commits whose staged changes contain a
# secret. AGENTS.md rule 2. Needs gitleaks 8.19+ (brew install gitleaks); without
# it the hook warns and lets the commit through, and CI still scans the push.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in *"git commit"*) ;; *) exit 0 ;; esac

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed, so staged changes were not scanned for secrets. Install it: brew install gitleaks" >&2
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
scope="--staged"
# `git commit -a` / `-am` stages tracked changes at commit time: scan the working tree too.
if printf '%s' "$cmd" | grep -Eq -- '(^| )(-[a-zA-Z]*a[a-zA-Z]*|--all)( |$)'; then scope=""; fi
if ! out=$(gitleaks git --pre-commit $scope --redact --no-banner --no-color 2>&1); then
  {
    echo "Blocked: gitleaks found a secret in the staged changes. Remove it from the file, read it from an env var instead, and rotate it if it was ever pushed."
    printf '%s\n' "$out" | tail -20
  } >&2
  exit 2
fi
exit 0
