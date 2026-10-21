---
name: ship
description: Release Moduo to production. `/ship` prepares the next version from develop (notes, version, risk, manual prerequisites), then asks one question: ship it yourself now, or hand it to the other founder. `/ship vX.Y.Z` finishes an open release PR (a hand-off). The only way to release; guard-release.sh blocks release tags and prod workflows started any other way. Not for landing blocks (that is /s3).
effort: high
---

# /ship: release develop to production

One release = one `release/vX.Y.Z → develop` PR (VERSION, `release-notes/releases.json`, `CHANGELOG.md`, consumed `.changes/` removed), merged with a merge commit, and an annotated tag `vX.Y.Z` on that merge commit. The tag starts `release.yml`, which ships web, landing and (when needed) desktop from that commit. Why: [specs/release-v2.md](../../../specs/release-v2.md); runbook: [docs/release.md](../../../docs/release.md).

## Rules
- **Nothing outward-facing before the person answers the ship question** (AC3): no branch push, no PR, no comment. Reading (`git fetch`, `gh pr list`, `gh run list`, `curl`) is fine.
- **Never apply migrations or deploy Edge Functions.** List them and wait for a human (`guard-prod-db.sh` still holds).
- **Before each production action, say in one line what it will do** (merge into develop, push the tag).
- Work in a scratch worktree off `origin/develop`, never in the person's checkout. Commands that need the release marker run from the session's own checkout (the guard looks for the marker there).
- Pass PR bodies and comments with `--body-file`/`-F`: `guard-release.sh` (and `guard-git.sh`) read the whole command, so an inline body that quotes a tag push or a prod workflow run is blocked too.
- Only you write the marker, and only right after the person's "Ship now" (or "Ship Release X.Y.Z now?" on a resume).
- One release at a time: refuse to start while a release PR is open or a `release` run is queued or running.
- Logins: Mike = `GrochowskiMichal`, Maciej = `En5hi`. You = `gh api user -q .login`; the other founder is the other one.

