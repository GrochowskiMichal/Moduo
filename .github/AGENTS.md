# .github/ (loads when an agent works in this folder)

Read [docs/gotchas/build-ci.md](../docs/gotchas/build-ci.md) before changing any workflow. Locked calls: [docs/decisions/desktop-release.md](../docs/decisions/desktop-release.md).

- **Both desktop release channels share `_desktop-release.yml`.** Fix a problem there once instead of in `desktop-release.yml` or `desktop-release-prod.yml`.
- **Mac builds send three notarizations at once** (the universal `.dmg`, stapled, and each per-arch `.app` as a zip, REL-5). Don't pass `APPLE_ID`/`APPLE_PASSWORD` or `APPLE_CERTIFICATE` to `tauri build`; the workflow imports the cert itself. A slow run is usually Apple's queue; use *Re-run failed jobs*, which never resubmits.
- **Shell pitfalls:** `export X="$(cmd)"` hides a failing `cmd` (assign first, then export); on Windows `shell: bash`, quote `"$GITHUB_WORKSPACE"` instead of `${{ github.workspace }}`.
- **`checks.yml` matches `bun run verify`** (typecheck, `bun lint` + `bun fmt --check`, lint:tw, lint:boundaries, lint:css, the release-notes leak check `lint:notes`, tests) plus the gitleaks secret scan. Add any new check to both. Tests run through Turborepo (`turbo run test test:scripts -- --shard N/3`), so every suite takes the same shard. A docs-only diff skips lint and tests (the `scan` job decides); `static-checks` still passes. Release notes (`.changes/`, `release-notes/`, `CHANGELOG.md`) are Markdown but never count as docs-only, because they're published.
- **The Turborepo remote cache decides what runs, not `--affected`** (which misses the app's alias inputs). A task whose declared inputs didn't change is restored from the cache. If a task reads a file outside its package, declare it in that package's `turbo.json` `inputs` (`$TURBO_ROOT$/…`), or the cache will replay a stale result.
- **The desktop app is in `apps/desktop`** (since PLAT-2, 2026-10-17). `_desktop-release.yml` still finds it per build (`DESKTOP_DIR`); every release tag has the new layout, so the root fallback only serves a staging run of a pre-move commit.
- Workflow changes are Tier 2 risk (see `/s3`). Watch a release run with `/loop` instead of polling by hand.

## Release reality

How a release is applied: [docs/release.md](../docs/release.md).

- `desktop-release-prod.yml` publishes to `GrochowskiMichal/moduo-releases` (rolling `prod-latest` release + `latest.json` for the updater). Look there, not in this repo.
- This repo's own `prod-latest` release is stale (v0.1.0, 2026-10-05). Ignore it.
- **One version, from `VERSION`** (`scripts/release/version.mjs`): prod web and prod desktop ship it as is, staging and preview web as `<VERSION>-rc`, staging desktop as `<VERSION>-rc.<run>`. The updater only installs a higher version, so **bump `VERSION` before every production desktop release**; the workflow's `version` job fails up front otherwise.
- Staging deploys (`app-staging.yml`, `landing-deploy.yml`) run only after `checks` passed on a develop push (`workflow_run`), for the commit checks tested. Production is `release.yml`, on a pushed `vX.Y.Z` tag whose commit is on develop, passed `checks` and has that `VERSION` (`scripts/release/check-tag.sh`); `deploy-prod.yml` and `desktop-release-prod.yml` re-run one half from a tag (owner-only, same check). The web deploy lives once in `_deploy-web.yml`. There are no mirror branches: REL-6 (2026-10-19) retired `prod-app`, `staging-app`, `prod-landing`, `staging-landing` and `main` (no workflow uses them; each is deleted once its open PRs are handled); prod is tags only. GitHub deletes PR head branches on merge; rulesets keep `develop`, `mike` and `maciej`. `scripts/release/branch-audit.ts` lists the remote branches for a cleanup.
- Third-party actions outside `actions/*` are pinned to commit SHAs, with the tag in a comment (`oven-sh/setup-bun@<sha> # v2.2.0`): they run next to the signing keys and deploy tokens, and a moved tag would run new code there. Bun itself is pinned by `.bun-version`.
- After a prod run, confirm the Mac notarize steps actually ran (not skipped) before calling the build shippable.

## Desktop update server (PLAT-6)

- Installed apps ask `infra/update-server` at https://updates.moduo.app first (the repo variable `UPDATE_SERVER_URL`), the same Worker on workers.dev second, then GitHub. Builds from rc.43 up to PLAT-8 know only the workers.dev address, so `workers_dev` stays on. Releases go to R2 `moduo-releases` under `desktop/<channel>/<version>/` (never overwritten), and the channel pointer is written last. Deploy: `update-server.yml`.
- **The GitHub `latest.json` is frozen at each channel's bridge release** (`"bridge": true`), and later releases skip the GitHub upsert. Never unfreeze it casually: the updater falls back to GitHub on any Worker error, and a moving GitHub manifest would bypass the kill switch.
- Rollout share and kill switch: run `desktop-rollout.yml` (channel, rollout 0–100, paused). It takes effect in about a minute and never downgrades anyone.

## MCP connector address

- `https://mcp.moduo.app` is the Worker `infra/mcp-proxy` (`moduo-mcp-proxy`), forwarding to the `moduo-mcp` Edge Function. It deploys with every release tag (`release.yml` job `mcp` → `_deploy-mcp-proxy.yml`; re-run: `deploy-prod.yml` target `mcp`), never from a branch push. Its smoke test fails until the function serving the public address is deployed: function first. Decision: [docs/decisions/mcp.md](../docs/decisions/mcp.md) (2026-10-23).

## Mac build runner (PLAT-7)

- The signing jobs run in the `desktop-signing` environment (develop, mike, `v*` only), so a build started from a task branch stops there. Test `_desktop-release.yml` changes by landing them on `mike` and starting the staging build from `mike`.

- `build-mac` runs on Mike's Mac (`moduo-mac`, set up by `infra/mac-runner/setup.sh`) when `pick-runner` finds it online and idle, otherwise on `macos-latest`. Steps that differ use `runner.environment == 'self-hosted'`; keep the GitHub-hosted path working on its own.
- Only pushes to `develop`/`mike`, `v*` tags and the owner's manual runs may use it; the Mac's job-started hook refuses anything else. Never point a `pull_request` job at it. Any re-run builds on GitHub.

## Turborepo remote cache

The Worker is `infra/turbo-cache` (`moduo-turbo-cache` on workers.dev, R2 bucket `moduo-turbo-cache`, objects expire after 30 days), deployed by `turbo-cache.yml` when it changes on `develop`/`mike` or by hand.

| Name | Kind | Where | Used by |
| --- | --- | --- | --- |
| `TURBO_READ_TOKEN` | secret | repo | PR runs of `checks.yml`; set on the Worker as `READ_TOKEN`. The Worker refuses writes with it (403). |
| `TURBO_WRITE_TOKEN` | secret | environment `turbo-cache-write` | push runs of `checks.yml`; the Worker's `WRITE_TOKEN`. |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | secret | repo | every `checks.yml` run: turbo signs on write and can't verify a read without it. |
| `TURBO_API` | variable | repo | the Worker URL. Unset → CI runs without the remote cache (and sends no token). |
| `TURBO_TEAM` | variable | repo | the cache namespace (`moduo`). |

- **`turbo-cache-write` may only be used by `develop`, `mike`, `maciej` and `v*` tags** (`cloudflare-deploy`: `develop`, `mike` and `v*` tags) (deployment branch policy). A job that needs the write token names the environment; a PR job never does.
- **Rotate** a token: `openssl rand -hex 32 | gh secret set TURBO_READ_TOKEN` (add `--env turbo-cache-write` for the write token), then run `turbo-cache.yml` by hand so the Worker gets it. A new signing key invalidates every stored artifact (they become misses), which is harmless.
- PR runs use `TURBO_CACHE=local:rw,remote:r`; `TURBO_REMOTE_CACHE_READ_ONLY` is deprecated in turbo 2.11.
