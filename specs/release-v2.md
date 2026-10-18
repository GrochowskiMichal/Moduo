# Spec: Release v2 — tag releases, /ship, release notes, What's new, split Mac builds

> Status: **Draft — Ready to execute** · Owner: mike · Source: the release-pipeline audit (private Artifact "Moduo Release Pipeline"), Phase 2 of its roadmap, plus the decisions Mike made on 2026-10-17 and 2026-10-19. Builds on [`specs/platform-v2.md`](./platform-v2.md) (PLAT-0–8, landed).

## Scope

Platform v2 gave Moduo fast CI, Cloudflare hosting and an update server. Prod still ships by hand in three steps (bump `VERSION`, run `deploy-prod`, run `Desktop Release (production)`), tracked by a mirror branch (`prod-app`), with no release notes users can read.

This spec makes a release one guarded step:

- **`/ship`** in Claude picks the version, writes the notes and asks one question: ship it yourself now, or hand it to the other founder.
- **A `vX.Y.Z` tag** ships web, landing and desktop from the same commit.
- **Release notes** are written by the agent as work lands. They publish without review, behind an automated leak check. They appear in an in-app "What's new", in the update toast, on `moduo.app/changelog` and in the updater manifest.
- **Long-lived web tabs** learn about a new version and offer a reload.
- **Mac updates** download per architecture (about half the size). The website keeps one universal `.dmg`.
- **Mirror branches** (`prod-app`, `staging-app`, `prod-landing`, `main`) are retired, and stale remote branches are cleaned up.

**Out of scope:**

- Windows code signing. Mike decided on 2026-10-19 to skip it; revisit before public launch.
- The in-house UI updater and CSP enforcement (Phase 3).
- Automating database migrations and Edge Function deploys (Phase 4, after the migration history is fixed). Until then `/ship` checks them and points at the runbook.

## Product behavior & UX

**People using Moduo:**

1. **After an update** (desktop relaunch or web reload), the app shows a small toast once: "Updated to 1.2.0 · See what's new". Clicking it opens **What's new**, a dialog listing that release's changes in three groups: New, Improved, Fixed. Each item is one or two plain sentences. Earlier releases are one click away. It never opens on its own over someone's work.
2. **The desktop update toast** ("Moduo 1.2.0 is ready") shows the release's two highlights under the title, with **Update & restart** and **See what's new**.
3. **Settings → About** shows the version, the build and "Check for updates" as today, plus a **What's new** list of the last releases. "Full changelog" links to `moduo.app/changelog`.
4. **A web tab left open across a release** shows a quiet toast within about 10 minutes, or when the tab regains focus: "Moduo was updated · Reload". It never reloads by itself, so nothing typed is lost.
5. **`moduo.app/changelog`** lists every release, newest first, in the same words.
6. **Mac users** get smaller update downloads, one per chip. The website download stays a single `.dmg` that works on every Mac.

**Mike and Maciej:**

1. While working, `/s3` adds a release-note file for each block that changes something users notice. Internal work is marked internal and never shown.
2. To release, either of you runs **`/ship`** in Claude. It shows:
   - what's in the release, in plain words with the generated notes
   - the version it will be (any `new` item → minor bump, otherwise patch)
   - a risk label: **Higher risk** when the release touches migrations, RLS, auth, billing, account deletion, `moduo-mcp`, the updater or signing; **Normal** otherwise
   - anything that still has to be done by hand first (pending migrations or Edge Functions)
3. It asks one question: **"Ship it yourself now, or hand it to Maciej (Mike) to look at first?"** For Higher risk, hand-off is listed first as the recommendation. It's never forced.
4. **Ship now:** `/ship` opens a "Release 1.2.0" PR (VERSION bump, notes, consumed note files removed). It merges it when checks pass, tags the merge commit `v1.2.0`, watches the release run and reports what's live.
   - **Hand off:** `/ship` opens the same PR without merging, assigns the other founder and posts a summary. The other founder's Claude finishes it with `/ship v1.2.0`.
5. **Rollback:** web through Cloudflare in under a minute (as today). Desktop through `desktop-rollout`: kill switch, or pin the previous version. Both are in `docs/release.md`.

