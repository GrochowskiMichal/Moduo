#!/usr/bin/env bash
# Claude Code notification hook (Stop = block finished, Notification = needs input).
# Cross-platform and ALWAYS non-blocking: it fires a desktop notification where it
# can and otherwise no-ops. It never returns a blocking exit code, so it can never
# affect whether Claude stops. Args: $1 = title, $2 = message.
title="${1:-Claude Code}"
message="${2:-Done}"
case "$(uname -s 2>/dev/null || echo unknown)" in
  Darwin)
    osascript -e "display notification \"${message}\" with title \"${title}\"" >/dev/null 2>&1 || true
    ;;
  Linux)
    command -v notify-send >/dev/null 2>&1 && notify-send "${title}" "${message}" >/dev/null 2>&1 || true
    ;;
  *)
    : # other platforms (e.g. native Windows): no-op
    ;;
esac
exit 0
