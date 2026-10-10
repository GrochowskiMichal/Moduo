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

- [ ] **PERM-10 — Definer ops check the item on every path that doesn't write it, and invites can't impersonate their creator** · deps: PERM-9 (same migration family; land after it) · found by PERM-9's audit 2026-10-08, open on prod: **(1, high)** `workspace_invites.created_by` and `share_payload` are client-writable and `share_apply_invite` grants from `created_by`'s access, so any `ws.invite` holder can file an invite "from" a teammate that grants that teammate's private items, up to Full, to a second account (pin `created_by := auth.uid()` on insert, freeze it and `share_payload` against other writers in `perm_invites_validate`); **(2, high)** `tasks_op_uncommit` / `_skip_today` / `_unschedule` / `_set_status` and `contacts_op_set_status` return the whole row on a no-op early exit with only the module guard (an item check in `tasks_op__guard` / `contacts_op__guard_contact`, or at each early return; Tasks has open PRs, so coordinate); **(3, integrity)** `entities_op_tombstone` hides any item from its owner's search (check `perm_can_see_entity` in the public RPC, keep an unguarded internal path for module deletes); **(4, low)** `tasks_notify_spine` logs a blocked private task's title to whoever closes its blocker, `notes_op_move` can re-parent under a note you can't open, `share_assign_preview` still names any profile id, mentions notify people who can't open the note; **(5, cleanup, from PERM-9's `/code-review high`)** drop or revoke the now-dead `perm_private_entity_visible`, answer `share_assign_preview`'s task-share case from `resource_grants` instead of `can_access` per task, have the connector apply the key's scopes before the RPC's limit (today a scoped key can get an empty list), `notes_op_duplicate` stamps `auth.uid()` (NULL under a key; no tool calls it yet), `task_project` never passes `perm_can_see_entity`. Verify on the PERM-9 replica (recipe in its checklist) before and after; test every op of the touched guards, since a guard change is a write-path change (the 2026-10-06 outage). Tier 2 review.
- [ ] **PERM-8b — Collective links for real: per-host busy calendars in booking-public, a co-host request inbox (link name visible to hosts), owner sees pending/declined; then flip `COLLECTIVE_LINKS_ENABLED`** · deps: PERM-8
- [ ] **PERM-6b — Contact groups list + share screen; merge moves links/activity and is scoped to the workspace; then re-enable the contact share bar** · deps: PERM-6

_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._

## Tasks v3 — the re-planned module · [`specs/tasks-v3.md`](./tasks-v3.md)

