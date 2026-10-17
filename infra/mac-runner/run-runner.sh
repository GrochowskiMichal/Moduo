#!/bin/bash
# What the LaunchDaemon starts instead of the runner's own run.sh (setup.sh installs it root-owned
# under /Library/Moduo/mac-runner). run.sh copies run-helper.sh.template to run-helper.sh, a file
# moduo-ci would own, on every start and runs the copy, so a job could rewrite what the next start
# runs. This runs the root-owned template itself, with run.sh's restart rule.
RUNNER_DIR=/Library/Moduo/actions-runner
while :; do
  /bin/bash "$RUNNER_DIR/run-helper.sh.template" "$@"
  rc=$?
  if [ "$rc" = 2 ]; then
    echo "Restarting runner..."
    continue
  fi
  echo "Exiting runner (exit $rc); launchd starts it again."
  exit 0
done
