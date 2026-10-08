# Build order — the execution ledger

> **Status of record for "what's next."** One flat, dependency-respecting sequence of every execution block across all ready specs, with a checkbox each. This is the single entry point a fresh session reads to know what to build next — the per-block detail lives in each spec's *Execution blocks* table.
>
> **How `/s2` uses this:** if you name a block, it builds that one. If you don't (e.g. `/s2 next`), it takes the **first unchecked block below whose dependencies are all ticked**, states which it picked and why, then builds it. On success it ticks the box here.
> **How `/s3` uses this:** at session end it reconciles this file (ticks any block completed that session) and syncs each spec's `Status:` line.
> **Invariant:** every block's dependencies appear **above** it, so strict top-to-bottom is always a valid order. Items at the same depth with disjoint deps may be built in parallel/any order.

**Focus:** Tasks (TV-*, AT-*, and the DS-* blocks they need) · the website (moduo.app, PRs into `prod-landing`: BRAND-4, PRIV-2d) · transactional email templates (TX-*, plus BRAND-1's email logos), **not** the email module · set by Maciej 2026-10-08 — the designer's current focus area, edited by Mike or Maciej. `/s2` and `/s3` turn a 🔎 Found item into a chip or next-session suggestion only when it falls inside this; while it's unset, none do.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done (date + branch in the trailing note).

> **⚠ Reading the trailing notes: "migration deploy-ready but unapplied" is HISTORY, not current state.**
> Many `[x]` notes below say a block's migration was "deploy-ready but unapplied", "deploy-gated", or "manual-test post-deploy". Those describe the world **on the day that block shipped** — sessions routinely could not reach prod. **As of 2026-07-29 (OPS-1 + OPS-2) every migration file in this repo is applied to prod**: every object those files *declare* (195 of them — tables, columns, functions, triggers, policies, one view) exists in prod, and no function body drifts semantically. See [`docs/reviews/ops-2-schema-reconciliation.md`](../docs/reviews/ops-2-schema-reconciliation.md), re-runnable via `bun run db:reconcile`. **Mind its limits (§1.1):** it is a name-existence + function-body check — **indexes, grants, function signatures, base-table columns and policy bodies are NOT compared**, which is exactly the class OPS-2's anon-EXECUTE hole fell into. "Applied" ≠ "audited".
> **Do not treat a per-block "unapplied" note as a task.** Probe the database before concluding anything is pending — a stale note of exactly this kind is why OPS-1's own entry first claimed 3 pending migrations when there were 2 (gotchas.md §Supabase/migrations: *"The repo's own docs are NOT evidence of what prod has"*).
> The real remaining schema gap runs the other way: at OPS-2 time prod held **73 applied migration versions** while the repo has **43 files today**, and **22 of prod's 44 tables are created by no migration**, so `supabase db reset` cannot bootstrap a database. That is an open problem, tracked in the OPS-2 inventory §4 — not a per-block deploy step.

## Wave 0 — Connective Tissue (the spine) · [`specs/connective-tissue.md`](./connective-tissue.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Wave 1 — Contacts (light CRM) · [`specs/contacts.md`](./contacts.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Wave 1.5 — Contacts v3 fix pack · [`specs/contacts-v3-fixpack.md`](./contacts-v3-fixpack.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Wave 2 — Calendar (the schedule-to-completion loop) · [`specs/calendar.md`](./calendar.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Tasks — Timeline view (the un-deferred lightweight Gantt) · [`specs/tasks-timeline.md`](./tasks-timeline.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Wave 3 — Notes rebuild (the multiplayer enabler) · [`specs/notes.md`](./notes.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Email — Spark replacement (desktop-first hybrid) · [`specs/email.md`](./email.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Wave 6 — Dashboard rebuild ("Home") · [`specs/dashboard-rebuild.md`](./dashboard-rebuild.md) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Dogfood fixes (DF) — from the whole-app critique · [`docs/reviews/whole-app-critique-2026-07-plan.md`](../docs/reviews/whole-app-critique-2026-07-plan.md) *(the spec — block details, ratified designer calls, ACs live there)*

> Ratified 2026-07-10 from [the whole-app critique](../docs/reviews/whole-app-critique-2026-07.md) (re-based on PR #73). Three waves: **A = trust-killers before dogfood**, **B = making the moat felt**, **C = one-product cohesion + pulled-forward spine features**. Runs BEFORE MCP-1. Lanes below; don't run two blocks touching `entity-open.ts`/app-chrome concurrently (DF-1/DF-2/DF-10).

**Wave A — trust-killers**

**Wave B — making the moat felt**

**Wave C — cohesion + pulled-forward spine features**
- [ ] **DF-15 — Home first-run composition** · deps: — · lane dashboard · ratified: recompose default with ~2 free slots (designer look-approves the draft); content anchors/fills its frame; fallback heading → **"Open"**; toasts off the edit controls.

_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._

## Housekeeping & pre-alpha (between waves — designer-requested 2026-07-03) · ✅ complete

All blocks done. Notes and blocks: [BUILD_LOG.md](./BUILD_LOG.md).

## Zod / enum foundation · `.omo/plans/zod-enum-foundation.md`

Shared Zod 4 contracts + closed vocabularies. Wave 1 (tasks 1–4) landed on `t/mike/zod-enum-foundation` and is on `develop`. Wave 2–3 (tasks 5–12) continues on `t/mike/zod-enum-wave2`.

---
- [ ] **MCP-1 — Pre-alpha connector hardening** · _partly done 2026-10-08 by KEYS-1: the keyed write round-trip ran for every module (SQL-level on prod, rolled back) and its six findings are fixed; `scripts/mcp-roundtrip.ts` runs the HTTP round-trip with a real key. Still open here: the notes CRDT write path (below), a task-create tool, refreshing `docs/moduo-mcp-connector.md`'s per-module tool tables._ · deps: ~~the alpha feature set (post-Notes + Email + the Dashboard/**Mindmap** reworks)~~ → **DEPS MET as of 2026-07-29.** Notes ✅, Email ✅ (EM-1…EM-11), the Dashboard rework ✅ (Wave 6, DB-1…DB-8), and the **Mindmap rework was removed from alpha** that day, so MCP-1 no longer waits on it. Finance stays post-v1. **Nothing blocks it — buildable with no further planning.** (Still *designed* to run late: the redeploy picks up everything since the last one, so schedule it after the rest of Wave D.) · Redeploy `moduo-mcp` (picks up the calendar module + anything since the last deploy), then a **keyed round-trip per module** (view + edit scopes: tasks, links, contacts, calendar, notes, email — dashboard/mindmap expose no ops; finance is post-v1) against the hosted workspace — the api-key permission gotcha proved reads can pass while writes are silently dead, so every module's write path gets exercised with a real scoped key; fix findings; refresh `docs/moduo-mcp-connector.md`. *(Note: the 20260702170000 permission fix is already live server-side — the deployed connector's contacts/spine/tasks writes work today; the redeploy mainly adds the calendar tools.)*
- [ ] **DESKTOP-1 — macOS updater + CI release (hands-off dogfood updates)** · deps: Wave-6 dashboard rebuild done + app "ready" (designer deferred 2026-07-09) · **macOS-first — Windows deprioritized** (~80–90% Mac usage). Today's loop is a local rebuild: `bun run build:desktop --bundles app` + drop-in replace `/Applications/Moduo.app` (Rust is cargo-cached, so frontend-only rebuilds are ~30s–2min; identifier `com.moduo.desktop` stable → data untouched). This block makes it hands-off: add `@tauri-apps/plugin-updater` + a signing keypair + a GitHub Actions **release** job on push to `maciej` (build the `.app`, sign the update, publish `latest.json` + bundle to Releases) so the app self-updates on launch. Also prune the dead `PUBLIC_*` stock-API secrets from [`windows-portable.yml`](../.github/workflows/windows-portable.yml) (widgets deleted in DB-2). **Later endgame** (separate, needs a deployed web app — `PUBLIC_WEB_ORIGIN` is empty today): point the desktop shell at the deployed web URL for **zero-rebuild** frontend updates (only Rust changes then need a build). Data-safety reminder for any of this: Supabase = truth, local redb = disposable cache, dashboard layout local-only **until DB-4**.

---

_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._

## Moduo Meet — own video calls (LiveKit on Azure) · [`specs/moduo-meet.md`](./moduo-meet.md)

> Lanes: **infra** (0a → 0b) · **app** (1 → 2 → 3 → 4 → 7 → 8 → 9 → 10). **MEET-5** (desktop) and **MEET-6** (Studio) can run in parallel after MEET-2. 0b can run alongside 1/2. External prereqs for 0a: Azure VM quota (the subscription reports 0 today), Vercel DNS access, Supabase MCP auth.

- [ ] **MEET-0a — Azure foundation + single LiveKit node** · deps: —
- [ ] **MEET-0b — Scale-out (Redis + VMSS autoscale) + Egress + monitoring** · deps: MEET-0a
- [ ] **MEET-1 — Data, contracts, tokens (meet_rooms/invites/sessions/recordings, meet-room/token/admit)** · deps: MEET-0a
- [ ] **MEET-2 — Call core (web): join pre-connect, calm-cinematic stage, dock, share, adaptive quality** · deps: MEET-1
- [ ] **MEET-3 — Public /m/:slug, lobby/knock, waiting room, mobile guest** · deps: MEET-2
- [ ] **MEET-4 — Booking + events + instant call wiring (default for paid)** · deps: MEET-3
- [ ] **MEET-5 — Desktop in-app calls + floating mini-player + screen share** · deps: MEET-2
- [ ] **MEET-6 — Studio look (blur/replace, noise, low-light, auto-framing)** · deps: MEET-2
- [ ] **MEET-7 — Spine panel + live Call note (action items → tasks)** · deps: MEET-4
- [ ] **MEET-8 — Webhooks + aftermath recap + 4 h sweep** · deps: MEET-7, MEET-0b
- [ ] **MEET-9 — Recording + transcript (Egress → Blob, Speech batch, consent)** · deps: MEET-8
- [ ] **MEET-10 — Module DoD: MCP tools + Next-call widget** · deps: MEET-8

## Permissions & sharing (all modules) · [`specs/permissions.md`](./permissions.md)

> Order: PERM-0 → PERM-1 → PERM-2, then PERM-3…7 in any order (each needs PERM-1+2); PERM-8 needs PERM-5. Designer calls locked 2026-10-06 (spec §Open questions).

- [ ] **PERM-8b — Collective links for real: per-host busy calendars in booking-public, a co-host request inbox (link name visible to hosts), owner sees pending/declined; then flip `COLLECTIVE_LINKS_ENABLED`** · deps: PERM-8
- [ ] **PERM-6b — Contact groups list + share screen; merge moves links/activity and is scoped to the workspace; then re-enable the contact share bar** · deps: PERM-6

_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._

## Tasks v2 — dogfood rework · [`specs/tasks-v2.md`](./tasks-v2.md) + [`specs/design-state-layer.md`](./design-state-layer.md) + [`specs/attachments.md`](./attachments.md)

> **Planned 2026-10-07 (`/s1`, from [`.design/tasks-dogfood/REVIEW.md`](../.design/tasks-dogfood/REVIEW.md)).**
> - **Land on `maciej` only:** no pushes or merges to `develop` until Maciej says so. Mike is rebuilding on `develop`, so this overrides the standing develop authorization for these blocks.
> - **DoR status:** ✅ means ready now; the rest follow their dependencies. All designer calls are answered (2026-10-08).
> - **Order:** top to bottom, every dep listed above its dependents. The lane table below shows what can run at once.

- [ ] **AT-1 — Attachments storage, limits, trash** ✅ · attachments block 1 · deps: — · lane attachments · migration + `purge-deleted` Edge Function; confirm the hosted upload limit ≥ 500 MB
- [ ] **TV-D2 — Personal queue (data)** · tasks-v2 block 4 · deps: TV-D1 · lane data · migration + legacy op shims + MCP queue tools
- [ ] **TV-D3 — Time entries** · tasks-v2 block 5 · deps: TV-D1, TV-F1 · lane data · migration + legacy backfill/shim
- [~] **TV-T1 — Shared tag store** · tasks-v2 block 6 · deps: TV-D1 · lane data · claimed 2026-10-08 `t/maciej/tv-t1-shared-tag-store`
- [ ] **DS-3 — NavRow + MetaCount (+ Tasks rail)** · design-state-layer block 3 · deps: DS-2, TV-Q1 · lane design · also: return focus to the rail when a row menu's dialog closes (TV-Q1's delete-bucket confirm leaves it on the page body, like notes' Delete forever)
- [ ] **TV-D4 — Queue & assignee in the UI (claims, My tasks)** · tasks-v2 block 7 · deps: TV-D2, DS-3 · lane tasks-ui
- [ ] **TV-D5 — Live updates (Realtime)** · tasks-v2 block 8 · deps: TV-D2 · lane data · adds tables to the `supabase_realtime` publication
- [ ] **TV-U1 — Rows, board, completed** · tasks-v2 block 9 · deps: DS-3, TV-D4 · lane tasks-ui
- [ ] **TV-U3 — Detail panel + comments** · tasks-v2 block 10 · deps: DS-2, TV-D1, TV-D3 · lane tasks-ui
- [ ] **TV-F2 — Queue run (line-up, run, Now/Up next, claims "is on this")** · tasks-v2 block 11 · deps: TV-F1, TV-D2, TV-D3, DS-2 · lane focus · migration (`focus_runs`)
- [ ] **TV-F3 — Pomodoro per run, break, summary, empty, Home pomodoro widget** · tasks-v2 block 12 · deps: TV-F2 · lane focus
- [ ] **TV-U2 — Toolbar, Filter, Display, search** · tasks-v2 block 13 · deps: DS-4, TV-U1, TV-D4 · lane tasks-ui
- [ ] **TV-U4 — Drag and drop (reorder vs nest, sidebar drops, cross-group)** · tasks-v2 block 14 · deps: TV-U1, DS-4, TV-D4 · lane tasks-ui
- [ ] **TV-U5 — Multi-select, bulk actions, keyboard, `?` sheet** · tasks-v2 block 15 · deps: TV-U4 · lane tasks-ui
- [ ] **TV-U6 — Sidebar: bucket colours/reorder, archive, delete-with-tasks, Recently deleted** · tasks-v2 block 16 · deps: DS-3, TV-D4, AT-1 · lane tasks-ui · migration (`buckets.color/archived_at`, batch ids) · note: TV-Q1 hides a deleted bucket for the whole session (`src/features/tasks/hidden-buckets.ts`), so a Restore must call `unhideBucket` or rework that store
- [ ] **TV-U7 — Capture v2 (`#tag`, pills, queue switch, filter seed)** · tasks-v2 block 17 · deps: DS-2, TV-T1, TV-D2, TV-U2 · lane tasks-ui
- [ ] **TV-F4 — In flight (hand-off, check-backs, linked waits)** · tasks-v2 block 18 · deps: TV-F3, TV-U3 · lane focus · migration (`focus_in_flight`)
- [ ] **TV-F5 — Calendar & Home on one engine** · tasks-v2 block 19 · deps: TV-F2, TV-D3 · lane focus
- [ ] **AT-2 — Upload pipeline + panel attachments + viewer** · attachments block 2 · deps: AT-1, TV-U3 · lane attachments
- [ ] **AT-3 — Attachments everywhere + Settings → Storage** · attachments block 3 · deps: AT-2, TV-U1, TV-U7 · lane attachments
- [ ] **TV-U8 — Saved views** · tasks-v2 block 20 · deps: TV-U2, TV-U6 · lane tasks-ui · migration (`task_views`)
- [ ] **DS-5 — Sweep: NavRow + state layer in every module, lint guards** · design-state-layer block 5 · deps: DS-3, DS-4 · lane design
- [ ] 🔴 **TV-D7 — Contract cleanup (drop legacy columns, view, shims, MCP aliases)** · tasks-v2 block 21 · deps: all TV-* above + ≥2 desktop releases and 14 days after TV-D3 ships
- [ ] **GR-0 — `/s1` the app-wide reference grammar (`@` / `#` / `/`)** · own spec, not written yet · deps: — · `#tag` in text = Link (decided 2026-10-08)

_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._

### Tasks v2 lanes (parallel once merged into `maciej`)

| Once merged into `maciej` | Ready to run in parallel | Width |
| --- | --- | --- |
| *(start)* | **TV-Q1** · **TV-F1** · **DS-1** · **TV-D1** · **AT-1** | 5 (recommend 3–4 live at once) |
| DS-1 | **DS-2** | 1 |
| TV-D1 | **TV-D2** · **TV-T1** (+ **TV-D3** once TV-F1 is in) | 2–3 |
| DS-2 (+ TV-Q1) | **DS-3** · **DS-4** | 2 |
| TV-D2 + DS-3 | **TV-D4** · **TV-D5** | 2 |
| DS-2, D1, D3 | **TV-U3** | 1 |
| TV-D4 | **TV-U1** → then **TV-U2** · **TV-U4** | 2 |
| F1, D2, D3, DS-2 | **TV-F2** → **TV-F3** → **TV-F4** · **TV-F5** | 1–2 |

**Tasks v2 serialization points** (they share files, so expect small merges if run together):
- **`src/lib/runtime.web.ts` + `runtime.types.ts`** — D1, D2, D3, T1, AT-1, F2.
- **`src/features/tasks/hooks/use-tasks-module.ts`** — Q1, D1, D2, D3, T1, D4.
- **`task-row.tsx` / `task-card.tsx`** — Q1, D1, D4, U1.
- **`bucket-rail.tsx`** — Q1, DS-3, U6.
- **`tokens.css` / `global.css`** — DS-1, DS-2.
- **Migrations** — D1, D2, D3, F2, F4, U6, U8, AT-1, all with distinct timestamps. Never two sessions altering `tasks` at once: D1, D2 and D3 are sequential for that reason.

## Brand system · [`.design/brand/BRAND_BRIEF.md`](../.design/brand/BRAND_BRIEF.md) (§16)

> Planned 2026-10-08 (PR #274). Maciej makes every brand call; agents never edit `brand/masters/`. **BRAND-1 supplies TX-1's logo PNGs** (`public/email/`), so TX-1 takes them instead of rasterising its own. BRAND-0 is design work by Maciej; every later block re-exports when it lands.

- [ ] **BRAND-0 — Redraw the masters (mark at 45° from one stroke, wordmark A, lockup spacing, small master)** · deps: — · *Maciej*
- [ ] **BRAND-2 — App touch-points (initials default avatar, Pilat out of the picker, dead fonts, staging favicon)** · deps: BRAND-1
- [ ] **BRAND-3 — The reveal animation (once per launch, reduced-motion fade, video intro)** · deps: BRAND-1
- [ ] **BRAND-4 — Landing alignment (PR into `prod-landing`)** · deps: BRAND-1
- [ ] **BRAND-5 — Press kit page + zip, social avatars and banners** · deps: BRAND-1
- [ ] **BRAND-6 — Rendered brand page** · deps: BRAND-0

## Transactional email — every email Moduo sends · [`specs/transactional-email.md`](./transactional-email.md)

> Planned 2026-10-08. Ratified copy + look: [`.design/transactional-email/email-set.html`](../.design/transactional-email/email-set.html). **TX-1 → TX-4 is the gate for sending the first waitlist invites** (Q57). After TX-3: TX-5 ∥ TX-8 ∥ TX-9a; TX-7 after TX-4; TX-6 after TX-5; TX-9b after TX-4 + TX-9a; TX-10 after TX-8. Every block has prod steps (migration round trip + apply, function deploy with Maciej's OK, and for TX-2/TX-4 a dashboard checklist Maciej runs). Shared files: `supabase/migrations/*` (distinct timestamps), `_shared/email/templates/index.ts`, `docs/email-runbook.md`.

- [ ] **TX-2 — Sign-in codes on Resend (Send Email Hook, `email_outbox` log, 10-min codes, resend countdown)** · deps: TX-1, BRAND-1's email exports deployed to app.moduo.app/email (check all four files, `lockup-{light,dark}@2x.png` at 192 × 44 and `mark-{light,dark}@2x.png` at 26 × 26, each answering `content-type: image/png`; until then the URLs serve the app's HTML and emails show a broken image)
- [ ] **TX-3 — Outbox worker + deliverability (enqueue/cancel, pg_cron + pg_net, retries, suppression webhook, purge, ops alert)** · deps: TX-2
- [ ] **TX-4 — Invite-only gate + waitlist invite from the dashboard (before-user-created hook, B1)** · deps: TX-3
- [ ] **TX-5 — Booking emails (C1–C5, .ics, host bell, booking page copy)** · deps: TX-3 (booking origin fix landed in PR #250)
- [ ] **TX-6 — Booking reminders + host-side cancel (C6, C7, per-link "Remind guests")** · deps: TX-5
- [ ] **TX-7 — Workspace emails (B3–B5, invite only for its address, 20/day cap, pending-join fix; retire `send-workspace-invite`)** · deps: TX-4
- [ ] **TX-8 — Account deleted email + Settings → Email preferences** · deps: TX-3
- [ ] **TX-9a — Welcome + trial emails (D1–D3, onboarding 14-day copy)** · deps: TX-3
- [ ] **TX-9b — Founder access grants (D4, D5; retire the coupon tool)** · deps: TX-4, TX-9a
- [ ] **TX-10 — Build updates + announcements (B2, E1, E2, `news.moduo.app`, the `moduo.app/email` page)** · deps: TX-8

_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._

## Running sessions & parallelism

**Each session = its own git worktree + a `t/<owner>/<kebab>` branch cut off the *latest* `maciej`** (never `main`/`develop`; `maciej` is hot → integrate with a merge commit, not a fast-forward — see [CONTRIBUTING.md](../CONTRIBUTING.md) + [docs/gotchas.md](../docs/gotchas.md)). In the session, run `/s2 next` (auto-picks the first ready block above) or name one (`/s2 CT-3`).

**A block is "ready" only when all its deps are *merged into the base the session branches from*.** So parallelism is **fan-out after each merge barrier**, not "start all 12 at once": land a block → merge it into `maciej` → start the next round's sessions off the updated `maciej`. A session whose base is missing its deps is building on sand (the stale-base trap — gotchas.md).

### Parallel lanes (derived from the deps above)

| Once merged into `maciej` | Become ready to run in parallel | Max width |
| --- | --- | --- |
| *(start)* | **CT-1** — the gate; everything waits on it | 1 |
| CT-1 | **CT-2** · **CT-5** · **CO-1** | 3 |
| CT-1, CT-2, CO-1 | **CT-3** · **CT-4** · **CT-6** · **CO-2** · **CO-3** | ~5 |
| CT-1–3, CT-5, CO-1–2 | **CT-7** · **CO-4** (needs CT-3/4/6 too) | 2 |
| CT-7, CO-1–2 | **CO-5** | 1 |
| *(Wave 2 start)* | **CAL-1** — the gate for the wave | 1 |
| CAL-1 | **CAL-2** ∥ **CAL-3** (both add `runtime.web.ts` methods — the known contention file; sequence those edits or expect a small merge) | 2 |
| CAL-2, CAL-3 | **CAL-4** · **CAL-5** · **CAL-6** | 3 |
| CAL-2–4 | **CAL-7** | 1 |
| CAL-6 (shipped) | **CAL-8a** → **CAL-8b** (strictly sequential — 8b consumes 8a's commands + descriptor) | 1 |

### Serialization points — dep-independent ≠ conflict-free

Two blocks with no dependency between them still **merge-conflict if they edit the same file.** These are shared and *will* collide if worked in parallel — sequence them, or expect a quick manual merge:

- **`supabase/migrations/*.sql`** — each block adds its own timestamped file (additive), but coordinate timestamps so the apply order stays sane; never let two sessions alter the *same* table at once. (CT-1, CT-5, CO-1, CO-3 all add migrations.)
- **`src/lib/module-registry.ts`** — every module's DoD registers a manifest here (CT-7, CO-5). A one-line array push — trivial to resolve, but expect it.
- **`src/lib/runtime.web.ts` / `runtime.tauri.ts`** — each block adds runtime methods → the **highest-contention** shared files; the most likely real conflict.
- **Shared chrome** — `SlashCommandPlugin` (CT-4), `NotificationCenter` (CT-5), `GlobalCommandPalette` — mostly disjoint across blocks, but check before parallelizing two that touch the same one.

**Rule of thumb:** parallelize blocks **in the same lane whose file footprints are disjoint** (e.g. CT-2 UI components ∥ CT-5 comments/notifications ∥ CO-1 schema+route — clean). Blocks that pile into the same migration / registry / runtime file should be sequenced or merged carefully. When in doubt, the lane table gives the *dependency*-safe set; this list gives the *file*-safe overlay.

## Wave D — Dogfood & alpha readiness · _added 2026-07-29 from the whole-project state audit_

> **Why this wave exists.** After DF-17 the DF series is effectively done, but the remaining ledger blocks (DF-15, ~~DF-18~~ *(done 2026-08-14)*, MCP-1, DESKTOP-1) do **not** move either of the designer's two stated goals: **(1) move my data in and use Moduo daily**, and **(2) send it to friends for a real alpha**. This wave is those two goals decomposed. Sourced from a three-agent audit (data-migration readiness · alpha readiness · roadmap/risk synthesis) on 2026-07-27/29.
>
> **🔴 = NOT DoR-ready — run the named `/s1` first.** `/s2` needs a spec with acceptance criteria + tests; a bare line here is not enough. Everything else is DoR-ready and can be built directly with `/s2 <ID>`.
>
> **Suggested order:** OPS-1 → OPS-2 → (dogfood lane ∥ `/s1 ALPHA`) → alpha lane. OPS-1 first because it unblocks already-built code that is currently inert.

### Lane: unblock — mechanical, do first

### Lane: dogfood — get the designer's real data in (goal 1)

- [ ] **IM-2c-b — Backfill progress + cancel (AC9)** · deps: IM-2c-a · **DoR-ready.** What IM-2c-a deliberately left: determinate progress and a cancel affordance. 🔴 **Read [`specs/import.md`](import.md) §Assumptions 12 first — the transport is amended.** The spec assumed "Tauri progress events"; the app has **zero** event emission in `src-tauri` and **zero** `listen()` on the frontend, and events are the wrong shape anyway for a walk that survives quit/restart (a stream tells a relaunched app nothing). Use a **narrow cursor-backed status command** — IM-2b already persists `oldest_synced_uid` / `history_floor_ms` / `backfill_complete` / `backfill_last_error`. ⚠️ **Do not reuse `email_get_mailbox_status`**: it full-table scans and deserializes every envelope, the exact AC11 pattern IM-2a removed, so polling it at a 12-month depth is a live regression. Two things are cheaper than they look: **`Progress` already exists** (IM-1 shipped it — the block table's "introduces the app's first Progress primitive" is stale), and **cancel is ~90% delivered by AC8** (lowering the depth stops the walk and deletes nothing), so it shrinks to a labelled affordance. Also surface **`backfill_last_error`** — a poison chunk currently retries every round completely invisibly — and give the backfill a real driver (it advances only inside a sync round; an IDLE account can park ~29 min). → AC9.

### Lane: alpha — make it sendable (goal 2)

- [ ] 🔴 **`/s1 ALPHA` — Alpha launch plan** · deps: — · **NOT DoR-ready — needs `/s1`, and several answers only the designer has.** A friend currently **cannot obtain the app at all**: there is **no web deploy** (no Vercel/Netlify/Docker config anywhere; `PUBLIC_WEB_ORIGIN` is empty, so invite links and `/p/<token>` share links point at `localhost`), and the macOS build is signed with an **Apple *Development*** certificate with no notarization and no updater, so Gatekeeper refuses it on anyone else's Mac. Beyond distribution: the trial is 7 days and then the paywall hard-blocks, with Stripe in **test mode**; **invites are gated on the Team tier while trials provision Pro**, so friends can't be invited at all; email OTP runs through custom SMTP on Mike's Hostinger mailbox with a 30-per-hour project cap (corrected 2026-10-08 from a live config read; the cheapest way to make the whole alpha look broken — now planned in [`transactional-email.md`](./transactional-email.md) TX-2); and the invite→join→redeem loop has **never been run by two humans**. Decisions needed: hosting target + domain, trial length / comping for alpha, whether to drop the Team gate for alpha, Resend (or similar) for transactional email, Developer ID cert + notarization (**start early — it has lead time**), and error monitoring (`posthog-js` is a dependency but unwired).
- [ ] **DF-15 — Home first-run composition** *(existing block, see Wave C)* · **needs the designer's look-approval on the draft** — the only remaining block that literally cannot complete without you.
- [~] **PRIV-1 — Account deletion erases Stripe, Storage, booking links, integration tokens, waitlist** · deps: ~~DF-19h ✓~~ · _code + tests 2026-10-07 · `t/maciej/delete-account-erasure`_ (closes the five deletion gaps found 2026-10-07, plus private contact notes and legacy busy windows; Stripe still keeps invoices and our `stripe.*` mirror keeps a copy, see PRIV-2. Live check passed and `delete-account` v15 deployed 2026-10-07. **Open:** the throwaway-account pass in [docs/testing/t-maciej-delete-account-erasure.md](../docs/testing/t-maciej-delete-account-erasure.md) §2. Decision: [docs/decisions.md](../docs/decisions.md) 2026-10-07.)
- [x] **PRIV-2a — Erase what a deleted user leaves in other people's workspaces (SQL)** · deps: PRIV-1 (deployed as `delete-account` v15) · **done 2026-10-08 · `t/maciej/priv-2a-erase-workspace-data` · applied to prod 2026-10-08 (version `20261008013000`, designer's OK)** · spec [`specs/privacy-account-erasure.md`](privacy-account-erasure.md) block 1 · migration `20261008013000_account_erase_workspace_data.sql`: private items deleted with every trace, shared items to the owner or closest teammate, tasks unassigned, names cleared from activity, member-removal fixes (incl. removals that failed on prod, and a one-time unassign of tasks frozen by earlier removals). Catalog, grants and a read-only preview checked on prod ([testing doc](../docs/testing/t-maciej-priv-2a-erase-workspace-data.md) §1). Ultra review: one nit (slow on big private collections), fixed by `20261008040000_account_erasure_private_shortcut.sql`. Claude Security and the rest of the Tier 2 gate waived by Maciej for this run (2026-10-08). Follow-up `20261008040000` applied to prod 2026-10-08 (designer's OK), before `delete-account` v17. Merged into maciej (GrochowskiMichal/Moduo#251). **Open:** the in-app removal check in §2.
- [~] **PRIV-2b — Wire it into delete-account, wipe our Stripe copy, in-app copy** · deps: PRIV-2a · **built + verified 2026-10-08 · `t/maciej/priv-2b-wire-delete-account` · merged into maciej (GrochowskiMichal/Moduo#277) · `20261008050000` applied to prod and `delete-account` v17 deployed 2026-10-08 (designer's OK)** · spec block 2 · migration `20261008050000_account_scrub_stripe_mirror.sql`, steps `stripe_mirror` + `workspace_data` in `delete-account` (with a dry run before anything irreversible), Danger zone sentence, `/auth?deleted=1` notice. Tier 2 review gates waived by Maciej for this run (2026-10-08). **Open:** the AC17 one-off (designer deletes the two leftover Stripe customers first), the throwaway-account pass ([testing doc](../docs/testing/t-maciej-priv-2b-wire-delete-account.md)).
- [ ] **PRIV-2c — Admin command for privacy@ deletion requests** · deps: PRIV-2a, PRIV-2b · **DoR-ready** · spec block 3 · designer creates `ACCOUNT_ADMIN_SECRET`; `admin-delete-account` passes `posthog: postHogEraserFromEnv(…)` to `deleteAccount` and needs the PRIV-3 PostHog secrets. Tier 2 review.
- [ ] **PRIV-2d — Privacy policy wording** · deps: — · **DoR-ready** · spec block 4 + appendix · landing branch flow; Mike redeploys Vercel.
- [~] **PRIV-3 — Erase a person's PostHog analytics on account deletion and when they switch analytics off** · deps: PRIV-1 · _merged into `maciej` and deployed 2026-10-08 (GrochowskiMichal/Moduo#245; `delete-account` v16, `analytics-forget` v1; validator, ultrareview and Claude Security passed)_: a `posthog` step first in `deleteAccount` ([`_shared/posthog-erasure.ts`](../supabase/functions/_shared/posthog-erasure.ts)); a new `analytics-forget` function, called by the app the moment a yes turns into a no (it waits ~10 s, then deletes) and sent again each session until it answers 200; the app stops analytics before signing out of a deleted account. **Open:** (1) Mike creates the PostHog personal API key (`person:write`) and sets `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` as Edge Function secrets; (2) ~~deploy~~ done; (3) the end-to-end check in [docs/testing/priv-3-posthog-erasure.md](../docs/testing/priv-3-posthog-erasure.md); (4) then merge the policy wording, GrochowskiMichal/Moduo#244 (draft, into `prod-landing`).
- [ ] **PRIV-3b — Durable PostHog erasure backlog** · deps: PRIV-3 · **before the app's PostHog key goes on in production** · delete-account records an erasure that was refused, skipped or rate-limited in a service-role-only table before the auth user goes, and a scheduled job retries it; a 429 or timeout then becomes a backlog entry instead of a blocked deletion. Optional: a per-user cooldown on `analytics-forget`. Why: the validator and the security pass both found the logs-only gap (docs/decisions/permissions.md 2026-10-08). Tier 2 (migration + `delete-account`). Decision: [docs/decisions/permissions.md](../docs/decisions/permissions.md) 2026-10-08.

---

**Alpha scope — not yet specced** (await `/s1`; add their blocks here when the spec passes the Definition-of-Ready gate): ~~**the mindmap rethink**~~ — **REMOVED from alpha 2026-07-29** (designer call; post-alpha now, and MCP-1 no longer waits on it). ~~The Dashboard rebuild~~ — **specced 2026-07-08** → Wave 6 above (DB-1…DB-8). Then **MCP-1** (above) as the pre-alpha hardening pass.

**Planned — not yet specced, timing open** (Maciej + Mike call 2026-10-02; await `/s1` — nothing to build now): **Communication module — chat + calls**, Duo (2 seats) and Team (3+ seats) plans only, competing with Slack on features. Reverses the 2026-06-24 "no chat module, keep Slack" line. Whether it lands before or after the alpha is not decided; add its blocks here only once its spec passes the Definition-of-Ready gate. Rationale: [docs/ROADMAP.md](../docs/ROADMAP.md) (*Communication module* + Q14) + [docs/decisions.md](../docs/decisions.md) (2026-10-02).

**Post-alpha / out of v1** (designer calls 2026-07-04 — kept for later, *not* deleted): ~~**Finance**~~ — **not planned at all** (Maciej, 2026-10-07: not soon, possibly never). **Email was pulled BACK IN the same day** (pm designer call — EM-1…EM-11 above, next to build); its post-v1 remainder: Outlook/Workspace-Google providers, send-as aliases, scheduled send, full web client (the relay decision). Rationale in [docs/ROADMAP.md](../docs/ROADMAP.md) + [docs/decisions.md](../docs/decisions.md) (2026-07-04 entries). The Cmd-K Search/Capture modes and the Universal Inbox screen are deferred spine sub-features (see `specs/connective-tissue.md` → Out of scope).
_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._
