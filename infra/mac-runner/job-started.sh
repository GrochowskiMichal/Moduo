#!/bin/bash
# Job-started hook of the moduo-mac self-hosted runner (ACTIONS_RUNNER_HOOK_JOB_STARTED, set in the
# root-owned launchd plist; setup.sh installs this file root-owned under /Library/Moduo/mac-runner).
#
# The runner runs it before any step of every job it picks up. A non-zero exit fails the job before
# the job's own code runs, so this is the Mac's own gate, independent of what a workflow asks for:
# a fork pull request that edits a workflow to say `runs-on: moduo-mac` still stops here.
#
# Allowed (spec platform-v2 AC13): push to develop or mike, a v* tag, and a manual dispatch (or a
# re-run) by the repository owner. Everything else, pull_request and schedule included, is refused.
#
# It also keeps the Mac from idle-sleeping while the job runs (the runner's orphan-process cleanup
# ends caffeinate when the job ends; -t caps it anyway) and drops the shared Cargo target directory
# when it outgrows its budget.
set -euo pipefail
# Only system tools: moduo-ci's own bin dirs (cargo, bun) come first in the job PATH.
PATH=/usr/bin:/bin:/usr/sbin:/sbin

refuse() {
  echo "::error::moduo-mac refuses this job: $1. Only pushes to develop/mike, v* tags and the owner's manual runs may use it."
  exit 1
}

event="${GITHUB_EVENT_NAME:-}"
ref="${GITHUB_REF:-}"
owner="${GITHUB_REPOSITORY_OWNER:-}"
# A re-run's triggering actor is whoever pressed re-run; GITHUB_ACTOR stays the original author.
actor="${GITHUB_TRIGGERING_ACTOR:-${GITHUB_ACTOR:-}}"

case "$event" in
  push)
    case "$ref" in
      refs/heads/develop | refs/heads/mike | refs/tags/v*) ;;
      *) refuse "push to $ref" ;;
    esac
    ;;
  workflow_dispatch)
    [ -n "$owner" ] && [ "$actor" = "$owner" ] || refuse "manual run by ${actor:-unknown}, not the owner"
    ;;
  *) refuse "event ${event:-unknown}" ;;
esac

# Exit here when only checking the rules (setup.sh --verify runs this file with fake events).
[ "${MODUO_HOOK_DRY_RUN:-}" = 1 ] && exit 0

echo "moduo-mac accepted: $event on $ref by $actor"

# Universal release builds add a few GB per toolchain bump; start over past the budget.
target="${CARGO_TARGET_DIR:-}"
if [ -n "$target" ] && [ -d "$target" ]; then
  size_gb="$(du -sg "$target" 2>/dev/null | tail -1 | cut -f1 || true)"
  if [[ "$size_gb" =~ ^[0-9]+$ ]] && [ "$size_gb" -gt "${MODUO_TARGET_BUDGET_GB:-60}" ]; then
    echo "Cargo target dir is ${size_gb} GB; clearing it (next build is cold)."
    rm -rf "$target"
  fi
fi

nohup caffeinate -i -s -t 10800 >/dev/null 2>&1 &
