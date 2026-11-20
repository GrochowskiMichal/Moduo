# Release runbook

How a change gets from `develop` to prod. **`/ship` is the only way to release** (since REL-3, 2026-10-19): it prepares the release, asks one question and does the rest; this file is what it runs and what to do by hand when something breaks. Why it works this way: [decisions/workflow.md](./decisions/workflow.md) (2026-10-19, 2026-10-17, 2026-10-14). Traps: [gotchas/supabase.md](./gotchas/supabase.md), [gotchas/build-ci.md](./gotchas/build-ci.md).

Every prod database or function action asks a human first (`guard-prod-db.sh`). Every release tag and prod workflow run needs `/ship`'s approval (`guard-release.sh`).

## 1. Releasing: `/ship`

Blocks land on the personal branch with a release note (`.changes/`, written by `/s3`), then sync to `develop` in batches. When `develop` has something worth shipping, either founder runs **`/ship`** in Claude ([.claude/skills/ship/SKILL.md](../.claude/skills/ship/SKILL.md)):

1. **Preflight** (read-only): no other release PR open and no release running; the notes since the last `vX.Y.Z` tag (`changes.ts status` and the leak check `lint:notes`); a release PR merged without its tag (it offers to tag it) and the next version (any `new` note → minor, else patch); the risk label (**Higher** when the release touches migrations, RLS/policies, auth, billing, account deletion, `moduo-mcp`, the updater or signing; else **Normal**); whether desktop will build (§5).
2. **Manual prerequisites:** `git diff --name-only <last tag>..origin/develop -- supabase/migrations supabase/functions`. Anything listed stops `/ship` until you confirm it's applied to prod by §2–3. `/ship` never applies it.
3. **One question:** ship it yourself now, or hand it to the other founder (Mike `GrochowskiMichal` ↔ Maciej `En5hi`). Higher risk recommends the hand-off; nothing is forced.
4. **Either way** it opens the PR **Release X.Y.Z** (`release/vX.Y.Z → develop`): `changes.ts prepare` bumps `VERSION`, adds the release to `release-notes/releases.json`, rewrites `CHANGELOG.md` and removes the consumed notes. The PR body is the release summary and the record of the release.
   - **Ship now:** it waits for the PR's checks (failing → it stops, no tag), merges with a merge commit, writes the one-time marker `.claude/release-approved/X.Y.Z` (gitignored), pushes the annotated tag `vX.Y.Z` on the merge commit, watches `release.yml` (§4) and reports what's live (§6).
   - **Hand off:** the PR stays open, assigned to the other founder. `/ship vX.Y.Z` (from either of you) finishes it.
5. **Nothing user-facing** since the last tag: `/ship` asks whether to ship a patch with "Reliability improvements." or not ship.

**Risky releases ship small.** Anything Higher-risk ships on its own, not bundled into a large release, and a fix a real user is blocked by goes out the same day.

