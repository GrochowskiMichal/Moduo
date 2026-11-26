#!/usr/bin/env bash
# Checks that a release tag may ship to production (specs/release-v2.md, REL-2, AC7). Used by
# release.yml (on the tag push), deploy-prod.yml and desktop-release-prod.yml (re-runs of a tag).
#
#   scripts/release/check-tag.sh <tag> [--wait-checks <minutes>]
#
# A tag ships only when all of these hold; every failing one is reported, then it exits 1:
#   - the tag is vX.Y.Z and exists in this checkout (fetch-depth 0 brings tags and origin/develop)
#   - its commit is on origin/develop
#   - VERSION at that commit is X.Y.Z, and release-notes/releases.json there has an X.Y.Z entry
#     (the updater manifest and the release page are rendered from it)
#   - `checks` passed on a push of that commit. With --wait-checks, a run still going is waited
#     for up to that many minutes (/release tags the release PR's merge commit while develop's checks
#     run on it); without, it must have passed already. Or the commit is the merge of a release PR
#     that changed nothing on the way in (its tree is the PR head's, which contains its first
#     parent) and `checks` passed on that PR's head: the same tree, already tested, so the push run
#     isn't waited for (it would test the same diff again).
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
  || problems+=("$tag is not a release tag: release tags are vX.Y.Z (tag the release commit with /release).")
git merge-base --is-ancestor "$sha" origin/develop \
  || problems+=("$tag points at ${sha::7}, which is not on develop. Release only commits merged into develop.")
file_version="$(git show "$sha:VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
[ "$file_version" = "$version" ] \
  || problems+=("VERSION at ${sha::7} is '${file_version:-missing}', not $version. The release PR bumps VERSION; tag its merge commit.")
git show "$sha:release-notes/releases.json" 2>/dev/null \
  | jq -e --arg v "$version" 'any(.releases[]; .version == $v)' > /dev/null 2>&1 \
  || problems+=("release-notes/releases.json at ${sha::7} has no $version entry. The release PR adds it (changes.ts prepare).")

# No point waiting for checks on a commit that is refused anyway.
[ "${#problems[@]}" -eq 0 ] || wait_minutes=0

pr_checked=""
if [ "${#problems[@]}" -eq 0 ] \
  && head="$(git rev-parse --verify --quiet "$sha^2")" \
  && [ "$(git rev-parse "$sha^{tree}")" = "$(git rev-parse "$head^{tree}")" ] \
  && git merge-base --is-ancestor "$sha^1" "$head"; then
  pr_runs="$(gh run list --workflow checks.yml --commit "$head" --event pull_request --limit 20 --json conclusion,headBranch,url)"
  pr_checked="$(jq -r 'map(select(.conclusion == "success" and (.headBranch | startswith("release/v")))) | .[0].url // empty' <<< "$pr_runs")"
fi
deadline=$(( $(date +%s) + wait_minutes * 60 ))
while [ -z "$pr_checked" ]; do
  runs="$(gh run list --workflow checks.yml --commit "$sha" --event push --limit 20 --json status,conclusion,url)"
  if jq -e 'any(.[]; .conclusion == "success")' <<< "$runs" > /dev/null; then break; fi
  # A run still going, or none yet (a push's run can take a moment to appear): wait, if allowed.
  if { jq -e 'length == 0 or any(.[]; .status != "completed")' <<< "$runs" > /dev/null; } && [ "$(date +%s)" -lt "$deadline" ]; then
    echo "checks has not finished on ${sha::7}; waiting."
    sleep 30
    continue
  fi
  if jq -e 'length == 0' <<< "$runs" > /dev/null; then
    problems+=("checks has not run on a push of ${sha::7}. Push it to develop and let checks pass first.")
  else
    problems+=("checks has not passed on a push of ${sha::7} (latest: $(jq -r '.[0] | "\(.status) \(.conclusion // "") \(.url)"' <<< "$runs")). A run cancelled by a newer push to develop counts as not passed: re-run checks on it, then re-run this.")
  fi
  break
done

[ "${#problems[@]}" -eq 0 ] || refuse "${problems[@]}"

if [ -n "$pr_checked" ]; then
  echo "$tag → ${sha::7} ($(git log -1 --format=%s "$sha")): on develop, checks passed on the release PR's head with the same tree ($pr_checked), VERSION $version."
else
  echo "$tag → ${sha::7} ($(git log -1 --format=%s "$sha")): on develop, checks passed, VERSION $version."
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "sha=$sha" >> "$GITHUB_OUTPUT"
  echo "version=$version" >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Releasing \`$tag\` · \`${sha::7}\` ($(git log -1 --format=%s "$sha"))" >> "$GITHUB_STEP_SUMMARY"
fi
