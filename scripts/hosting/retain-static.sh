#!/usr/bin/env bash
# Old-chunk retention for the web app on Cloudflare (specs/platform-v2.md, PLAT-4, AC8).
#
# Workers static assets serve only the files of the deployed version, so a tab opened on the
# previous build would 404 on its lazy chunks right after a deploy. Each deploy therefore uploads
# its own static/ plus the hashed files of the previous 3 builds of the same lane.
#
#   retain-static.sh merge  <lane> <build> <dist>   before the upload
#   retain-static.sh record <lane> <build>          after a successful upload
#
# merge:  packs <dist>/static as this build's tarball (before anything is added), then unpacks
#         the last 3 recorded builds of <lane> into <dist> without overwriting a current file,
#         and writes the newest previous build's file list to $RUNNER_TEMP/web-builds/previous-static.txt
#         (scripts/smoke-hosting.ts --old checks a sample after the deploy).
# record: uploads this build's tarball to R2 builds/<build>/static.tar.gz (production:
#         builds/production/<build>/…, because a prod build of the same commit has other hashes
#         in the chunks that carry the version label) and puts it first in
#         lanes/<lane>.json (newest first, 10 kept).
#
# Lanes: "staging", "production" (PLAT-8), "pr-<n>" for previews. Bucket moduo-web-builds; record
# creates it on first use, with builds/ and lanes/pr- expiring after 60 days. Needs
# CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, jq and rsync.
set -euo pipefail

BUCKET="${WEB_BUILDS_BUCKET:-moduo-web-builds}"
WRANGLER="${WRANGLER:-npx --yes wrangler@4.147.0}"
TMP="${RUNNER_TEMP:-/tmp}/web-builds"
KEEP_PREVIOUS=3

cmd="${1:-}"; lane="${2:-}"; build="${3:-}"
[[ "$lane" =~ ^(staging|production|pr-[0-9]+)$ ]] || { echo "bad lane: $lane" >&2; exit 2; }
[[ "$build" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad build id: $build" >&2; exit 2; }
mkdir -p "$TMP"

# Returns 1 only for a missing object; any other failure (auth, network) stops the script, so
# a transient error can't silently reset a lane's history.
r2_get() {
  local out
  if out=$($WRANGLER r2 object get "$BUCKET/$1" --remote --file "$2" 2>&1); then return 0; fi
  if grep -qiE "does not exist|not found|NoSuchKey|10007" <<< "$out"; then return 1; fi
  echo "$out" >&2
  echo "::error::reading R2 $BUCKET/$1 failed" >&2
  exit 1
}
r2_put() { $WRANGLER r2 object put "$BUCKET/$1" --remote --file "$2" --content-type "$3" >/dev/null; }

ensure_bucket() {
  if ! $WRANGLER r2 bucket info "$BUCKET" >/dev/null 2>&1; then
    $WRANGLER r2 bucket create "$BUCKET"
  fi
  local rules
  rules=$($WRANGLER r2 bucket lifecycle list "$BUCKET")
  grep -q expire-builds <<< "$rules" \
    || $WRANGLER r2 bucket lifecycle add "$BUCKET" expire-builds builds/ --expire-days 60 --force
  grep -q expire-pr-lanes <<< "$rules" \
    || $WRANGLER r2 bucket lifecycle add "$BUCKET" expire-pr-lanes lanes/pr- --expire-days 60 --force
}

# R2 key of a build's tarball in this lane.
tarball() { if [ "$lane" = production ]; then echo "builds/production/$1/static.tar.gz"; else echo "builds/$1/static.tar.gz"; fi; }

# The lane's recorded builds, newest first, one per line ("" when the lane is new).
lane_builds() {
  if r2_get "lanes/$lane.json" "$TMP/lane.json"; then
    jq -r '.[]' "$TMP/lane.json"
  fi
}

case "$cmd" in
  merge)
    dist="${4:?dist dir}"
    [ -d "$dist/static" ] || { echo "no $dist/static" >&2; exit 1; }
    tar -czf "$TMP/$build.tar.gz" -C "$dist" static
    : > "$TMP/previous-static.txt"
    # Read in the main shell (not a pipe or <(…)), so a failed read stops the script.
    builds=$(lane_builds)
    n=0
    first=true
    while IFS= read -r prev; do
      [ -n "$prev" ] && [ "$prev" != "$build" ] || continue
      [ "$n" -lt "$KEEP_PREVIOUS" ] || break
      if ! r2_get "$(tarball "$prev")" "$TMP/prev.tar.gz"; then
        echo "::warning::build $prev of lane $lane is no longer in R2 (expired?); skipped"
        continue
      fi
      if [ "$first" = true ]; then
        tar -tzf "$TMP/prev.tar.gz" | grep -v '/$' | sed 's|^|/|' | while IFS= read -r f; do
          [ -e "$dist$f" ] || echo "$f"
        done > "$TMP/previous-static.txt"
        first=false
      fi
      rm -rf "$TMP/prev" && mkdir -p "$TMP/prev"
      tar -xzf "$TMP/prev.tar.gz" -C "$TMP/prev"
      rsync -a --ignore-existing "$TMP/prev/static/" "$dist/static/"
      echo "kept the files of build $prev"
      n=$((n + 1))
    done <<< "$builds"
    echo "merged $n previous build(s) into $dist/static ($(find "$dist/static" -type f | wc -l | tr -d ' ') files)"
    ;;
  record)
    [ -f "$TMP/$build.tar.gz" ] || { echo "run merge first" >&2; exit 1; }
    ensure_bucket
    r2_put "$(tarball "$build")" "$TMP/$build.tar.gz" application/gzip
    builds=$(lane_builds)
    { echo "$build"; grep -vx "$build" <<< "$builds" || true; } | grep . | head -n 10 | jq -R . | jq -s . > "$TMP/lane-new.json"
    r2_put "lanes/$lane.json" "$TMP/lane-new.json" application/json
    echo "recorded build $build first in lane $lane"
    ;;
  *)
    echo "usage: retain-static.sh merge <lane> <build> <dist> | record <lane> <build>" >&2
    exit 2
    ;;
esac