## 1. Preflight (read-only)
1. `git fetch origin --tags --prune`. Note `origin/develop`'s commit; everything below is about it.
2. **Open release?** `gh pr list --state open --base develop --json number,title,headRefName,assignees,url` and keep heads starting `release/v`.
   - With `/ship vX.Y.Z`: it must be `release/vX.Y.Z`; go to **§5 Resume**.
   - Without an argument and one is open: show it (version, who it's assigned to, link) and ask "Continue Release X.Y.Z, or stop?" Continue = §5. Never open a second one.
   - **Merged but never tagged?** `gh pr list --state merged --base develop --search "Release in:title" -L 5 --json number,headRefName,mergeCommit` and `git ls-remote --tags origin 'v*'`: a merged `release/vX.Y.Z` with no `vX.Y.Z` tag (a run that died between merge and tag) → say so and offer to tag it (§4a.3–7) before anything else; otherwise its notes would never reach anyone.
3. **Release running?** `gh run list --workflow release.yml -L 5 --json status,headBranch,url`: any status other than `completed` → stop and report it.
4. **Base.** `git describe --tags --abbrev=0 --match 'v[0-9]*' origin/develop`. No tag yet (the first tag release) → the commit production web serves: `curl -s https://app.moduo.app/config.json | jq -r .build`. Call it `<base>`.
5. **Scratch worktree:** `git worktree add --detach <scratchpad>/ship origin/develop` and run the steps below inside it (`bun install --frozen-lockfile` once if `node_modules` is missing; the release scripts need only Bun).
6. **Notes and version:** `bun run lint:notes` (the leak check: a failing note → stop and name it; a release can't be cut over it), then `bun scripts/release/changes.ts status`. It prints the next version (any `new` → minor, else patch; major only when the person asks, via `--version`) and the public notes.
   - **Nothing user-facing** (0 public notes): say so and ask "Ship a patch with 'Reliability improvements.', or don't ship?" Don't ship → clean up and end. Ship → use `prepare --reliability` in §3.
7. **Risk label.** `git diff --name-only <base>..origin/develop`. **Higher risk** if any path matches: `supabase/migrations/`, a policy or RLS change, auth (`apps/app/src/components/auth/`, `apps/app/src/lib/auth-url*`, `supabase/functions/auth-email-hook/`), billing (`apps/app/src/features/billing/`, `supabase/functions/{create-checkout-session,create-portal-session,start-trial,extend-trial,issue-founder-coupon}/`), `supabase/functions/delete-account/`, `supabase/functions/moduo-mcp/`, the updater or signing (`apps/app/src/features/updater/`, `apps/desktop/src-tauri/src/lib.rs` (the updater wiring), `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/`, `.github/workflows/_desktop-release.yml`, `.github/workflows/desktop-rollout.yml`, `scripts/tauri-signed-build.sh`, `infra/update-server/`). Otherwise **Normal**. Name the paths that made it Higher.
8. **Manual prerequisites (DB and functions).** `git diff --name-only <base>..origin/develop -- supabase/migrations supabase/functions` (ignore `*.test.ts`). Anything listed → show it grouped (migrations; functions by name, with `_shared/` meaning every function that imports it) and **stop** until the person confirms it's applied to prod per docs/release.md §2–3 ("Applied" / "Stop"). Check yourself where you can, read-only: `supabase functions list` versions and times, and ask the person to compare `schema_migrations`. Never apply anything.
9. **Desktop?** It builds when `apps/app`, `apps/desktop`, `packages`, `supabase/functions/_shared`, `assets`, `bun.lock`, `package.json`, `tsconfig.base.json` or `.bun-version` changed since the tag of the production desktop version (`curl -s https://updates.moduo.app/desktop/production/latest.json | jq -r .version`); no such tag → it builds.
10. **Contents:** the PRs merged since `<base>`: `git log --first-parent --merges --format='%s' <base>..origin/develop`. Mention any substantial work that has no public note (it ships silently).

## 2. The question
Show, short: version (`current → next`), risk label (with why), the public notes grouped New/Improved/Fixed, the contents, desktop yes/no, prerequisites and their state. Then ONE `AskUserQuestion`:

> Ship it yourself now, or hand it to <Maciej|Mike> to look at first?

Options "Ship now" and "Hand off to <name>". **Higher risk → hand-off first, marked (Recommended)**; Normal → ship now first. Never forced, never assumed.

## 3. Release PR (both answers)
In the scratch worktree:
1. `git switch -c release/vX.Y.Z`
2. `bun scripts/release/changes.ts prepare` (add `--reliability` or `--version X.Y.Z` when decided above). Check the diff: `VERSION`, `release-notes/releases.json`, `CHANGELOG.md`, deleted `.changes/*.md` (never `README.md`), nothing else.
3. `bun run lint:notes`, then commit those paths explicitly: `Release X.Y.Z` + the Co-Authored-By trailer.
4. `git push -u origin release/vX.Y.Z` and `gh pr create --base develop --head release/vX.Y.Z --title "Release X.Y.Z" --body-file <scratchpad>/release-body.md` with the body: the summary from §2 (notes as they'll read, risk + why, prerequisites + "confirmed applied by <login>", desktop yes/no, contents) and a **Ship** line: "Merge with a merge commit, then tag the merge commit: run `/ship vX.Y.Z`."

## 4a. Ship now
1. `gh pr checks <n> --watch --required` (run it in the background if it may take over 2 minutes). Failing → **stop**: report the failing check and the PR link, leave the PR open, no tag. The fix lands through a normal PR into develop; then `/ship vX.Y.Z` after rebasing the release branch, or close the PR and start over.
2. Say "Merging Release X.Y.Z into develop", then `gh pr merge <n> --merge` (GitHub deletes `release/vX.Y.Z` on merge; don't delete it yourself). Get the commit: `gh pr view <n> --json mergeCommit -q .mergeCommit.oid`.
3. `git fetch origin develop --tags` and `git tag -a vX.Y.Z -m "Moduo X.Y.Z" <merge sha>` (verify `git show <merge sha>:VERSION` is X.Y.Z first).
4. **Marker, in its own Bash call from the session's checkout:** `d="$(git rev-parse --show-toplevel)/.claude/release-approved"; mkdir -p "$d" && date -u > "$d/X.Y.Z"`. It is valid for 60 minutes and one command.
5. Say "Pushing tag vX.Y.Z: this starts the production release (web, landing, desktop when needed)", then, in a separate Bash call: `git push origin vX.Y.Z`. The guard consumes the marker; `rm -f` it afterwards anyway.
6. **Watch:** `gh run list --workflow release.yml --event push -L 5 --json databaseId,headBranch,url` → the run whose `headBranch` is `vX.Y.Z`; `gh run watch <id> --exit-status` in the background (resolve waits for develop's `checks` on the merge commit; desktop adds about 30–50 minutes). A failed job → report which, with its log tail; re-run per docs/release.md §4 (re-runs need a fresh marker: steps 4–5 with `gh workflow run … -f tag=vX.Y.Z`).
7. **Report what's live, each with its proof:**
   - web: `curl -s https://app.moduo.app/config.json | jq -r .build` equals `git rev-parse --short=7 <merge sha>` (7 characters, as the deploy writes it)
   - desktop: `curl -s https://updates.moduo.app/desktop/production/latest.json | jq '.version,.notes'` shows X.Y.Z and the notes (or "skipped", with the run summary's reason; Windows left out if its build failed)
   - `curl -s https://moduo.app/changelog | grep -c X.Y.Z` is non-zero
   - the GitHub release `vX.Y.Z` on GrochowskiMichal/moduo-releases
   - links: the release PR, the tag, the run. Add them to the PR as a comment.
8. **Moduo (skip quietly without the `moduo` connector):** once the web proof passes, move the tasks this release carried from **Awaiting release** to **Shipped** with `tasks_set_status` (names in [moduo-agent](../moduo-agent/SKILL.md) §Stages). Take them from the release notes' block IDs and the `Awaiting release` tasks (`Build`, `Moduo App`); leave any task whose change isn't in this tag.

## 4b. Hand off
Leave the PR open. `gh pr edit <n> --add-assignee <other login>`. The PR body is the summary; post nothing else. Report the PR link and that `/ship vX.Y.Z` (theirs or yours) finishes it.

## 5. Resume (`/ship vX.Y.Z`)
1. Find the open PR with head `release/vX.Y.Z` (none → say so; maybe it merged: check for the tag and offer to tag it via §4a.3–7 if `develop` has the commit but no tag exists).
2. Re-run §1 steps 3, 4, 5, 7 and 8 against `origin/develop` (new migrations or functions since the hand-off need confirming too). If develop moved past the release branch's base, that's fine: the release ships the merge commit, which includes them; list what's new in the summary.
3. Show the PR body's summary, then ask "Ship Release X.Y.Z now?" (Ship now / Leave it open). Ship now → §4a.

## Clean up
`git worktree remove <scratchpad>/ship` and `git branch -D release/vX.Y.Z` (local only; a hand-off keeps the remote branch). Remove any leftover marker. The personal branches pick the release commit up on their next develop merge-back.