**By hand** (only if `/ship` can't run): a person runs the same steps in a terminal; `guard-release.sh` only sees Claude's commands, so nothing blocks a person. An agent never writes the marker itself: only `/ship` does, after the person answers "Ship now" (or "Ship Release X.Y.Z now?" on a resume). The marker works once, for 60 minutes.

## 2. Database migrations

Prod's migration history does not match the repo folder (files renamed after applying, some applied in the SQL editor), so **never `supabase db push` from the repo folder**, and don't use MCP `apply_migration` (it stamps the apply time, not the file version).

Before either path:

- Test on the local stack (`bun run local:reset`).
- **Check prod's real function bodies first.** A migration that `CREATE OR REPLACE`s a function must start from prod's `pg_get_functiondef`, not from this branch's newest file, or it silently drops another branch's change. Restate grants by name.
- Stamp files in the order they will be applied.

**Many files (a big release): a scratch-folder push.**

1. Make a scratch folder with `supabase/migrations/` holding only the release files, plus one empty placeholder file per version prod already has.
2. Dry run: `supabase db push --include-all --skip-vault --dry-run`. It must list only the release files.
3. Push: `supabase db push --include-all --skip-vault`. Always `--skip-vault`: without it the CLI writes `config.toml`'s Vault secrets to prod.

The scratch folder also needs `supabase/templates/` copied next to it (the auth email templates are config paths) and `[db.migrations] enabled = true` in its copy of `config.toml` only, or the push silently says "up to date". Another session may apply a migration to prod between your snapshot and your push: re-read prod's history count and newest version right before pushing, and grep your release files for every function the newcomer redefines.

**One or two files: a direct query, in one transaction.**

```sql
BEGIN;
-- the migration file's contents
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('<version>', '<name>', ARRAY[]::text[]);
COMMIT;
```

Run it with `supabase db query --linked -f <file>`, so the history row carries the file's version.

**After either path, verify:** `schema_migrations` has the new versions; catalog checks for what the migration adds (`pg_proc` signatures and argument counts, `pg_constraint`, `pg_policies`, grants via `has_function_privilege`); and the release's own read-only checks of the data it converts.

## 3. Edge Functions

Deploy each changed function with `supabase functions deploy <name>`, in dependency order (a function a migration queues work for goes first; see the Chat v2 record). A function that imports `zod` needs `--import-map supabase/functions/deno.json` (the hosted bundler fails without it), and one that does its own auth (a JWT check inside, a webhook signature, `moduo_sk_` keys, a public token) keeps `--no-verify-jwt`.

`moduo-mcp` goes out **before** the release that deploys `mcp.moduo.app`'s Worker: the release's `mcp` job refuses to deploy while the function still names only its Supabase URL in discovery (re-run the job once the function is out).

A **shared function such as `moduo-mcp` deploys from a merge of `maciej` + `mike`** (every branch that has deployed it), or one person's tools disappear. When a migration and a function depend on each other, follow the order the block's record names (NR-8: `moduo-mcp` before or with the web release).

## 4. Web

Web and landing run on Cloudflare Workers (since PLAT-8, 2026-10-17); moduo.app's DNS is a Cloudflare zone.

| Host | Worker | Deployed by |
| --- | --- | --- |
| app.staging.moduo.app | `moduo-app-staging` | `app-staging.yml`, after `checks` passes on a develop push |
| staging.moduo.app | `moduo-landing-staging` | `landing-deploy.yml`, same trigger |
| app.moduo.app | `moduo-app-production` | `release.yml`, on a `vX.Y.Z` tag (re-run: `deploy-prod.yml`) |
| moduo.app | `moduo-landing-production` | `release.yml`, same (re-run: `deploy-prod.yml`) |
| www.moduo.app | none: a zone Redirect Rule, 308 to https://moduo.app | n/a |
| updates.moduo.app | `moduo-update-server` | `update-server.yml` |
| mcp.moduo.app | `moduo-mcp-proxy` (forwards to the `moduo-mcp` Edge Function) | `release.yml`'s `mcp` job, on a `vX.Y.Z` tag (re-run: `deploy-prod.yml` target `mcp`) |

Every PR that touches the app or the landing also gets a preview URL comment on workers.dev (`app-preview.yml`, `landing-preview.yml`). Custom domains are declared in each `wrangler.jsonc` (`routes` with `custom_domain`), so a deploy keeps them.

**To ship: a release tag** (since REL-2, 2026-10-19). A release is one commit on `develop` whose `VERSION` and `release-notes/releases.json` already name the new version (the release PR). Pushing its tag `vX.Y.Z` starts **release** (`release.yml`), which ships that commit everywhere:

1. `resolve` refuses the tag unless its commit is on `develop`, `checks` passed on a push of it (it waits up to 40 minutes for a run still going), `VERSION` equals the tag without the `v` and `releases.json` has that version. Every failing reason is listed in the run summary.
2. `web` rebuilds the commit with the production version (`VERSION`, no `-rc`), ships the app as a **canary** and then the landing (`_deploy-web.yml`), keeps the previous 3 builds' files and smoke-tests both hosts. A canary that rolls back fails `web`, so the landing, desktop and the notes don't ship.
3. `desktop` builds and publishes the production desktop app from the tag's commit (§5), but only when `apps/app`, `apps/desktop`, `packages`, `supabase/functions/_shared`, `assets`, `bun.lock`, `package.json`, `tsconfig.base.json` or `.bun-version` changed since the tag of the version production desktop runs now (`updates.moduo.app/desktop/production/latest.json`). Otherwise the summary says "Desktop: skipped" and why. With no tag for that version (the first tag release), it always builds.
4. `notes` creates the GitHub release `vX.Y.Z` on **GrochowskiMichal/moduo-releases** with that version's notes from `releases.json`.

`/ship` (§1) makes the release PR, merges it and pushes the tag. Releases run one at a time (`release-production`); GitHub keeps only one waiting, so a third tag cancels the waiting one, and `/ship` refuses to start while a release runs.

**Re-runs:** a failed job → **Re-run failed jobs** on the release run. To redeploy web from a tag (after a rollback, or one target alone), run **deploy-prod** (owner only) with `tag` and `target`; it runs the same check and the same deploy. From Claude, `gh workflow run` of deploy-prod or Desktop Release (production) is blocked unless `/ship` approved that version; a person can run them from the Actions tab or a terminal. There are no mirror branches (REL-6 retired `prod-app`, `staging-app`, `prod-landing`, `staging-landing` and `main`): what's live is the newest `vX.Y.Z` tag that `release.yml` finished.

**The canary** (HV-28, `scripts/release/canary.ts`). The app Worker is not deployed in one go: the job uploads the build as a version (`wrangler versions upload`), then

1. **0%:** once a request with the `Cloudflare-Workers-Version-Overrides` header is answered by the new version (a fresh deployment can take a few seconds to honour it; the canary waits up to a minute), the full hosting smoke test runs against the new version alone, through that header. No visitor sees it. A failure ends here.
2. **10% for 15 minutes:** every 30 s a probe round (the shell, a deep link, `/config.json` naming the build) hits the new version; every minute the Workers analytics compare its error rate with the old version's. A **spike** is two failed probe rounds in a row, or an error rate over max(2%, 2× the old version's) on at least 20 requests.
3. **100%**, or on a spike the old version back at 100% (rollback by version id) and a red job. The run summary shows each stage, the soak's numbers and any rollback reason.

