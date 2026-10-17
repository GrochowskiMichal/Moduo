# Spec: Platform v2 — workspaces, Cloudflare hosting, Mac build runner

> Status: **Draft — Ready to execute once the human prerequisites in §Assumptions are done** · Owner: mike · Source: the release-pipeline audit (private Artifact "Moduo Release Pipeline", revision 4, 2026-10-17), §6, §7, §11 and the roadmap's Phase 1.

## Scope

This moves Moduo from "one root package, deployed by Vercel from mirror branches, desktop built only on GitHub's slow Macs" to the platform chosen on 2026-10-17:

- **Repo structure:** Bun workspaces + Turborepo (`apps/app`, `apps/desktop`, `apps/landing`, `apps/storybook`, `supabase/` as a package), with a remote cache.
- **Hosting:** web and landing on Cloudflare Workers static assets, with PR previews, instant rollback, runtime config per host and old chunks kept across deploys.
- **Desktop:** installers and updater manifests on Cloudflare R2, served by an update-server Worker with channels, staged rollout and a kill switch.
- **Builds:** desktop builds run on Mike's M4 Pro as a GitHub self-hosted runner when it's online, with automatic fallback to GitHub-hosted macOS.
- **Repo:** goes private on Mike's personal account with GitHub Pro. Vercel is cancelled.

**Not in this spec:**

- The tag-based release flow, `/ship`, the changelog pipeline, one version stream, the in-house UI updater, and retiring the mirror branches. Those are Phase 2–3 specs.
- The Phase 0 quick fixes, which run as their own session (`PLAT-0` below tracks them).

## Product behavior & UX

People using Moduo should notice only three things:

1. **The web app stops breaking after a deploy.** A tab that was open before a release keeps working. If a needed file is truly gone, the app reloads once quietly instead of showing a blank page.
2. **Desktop updates arrive from a Moduo address** (`updates.moduo.app`) instead of a GitHub releases page. Existing installs get there through one bridge release with no action from the user. The update toast and About panel work as today.
3. **Booking links keep working at the same address.** `moduo.app/book/<slug>` still opens booking on `moduo.app`. Legal pages (`/privacy`, `/terms`, `/dpa`, `/aup`, `/manifesto`) still resolve.

What Mike and Maciej notice:

- Every PR gets a **preview link** posted as a comment.
- **Staging** updates only after checks pass on `develop`.
- A landing-only or docs-only change finishes CI in about a minute.
- Re-running CI on an unchanged commit restores from cache.
- A desktop build takes about 2–3 minutes when Mike's Mac is awake. When it isn't, the build goes to GitHub's Mac within about a minute and takes about 6.
- Prod web can be rolled back to the previous version in under a minute.
- The repo is private. Rulesets still require `static-checks` on `develop`.

## Edge cases

