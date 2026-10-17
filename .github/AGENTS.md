# .github/ (loads when an agent works in this folder)

Read [docs/gotchas/build-ci.md](../docs/gotchas/build-ci.md) before changing any workflow. Locked calls: [docs/decisions/desktop-release.md](../docs/decisions/desktop-release.md).

- **Both desktop release channels share `_desktop-release.yml`.** Fix a problem there once instead of in `desktop-release.yml` or `desktop-release-prod.yml`.
- **Mac builds notarize once (the `.dmg`).** Don't pass `APPLE_ID`/`APPLE_PASSWORD` or `APPLE_CERTIFICATE` to `tauri build`; the workflow imports the cert itself. A slow run is usually Apple's queue; use *Re-run failed jobs*, which never resubmits.
- **Shell pitfalls:** `export X="$(cmd)"` hides a failing `cmd` (assign first, then export); on Windows `shell: bash`, quote `"$GITHUB_WORKSPACE"` instead of `${{ github.workspace }}`.
- **`checks.yml` matches `bun run verify`** (typecheck, Biome, lint:tw, lint:css, tests) plus the gitleaks secret scan. Add any new check to both. Tests run through Turborepo (`turbo run test test:scripts -- --shard N/3`), so every suite takes the same shard.
- **The desktop app is in `apps/desktop`** (since PLAT-2, 2026-10-17). `_desktop-release.yml` finds it per build (`DESKTOP_DIR`), because `prod-app` keeps the old root layout until the next promote; drop the fallback once `prod-app` has the move.
- Workflow changes are Tier 2 risk (see `/s3`). Watch a release run with `/loop` instead of polling by hand.

## Release reality

How a release is applied: [docs/release.md](../docs/release.md).

- `desktop-release-prod.yml` publishes to `GrochowskiMichal/moduo-releases` (rolling `prod-latest` release + `latest.json` for the updater). Look there, not in this repo.
- This repo's own `prod-latest` release is stale (v0.1.0, 2026-10-05). Ignore it.
- **One version, from `VERSION`** (`scripts/release/version.mjs`): prod web and prod desktop ship it as is, other web branches as `<VERSION>-rc`, staging desktop as `<VERSION>-rc.<run>`. The updater only installs a higher version, so **bump `VERSION` before every production desktop release**; the workflow's `version` job fails up front otherwise.
- `sync-staging-app.yml` runs only after `checks` passed on a develop push (`workflow_run`), and merges the commit checks tested.
- Third-party actions outside `actions/*` and `oven-sh/*` are pinned to commit SHAs; Bun is pinned by `.bun-version`.
- After a prod run, confirm the Mac notarize steps actually ran (not skipped) before calling the build shippable.
