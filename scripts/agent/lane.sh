#!/usr/bin/env bash
# Run Claude Code unattended for one lane (HV-1, AC6): bypass permissions, and only inside the srt
# sandbox with the network allowlist in .claude/sandbox/lane.srt.json. Production deploys are denied by
# .claude/settings.lane.json and guard-lane.sh (MODUO_LANE=1). Interactive sessions use auto mode.
#   bash scripts/agent/lane.sh "<prompt>" [more claude args…]     (run it from the lane's worktree)
# Needs srt: npm install -g @anthropic-ai/sandbox-runtime. Without it the lane refuses to start: bypass
# never runs unsandboxed. The shared git directory is writable (commits) except its hooks/ and config,
# so a lane can't plant a hook or rewrite the remote. Tests: scripts/agent/settings.test.ts.
set -euo pipefail
[ "$#" -ge 1 ] || { echo "usage: bash scripts/agent/lane.sh \"<prompt>\" [claude args…]" >&2; exit 64; }
command -v srt >/dev/null 2>&1 || {
  echo "lane: srt is not installed (npm install -g @anthropic-ai/sandbox-runtime). Lanes never run bypass outside the sandbox." >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || { echo "lane: jq is missing (brew install jq)." >&2; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "lane: claude is not on PATH." >&2; exit 1; }

root=$(git rev-parse --show-toplevel)
gitdir=$(git rev-parse --path-format=absolute --git-common-dir)
turbo=""
if [ -n "${TURBO_API:-}" ]; then turbo=${TURBO_API#*://}; turbo=${turbo%%/*}; fi
settings=$(mktemp "${TMPDIR:-/tmp}/lane-srt.XXXXXX")
trap 'rm -f "$settings"' EXIT
jq --arg root "$root" --arg git "$gitdir" --arg turbo "$turbo" '
  def abs: if startswith("/") or startswith("~") then . elif . == "." then $root else $root + "/" + . end;
  del(."$comment")
  | .filesystem.allowWrite = ([.filesystem.allowWrite[] | abs] + [$git])
  | .filesystem.denyWrite = ([.filesystem.denyWrite[] | abs] + [$git + "/hooks", $git + "/config"])
  | .filesystem.denyRead = [.filesystem.denyRead[] | abs]
  | if $turbo != "" then .network.allowedDomains += [$turbo] else . end
' "$root/.claude/sandbox/lane.srt.json" >"$settings"

cd "$root"
inner=$(printf '%q ' claude -p --permission-mode bypassPermissions --settings "$root/.claude/settings.lane.json" "$@")
MODUO_LANE=1 MODUO_LANE_SANDBOX=1 srt --settings "$settings" "$inner"