- **Mike's Mac asleep, offline or busy:** the runner check finds no idle `moduo-mac` runner, and the job goes to `macos-latest`. A queued job never waits forever.
- **Mac goes to sleep mid-build:** the job fails as "runner lost". Re-run sends it to the fallback (the check runs again).
- **Preview login:** previews point at staging Supabase. Magic links must redirect back to the preview origin, so the staging Supabase auth redirect allowlist gets a wildcard for preview hosts. Prod Supabase never allows preview hosts. (As built in PLAT-4: there is one Supabase project for staging and prod, and sign-in is a typed code with no redirect, so no allowlist entry was added; see `docs/decisions/workflow.md`.)
- **Emailed links from previews** (booking cancel and app links) use the canonical origins (`supabase/functions/_shared/app-origin.ts` allow lists). Preview hosts are deliberately not added, so a preview can't mail links to itself.
- **Push service worker:** `/push-sw.js` and `/push-display.js` must stay at the root, never get an immutable cache header (`Cache-Control: no-cache`), and never be replaced by the SPA fallback.
- **Old chunk deleted** (older than the retention window): the app's chunk-load error handler reloads once per session, guarded so it can't loop.
- **Config missing or malformed at the edge:** the app falls back to the build-time values (`import.meta.env.PUBLIC_*`), which are kept for desktop and dev. It never boots with an empty Supabase URL.
- **Bridge release not installed** (a desktop app that stays closed for weeks): it keeps polling the old GitHub `latest.json`. That file stays published, pointing at the bridge build, until download stats show no old installs, or 60 days.
- **DNS cutover:** the MX (Hostinger), SPF, DKIM and DMARC records and every verification TXT record must exist in Cloudflare before the nameservers change. A record left out breaks email silently.
- **Cache poisoning:** PR jobs get a read-only Turborepo cache token, which the cache Worker refuses for writes. Only push runs on `develop`, `main`, `mike`, `maciej` and `v*` tags write, through the `turbo-cache-write` environment. (As built in PLAT-3: PRs do get the signing key, since turbo can't verify a read without it; see `docs/decisions/workflow.md`.)
- **Windows build fails:** as today, Windows is left out of the manifest rather than pointing at an older installer.
- **A Rust-only change:** Turborepo doesn't rebuild the web app; the desktop job still runs.
- **A rename caught mid-freeze:** a personal branch that wasn't merged before the big move gets rebased with `git rebase` and rename detection, or its changes are re-applied by hand. The freeze checklist prevents this.

## Acceptance criteria

- **AC1:** One `bun install` at the root installs every workspace. `bun run verify` runs typecheck, Biome, lint:tw, lint:css and tests through Turborepo and is green.
- **AC2:** `bun run dev:web` and `bun run dev:desktop` work as before from the root. A desktop debug build launches. The release workflow still produces a signed, notarized `.dmg` and an NSIS `.exe`.
- **AC3:** A PR that changes only `apps/landing/**` runs no app unit tests. A docs-only PR runs only the secret scan and the required-checks aggregate.
- **AC4:** Re-running checks on an unchanged commit restores typecheck, lint and test results from the remote cache. The checks job finishes in under 90 s.
- **AC5:** PR workflows can read the remote cache but can't write it. `develop` workflows write (as built in PLAT-3: also `main`, `mike`, `maciej` pushes and `v*` tags).
- **AC6:** Every PR gets a comment with a working preview URL of the web app, pointed at staging Supabase. Staging (`app.staging.moduo.app`) updates only after `static-checks` passes on `develop`.
- **AC7:** One built artifact serves staging and prod. Each host gets its own Supabase URL and key, Stripe keys, PostHog key, VAPID key and web origin at request time, with no rebuild.
- **AC8:** After a deploy, a tab opened on the previous build can still lazy-load routes (hashed files from the last 3 builds stay served). A truly missing chunk triggers at most one quiet reload.
- **AC9:** A request for a missing `/static/*` file gets a 404, not `index.html`. Hashed files are served `immutable` for a year. `index.html` and the push service workers are revalidated. Security headers are present (CSP report-only, `nosniff`, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy).
- **AC10:** `moduo.app` serves the landing page and its subpages as today. `moduo.app/book/<slug>` opens booking on `moduo.app` without changing the address. The landing build no longer builds the whole app.
- **AC11:** Desktop releases publish installers and a signed manifest to R2, served at `updates.moduo.app`. Staging and production channels stay separate. A staged-rollout percentage and a kill switch can be changed without a rebuild. A desktop app on today's version reaches the new endpoint through the bridge release.
- **AC12:** A desktop build runs on Mike's Mac when it's online and idle, and otherwise on GitHub-hosted macOS. The decision takes under 60 s. The job log names the runner used.
- **AC13:** The self-hosted runner runs as a separate macOS user and can't read Mike's personal home or keychain. Only `push` to `develop`, `v*` tags and manual dispatch by the owner can target it. `pull_request` jobs never run on it.
- **AC14:** After cutover: the repo is private, rulesets require `static-checks` on `develop`, Vercel serves and deploys nothing, and DNS for `moduo.app` is on Cloudflare. Mail to `@moduo.app` still arrives, and SPF/DKIM/DMARC still pass for mail Moduo sends.
- **AC15:** Prod web rolls back to the previous version in under a minute, from the Cloudflare dashboard or one `wrangler rollback`.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| CI `checks` on the big-move PR · "turbo verify green" | AC1 | The whole verify suite passes through Turborepo after the move |
| `apps/desktop` debug build launch (manual, recorded in the PR) · "app opens, signs in" | AC2 | The moved desktop app still builds and boots |
| `desktop-release` staging run after the move · "signed dmg + exe published" | AC2 | Release builds still sign, notarize and publish |
| Two probe PRs (landing-only, docs-only) · "cache skips unrelated work" | AC3 | Turborepo restores unchanged tasks from the cache; a docs-only PR skips lint and tests |
| Re-run of `checks` on the same SHA · "cache hit, <90 s" | AC4 | The remote cache restores results |
| `.github/workflows/checks.yml` review + a PR run log showing a read-only token | AC5 | PRs can't write the shared cache |
| `scripts/smoke-hosting.ts` · "preview + staging" | AC6, AC9 | Fetches the preview and staging URLs: status codes, headers, 404 for missing `/static`, no-cache on the push service worker |
| `apps/app/edge/config.test.ts` · "injects per-host config" | AC7 | The edge handler injects the right config per hostname and falls back cleanly when one is missing |
| `apps/app/src/lib/public-config.test.ts` · "edge config wins, build-time fallback" | AC7 | The app reads injected config first and build-time values second |
| `apps/app/src/lib/chunk-reload.test.ts` · "reloads once" | AC8 | A chunk-load error reloads at most once per session |
| `scripts/smoke-hosting.ts` · "old chunk still served" (after two deploys) | AC8 | Files from the previous build are still reachable |
| `scripts/smoke-hosting.ts` · "landing routes" | AC10 | `/`, the legal pages and `/book/<slug>` on `moduo.app` return the right document |
| `infra/update-server/*.test.ts` · "channel, rollout, kill switch, 204" | AC11 | The update Worker answers 204 or a manifest by channel, rollout bucket and kill switch |
| Bridge release on staging (manual) · "old build updates to new endpoint" | AC11 | An installed staging app updates across the bridge |
| Desktop workflow run with the Mac awake, then asleep · "runner chosen" | AC12 | The runner check picks the Mac or falls back, and logs which |
| `infra/mac-runner/setup.sh --verify` · "isolation checks" | AC13 | The runner user can't read Mike's home or keychain, and workflow triggers are restricted |
| `scripts/dns-diff.ts` (before the nameserver change) · "records match" | AC14 | Every record on Vercel DNS exists identically on Cloudflare |
| Mail round-trip + DMARC report check after cutover | AC14 | Email still works after DNS moves |
| Timed rollback on prod after cutover | AC15 | Rollback takes under a minute |

## Assumptions & technical decisions

Decided on the owner's behalf. Durable ones are in `docs/decisions/workflow.md`, 2026-10-17 · Platform v2.

**Human prerequisites (Mike, before the blocks that need them):**

- (a) Cloudflare account on Workers Paid ($5), an API token scoped to Workers, R2 and DNS for `moduo.app`, and the account ID, stored as GitHub secrets. Before PLAT-3.
- (b) Access to the `moduo.app` registrar to change nameservers. Before PLAT-8.
- (c) GitHub Pro on Mike's account. Before PLAT-8.
- (d) An admin login on the Mac to create the runner user. During PLAT-7.
- (e) A fine-grained token with Administration: read on the repo, for the runner-status check. During PLAT-7.
- (f) Optional: apply to Cloudflare for Startups.

**Layout and tooling:**

- **Layout:** `apps/app` (Rsbuild SPA: `src/`, `public/`, `index.html`, `rsbuild.config.ts`, `rstest.*`, `postcss.config.mjs`, `components.json`), `apps/desktop` (`src-tauri/` moved inside, so the Tauri CLI runs from `apps/desktop`), `apps/landing`, `apps/storybook` (`.storybook/`; `storybook-static/` leaves git and is gitignored), and `supabase/` as package `@moduo/backend` (it stays at the root because the Supabase CLI expects it). `e2e/` and `tests/` become `@moduo/e2e`; `scripts/` and `tools/` stay at the root as repo tooling. `infra/` is new: Worker code, wrangler configs and runner setup.
  - *Rejected:* keeping the app at the root, which mixes the workspace root with an app and defeats per-package caching.
- **Aliases stay** (`@/*`, `@contracts/*`, `@email/*`), re-pointed in `apps/app/tsconfig.json`, so no import in `src/` changes. Making contracts a real `@moduo/contracts` package is deferred.
  - *Rejected:* rewriting imports during the move, which multiplies the diff.
- **Supabase function tests** move out of the app's Rstest config into `supabase/rstest.config.ts`, so Turborepo caches them separately.
- **Turborepo** with tasks `build`, `build:desktop`, `typecheck`, `lint`, `test` and `verify`, and the remote cache deciding what runs in CI (not `--affected`, which misses the app's alias inputs: see PLAT-3 in `docs/decisions/workflow.md`). Never use `turbo prune`; its `bun.lock` pruning had bugs as recently as September 2026.
- **Remote cache:** self-hosted Worker + R2 (`infra/turbo-cache`, our own small v8 artifacts implementation) with HMAC signing. PR jobs get a read-only token and `TURBO_CACHE=local:rw,remote:r`. As built in PLAT-3 they also get the signing key, because turbo can't verify a read without it.
  - *Rejected:* Vercel Remote Cache (we're leaving Vercel); Nx (its free self-hosted cache was deprecated in May 2026).

**Hosting:**

- **Web:** Workers static assets with `not_found_handling = "single-page-application"`. A small Worker runs first, only for HTML navigations and `/config.json`, using `run_worker_first` patterns. (As built in PLAT-4: `not_found_handling = "none"` and the Worker serves the shell for unmatched paths, because SPA mode answered a missing `/static/*` file with the shell; `run_worker_first` is `/` and `/index.html`.)
  - It injects `window.__MODUO_CONFIG__` with HTMLRewriter, so there's no extra round trip.
  - Static files never pass through the Worker.
  - Config values are Worker environment variables per environment (staging, production).
  - *Rejected:* fetching `/config.json` at boot, which adds a blocking request.
- **App config:** a new `src/lib/public-config.ts` replaces the 15 direct `import.meta.env.PUBLIC_*` reads in 9 files. It falls back to build-time defines, which desktop keeps for now.
- **Old chunks:** each deploy uploads the merged hashed files of the current build plus the previous 3, taken from R2 `builds/<build>/static/`, which CI writes on every deploy. A chunk-load handler reloads once.
  - *Rejected:* waiting for native skew protection, which Cloudflare doesn't offer for static assets.
- **Deploys** run from GitHub Actions with `wrangler versions upload` (previews) and `wrangler deploy` (staging and prod), not from Workers Builds, so there's one CI system.
  - *Rejected:* Workers Builds. It has no Rust and no Cargo cache, a 20-minute cap and no artifacts, and it would be a second CI.
- **Prod deploy, until Phase 2's `/ship`:** a manual `deploy-prod` workflow deploys a given staging version to the production environment. The same artifact goes out, with prod config injected at the edge.
- **Landing:** its own Worker. On `moduo.app`, Workers routes send `/book*` and `/static/*` to the app Worker and everything else to the landing Worker. Booking keeps its URL, and the landing build stops including the app. The legal-page rewrites become plain files with clean-URL handling.
- **Headers:** `_headers` files per app. CSP stays report-only in this spec; enforcing it is Phase 3.

**Desktop distribution:**

- **Installers and manifests:** R2 bucket `moduo-releases`, versioned paths (`desktop/<channel>/<version>/…`), and a Worker at `updates.moduo.app` that serves the Tauri updater endpoint by `{{target}}`, `{{arch}}`, `{{current_version}}` and a channel. Rollout percentage and the kill switch live in Worker KV. Upload artifacts first and the manifest last, and never overwrite a version.
- **Bridge:** one release per channel built with the new endpoint first and the old GitHub endpoint as fallback. The GitHub `latest.json` keeps pointing at the bridge until no old installs remain, or 60 days.

**Mac runner and CI:**

- **Mac runner:** a persistent GitHub Actions runner as macOS user `moduo-ci` on Mike's MacBook, with labels `self-hosted, macOS, ARM64, moduo-mac`.
  - It holds the Developer ID certificate in its own keychain and the notarization key. Its Cargo and Bun caches persist, which is the point.
  - *Rejected:* a Tart VM per job on a laptop, which loses the warm cache and costs about 50 GB per image.
- **Fallback:** a `pick-runner` job using `jimmygchen/runner-fallback-action`, pinned by SHA. The workflow can target the runner only on `push`, `workflow_dispatch` and `v*` tags.
- **Signing:** the Apple account is Individual, so only Mike's Mac is a signing runner. Maciej's Mac isn't added until the Organization enrollment.
- **Windows:** stays on GitHub-hosted `windows-latest`. Cross-compiling with `cargo-xwin` is out of scope.
- **GitHub plan:** Pro on the personal account covers private-repo rulesets, required checks and environment secrets. Moving to an organisation is deferred to the Apple Organization enrollment.
- **Actions budget:** Pro includes 3,000 minutes, and Linux overage is $0.006/min. Set a spending limit and alert at $20.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 0 | **PLAT-0 — Phase 0 quick fixes** (own session) | Web version stopgap, `min_build` guard, `vercel.json` 404/caching/headers, parallel + sharded tests, staging gated on checks, pinned actions, dead secrets removed | — (prerequisite hygiene) | — |
| 1 | **PLAT-1 — Workspaces skeleton + landing package** | Root `workspaces`, `turbo.json`, `apps/landing` (moved with `git mv`), and the landing build decoupled from the app build (still deployed by Vercel via an updated `vercel-build.mjs`) | AC1 (partial), AC10 (build half) | PLAT-0 |
| 2 | **PLAT-2 — The big move** (freeze point) | `apps/app`, `apps/desktop`, `apps/storybook`, `@moduo/backend`, `@moduo/e2e`; every path reference updated (configs, workflows, `AGENTS.md` + folder `AGENTS.md` files, `.claude/hooks`, `.claude/skills`, `.claude/agents/validator.md`, `docs/agent-setup.md`, `docs/architecture.md`); a dated "paths before the move" note in `docs/gotchas.md` | AC1, AC2 | PLAT-1 |
| 3 | **PLAT-3 — Turborepo CI + remote cache** | Cache Worker + R2 with signing; `checks.yml` on `turbo run …` through the remote cache with test shards; PR read-only cache | AC3, AC4, AC5 | PLAT-2, prereq (a) |
| 4 | **PLAT-4 — App on Cloudflare (previews + staging)** | `apps/app/wrangler.jsonc`, the edge Worker (config injection, `/config.json`), `public-config.ts`, chunk reload, `_headers`, old-chunk retention, preview comments, staging deploy after checks, `scripts/smoke-hosting.ts`, staging Supabase redirect allowlist; move `CLOUDFLARE_API_TOKEN` from a repo secret into an environment (PLAT-3 left it repo-level) | AC6, AC7, AC8, AC9 | PLAT-3 |
| 5 | **PLAT-5 — Landing on Cloudflare** | Landing Worker, routes for `/book*` and `/static/*` to the app Worker, legal pages, staging landing host | AC10 | PLAT-4 |
| 6 | **PLAT-6 — Desktop distribution on R2 + update server** | R2 bucket, update-server Worker with tests, release workflow publishing to R2, bridge release per channel | AC11 | PLAT-3 |
| 7 | **PLAT-7 — Mac runner with fallback** | `infra/mac-runner/setup.sh` (user, keychain, runner service, `--verify`), `pick-runner` job in the desktop workflow, trigger restrictions | AC12, AC13 | PLAT-2, prereqs (d), (e) |
| 8 | **PLAT-8 — Cutover** | `scripts/dns-diff.ts`; DNS to Cloudflare; custom domain `app.staging.moduo.app` on the `moduo-app-staging` Worker (it runs on workers.dev since PLAT-4) and retire `sync-staging-app.yml`; prod hosts on Workers via the `deploy-prod` workflow; GitHub Pro + rulesets; repo private; Vercel cancelled; `docs/release.md` updated | AC14, AC15 | PLAT-4, PLAT-5, PLAT-6, PLAT-7, prereqs (b), (c) |

PLAT-6 and PLAT-7 can run in parallel with PLAT-4 and PLAT-5: their files don't overlap, except `.github/workflows/_desktop-release.yml`, which PLAT-6 and PLAT-7 both edit, so run those two in sequence.

**Tier:** PLAT-3, PLAT-4, PLAT-6, PLAT-7 and PLAT-8 touch `.github/workflows` or the updater, so they're Tier 2 and get the `validator`. PLAT-1 and PLAT-2 are Tier 1, but PLAT-2 edits workflows too, so it gets the validator as well.

## Out of scope

- Tag-based releases, `/ship`, the hook guard, retiring `staging-app`/`prod-app`/`prod-landing`/`main` (Phase 2). Until then `deploy-prod` is the bridge.
- One version stream and the changelog pipeline (Phase 2). PLAT-0 only adds the web version stopgap.
- The in-house UI updater, enforced desktop and web CSP, one desktop build for both channels (Phase 3).
- Moving Supabase, attachments or functions (section 10 of the audit; later).
- Video engine choice. `specs/moduo-meet.md` plans self-hosted LiveKit on Azure. The Calls re-plan should weigh Cloudflare RealtimeKit and LiveKit Cloud against it, since self-hosting on Azure adds a third platform.
- Mobile builds. iOS later reuses the same Mac runner.
- `packages/ui` extraction and a real `@moduo/contracts` package.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous.
- [x] **Every acceptance criterion has at least one test**, with its plain-English note.
- [x] **Open questions is empty.** Technical unknowns are researched and recorded under Assumptions. The human prerequisites are actions, not open questions.
- [x] **Data model:** no database change. Supabase-first is unaffected. The only Supabase config change is the staging auth redirect allowlist.
- [x] **Module feature:** not applicable (platform work, no spine, MCP or widget surface).
- [x] **Execution blocks** are decomposed, sequenced and context-sized.
- [x] **Design constraints:** no UI beyond the existing update toast. The chunk reload is invisible.
- [x] **Manual-test surfaces** are identified: preview links, the staging smoke script, the desktop launch, the bridge update, the runner decision, mail after the DNS change, and the timed rollback.

**Ready to execute** PLAT-0, PLAT-1 and PLAT-2 now. PLAT-3 onward waits only on the human prerequisites named in each block.

## Open questions

- [ ] (none)