It refuses to start while the Worker is split (a previous rollout half-done), and it never touches a deployment someone else made meanwhile. A cancelled job puts the old version back (the "Undo an unfinished canary" step). The release takes about 20 minutes longer.

**Version affinity (one-time zone setup, required for the 10% stage).** During a split, a page from one build must not fetch its hashed chunks from the other, which doesn't have them. Cloudflare keeps a visitor on one version when the request carries `Cloudflare-Workers-Version-Key`. Set it once on the moduo.app zone: Rules → Transform Rules → **Modify Request Header** → name "Workers version affinity", expression `(http.host in {"app.moduo.app" "app.staging.moduo.app" "moduo.app"})`, **Set dynamic** `Cloudflare-Workers-Version-Key` = `ip.src`. (moduo.app is in the list because the landing forwards `/book` and `/static` to the app Worker.) The canary checks for affinity after moving to 10% (40 requests from one client must all name one build). A failed request during that check doesn't count as "no affinity"; only two different builds do. **Without it, it promotes straight to 100% with a warning** (an annotation on the run and a line in the summary), which is a plain deploy with a 0% smoke in front: the release still ships, without the soak.

**Analytics:** the error rate leaves out the canary's own probe requests. The error-rate half needs `CLOUDFLARE_API_TOKEN` to carry *Account Analytics: Read*. Without it the summary says "Workers analytics unavailable" and the probes decide alone.

