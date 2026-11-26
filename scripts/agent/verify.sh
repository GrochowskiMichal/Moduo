#!/usr/bin/env bash
# `bun run verify`: the block-done gate. A person at a terminal (or CI, or
# VERIFY_FULL=1) gets the full stream; anything else (an agent, a pipe) gets
# the exit code, the failure lines and a short tail through quiet.sh, with the
# full log on disk. A passing run printed about 250 KB into a session before
# this (2026-11-26).
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.." || exit 1
if [ -t 1 ] || [ -n "${CI:-}" ] || [ -n "${VERIFY_FULL:-}" ]; then
  exec bun run verify:full "$@"
fi
exec "$here/quiet.sh" verify bun run verify:full "$@"