## Edge cases

- **Nothing user-facing since the last tag** (only internal notes): `/ship` says so and asks whether to ship anyway as a patch with a "Reliability improvements" line, or not ship.
- **Pending migrations or Edge Functions since the last tag:** `/ship` lists them and stops until the person confirms they're applied per `docs/release.md` §2–3. It never applies them itself (`guard-prod-db.sh` still applies).
- **A note fails the leak check:** verify and CI fail on the PR that added it, with the exact offending words. A release can't be cut with a failing note.
- **Security fix:** the note type `security` always renders as the fixed line "Security and reliability improvements." Any other text fails the check.
- **Checks fail on the release PR:** `/ship` stops and reports. No tag is created.
- **Tag pushed by hand, without `/ship`:** blocked locally by `guard-release.sh`. If it happens anyway (from another machine), `release.yml` still checks that the tag's commit is on `develop`, passed `checks`, and that `VERSION` matches the tag. It refuses otherwise.
- **Web-only release** (no change in `apps/app`, `apps/desktop` or shared packages since the last desktop release): desktop is skipped with a note in the run summary.
  - Desktop bundles the UI until Phase 3, so any `apps/app` change triggers a desktop build.
- **Windows build fails:** Windows is left out of that release's manifest (as today). The release still ships; `/ship` reports it.
- **Mac runner offline:** falls back to GitHub's Mac (PLAT-7).
- **Hand-off left waiting:** the PR stays open. A new `/ship` from either founder sees it and offers to continue it rather than start a second release.
- **Two releases started at once:** `release.yml` has a concurrency group per channel and queues the second. `/ship` refuses to open a second release PR while one is open.
- **What's new with no notes for the installed version** (a build from before this spec): no toast. About still lists the history.
- **Reload prompt while offline or on an old build** whose `/config.json` lacks `build`: no prompt.
- **Per-arch updater bundle missing** (one arch failed): that platform key is left out of the manifest, so the app falls back to the universal bundle key if present. Otherwise no update is offered for that arch.
- **Deleting branches:** only branches fully merged into `develop` are deleted automatically. Unmerged `claude/*` and `t/*` branches are listed for Mike to approve one by one.

## Acceptance criteria

