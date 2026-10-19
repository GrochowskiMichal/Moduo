#!/usr/bin/env bash
# Checks that a release tag may ship to production (specs/release-v2.md, REL-2, AC7). Used by
# release.yml (on the tag push), deploy-prod.yml and desktop-release-prod.yml (re-runs of a tag).
#
#   scripts/release/check-tag.sh <tag> [--wait-checks <minutes>]
#
# A tag ships only when all of these hold; every failing one is reported, then it exits 1:
#   - the tag is vX.Y.Z and exists in this checkout (fetch-depth 0 brings tags and origin/develop)
#   - its commit is on origin/develop
#   - VERSION at that commit is X.Y.Z
#   - `checks` passed on a push of that commit. With --wait-checks, a run still going is waited
#     for up to that many minutes (/ship tags the release PR's merge commit while develop's checks
#     run on it); without, it must have passed already.
# Needs GH_TOKEN (actions: read). Writes sha= and version= to $GITHUB_OUTPUT when set.
set -euo pipefail

tag="${1:?usage: check-tag.sh <tag> [--wait-checks <minutes>]}"
wait_minutes=0
if [ "${2:-}" = --wait-checks ]; then wait_minutes="${3:?--wait-checks needs minutes}"; fi

refuse() {
  for reason in "$@"; do echo "::error::$reason"; done
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Refused \`$tag\`"
      for reason in "$@"; do echo "- $reason"; done
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 1
}

sha="$(git rev-parse --verify --quiet "refs/tags/$tag^{commit}")" \
  || refuse "There is no tag $tag in this repo."
version="${tag#v}"

problems=()
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || problems+=("$tag is not a release tag: release tags are vX.Y.Z (tag the release commit with /ship).")
git merge-base --is-ancestor "$sha" origin/develop \
  || problems+=("$tag points at ${sha::7}, which is not on develop. Release only commits merged into develop.")
file_version="$(git show "$sha:VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
[ "$file_version" = "$version" ] \
  || problems+=("VERSION at ${sha::7} is '${file_version:-missing}', not $version. The release PR bumps VERSION; tag its merge commit.")

# No point waiting for checks on a commit that is refused anyway.
[ "${#problems[@]}" -eq 0 ] || wait_minutes=0
deadline=$(( $(date +%s) + wait_minutes * 60 ))
while :; do
  runs="$(gh run list --workflow checks.yml --commit "$sha" --event push --limit 20 --json status,conclusion,url)"
  if jq -e 'any(.[]; .conclusion == "success")' <<< "$runs" > /dev/null; then break; fi
  if jq -e 'any(.[]; .status != "completed")' <<< "$runs" > /dev/null && [ "$(date +%s)" -lt "$deadline" ]; then
    echo "checks is still running on ${sha::7}; waiting."
    sleep 30
    continue
  fi
  if jq -e 'length == 0' <<< "$runs" > /dev/null; then
    problems+=("checks has not run on a push of ${sha::7}. Push it to develop and let checks pass first.")
  else
    problems+=("checks has not passed on a push of ${sha::7} (latest: $(jq -r '.[0] | "\(.status) \(.conclusion // "") \(.url)"' <<< "$runs")). Re-run checks on it, then re-run this.")
  fi
  break
done

[ "${#problems[@]}" -eq 0 ] || refuse "${problems[@]}"

echo "$tag → ${sha::7} ($(git log -1 --format=%s "$sha")): on develop, checks passed, VERSION $version."
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "sha=$sha" >> "$GITHUB_OUTPUT"
  echo "version=$version" >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Releasing \`$tag\` · \`${sha::7}\` ($(git log -1 --format=%s "$sha"))" >> "$GITHUB_STEP_SUMMARY"
fi
