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
#         and writes the newest previous build's file list to $RUNNER_TEMP/previous-static.txt
#         (scripts/smoke-hosting.ts --old checks a sample after the deploy).
# record: uploads this build's tarball to R2 builds/<build>/static.tar.gz and puts it first in
#         lanes/<lane>.json (newest first, 10 kept).
#
# Lanes: "staging", "production" (PLAT-8), "pr-<n>" for previews. Bucket moduo-web-builds; its
# builds/ prefix expires after 60 days (app-staging.yml creates the bucket and the rule). Needs
# CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and GNU tar (CI runs it on ubuntu-latest).
set -euo pipefail

BUCKET="${WEB_BUILDS_BUCKET:-moduo-web-builds}"
WRANGLER="${WRANGLER:-npx --yes wrangler@4.147.0}"
TMP="${RUNNER_TEMP:-/tmp}/web-builds"
KEEP_PREVIOUS=3

cmd="${1:-}"; lane="${2:-}"; build="${3:-}"
[[ "$lane" =~ ^(staging|production|pr-[0-9]+)$ ]] || { echo "bad lane: $lane" >&2; exit 2; }
[[ "$build" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad build id: $build" >&2; exit 2; }
mkdir -p "$TMP"

r2_get() { $WRANGLER r2 object get "$BUCKET/$1" --remote --file "$2" >/dev/null 2>&1; }
r2_put() { $WRANGLER r2 object put "$BUCKET/$1" --remote --file "$2" --content-type "$3" >/dev/null; }

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
    n=0
    first=true
    while IFS= read -r prev; do
      [ -n "$prev" ] && [ "$prev" != "$build" ] || continue
      [ "$n" -lt "$KEEP_PREVIOUS" ] || break
      if ! r2_get "builds/$prev/static.tar.gz" "$TMP/prev.tar.gz"; then
        echo "::warning::build $prev of lane $lane is no longer in R2 (expired?); skipped"
        continue
      fi
      if [ "$first" = true ]; then
        tar -tzf "$TMP/prev.tar.gz" | grep -v '/$' | sed 's|^|/|' | while IFS= read -r f; do
          [ -e "$dist$f" ] || echo "$f"
        done > "$TMP/previous-static.txt"
        first=false
      fi
      tar -xzf "$TMP/prev.tar.gz" -C "$dist" --skip-old-files
      echo "kept the files of build $prev"
      n=$((n + 1))
    done < <(lane_builds)
    echo "merged $n previous build(s) into $dist/static ($(find "$dist/static" -type f | wc -l | tr -d ' ') files)"
    ;;
  record)
    [ -f "$TMP/$build.tar.gz" ] || { echo "run merge first" >&2; exit 1; }
    r2_put "builds/$build/static.tar.gz" "$TMP/$build.tar.gz" application/gzip
    { echo "$build"; lane_builds | grep -vx "$build" || true; } | head -n 10 | jq -R . | jq -s . > "$TMP/lane-new.json"
    r2_put "lanes/$lane.json" "$TMP/lane-new.json" application/json
    echo "recorded build $build first in lane $lane"
    ;;
  *)
    echo "usage: retain-static.sh merge <lane> <build> <dist> | record <lane> <build>" >&2
    exit 2
    ;;
esac
