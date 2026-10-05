# Desktop auto-update — manual test checklist

Update files live in the public repo `GrochowskiMichal/moduo-releases` (rolling `staging-latest` / `prod-latest` releases). Needs the `RELEASES_REPO_TOKEN` Actions secret on `moduohyb`.

## Setup
- [ ] `RELEASES_REPO_TOKEN` (fine-grained PAT, Contents: read/write on `moduo-releases`) is set as a repo secret.
- [ ] Run **Desktop Release (production)** (after promoting to `prod-app`). Both jobs + publish green → `prod-latest` on `moduo-releases` has `Moduo_universal.dmg`, `Moduo_universal.app.tar.gz`, `Moduo_x64-setup.exe`, `latest.json`.
- [ ] `latest.json` (open it logged out) has non-empty `signature` for darwin-* and windows-*, and a `version` of `1.0.<run number>`. → both

## Download
- [ ] Settings → About on app.moduo.app (signed in, logged-out browser for the link itself): Mac/Windows buttons download without a GitHub login. → web

## Update flow (Mac)
- [ ] Install build N from the Settings button; open Settings → About, version shows `1.0.N`.
- [ ] Run the prod desktop workflow again (build N+1; any trivial change is fine).
- [ ] Relaunch build N: ~8s after launch a toast "Moduo 1.0.N+1 is available" appears. → desktop
- [ ] Click **Update & restart**: "Downloading update…" → app relaunches on its own → About shows `1.0.N+1`. No password prompts, no manual reinstall. → desktop
- [ ] Settings → About → **Check for updates** on the newest build says up to date (no toast). → desktop

## Windows
- [ ] Same flow with the NSIS installer (passive install, app relaunches). → desktop

## Known gaps
- Apps installed before this change (0.1.0) have no updater permissions and a private-repo endpoint baked in: reinstall once from Settings.
- Never run end to end by the author: the first real update needs two published builds.