**Rehearsal:** `canary-rehearsal.yml` proves the rollback on staging: it uploads the commit to `moduo-app-staging` with `CANARY_FORCE_ERROR_AFTER` set three minutes ahead (the edge Worker throws after that time, on staging only), runs the same canary with a short soak, and passes only when the canary rolled the version back. It runs when the canary or the edge Worker changes on `develop`, and from the Actions tab (it isn't a prod workflow, so `guard-release.sh` leaves it alone). Its version stays in staging's version list with the forced error armed: never roll back to a version whose message says "canary rehearsal".

**Not versioned:** `versions upload` doesn't push a Worker's non-versioned settings (`observability`, `logpush`, `tail_consumers` in `apps/app/wrangler.jsonc`); `wrangler deploy` did. A change to those reaches production only through a one-off `npx wrangler@4.147.0 deploy --env production` by a person, or the dashboard.

**Roll back (under a minute):** Cloudflare dashboard → Workers & Pages → `moduo-app-production` (or `moduo-landing-production`) → Deployments → the previous version → Rollback. From a terminal: `npx wrangler rollback --env production` in `apps/app` (or `apps/landing`). A rollback keeps the custom domain; run deploy-prod with the release's tag to move forward again (it runs the canary again, on a fresh upload). **A Worker left split** (a canary job killed so hard its cleanup didn't run): Deployments shows two versions; roll back to the old one as above, or `npx wrangler@4.147.0 versions deploy <old-version-id>@100 --env production -y` in `apps/app`.

**www and the wildcard:** the www Redirect Rule (`http.host eq "www.moduo.app"` → `https://moduo.app${http.request.uri.path}`, 308, query kept) only runs on proxied traffic, so `www` has a proxied placeholder record (AAAA `100::`). There is no `*` record: Vercel's wildcard is deleted at cutover, so an unnamed subdomain doesn't resolve rather than pointing at a provider we left. Cutover order (each step keeps every host up): deploy-prod (app.moduo.app and moduo.app get their own records) → the Redirect Rule, then the www placeholder → delete the wildcard → remove Vercel.

**DNS** is edited in the Cloudflare dashboard. Mail records (Hostinger MX, SPF, the `hostingermail-*` DKIM CNAMEs, Resend's `send.*` and `resend._domainkey`, DMARC) must stay DNS-only (grey cloud): a proxied record answers with Cloudflare addresses. `scripts/dns-diff.ts` was the pre-cutover gate (Vercel vs Cloudflare); it needs a Vercel token, so it can't run once the Vercel account is gone.

## 5. Desktop

The desktop app bundles its own copy of the UI at build time, so a web change reaches desktop users only when a desktop build ships. The release run builds it whenever something it bundles changed (§4).

- **The build** (`_desktop-release.yml`, channel production, from the tag): the signed Mac universal `.dmg` (the website download), per-arch Mac updater bundles (`darwin-aarch64`, `darwin-x86_64`; REL-5) and the Windows NSIS installer, published with `latest.json` for the in-app updater through the update server (R2 `moduo-releases`). The manifest's notes are that version's entry in `releases.json`, as Markdown (`changes.ts notes`); the update toast shows its two highlights. Staging's manifest carries the pending `.changes` notes as "Coming next".
- **Desktop Release (production)** (`desktop-release-prod.yml`, manual, owner only) builds a tag again: a release whose desktop job failed, or one that skipped desktop. It takes `tag` and runs the same check as the release.
- **Download links:** Settings → About's "Download for Mac/Windows" open `updates.moduo.app/download/desktop/<channel>/latest/Moduo_universal.dmg` (or `Moduo_x64-setup.exe`), which redirects to that file in the version `latest.json` names (or, when that version has no Windows installer, the newest earlier one that does). The rollout share and the kill switch don't apply to downloads. **To stop handing out a bad build**, point the channel back at the previous version's sealed manifest: `npx wrangler@4.147.0 r2 object get moduo-releases/desktop/production/<previous>/latest.json --remote --file prev.json`, then `npx wrangler@4.147.0 r2 object put moduo-releases/desktop/production/latest.json --remote --file prev.json --content-type application/json --cache-control no-store`. Staging is the same with `desktop/staging/`. That also stops the updater offering the bad version; the next release moves the pointer forward again.
- **Notarization:** `build-mac` waits up to 20 minutes for Apple and staples. `notarize-mac` runs only when Apple was slower; "skipped" is normal when `build-mac`'s log says the staple worked (the 2026-10-16 run). A skipped `notarize-mac` with no staple in `build-mac` is a problem.
- **Not the source of truth:** the main repo's own `prod-latest` release (last published 2026-10-05) is stale; don't judge what's live from it.
- **Bump `VERSION` first.** Production ships the `VERSION` file as is (staging adds `-rc.<run>`), and the updater only installs a higher version, so a production run on an unchanged `VERSION` fails in its `version` job before any build starts. The release PR bumps it. After a run has published, use **Re-run failed jobs**, not "Re-run all jobs": a full re-run asks for the same version again and the check refuses it.

## 6. Verify what's live

- **Web:** `curl -s https://app.moduo.app/config.json | jq -r .build` is the short commit production serves (staging: app.staging.moduo.app). After a Cloudflare rollback it is older than the newest tag.
- **Database:** `select version, name from supabase_migrations.schema_migrations order by version desc limit 20;`
- **Functions:** `supabase functions list` (version and updated time per function); call one new tool through the connector.
- **Desktop:** `curl -s https://updates.moduo.app/desktop/production/latest.json | jq '.version,.notes'` (staging: `/desktop/staging/`). The notes are the release's Markdown notes from `releases.json` (since REL-2; 1.1.0's note still names a commit, `37bb493`, while it was built from `0670dbe`); the build is in About. The GitHub `prod-latest` manifest is frozen at the bridge release (1.1.0), so it no longer shows what's live.