- **AC1:** A note file in `.changes/` with `type` (new, improved, fixed, security) and plain text passes the leak check. One containing a path, a code identifier, a block ID, a table, SQL function or Edge Function name, or a banned term fails `bun run verify` and CI, with the offending words named.
- **AC2:** `/s3` adds a `.changes/<block>.md` file for each landed block that users can notice, following the writing rules, or `internal: true` otherwise.
- **AC3:** `/ship` shows the contents, version, risk label and manual prerequisites, then asks ship-now or hand-off. It does nothing outward-facing before the answer.
- **AC4:** Ship-now produces a merged "Release X.Y.Z" PR (`VERSION`, `release-notes/releases.json`, `CHANGELOG.md`, consumed notes removed) and an annotated `vX.Y.Z` tag on its merge commit. `release.yml` then deploys web and landing and, when needed, desktop, all from that tag.
- **AC5:** Hand-off produces an open release PR assigned to the other founder with the summary. `/ship vX.Y.Z` from the other founder completes it.
- **AC6:** `guard-release.sh` blocks `git push` of a `v*` tag and `gh workflow run release`/`deploy-prod`/`desktop-release-prod` unless `/ship` wrote a one-time marker for that version.
- **AC7:** `release.yml` refuses a tag whose commit isn't on `develop`, hasn't passed `checks`, or whose `VERSION` differs from the tag.
- **AC8:** After updating to a release, the app shows "Updated to X · See what's new" once. The dialog lists that release's grouped notes, and earlier releases can be opened. It works offline on desktop because the notes are bundled.
- **AC9:** The desktop update toast shows the new version's two highlights. Settings → About lists recent releases and links to `moduo.app/changelog`.
- **AC10:** A web tab on an older build shows "Moduo was updated · Reload" within 10 minutes of a production deploy, or on focus, and never reloads by itself.
- **AC11:** `moduo.app/changelog` lists every release from `releases.json`, newest first.
- **AC12:** Production and staging updater manifests carry separate `darwin-aarch64` and `darwin-x86_64` bundles, each signed and from notarized apps. Each is at most 60% of the universal bundle's size. The website `.dmg` stays universal and notarized.
- **AC13:** `prod-app`, `staging-app`, `prod-landing` and `main` no longer exist. Workflows, environments, guards and docs reference tags and `develop` only. Branches fully merged into `develop` are deleted, and GitHub deletes head branches on merge.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `scripts/release/check-notes.test.ts` · "accepts plain notes, names each leak" | AC1 | Good notes pass. Paths, identifiers, block IDs, DB and function names and banned terms fail with the word named. |
| `scripts/release/check-notes.test.ts` · "deny-list comes from the codebase" | AC1 | Table, SQL function and Edge Function names are read from `supabase/` at run time, so new ones are covered automatically. |
| `scripts/release/check-notes.test.ts` · "security type is the fixed line" | AC1 | Any other text on a security note fails. |
| A probe PR with a leaking note (closed after) | AC1 | CI fails on it |
| `.claude/skills/s3/SKILL.md` review + one real `/s3` run in a later block | AC2 | The note gets written |
| `scripts/release/changes.test.ts` · "collects, versions, renders" | AC4, AC11 | The right bump; `releases.json`, `CHANGELOG.md` and the manifest Markdown are rendered from note files |
| First real release, run through `/ship` (v1.2.0) | AC3, AC4 | The full ship-now path, with links in the PR body |
| A dry-run hand-off on a throwaway version, closed after | AC5 | The PR is assigned and the summary posted |
| `.claude/hooks/guard-release.test.sh` | AC6 | Blocks without a marker, allows once with it, and the marker is consumed |
| `release.yml` refusal probe (a tag on a non-develop commit, deleted after) | AC7 | Refuses with a clear error |
| `apps/app/src/features/whats-new/*.test.tsx` · "shows once per version, groups, history" | AC8 | Toast and dialog behaviour, the last-seen-version logic |
| `apps/app/src/features/updater/update-toast.test.tsx` · "two highlights" | AC9 | The toast renders highlights from manifest notes |
| `apps/app/src/lib/new-version-check.test.ts` · "prompts on change, never reloads, quiet offline" | AC10 | The polling logic |
| `apps/landing` build test · "changelog page from releases.json" | AC11 | The page lists releases in order |
| Staging desktop run + `curl` of the manifest + size comparison in the PR | AC12 | Per-arch bundles exist, are signed, and are about half the size |
| `scripts/release/branch-audit.ts` output + `git ls-remote` after | AC13 | Mirror branches are gone and merged branches are cleaned |

## Assumptions & technical decisions

**Versioning and notes:**

- **Version stays on 1.x SemVer.** The 0.x idea (revision 1) is dropped because installed apps are on 1.x: going down would need a downgrade bridge for nothing. Bump policy in `/ship`: any `new` note → minor, otherwise patch. Major only when asked. Staging keeps `-rc.<run>`.
- **Note files:** `.changes/<block-or-slug>.md` with YAML front matter (`type: new|improved|fixed|security`, `internal: true|false`, optional `highlight: true`) and one or two sentences, max 200 characters. Agents write them (`/s3`); no human review.
  - *Rejected:* conventional-commit generators like git-cliff and release-please. Commit subjects are written for agents and would leak internals.
- **Leak check** `scripts/release/check-notes.ts`, run in `verify` (as a Turborepo root task) and in `checks.yml`. It rejects:
  - file paths, `camelCase`/`snake_case`/`kebab-case` identifiers, backticks and `()`, block-ID patterns (`[A-Z]{2,5}-[A-Z]?\d+[a-z]?`)
  - a deny-list built at run time from `supabase/migrations` (table and function names) and `supabase/functions/*` directory names
  - a fixed term list: RLS, migration, Supabase, Tauri, Rust, Cloudflare, Worker, endpoint, token, secret, CVE, exploit, vulnerability, validator, Turborepo, workflow
  - Product words stay allowed even though they sound technical: agents, Claude Desktop, MCP, GitHub pull requests (the GitHub-on-tasks feature).
  - `security` notes that aren't the fixed line