> **🟠 LOCAL BUILD MODE — read this before anything else in this section (Maciej, 2026-10-10).** Every Tasks v3 block is built and landed **locally**; nothing is pushed, no PRs are opened, nothing touches the cloud project until Maciej says "release".
> 1. **The local Supabase stack is "prod".** Apply each block's migrations to it (`bun run local:up` once; then `supabase migration up` against the local stack, or `bun run local:reset` when a clean rebuild is needed). `.env.local` points at the local stack (`bun run env:local`). Never use the Supabase MCP or the CLI against the cloud project. Everything is migrated to the real prod at once when the module is done.
> 2. **The integration branch is `t/maciej/tasks-v3-build`** (local only). Start each block from it: `git switch -c t/maciej/<block-kebab> t/maciej/tasks-v3-build`. Land a finished block by fast-forwarding it: `git merge t/maciej/tasks-v3-build` into your block branch (merge commit, never rebase), re-run `bun run verify`, then `git push . HEAD:t/maciej/tasks-v3-build` (a local fast-forward; if it's refused because another lane landed first, merge again and retry). Never check the integration branch out in a worktree.
> 3. **/s2 and /s3 run as usual except:** no `git push` to `origin`, no `gh pr`, no prod migration step, no `develop` sync. `/s3`'s manual-test checklist, decisions, gotchas, BUILD_ORDER tick and BUILD_LOG entry are still written, and committed with the block.
> 4. **The shared local database:** only the **data lane** (TV-D5 → D8 → D9 → D10 → D11a → D11b, and later D12–D16) adds migrations; run one data block at a time. UI, shell and attachments lanes don't change the schema; if one must, it waits for the data lane's current block to land.
> 5. **Product questions** that come up are answered by the agent and recorded as "agent's choice, deferred to by Maciej" (docs/decisions/tasks.md format). Stop only for a hard blocker.
> 6. **When a block lands,** spawn the chip for the next ready block in your lane (`spawn_task`), using this section's lane order and the same instructions, so Maciej only has to click.
>
> **Carry-forward notes from checkpoint 1 (orchestrator, 2026-10-10; read if your block is named):**
> - **TV-U10:** Detailed rows truncate titles while the row is mostly empty: the title column must take the free width; fixed columns stay compact.
> - **TV-U13:** the Time value wraps as "0m of / ~1h" in a 390 px panel (give the value column its own min width, keep the bar on its own line); activity avatars read "ME" for the signed-in user (rule 43: two initials of the person, never "Me"); a gray "?" avatar appears for the signed-in user somewhere in the chrome: trace it.
> - **TV-U6 / TV-F7:** still old shapes by design until then: "Plan · Focus" switch, "Queue", the "Buckets" label.
> - **Menus:** long menus scroll now (DS-6), but the cut-off last item needs a bottom fade so it reads as scrollable.
> - **From TV-U4:** every drop goes through `api.dropTask` (`order.ts`, `dnd/board-drop.ts`). Call 87 (finishing finishes open subtasks, with Undo) is **not built yet** → TV-U13. A drop into Done then Undo loses the queue place (gap) → TV-D11a. The insertion line is clipped above the List's first row → TV-U10. Board ⌥⇧←→ and Group by Assignee/Priority → TV-U11.
> - **From TV-D8:** `tasks__apply_status` is the only status path; new columns go into both ops' key lists; redefine functions from their live bodies; apply its migrations A then B. Deferred: deleteBucket → TV-U6 · handle deep links → RF-1 · MCP handle args → TV-D16 · DST and skip datetimes → TV-D12 · completions in Realtime → TV-D11a · raw fallbacks → TV-D7 · the handle column → TV-U10. D8-14: moving a parent carries only the subtasks you can edit. D8-15: Won't do takes back a completion.
> - **Verify before release (collected):** prod has 0 tasks failing `tasks__recurrence_problem` before D8 applies; the hosted cron runs; a pre-D8 desktop build works against the migrations; handle copy in a real browser; the desktop Finder drop (AT-2); signed-build notifications.

> **Planned 2026-10-10 (`/s1`, the deep re-plan).** Supersedes [`specs/tasks-v2.md`](./tasks-v2.md): v2's blocks 1–10 landed and stay (except TV-D5, v2 block 8, still open, which finishes as block 1 here); v2's blocks 11–21 are re-scoped per the spec's "Carried from v2" paragraph, mapping logged in [BUILD_LOG.md](./BUILD_LOG.md). Companion specs: [`attachments.md`](./attachments.md) (AT-2 = block 2; AT-3 stays there, listed after block 19) and [`design-state-layer.md`](./design-state-layer.md) (DS-5 folded into DS-6 = block 8). Decisions: [docs/decisions/tasks.md](../docs/decisions/tasks.md).
> - **Land on `maciej` only:** no pushes or merges to `develop` until Maciej says so. Mike is rebuilding on `develop`, so this overrides the standing develop authorization for these blocks.
> - **DoR status:** ✅ means ready now; the rest follow their dependencies. Ids = `tasks-v3 block N` (the spec table's row numbers); PERM-W and SH-0 are external blocks with their own sessions.
> - **Order:** top to bottom, every dep listed above its dependants. The lane table below shows what can run at once. Migrations (spec §Assumptions #24): local stack first (`bun run local:reset`), prod only on a release train with Maciej's OK, function bodies probed before `CREATE OR REPLACE`; nothing is dropped before TV-D7.

- [x] **PERM-W — The private write-checks branch** · external, own session · done 2026-10-10 (#346, on prod) · deps: — · lands (prod first, then PR) before TV-D10 touches `buckets`; its migration timestamp precedes TV-D9's (spec §Assumptions #25)
- [x] **SH-0 — Help menu + Focus timer in the top bar** · external, own session · done 2026-10-10 (#347) · deps: — · lands before TV-F7
- [x] **TV-D5 — Live updates (Realtime)** ✅ · tasks-v3 block 1 · deps: — · lane data · finish #315: merge as is + the window-focus guard that stops the client repeat catch-up (P0 #2 path), docs conflicts resolved; its two migrations are already on prod · done 2026-10-10 · `t/maciej/tv-d5-live-updates` (local; landed on `t/maciej/tasks-v3-build`, #315 still open on GitHub until the release) · a quiet refetch no longer re-runs the catch-up (the first read that works still does); the local stack needed the publication re-applied (see gotchas §Supabase/migrations)
- [ ] **AT-2 — Attachments: upload pipeline + panel + viewer** ✅ · tasks-v3 block 2 (attachments block 2) · deps: — · lane attachments · finish #327: shared drop-highlight fix, validator + review + Tier 2 (contracts file), Finder-drop check, merge
- [x] **TV-P0 — Trust pass, client side** ✅ · tasks-v3 block 3 · done 2026-10-10 (local, `t/maciej/tv-p0-trust-pass`, landed on `t/maciej/tasks-v3-build`; no migrations; `tests/trust-pass.spec.ts` 11/11 on the local stack; #323 stays open until release, its salvage list is REPLAN §L) · deps: — · lane ui · parser words/5 PM/date+repeat/⌘A; the "Won't do" label and Reopen in the panel (value at D7; the list is Filter → Status in TV-U2); skeletons + "No tasks match"; notifications name the task; parent moves subtasks; New from Focus queues; unseen project never "Inbox" + "Private item" deep link; no "Rescheduled N×"; date popovers save once + trail; avatar initials + one date grammar; no truncation (P0 #3–5, 7–12, 15–16)
- [x] **SH-1 — Shell: panel dropdown, capture shell, motion** ✅ · tasks-v3 block 4 · deps: — · lane shell/kit · right-panel view registry + "Details ▾" title dropdown + "← item" stack replacing `RightPanelSwitcher`, panel min 280 px; the app capture shell with a type registry (Task registered, ⌘1–7 switching); motion tokens + four patterns + reduced motion; Calendar/Email/Notes/Contacts keep working through the registry · done 2026-10-10 · `t/maciej/sh-1-shell` (local; landed on `t/maciej/tasks-v3-build`) · registries in `src/lib/panel-registry.ts` + `src/lib/capture-registry.ts`; Notes/Calendar/Contacts keep their one-line captures as provisional types until rebuilt; log in [BUILD_LOG.md](./BUILD_LOG.md)
- [x] **TV-D8 — Server ops, registry, handles, recurrence, tolerance** · tasks-v3 block 5 · deps: TV-D5 · lane data · `tasks_op_create` / `tasks_op_update` for every field edit, registration + rename in the entities registry, `workspaces.task_key` + `tasks.number` (handles), server-side status/recurrence/next-occurrence + pg_cron roll-over, one dependency store ("blocks" always blocks), MCP list paging, client status tolerance + one "is open" rule, minimum client build check · migrations `tasks_ops_registry_handles`, `tasks_recurrence_server` · done 2026-10-10 · `t/maciej/tv-d8-server-ops` (local; landed on `t/maciej/tasks-v3-build`; migrations `20261010160000_tasks_ops_registry_handles` + `20261010161000_tasks_recurrence_server` applied to the local stack only; `bun run db:test` 189 checks) · log in [BUILD_LOG.md](./BUILD_LOG.md)
- [x] **TV-U2 — Toolbar, Filter, Display, search** · tasks-v3 block 6 · done 2026-10-10 (local, `t/maciej/tv-u2-toolbar`, landed on `t/maciej/tasks-v3-build`; no migrations; #330 stays open on GitHub until the release) · deps: TV-P0 · lane ui · re-scope #330: keep toolbar/Filter/search/Display; Group by set + one Date grouping; My tasks by status; "To do"/"Won't do" labels; "Group by" never "Columns"; Rows Standard · Detailed; the red test · log in [BUILD_LOG.md](./BUILD_LOG.md); for TV-U4: #330's sort type and drag-while-sorted toast are still as #330 left them (default m is yours), the Board's Group by offers Status · Project only (assignee/priority land with your drop rewrite), and a Status filter decides the Board's status groups (`statusesLetThrough`)
- [x] **TV-U4 — Drag and drop** · tasks-v3 block 7 · done 2026-10-10 (local, `t/maciej/tv-u4-dnd`, landed on `t/maciej/tasks-v3-build`; no migrations; #329 stays open on GitHub until the release) · deps: TV-U2 · lane ui · re-scope #329: the two drop planners + shared drag visuals; validator MAJOR/MINORs; manual order inside one project only + sorted-note action; Undo on every drop; #330's sort type; Inbox row drop does nothing · log in [BUILD_LOG.md](./BUILD_LOG.md); for TV-U10/TV-U11: every drop goes through `api.dropTask` (`dnd/drop-write.ts`), the order rule is `order.ts`, the Board's decisions `dnd/board-drop.ts`; the Board's ⌥⇧←/→ and its Group by Assignee/Priority are TV-U11's
- [x] **DS-6 — North-star kit, fix list, guards** · tasks-v3 block 8 (design-state-layer; DS-5 folded in, guards only) · deps: SH-1 · lane shell/kit · Row · Card · GroupHeader · MetaCount · PropertyRow/Value · CollectionHeader · NavRow · Toolbar · FilterBar/DisplayMenu · Chip · Picker pill · EmptyState · Feed · DateField · Progress · Avatar standardised with stories at three densities; the §5.1 fix list; lint guards for rotated text and small-caps user words; DS-5's other-module sweep retired · done 2026-10-10 · `t/maciej/ds-6-kit` (local; landed on `t/maciej/tasks-v3-build`; backup on origin) · the kit is listed in `src/components/ui/kit.ts`; Tasks views still render their own rows and cards (TV-U10/U11/U13 adopt `Row` / `ItemCard` / `PropertyRow`); the guards run in `lint:tw` + `lint:css` (no `lint:controls` exists on this line); log in [BUILD_LOG.md](./BUILD_LOG.md)
- [ ] **TV-D9 — Expand I: statuses, completion, dates** · tasks-v3 block 9 · deps: TV-D8 · lane data · `project_statuses` + `tasks.status_id` (legacy `status` mirrored to the category), workspace default statuses in settings, `tasks.completed_at/completed_by` + per-cycle history, `due_date` → date + `due_time`, late state server flag, backfill, old-build mapping · migrations `project_statuses`, `tasks_completion_due_date` · notes from TV-D8: `tasks__apply_status` is the one status path (`tasks_op_set_status` and `tasks_op_update` both call it): write `status_id` / `completed_at` / `completed_by` there and keep its server pointer and `task_completions` rows; the client already reads `backlog` as To do and `wont_do` as Won't do (`normalizeTaskStatus`); `tasks_op_create` / `_update` refuse unknown fields, so add the new columns to their key lists; redefine both TV-D8 functions from their live bodies
- [ ] **TV-D10 — Expand II: areas, projects, sections, sessions, reminders, waiting, teams** · tasks-v3 block 10 · deps: TV-D9, PERM-W · lane data · `areas` (from `group_label`), project fields, `sections` + `tasks.section_id`, `task_sessions`, `reminders`, `waiting_on`, `teams` + `team_members` + `tasks.team_id` + team default project, `tasks.imported_from`; ops for each; "bucket" aliases kept · migrations `areas_projects_sections`, `task_sessions_reminders_waiting`, `teams`
- [ ] **TV-D11a — The shared store** *(large)* · tasks-v3 block 11 · deps: TV-D5, TV-D8, TV-D9 · lane data · one store per workspace: IndexedDB cache, open-tasks-first load, delta sync by `updated_at`, Realtime merge (from TV-D5), echo skip, one-field rollback, offline read-only + queued captures/check-offs; every Tasks surface and the Calendar/Home widgets read from it; the ~10 per-screen fetches deleted · notes from TV-D5: add `attachments` to `supabase_realtime` (AT-2 changes no schema here) and listen to `comments` live (published since TV-D5, no listener yet: the comment counts D5-1 promised); the store must also drop a read whose workspace changed while it was out (today a late failure path after a switch calls the old workspace's `loadImpl` and shows its tasks until the next refetch; TV-D5's validator, pre-existing) · notes from TV-D8: `task_completions` (workspace_id, updated_at, deleted_at) joins the delta sync and the `supabase_realtime` publication; `opUpdateTask` answers with several rows (task + carried subtasks), merge them all; the client asks the server to roll repeats over after a full load (`opCatchUp` with `[]`, only when the workspace has repeats)
- [ ] **TV-D11b — Virtualization + the 10k fixture** · tasks-v3 block 12 · deps: TV-D11a · lane data · virtualized List/Board columns/Timeline rows (TanStack Virtual), memoised rows, server search; the 10,000-task fixture + `tests/perf` in CI with the 200 ms budget
- [ ] **TV-U6 — Sidebar v3** · tasks-v3 block 13 · deps: TV-U2, TV-D10 · lane ui · re-scope #328: projects/areas/Pinned/Views groups, hairline, collapsible, no glyphs, Customize sidebar, Pin, colours, reorder, archive, delete per 78 (open tasks → assignees with one notice; batch to Recently deleted; Restore), Archived + Recently deleted in ⋯, "Open at" removed, the word "project" everywhere · note: TV-Q1 hides a deleted bucket for the whole session (`src/features/tasks/hidden-buckets.ts`), so a Restore must call `unhideBucket` or rework that store · note from TV-D8: `runtime.tasks.deleteBucket` still moves the project's tasks to the Inbox with a raw update (the only task write left outside the ops); the project-delete rewrite moves it onto `tasks_op_update` or a project op
- [ ] **TV-U10 — List v3** · tasks-v3 block 14 · deps: DS-6, TV-D11a, TV-D11b, TV-U4 · lane ui · Standard/Detailed anatomy on the kit Row, sortable headers, sticky GroupHeaders with "+" at the top, section grouping default inside a project, folded Backlog/completed lines, hover rule, status-icon completes + ⇧S + `>`/`<`, states (skeleton, empty filter, read-only, offline) · notes from TV-U2: Display → Rows exists (stored per scope; Detailed today adds the status name, time, assignee first name and the project on every row through `rowColumns` in `row-layout.ts`): move those cells onto the kit Row and add handle, Project › Section, Due + Next session, waiting, updated and the sortable headers; add `section` (the project default once it has sections) and `team` to `GROUP_BYS` in `helpers.ts` when TV-D10's data exists; group headers are still the small-caps eyebrow
- [ ] **TV-U11 — Board v3** · tasks-v3 block 15 · deps: TV-U10 · lane ui · status default + "+ Add status"/"+ Add section", per-project status columns, folded button, fixed-width Card, hidden empty columns, lanes, cross-project category columns, per-column virtualization, one context menu
- [ ] **TV-U12 — Multi-select and the bottom-bar mode pattern** · tasks-v3 block 16 · deps: TV-U10, SH-1 · lane ui · selection model (⇧/⌘ click, ⇧↑↓), the bar's mode row Complete · Focus · Assign · Tag · Date · Delete · More ▾ + "n selected · Esc" (replacing the bar's centre while selecting), the panel's "n tasks · Mixed" editor, one Undo, bulk Date/Status/Section/Waiting/Team
- [ ] **TV-U13 — Detail panel v3 + full page** · tasks-v3 block 17 · deps: DS-6, TV-D9, TV-D10, SH-1 · lane ui · anatomy §9 on the kit, always/+ properties, folded description with counts, subtasks inline + open-with-back-arrow, Linked cards, agent session line slot, one feed with All · Comments, edit/delete, six reactions, Project view when nothing selected, full-page mode, tombstone/Private item/read-only states; pickers incl. repeat picker + summary line
- [x] **RF-1 — References** *(large)* · tasks-v3 block 18 (GR-0 folded in and retired) · done 2026-10-10 · `t/maciej/rf-1-references` (local; landed on `t/maciej/tasks-v3-build`; no migrations) · log in [BUILD_LOG.md](./BUILD_LOG.md); for TV-U14: capture reads the date commands through `spine/grammar.ts` (`takeSlashDates`), the `@`/`#`/`/` menus and the tokenizer are there to reuse; for TV-U13: the Linked cards and the description fold can render `Reference` (`spine/references/ui/reference.tsx`) and the panel stack is wired in `tasks-plan-view.tsx`; for TV-D12: a description `@person` notice needs a server op · deps: TV-D8, SH-1 · lane references/capture · the primitive: link/chip/card/hover for task · email · contact · note · event · project, "Show as", live updates, "Deleted …", "Private item" with no leakage, lazy cached previews, open-in-panel + ⌘-click; the prose grammar `@` `#` `/` incl. `/today` date chips (`#tag` in text = Link, decided 2026-10-08); registration-on-create + tombstone fixes · notes from TV-D8: every task is registered from creation (a trigger, every write path), re-labelled on rename, tombstoned while deleted and revived on restore; `entities.handle` holds `KEY-number` and `searchEntities` matches handles (and old keys, via `workspaces.task_key_aliases`); still to do here: `?id=MOD-142` deep links and a typed handle auto-linking in text
- [ ] **TV-U14 — Capture v3** · tasks-v3 block 19 (TV-U7 superseded) · deps: RF-1, TV-D10, SH-1 · lane references/capture · ⌘⇧K → Task · Inbox, ⌘N/`c` → here, destination row, four pills + More, token highlighting + the leave-the-title rule, `@team` routing with default project, "From:" chip, subtasks inline, paste-a-list (≤500, one Undo), offline queue, `/template` hook · notes from SH-1: replace the provisional Task line body (`features/tasks/capture-type.tsx`) with the full one; Esc should keep one draft that the next ⌘⇧K restores (keymap "Capture modal"; today `show()` starts fresh and `capture-shell.test.tsx` "always reopens as Task with an empty line" pins it — flip that test)
- [ ] **AT-3 — Attachments everywhere + Settings → Storage** · attachments block 3 (stays as specced there) · deps: AT-2, TV-U14 · lane attachments · row/card drop targets, capture paste chip, 📎 mark on every surface, Settings → Storage
- [ ] **TV-U15 — Upcoming, Inbox, My tasks, All** · tasks-v3 block 20 · deps: TV-U10, TV-D10 · lane ui · Upcoming rows + day headers + drag-reschedule + coverage rule; Inbox newest-first + source chips + triage keys 1·2·3·H + zero state; My tasks team block + status groups; All by area/project; Won't do list
- [ ] **TV-U8 — Saved views** · tasks-v3 block 21 · deps: TV-U2, TV-U6 · lane ui · migration `task_views` · re-scope: `task_views` personal + synced, Views group in the sidebar only, save/rename/delete, `?view=` (no project tabs)
- [ ] **TV-F6 — Focus salvage + one time engine** · tasks-v3 block 22 · deps: TV-D9, TV-D11a · lane focus · from #323: the run record re-cut to Timer: Per task · Pomodoro · Off, claims "is on this", cross-device takeover, run rules, capture default (P0 #9); one time engine app-wide so saves work from any page (P0 #6); the Calendar's block focus and Home pomodoro on it (TV-F5 folded in) · migration `focus_runs` (re-cut; replaces #323's unapplied file)
- [ ] **TV-F7 — Focus screen v3** *(large)* · tasks-v3 block 23 · deps: TV-F6, TV-U13, SH-1, SH-0 · lane focus · the sidebar rename, "Focus ⋯" header, Now card with one timer pill / header Pomodoro pill / none, Pause in the pill, Stop in ⋯ with Undo, ⋯ menu, subtasks open in the panel + ⇧F + ⏎, Up next with dividers, the done line, the empty state with today's rows, ⇧F from any task, Timer settings
- [ ] **TV-F8 — Along the way, meeting divider, pace, In flight view** · tasks-v3 block 24 · deps: TV-F7, RF-1 · lane focus · the between-tasks offer + three-Not-nows rule + the switch, "Arrange by project", the meeting divider, usual pace, In flight as the panel's second view with check-backs (TV-F4 reshaped), agent session line rendering
- [ ] **TV-TL1 — Timeline rebuild I** *(large)* · tasks-v3 block 25 · deps: TV-D11b, TV-D10, TV-U10 · lane timeline · rows by scope (projects → expand → tasks; sections + tasks inside a project), points/hollow/late/done, bars solid/outlined with segments, bands and diamonds on section rows, sticky resizable name column, two-tier header + Today pill, grid + weekend tint, Week · Month · Quarter · Year + ⌘-scroll, endless virtualized scroll, Display menu, Due per week, empty state
- [ ] **TV-TL2 — Timeline interactions** · tasks-v3 block 26 · deps: TV-TL1 · lane timeline · drag point/diamond/bar, click-to-create, multi-move, edge scroll, Undo, keyboard (↑↓ ⌥←→ ⇧ D T Space ⏎), dependency lines for selected + Show all + "Also move the 3", 68b contradictions, "No date · n" panel view, old tray removed
- [ ] **TV-D12 — Recurrence a–i, reminders, notifications** · tasks-v3 block 27 · deps: TV-D9, TV-D10 · lane server features · RRULE parity + after-completion + due/scheduled together + history + subtask reset + ghosts + move-one/change-pattern; reminder scheduling (pg_cron) + channels: desktop keeps running in the menu bar (tray / close-to-tray) + web push (VAPID keys, an Edge Function sender, service worker) + the bell; the §13 notification table as one generator with mute switches; backlog cancels reminders · migrations `notifications_v3`, `reminders_push` · notes from TV-D8: the server engine (`tasks__rrule_next/prev`, `20261010161000`) reads rules in UTC from DTSTART like rrule.js (DST drift as before: move both engines together); "after completion" is `recurrence.mode = 'after_completion'` (no picker yet); `tasks_op_skip_occurrence` still takes the client's datetimes; rules are bounded (INTERVAL/COUNT ≤ 1000, UNTIL/DTSTART 1900–2200, CHECK `tasks_recurrence_bounded`)
- [ ] **TV-D13 — Teams: routing, marks, settings** · tasks-v3 block 28 · deps: TV-D10, TV-D12 · lane server features · Settings → Members → Teams (create/membership/delete rule), team marks, routing ops (TV-U15 wires the My tasks claim block against them), filters/grouping by team, `@Team` digest, unclaimed check-backs, member-leaves rules · migration `teams_routing`
- [ ] **TV-D14 — Time entries, report, Time & region** · tasks-v3 block 29 · deps: TV-D9 · lane server features · "Add time…" + own entries list; the share switch; the report sheet (project overview + client hub) with PDF (print layout + Tauri/browser print-to-PDF) and CSV; Settings → General → Time & region used by every module + travel prompt; Copy as text / Export view as CSV / print layout / full export (default f) · migrations `time_entries_add`, `profiles_time_region`
- [ ] **TV-D15 — Templates and Duplicate project** · tasks-v3 block 30 · deps: TV-D10, TV-U13, TV-U14 · lane references/capture · task templates (keep/drop rule, template-as-editor, `/template`), project templates, "Duplicate project…" with date shift, sharing rule · migration `templates`
- [ ] **TV-D16 — Agents and MCP v3** · tasks-v3 block 31 · deps: TV-D8, TV-D10, TV-D13 · lane server features · the tool surface in spec §Assumptions #14 (create/update/file/status by category or name/assign/team/sessions/session status/import keys/re-run update/undo import/paging), scopes, "via <key>", private sessions + the share setting, the AI-import end-to-end test with Todoist, connector docs refreshed · migrations `imports`, `agent_sessions` · notes from TV-D8: `tasks_create` / `tasks_update` exist (fields, project, parent; assignee on create); results lead with `handle`; tools don't accept a handle as `task_id` yet
- [ ] **TV-H1 — Home widgets for Tasks** · tasks-v3 block 32 · deps: TV-D11a, TV-D13, TV-D14 · lane server features · Tasks widget = Focus/Open; time widget on task entries; team load; Upcoming widget — all on the shared store
- [ ] **TV-U16 — Project overview, archive/done prompts, departures** · tasks-v3 block 33 · deps: TV-U6, TV-U13, TV-D14 · lane ui · the Project panel view (progress, time, files, waiting, activity, "Done this month"), Done/archive-with-open-tasks prompt, archived stays searchable, member-removal hand-offs
- [ ] **TV-U17 — Onboarding and welcome** · tasks-v3 block 34 · deps: TV-U15, TV-F7 · lane ui · the role question + defaults/seeds, Tasks' welcome (three steps, clips recorded by script), reopen from ⋯
- [ ] **TV-U18 — Native importers** · tasks-v3 block 35 · deps: TV-D16 · lane server features · Todoist CSV → Trello JSON → Linear/Jira/Asana CSV, mapping rules, old ids, "imported from", undo
- [ ] 🔴 **TV-D7 — Contract cleanup** · tasks-v3 block 36 · deps: all of the above + ≥2 desktop releases and 14 days after TV-D9 ships · lane data (last) · drop the legacy `status` mirror and values, the old `due_date`, `scheduled_at`, `duration_minutes`, `time_spent_seconds`, `committed_for`, `commit_order`, `reschedule_count`, `task_time_blocks`, `group_label`, the owner shim, duplicate dependency rows, MCP aliases (`tasks_today`, `tasks_commit`, `tasks_list_buckets`…), raw write grants; the minimum build raised (§6.9) · migration `tasks_v3_contract` · notes from TV-D8: remove the client's raw-write fallbacks (`isMissingFunctionError` branches in `runtime.web.ts` task writes); keep the numbering and registry triggers (they serve the ops too); `tasks_op_catch_up`'s `p_items` can go; the minimum build in `app_settings.min_build` is the switch this step raises

_Finished blocks of this section (and the v2 blocks that landed): [BUILD_LOG.md](./BUILD_LOG.md)._

### Tasks v3 lanes (parallel once merged into `maciej`)

**By id** (the spec's suggestion): *data* D5 → D8 → D9 → D10 → D11a → D11b · *shell/kit* SH-1 → DS-6 · *ui* P0 → U2 → U4 → U6 → U10 → U11 → U12 → U13 → U15 → U8 → U16 → U17 · *references/capture* RF-1 → U14 → D15 · *focus* F6 → F7 → F8 · *timeline* TL1 → TL2 · *server features* D12 → D13 → D14 → D16 → H1 → U18 · **D7 last**. PERM-W and SH-0 run in their own sessions. The ui lane waits at U6 for the data lane (D10, which needs PERM-W) and at U10 for DS-6 + D11b.

| Once merged into `maciej` | Ready to run in parallel | Width |
| --- | --- | --- |
| *(start)* | **TV-D5** · **AT-2** · **TV-P0** · **SH-1** (+ **PERM-W**, **SH-0** in their own sessions) | 4 (recommend 3 live at once) |
| TV-D5 | **TV-D8** | 1 |
| SH-1 | **DS-6** | 1 |
| TV-P0 | **TV-U2** → **TV-U4** | 1 |
| TV-D8 (+ SH-1) | **TV-D9** · **RF-1** | 2 |
| TV-D9 (+ PERM-W) | **TV-D10** · **TV-D14** | 2 |
| TV-D5, D8, D9 | **TV-D11a** → **TV-D11b** | 1 |
| TV-D10 + U2 | **TV-U6** → **TV-U8** | 1 |
| TV-D9, D10 | **TV-D12** | 1 |
| DS-6, D11b, U4 | **TV-U10** → **TV-U11** · **TV-U12** | 1–2 |
| DS-6, D9, D10, SH-1 | **TV-U13** | 1 |
| RF-1, D10, SH-1 | **TV-U14** → **AT-3** · **TV-D15** (needs U13 too) | 1–2 |
| U10, D10 | **TV-U15** → **TV-D13** (needs D12 too) → **TV-D16** → **TV-U18** | 1 |
| D9, D11a | **TV-F6** → **TV-F7** (needs U13 + SH-0) → **TV-F8** (needs RF-1) | 1 |
| D11b, D10, U10 | **TV-TL1** → **TV-TL2** | 1 |
| D11a, D13, D14 | **TV-H1** | 1 |
| U6, U13, D14 · U15, F7 | **TV-U16** · **TV-U17** | 2 |
| everything + ≥2 desktop releases + 14 days after D9 | 🔴 **TV-D7** | 1 |

**Tasks v3 serialization points** (they share files, so expect small merges if run together):
- **Migrations** — D8, D9, D10, D12, D13, D14, D15, D16, F6, D7 (file names in spec §Assumptions #24), distinct timestamps, all after PERM-W's. Never two sessions altering `tasks` or `buckets` at once: D8 → D9 → D10 → D12 are sequential for that reason.
- **`src/lib/runtime.web.ts` + `runtime.types.ts`** — D5, D8, D9, D10, D11a, D12, D13, D14, D15, D16, F6, AT-2.
- **`src/features/tasks/ui/tasks-plan-view.tsx`** — P0, U2, U4, U6, U10, U11, U12, U15, TL1.
- **`src/features/focus/`** — SH-0, F6, F7, F8.
- **Shell registries** (`src/lib/panel-registry.ts`, `src/lib/capture-registry.ts`) — SH-1 creates them; U13, U14, F8 and AT-3 register into them.
- **`tokens.css` / `global.css`** — SH-1 (motion tokens), DS-6.

## Brand system · [`.design/brand/BRAND_BRIEF.md`](../.design/brand/BRAND_BRIEF.md) (§16)

> Planned 2026-10-08 (PR #274). Maciej makes every brand call; agents never edit `brand/masters/`. **BRAND-1 supplies TX-1's logo PNGs** (`public/email/`), so TX-1 takes them instead of rasterising its own. BRAND-0 is design work by Maciej; every later block re-exports when it lands.

- [ ] **BRAND-0 — Redraw the masters (mark at 45° from one stroke, wordmark A, lockup spacing, small master)** · deps: — · *Maciej*
- [ ] **BRAND-2 — App touch-points (initials default avatar, Pilat out of the picker, dead fonts, staging favicon)** · deps: BRAND-1
- [ ] **BRAND-3 — The reveal animation (once per launch, reduced-motion fade, video intro)** · deps: BRAND-1
- [ ] **BRAND-5 — Press kit page + zip, social avatars and banners** · deps: BRAND-1
- [ ] **BRAND-6 — Rendered brand page** · deps: BRAND-0

## Transactional email — every email Moduo sends · [`specs/transactional-email.md`](./transactional-email.md)

> Planned 2026-10-08. Ratified copy + look: [`.design/transactional-email/email-set.html`](../.design/transactional-email/email-set.html). **TX-1 → TX-4 is the gate for sending the first waitlist invites** (Q57). After TX-3: TX-5 ∥ TX-8 ∥ TX-9a; TX-7 after TX-4; TX-6 after TX-5; TX-9b after TX-4 + TX-9a; TX-10 after TX-8. Every block has prod steps (migration round trip + apply, function deploy with Maciej's OK, and for TX-2/TX-4 a dashboard checklist Maciej runs). Shared files: `supabase/migrations/*` (distinct timestamps), `_shared/email/templates/index.ts`, `docs/email-runbook.md`.

- [~] **TX-2 — Sign-in codes on Resend (Send Email Hook, `email_outbox` log, 10-min codes, resend countdown)** · **built 2026-10-08, merged into maciej (PR #310; no develop sync yet, per Maciej); migration applied + `auth-email-hook` v1 deployed 2026-10-08 (prod verified ~20:50 UTC: table empty, RLS on, no client grants, purge job; hook never called by Auth). Not live until: (1) a "Promote to production → app" run puts the email logos on app.moduo.app (they're on `staging-app`, Vercel's build serves them correctly); (2) PR #319 puts the policy lines on moduo.app; (3) Maciej runs the runbook's dashboard steps 4–7; (4) the live checklist in `docs/testing/t-maciej-tx-2-sign-in-codes.md`** · deps: TX-1, BRAND-1's email exports deployed to app.moduo.app/email (check all four files, `lockup-{light,dark}@2x.png` at 192 × 44 and `mark-{light,dark}@2x.png` at 26 × 26, each answering `content-type: image/png`; until then the URLs serve the app's HTML and emails show a broken image)
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
- [~] **PRIV-2b — Wire it into delete-account, wipe our Stripe copy, in-app copy** · deps: PRIV-2a · **built + verified 2026-10-08 · `t/maciej/priv-2b-wire-delete-account` · merged into maciej (GrochowskiMichal/Moduo#277) · `20261008050000` applied to prod and `delete-account` v17 deployed 2026-10-08 (designer's OK)** · spec block 2 · migration `20261008050000_account_scrub_stripe_mirror.sql`, steps `stripe_mirror` + `workspace_data` in `delete-account` (with a dry run before anything irreversible), Danger zone sentence, `/auth?deleted=1` notice. Tier 2 review gates waived by Maciej for this run (2026-10-08). AC17 done 2026-10-08 (Maciej deleted the two leftover customers at Stripe, then our copy was wiped). **Open:** the throwaway-account pass ([testing doc](../docs/testing/t-maciej-priv-2b-wire-delete-account.md)).
- [ ] **PRIV-2c — Admin command for privacy@ deletion requests** · deps: PRIV-2a, PRIV-2b · **DoR-ready** · spec block 3 · designer creates `ACCOUNT_ADMIN_SECRET`; `admin-delete-account` passes `posthog: postHogEraserFromEnv(…)` to `deleteAccount` and needs the PRIV-3 PostHog secrets. Tier 2 review.
- [ ] **PRIV-2d — Privacy policy wording** · deps: — · **DoR-ready** · spec block 4 + appendix · landing branch flow; Mike redeploys Vercel.
- [~] **PRIV-3 — Erase a person's PostHog analytics on account deletion and when they switch analytics off** · deps: PRIV-1 · _merged into `maciej` and deployed 2026-10-08 (GrochowskiMichal/Moduo#245; `delete-account` v16, `analytics-forget` v1; validator, ultrareview and Claude Security passed)_: a `posthog` step first in `deleteAccount` ([`_shared/posthog-erasure.ts`](../supabase/functions/_shared/posthog-erasure.ts)); a new `analytics-forget` function, called by the app the moment a yes turns into a no (it waits ~10 s, then deletes) and sent again each session until it answers 200; the app stops analytics before signing out of a deleted account. **Open:** (1) Mike creates the PostHog personal API key (`person:write`) and sets `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` as Edge Function secrets; (2) ~~deploy~~ done; (3) the end-to-end check in [docs/testing/priv-3-posthog-erasure.md](../docs/testing/priv-3-posthog-erasure.md); (4) then merge the policy wording, GrochowskiMichal/Moduo#244 (draft, into `prod-landing`).
- [ ] **PRIV-3b — Durable PostHog erasure backlog** · deps: PRIV-3 · **before the app's PostHog key goes on in production** · delete-account records an erasure that was refused, skipped or rate-limited in a service-role-only table before the auth user goes, and a scheduled job retries it; a 429 or timeout then becomes a backlog entry instead of a blocked deletion. Optional: a per-user cooldown on `analytics-forget`. Why: the validator and the security pass both found the logs-only gap (docs/decisions/permissions.md 2026-10-08). Tier 2 (migration + `delete-account`). Decision: [docs/decisions/permissions.md](../docs/decisions/permissions.md) 2026-10-08.

---

**Alpha scope — not yet specced** (await `/s1`; add their blocks here when the spec passes the Definition-of-Ready gate): ~~**the mindmap rethink**~~ — **REMOVED from alpha 2026-07-29** (designer call; post-alpha now, and MCP-1 no longer waits on it). ~~The Dashboard rebuild~~ — **specced 2026-07-08** → Wave 6 above (DB-1…DB-8). Then **MCP-1** (above) as the pre-alpha hardening pass.

**Planned — not yet specced, timing open** (Maciej + Mike call 2026-10-02; await `/s1` — nothing to build now): **Communication module — chat + calls**, Duo (2 seats) and Team (3+ seats) plans only, competing with Slack on features. Reverses the 2026-06-24 "no chat module, keep Slack" line. Whether it lands before or after the alpha is not decided; add its blocks here only once its spec passes the Definition-of-Ready gate. Rationale: [docs/ROADMAP.md](../docs/ROADMAP.md) (*Communication module* + Q14) + [docs/decisions.md](../docs/decisions.md) (2026-10-02).

**Post-alpha / out of v1** (designer calls 2026-07-04 — kept for later, *not* deleted): ~~**Finance**~~ — **not planned at all** (Maciej, 2026-10-07: not soon, possibly never). **Email was pulled BACK IN the same day** (pm designer call — EM-1…EM-11 above, next to build); its post-v1 remainder: Outlook/Workspace-Google providers, send-as aliases, scheduled send, full web client (the relay decision). Rationale in [docs/ROADMAP.md](../docs/ROADMAP.md) + [docs/decisions.md](../docs/decisions.md) (2026-07-04 entries). The Cmd-K Search/Capture modes and the Universal Inbox screen are deferred spine sub-features (see `specs/connective-tissue.md` → Out of scope).
_Finished blocks of this section: [BUILD_LOG.md](./BUILD_LOG.md)._
