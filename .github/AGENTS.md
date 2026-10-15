# .github/ (loads when an agent works in this folder)

Read [docs/gotchas/build-ci.md](../docs/gotchas/build-ci.md) before changing any workflow. Locked calls: [docs/decisions/desktop-release.md](../docs/decisions/desktop-release.md).

- **Both desktop release channels share `_desktop-release.yml`.** Fix a problem there once instead of in `desktop-release.yml` or `desktop-release-prod.yml`.
- **Mac builds notarize once (the `.dmg`).** Don't pass `APPLE_ID`/`APPLE_PASSWORD` or `APPLE_CERTIFICATE` to `tauri build`; the workflow imports the cert itself. A slow run is usually Apple's queue; use *Re-run failed jobs*, which never resubmits.
- **Shell pitfalls:** `export X="$(cmd)"` hides a failing `cmd` (assign first, then export); on Windows `shell: bash`, quote `"$GITHUB_WORKSPACE"` instead of `${{ github.workspace }}`.
- **`checks.yml` matches `bun run verify`** (typecheck, Biome, lint:tw, lint:css, tests) plus the gitleaks secret scan, `bun run test:hooks` and `bun run gen:decisions-index --check`. Add any new check to both. Its `rust-check` job runs the three Rust gates from `src-tauri/AGENTS.md` only when `src-tauri/` or the workflow changed.
- Workflow changes are Tier 2 risk (see `/s3`). Watch a release run with `/loop` instead of polling by hand.
