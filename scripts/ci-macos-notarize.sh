#!/usr/bin/env bash
# Apple notarization for CI, in three steps so a slow Apple queue never costs a rebuild.
#
#   ci-macos-notarize.sh check                 fail in seconds if Apple rejects the login
#   ci-macos-notarize.sh submit <file>         upload without waiting, print the submission id
#   ci-macos-notarize.sh wait <id> [<file>]    wait (bounded), staple <file> on success, print Apple's log on rejection
#
# `wait` exits 0 when accepted (and stapled), 1 when Apple rejected the build, 3 when Apple is still
# processing. Without <file> it staples nothing: a zipped .app (the per-arch updater apps) can't be
# stapled, and Gatekeeper checks its ticket online.
#
#   ci-macos-notarize.sh wait-all <dir>        `wait` on every submission a Mac build made, in parallel:
#                                              <dir>/notary-id.txt (the .dmg, stapled: <dir>/Moduo_universal.dmg)
#                                              and each <dir>/notary-id-<arch>.txt (a zipped per-arch .app).
#                                              Exits 1 if any was rejected, else 3 if any is still processing.
#
# Auth: the notarytool keychain profile NOTARY_KEYCHAIN_PROFILE (in NOTARY_KEYCHAIN) when set, as on
# the moduo-mac runner; else an App Store Connect API key when APPLE_API_KEY_ID / APPLE_API_ISSUER / APPLE_API_KEY_P8
# (the .p8 contents) are set, otherwise APPLE_ID / APPLE_ID_PASSWORD (app-specific password) / APPLE_TEAM_ID.
# NOTARY_WAIT_TIMEOUT (default 60m) bounds `wait`; a timeout leaves the submission running at Apple,
# and re-running the job waits on the same id again.
set -euo pipefail

trim() { printf '%s' "$1" | tr -d '[:space:]'; }

AUTH=()
# The moduo-mac runner (infra/mac-runner) keeps its login as a notarytool profile in its own keychain.
if [[ -n "${NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
  AUTH=(--keychain-profile "$NOTARY_KEYCHAIN_PROFILE" ${NOTARY_KEYCHAIN:+--keychain "$NOTARY_KEYCHAIN"})
elif [[ -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_P8:-}" ]]; then
  KEY_PATH="${RUNNER_TEMP:-/tmp}/AuthKey_$(trim "$APPLE_API_KEY_ID").p8"
  printf '%s\n' "$APPLE_API_KEY_P8" > "$KEY_PATH"
  AUTH=(--key "$KEY_PATH" --key-id "$(trim "$APPLE_API_KEY_ID")" --issuer "$(trim "$APPLE_API_ISSUER")")
else
  for v in APPLE_ID APPLE_ID_PASSWORD APPLE_TEAM_ID; do
    [[ -n "${!v:-}" ]] || { echo "::error::$v is empty — set it in the repo's Actions secrets."; exit 1; }
  done
  AUTH=(--apple-id "$(trim "$APPLE_ID")" --password "$(trim "$APPLE_ID_PASSWORD")" --team-id "$(trim "$APPLE_TEAM_ID")")
fi

# notarytool talks to Apple over the network; retry transient failures, not rejections.
with_retry() {
  local n
  for n in 1 2 3; do
    if "$@"; then return 0; fi
    echo "notarytool call failed (attempt $n/3), retrying in $((n * 15))s…" >&2
    sleep $((n * 15))
  done
  return 1
}

cmd="${1:-}"; shift || true
case "$cmd" in
  check)
    if ! out=$(xcrun notarytool history "${AUTH[@]}" --output-format json 2>&1); then
      echo "$out" >&2
      if [[ -n "${NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
        echo "::error::Apple rejected the runner's stored notarization login. On the Mac: sudo -u moduo-ci -H xcrun notarytool store-credentials $NOTARY_KEYCHAIN_PROFILE --keychain ${NOTARY_KEYCHAIN:-<keychain>}"
      else
        echo "::error::Apple rejected the notarization login. Regenerate the app-specific password at appleid.apple.com and update APPLE_ID_PASSWORD (or switch to an App Store Connect API key)."
      fi
      exit 1
    fi
    # Anything still "In Progress" from earlier runs is a sign Apple's queue is slow right now.
    printf '%s' "$out" | python3 -c '
import json, sys
h = json.load(sys.stdin).get("history", [])
pending = [s for s in h if s.get("status") == "In Progress"]
print("Apple login OK. Recent submissions: %d, still in progress: %d" % (len(h), len(pending)))
for s in pending[:5]:
    print("  in progress since %s: %s (%s)" % (s.get("createdDate"), s.get("id"), s.get("name")))
'
    ;;

  submit)
    file="$1"
    out=$(with_retry xcrun notarytool submit "$file" "${AUTH[@]}" --no-wait --output-format json)
    id=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
    echo "Submitted $(basename "$file") to Apple: $id" >&2
    echo "$id"
    ;;

  wait)
    id="$1"; file="${2:-}"
    timeout="${NOTARY_WAIT_TIMEOUT:-60m}"
    echo "Waiting up to $timeout for Apple to finish submission ${id}..."
    set +e
    out=$(xcrun notarytool wait "$id" "${AUTH[@]}" --timeout "$timeout" --output-format json 2>&1)
    set -e
    status=$(printf '%s' "$out" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("status",""))
except Exception: print("")' 2>/dev/null || true)
    echo "Apple status: ${status:-unknown}"
    case "$status" in
      Accepted)
        if [[ -n "$file" ]]; then
          with_retry xcrun stapler staple "$file"
          xcrun stapler validate "$file"
        fi
        ;;
      Invalid|Rejected)
        echo "::error::Apple rejected the build. Its log:"
        xcrun notarytool log "$id" "${AUTH[@]}" || true
        exit 1
        ;;
      *)
        echo "$out"
        echo "::warning::Apple has not finished submission $id after $timeout. That is Apple's queue, not the build."
        exit 3
        ;;
    esac
    ;;

  wait-all)
    dir="$1"
    [[ -f "$dir/notary-id.txt" ]] || { echo "::error::$dir/notary-id.txt is missing."; exit 1; }
    pids=(); names=()
    bash "$0" wait "$(cat "$dir/notary-id.txt")" "$dir/Moduo_universal.dmg" > "$dir/.notary-dmg.log" 2>&1 &
    pids+=($!); names+=(dmg)
    for idfile in "$dir"/notary-id-*.txt; do
      [[ -f "$idfile" ]] || continue
      arch="${idfile##*/notary-id-}"; arch="${arch%.txt}"
      bash "$0" wait "$(cat "$idfile")" > "$dir/.notary-$arch.log" 2>&1 &
      pids+=($!); names+=("$arch")
    done
    rejected=0; pending=0
    for i in "${!pids[@]}"; do
      set +e; wait "${pids[$i]}"; code=$?; set -e
      echo "── ${names[$i]} (exit $code)"
      cat "$dir/.notary-${names[$i]}.log"; rm -f "$dir/.notary-${names[$i]}.log"
      case $code in
        0) ;;
        3) pending=1 ;;
        *) rejected=1 ;;
      esac
    done
    [[ $rejected = 0 ]] || exit 1
    [[ $pending = 0 ]] || exit 3
    ;;

  *)
    echo "usage: $0 check | submit <file> | wait <id> [<file>] | wait-all <dir>" >&2
    exit 2
    ;;
esac