## 7. Updater trust: the releases token, signing keys and the GitHub bridge

An installed desktop app takes an update when the manifest it fetches offers a higher version whose bundle carries a valid minisign signature for the one public key built into it (`plugins.updater.pubkey`). The manifest's `version`, `url` and `notes` are not signed. So whoever can write a manifest an install reads, and holds a bundle signed with that key, decides what the install runs. MOD-552 (2026-10-24) narrows both.

**Setting it up (once, in this order, or the next release's `notes` job goes red):**

1. Settings → Environments → create `releases-production` with deployment rule *Selected branches and tags* → add a **tag** rule `v*` (not a branch rule). Create `releases-staging` with branch rules `develop` and `mike`.
2. Add `RELEASES_REPO_TOKEN` (fine-grained PAT, Contents read/write on `moduo-releases` only) to both environments.
3. Only then delete the repo-level `RELEASES_REPO_TOKEN`.
4. Settings → Rules → Rulesets → a tag ruleset on `v*`: restrict creations, updates and deletions, block force pushes, bypass list = the two founders.
5. Confirm on the next tag release that `notes` ran in `releases-production` and published the notes.

**Who can write the manifests.**

| Manifest | Read by | Written with | Who can reach it |
| --- | --- | --- | --- |
| R2 `desktop/<channel>/latest.json` (updates.moduo.app) | every build since PLAT-6 (first) | `CLOUDFLARE_API_TOKEN` | environment `cloudflare-deploy` (develop, mike, `v*`) |
| GitHub `moduo-releases/prod-latest/latest.json` | production builds before 1.1.0 (only endpoint); 1.1.0 up to MOD-552 (third endpoint) | `RELEASES_REPO_TOKEN` | environment `releases-production` (`v*` tags only) |
| GitHub `moduo-releases/staging-latest/latest.json` | staging builds before rc.43; rc.43 up to MOD-552 | `RELEASES_REPO_TOKEN` | environment `releases-staging` (develop, mike) |

- `RELEASES_REPO_TOKEN` is read in two places: `_desktop-release.yml`'s `publish-github` job (environment chosen by channel; it runs only until the channel's bridge is frozen, so today it is always skipped) and `release.yml`'s `notes` job (`releases-production`). A fine-grained PAT can't be narrower than one repository, so the staging copy could still write `prod-latest`; that is acceptable because only the founders can push `develop` and `mike`. A separate token (or a separate releases repo) for staging closes it fully.
- **Desktop Release (production)** dispatched from a branch can't use `releases-production`. That's fine while the production bridge is frozen (its `publish-github` is skipped); if a bridge ever has to be re-issued, start it from the tag (*Use workflow from* → Tags → `vX.Y.Z`, a tag cut after MOD-552: an older tag's workflow reads the token in `publish`, where it is empty once the repo secret is gone).
- **Builds made after their channel's bridge no longer list GitHub as an endpoint** (MOD-552). The frozen manifest never offered them anything newer, so the third endpoint was only a route around the update server's rollout and kill switch. Builds still list it while their channel has no frozen bridge (the build may become it).
- **The tag is the gate.** `releases-production`, `desktop-signing` and `cloudflare-deploy` all trust any `v*` tag, and a tag push runs the tagged commit's own workflow file. A tag ruleset on `v*` (create and update limited to the founders, no deletion, no force-update) keeps that to `/ship`.

**Signing keys: one per channel.** Today staging and production share one minisign keypair (public key id `A61FF79D41AB1E26`, `TAURI_SIGNING_PRIVATE_KEY` in `desktop-signing`), so every staging rc is a validly signed update for production installs, and a rewritten manifest could hand one to them. The change:

1. **Production keeps the current keypair.** Every production install trusts it, and Tauri v2 builds trust exactly one key, so rotating production needs a transition release signed with the old key that carries the new public key, and any install that skips that release is stranded (the update server offers only the newest version). Rotate production only if its private key leaks.
2. **Staging gets a new keypair** (`bunx tauri signer generate -w ~/.tauri/moduo-staging.key`, with a password). Staging builds then embed the staging public key in their CI Tauri config and sign with the staging private key; production builds keep the checked-in key. A staging rc then fails signature checks on a production install whatever manifest offers it.
3. **The workflow change** (a follow-up once the keys exist): `_desktop-release.yml` writes `plugins.updater.pubkey` from the repo variable `TAURI_UPDATER_PUBKEY_STAGING` into the staging CI config, and staging's build steps read `TAURI_SIGNING_PRIVATE_KEY_STAGING` (+ `_PASSWORD`), failing if either is missing. To keep the production private key away from branch builds too, move it into a `v*`-only environment (`desktop-signing-production`, holding copies of the Apple secrets) and pick the build jobs' environment by channel.
4. **Staging installs reinstall once.** The first staging build signed with the new key fails the old staging installs' check; download the staging `.dmg` (Settings → About on app.staging.moduo.app) and install it over the old one. Only the founders run staging.

**Retiring the GitHub bridge.** The bridge exists for installs older than PLAT-6 (production before 1.1.0, staging before rc.43), which know only GitHub.

1. **Check whether anyone still reads it.** Every update check that reaches GitHub downloads `latest.json`, and GitHub counts asset downloads. Note the count, wait a week, compare:

   ```bash
   gh api repos/GrochowskiMichal/moduo-releases/releases/tags/prod-latest --jq '.assets[] | select(.name == "latest.json") | .download_count'
   ```

   (13 on 2026-10-24; a browser opening the file counts too.) A count that stays flat for two weeks means no production install still checks GitHub. Cross-check in Cloudflare → Workers → `moduo-update-server` → Logs: every check carries its `current_version` in the path (`/desktop/production/<target>/<arch>/<current_version>`), so the versions that check in there are the PLAT-6-or-later installs. Anyone you know runs an older build: ask them to download the current `.dmg` once.
2. **Remove the code:** the `publish-github` job, the `bridge-manifest` upload and the GitHub endpoint in both *Write CI Tauri config* steps of `_desktop-release.yml`, the GitHub part of the `version` job's check (keep the update server's), and the GitHub endpoint in `apps/desktop/src-tauri/tauri.conf.json`. The `notes` job still needs `RELEASES_REPO_TOKEN` in `releases-production` (or point it at a token for the release-notes repo only).
3. **Then delete the manifest:** remove `latest.json` from `prod-latest` and `staging-latest` on `moduo-releases` (keep the `.dmg` for old links). Never delete it before step 2: the `version` job reads a missing manifest as "no bridge yet" and the next release would publish a new bridge, and its builds would list GitHub again.
4. Delete `releases-staging` once nothing reads it.