- **Notes source of truth:** `release-notes/releases.json`, committed and appended by the release PR. App, landing, `CHANGELOG.md` and manifest notes are all generated from it. It's bundled into the app at build time (an import), so desktop has it offline.

**Shipping:**

- **`/ship` skill** (`.claude/skills/ship/SKILL.md`) does the preflight, release PR, merge, tag, watch and report. GitHub logins: Mike = `GrochowskiMichal`, Maciej = `En5hi`; the "other founder" is derived from `gh api user`.
  - The release PR goes `release/vX.Y.Z → develop`.
  - The tag is created locally on the merge commit and pushed, with the one-time marker `.claude/release-approved/<version>` (gitignored) written just before and deleted after.
  - *Rejected:* a GitHub Environment approval. Required reviewers on a private repo need Enterprise, and Mike chose the agent-side check.
- **`guard-release.sh`** is a PreToolUse hook beside `guard-git.sh`, registered in `.claude/settings.json`. Its error message says "run /ship".
- **`release.yml`** runs on tag push `v*`.
  - **Jobs:** `resolve` (on develop, checks passed, VERSION = tag) → `web` (the app and landing deploy logic from `deploy-prod.yml`, moved into reusable `_deploy-web.yml`) → `desktop` (`_desktop-release.yml` with `ref: <tag>`, channel production, only when `apps/app`, `apps/desktop` or `packages` changed since the last tag that shipped desktop) → `notes` (GitHub release on `moduo-releases` with the rendered notes).
  - `deploy-prod.yml` becomes "redeploy a tag" (input: tag) for re-runs. `desktop-release-prod.yml` takes a tag input. Both are guarded by the hook.
- **Environments:** `cloudflare-deploy` allows `develop`, `mike` and tags `v*` (removing `main`, `prod-app`); likewise `turbo-cache-write`.
- **Manifest notes:** the publish job reads the version's entry from `releases.json` (production) or renders pending `.changes` as "Coming next" (staging), as Markdown. The update server already passes `notes` through.

**In the app and on the landing:**

- **What's new UI:** `apps/app/src/features/whats-new/`, built on existing primitives (Dialog, Toast, the About section) with tokens only, per `docs/DESIGN_RULES.md`. The last-seen version is kept in synced preferences when signed in, falling back to localStorage. Maciej may restyle later; behaviour is fixed here.
- **New-version check (web):** poll `/config.json` (the edge Worker already returns `build`) on `visibilitychange`/focus and every 10 minutes while visible. Prompt when `build` differs from the bundled `MODUO_BUILD` twice in a row, so mid-deploy flaps don't prompt. Old chunks are kept for 3 builds (PLAT-4), so the old tab keeps working until reload.
- **Changelog page:** `apps/landing/build.mjs` renders `changelog.html` from `release-notes/releases.json` with the landing's existing styles. Clean URL `/changelog`. `ABOUT_LINKS` "What's new" points to it.

**Split Mac builds:**

- Build per-arch `.app` bundles (`--target aarch64-apple-darwin`, then `x86_64-apple-darwin`), then the universal `.dmg` (`--target universal-apple-darwin`, reusing the two compiles from cache), all in the one Mac job. The Mac runner can't run two jobs at once, and per-arch compile on an M4 is about 65 s each.
- Each per-arch `.app` is notarized (zip submission, in parallel with the `.dmg`). The updater tarballs aren't stapled: updater-installed apps aren't quarantined, and the ticket is checked online.
- The manifest gets per-arch URLs. The universal `.app.tar.gz` is still produced for one release as the fallback key, then dropped.
- *Rejected:* separate Mac jobs per arch (there's only one Mac runner, and it doubles fallback cost); per-arch `.dmg` on the website (arch detection in browsers is unreliable).

**Branches:**

- **Retirement:** after the first tag release is proven (AC4), delete `prod-app`, `staging-app`, `prod-landing` and `main`. Update `guard-git.sh` (protect `develop`, `mike`, `maciej`; block pushing `v*` tags without the marker through the new hook), `checks.yml`, `secret-scan.yml`, the preview workflows, `docs/release.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/AGENTS.md` and `scripts/release/version.mjs` comments.
  - `scripts/release/branch-audit.ts` lists remote branches as merged into `develop` (deleted) or unmerged (printed for approval).
  - Turn on GitHub's "Automatically delete head branches".
- **The DB and functions** prerequisite check in `/ship`: `git diff --name-only <last tag>..HEAD -- supabase/migrations supabase/functions`. Anything listed must be confirmed applied before the PR merges.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **REL-1 — Release notes pipeline** | `.changes/` format, `check-notes.ts` (+ tests, in verify and CI), `changes.ts` (collect, bump, render `releases.json`, `CHANGELOG.md`, Markdown), initial `releases.json` with 1.1.0, writing rules in `docs/release-notes.md`, the `/s3` step, the leak probe PR | AC1, AC2 | — |
| 2 | **REL-2 — Tag release workflow** | `release.yml`, `_deploy-web.yml` (extracted from `deploy-prod.yml`), desktop-on-change logic, tag inputs on `deploy-prod`/`desktop-release-prod`, environment rules for `v*`, manifest notes from `releases.json`, the refusal probe | AC4 (workflow half), AC7 | REL-1 |
| 3 | **REL-3 — `/ship` + `guard-release.sh`** | The skill (preflight, risk, DB and function check, question, release PR, merge, tag, watch, report, hand-off, resume), the hook + its test, `.gitignore` marker dir, dry-run hand-off, **first real release v1.2.0 through `/ship`** | AC3, AC4, AC5, AC6 | REL-2 |
| 4 | **REL-4 — What's new, update toast, reload prompt, changelog page** | `features/whats-new`, the updated update toast, the About history, the new-version check, the landing `/changelog`, the `ABOUT_LINKS` change | AC8, AC9, AC10, AC11 | REL-1 |
| 5 | **REL-5 — Split Mac builds** | Per-arch bundles + notarization + manifest keys in `_desktop-release.yml`, size comparison | AC12 | REL-2 |
| 6 | **REL-6 — Retire mirror branches + cleanup** | Branch deletions, guard/workflow/environment/doc updates, `branch-audit.ts`, delete-on-merge setting | AC13 | REL-3 (first tag release proven) |

REL-4 can run in parallel with REL-2 and REL-3: it touches the app and landing, not workflows. REL-5 and REL-2 both edit `_desktop-release.yml`, so run them in sequence.

**Tier:** REL-2, REL-3, REL-5 and REL-6 touch workflows, hooks, the updater or signing, so they're Tier 2 (validator). REL-1 and REL-4 are Tier 1.

## Out of scope

- Windows code signing (Mike, 2026-10-19).
- The in-house UI updater, desktop and web CSP enforcement, one desktop build for both channels (Phase 3).
- Running migrations and Edge Function deploys from CI, and the migration-history baseline (Phase 4).
- Making the repo private (needs CI minutes cut first; separate task).
- Translations of release notes.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous.
- [x] **Every acceptance criterion has at least one test**, with its plain-English note.
- [x] **Open questions is empty.** The one product call (Windows signing entity) is answered: skip.
- [x] **Data model:** no new tables. The last-seen version goes in the existing synced preferences, with a localStorage fallback.
- [x] **Module feature:** not applicable (platform and release work; What's new is app chrome, not a module).
- [x] **Execution blocks** are decomposed, sequenced and context-sized.
- [x] **Design constraints:** What's new, the toast changes and the About history use existing primitives and tokens only, per `docs/DESIGN_RULES.md`. The changelog page uses the landing's existing styles.
- [x] **Manual-test surfaces:** the leak probe PR, the `/ship` run for v1.2.0, the hand-off dry run, the What's new toast after updating, the web reload prompt across a deploy, the per-arch manifest sizes, `git ls-remote` after cleanup.

**Ready to execute.** Start with REL-1. REL-4 can run in parallel with REL-2.

## Open questions

- [ ] (none)
