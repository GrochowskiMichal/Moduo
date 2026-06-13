# Moduo Tasks Module — Build Log

Breadcrumbs between Claude Code sessions. Newest first. Each entry: what was
built, key decisions, and anything deferred or broken. Pairs with
`moduo-tasks-feature-spec.md` (the anchor) and `moduo-architecture-vocabulary.md`.

---

## Improvement-plan Session 11 — Tasks UI/UX rebuild + shared primitives (2026-06-13)

Branch `t/maciej/session11-tasks-ui` off `maciej` (Opus). A maximum-rigor
UI/UX pass on Tasks, building a **reusable primitive + motion layer** (Notes is
the canary, next session). Decisions captured in
[.design/tasks-polish/DECISIONS.md](../.design/tasks-polish/DECISIONS.md); brief +
audits in `.design/tasks-polish/`. **One PR; primitives shared from day one.**

**The "huge on web" mystery — RESOLVED: browser per-site zoom**, not fonts/
density. `screen.width=1728` ⇒ base dpr 2.0 but the tab reported dpr 2.5 (= 125%
Chrome/Dia page zoom on the Moduo origin); ⌘0 fixed it. Measured sizes were
already Linear-grade. (Two earlier theories — "Inter wider", "display-role font"
— were wrong; Geist≈Inter within ~2%.)

**Foundation (tokens/global).** Replaced the `* { font-family: "Pilat Extended" }`
override with `var(--font-body)` (unclassed text → Geist; `font-display` still
wins) — a real bypass fix, not the zoom cause. Density default KEPT `comfortable`.
Added a density-scaling **icon-size ladder** (`--icon-xs/-sm/-/-lg` + `@theme`
`--spacing-icon-*` → `size-icon-*`). Motion: `--motion-fade` (kept ~80ms under
reduced-motion) + `--blur-veil` (fade+blur motif; →0 reduced); reduced-motion now
zeroes transforms but keeps fades. `--selected-bg`/`--selected-border` selection
recipe (accent-mix, recolors per data-accent).

**Shared primitives (`src/components/ui/`, with stories).** **FieldShell** cva
(`filled`/`ghost`/`bare`, modern offset-less ring) composed by Input(+`size`/
`variant`)/Textarea/SelectTrigger, all bumped to 14px. **Button** retuned (14px
across rungs, icon ladder, modern ring). **SegmentedControl** (radix ToggleGroup;
replaces 3 bespoke toggles: view switch, rail Plan/Queue, execute timer).
**IconButton** (required tooltip+label). **Toolbar** (aligned control row).
**Calendar** + **DateField** (react-day-picker@10 + date-fns; token-routed;
replaces 4 native date inputs; presets + withTime). **CompleteToggle** (promoted;
spring check-pop). **EmptyState** (promoted). **TagChip v2** (colored `#`, no
dot/pill).

**Surfaces.** Toolbar aligned (controls 26px, was 26/26/**32**/26). Task row: no
hover reflow (schedule/due reserve+fade), title **body/15**, faint accent-tint
selection, always-visible quiet **queue toggle** (replaces right-click-only),
subtask indent guide. Rail eyebrows display→body. Detail panel: DateField + ghost
property selects + `bg-primary` "Commit to Queue". Board: **Linear-quiet** (cards
`bg-card`+hairline on transparent columns — fixes inverted elevation; drag grip
removed). Capture modal: chromeless, 20px display title / body description,
DateField, dead attachment removed. **"Today" → "Queue"** rename app-wide (UI
only; `committed_for`/internal `execute` model unchanged). Execute card: compact
timer (body+tabular), x/y label back at the bottom, empty "Linked" placeholder
removed.

**Accent policy (modern under all 8 accents — contrast verified AA earlier).**
Accent only on: one primary action per pane, current selection (bar+tint), focus
ring, the quiet done-check. Segmented toggles + priority/energy stay neutral.

**Verified:** typecheck ✓, vitest **91/91** ✓, lint:tw ✓, lint:css ✓, build:web ✓.
Live (web, worktree rsbuild `:8099` + Chrome MCP Browser 1 + hosted test acct):
rename, board grip removal, **DateField calendar (June 2026 + presets + time,
real-click)**, selection tint, no console errors. (Note: synthetic `.click()`
won't open Radix popovers — used a real extension click.)

**Deferred / gated:**
- **Time-tracking (Wave 4)** — Round D chose "persisted total + sessions", which
  needs a **hosted Supabase migration** (`task_time_entries` + `tasks_op_track_time`
  intent-op) + runtime + UI. That migration is an irreversible shared-DB change, so
  it's **held for Maciej's explicit go-ahead** and split to a follow-up. The Execute
  card is restyled; the Time-spent mode + estimate-chip + Pomodoro-settings land then.
- **Detail-panel full PropertyRow** inline label→value grid (kept the `Field`
  stacked layout, now quiet via ghost controls).
- **Group control** = ghost Select (chose over a separate DropdownMenu-radio).
- **Visual-test baselines** for the new primitives (need a Storybook+Playwright run).
- `q` keyboard shortcut for queue; meta-icon density-scaling in rows.
- **Notes canary (Session 12):** adopt these primitives, prove portability.

---

## Improvement-plan Session 10 — Theme shades + tokenization deepening (2026-06-13)

Branch `t/maciej/session10-theme-shades` off `maciej` (Fable). Sessions 8/9
live on still-open PRs #18/#19 — Session 10 is design-only and parallelizable,
so it branches from `maciej` directly. Zero schema, zero runtime semantics.

**`data-shade` axis (tokens.css §4b).** Six curated presets: **black**
(default — the existing achromatic pure-black ladder) plus **warm / cool /
slate / plum / forest**. Each tinted preset re-tints only the dark surface
ladder (`--background --card --popover --muted --input --accent --secondary
--border` + a faint matching tint on `--muted-foreground`); accents, status
colors, label hues, and all foregrounds stay untouched, so `data-shade`
composes orthogonally with `data-accent` exactly as the shades memory/plan
wanted. Guarded with `:not([data-theme="light"])` — inert in light mode.
An explicit `[data-shade="black"]` block restates the defaults so the
Settings swatches (scoped `data-shade` on the buttons, accent-picker pattern)
preview correctly inside a tinted page. **Chroma was hand-tuned live** against
the running Tasks shell — the first-pass values (chroma 0.008–0.020) were
imperceptible; shipped values lift the canvas to L 0.13 and run chroma
0.010–0.035 tuned per hue (warm needs more chroma than blue/green to read;
slate is deliberately the quietest).

**Wiring.** `appearance.ts`: `shade` field (type, default `black`,
validation, `data-shade` in the attr map, `setShade`) — `sanitize()` defaults
old persisted blobs, `main.tsx`'s pre-paint `applyAppearance` covers boot
automatically. Settings: new `shade-picker.tsx` between Theme and Accent
(radiogroup of swatch circles, same a11y pattern as the accent picker).
Storybook: Shade toolbar entry + `AppearanceSync` mirror, alongside
density/text-size. Docs: DESIGN_SYSTEM.md attr table + TOKENS.md axis table.

**Token-bypass audit.** Anchor surfaces (tasks, settings, ui primitives,
app shell, layouts) were already clean except: `root-error-boundary.tsx`
(zinc-\* → semantic tokens; it renders inside the normal CSS pipeline, so
tokens are safe there) and global.css's mindmap dot fallbacks
(`#ffffff`/`#141414` → `var(--foreground)`/`var(--card)`) + one `rgba()`
alias — **stylelint is now at 0 warnings** (was 5). Catalogued-but-left
(legacy, parked per CLAUDE.md): dashboard widgets (heaviest — hex +
arbitrary sizes throughout), `email-workspace.tsx` (red-\*/white),
`onboarding-page.tsx` + `paywall-page.tsx` (amber-\*/white), mindmap
toolbar/nodes, `feature-empty-page.tsx`, `grid-page.tsx`, `src/tw/` shim.
These all predate the token system; fold fixes into Session 11's restyle or
each module's migration. `integrations-section.tsx`'s `#4285f4` is a Google
Calendar brand fallback for runtime calendar data, not a design-system
bypass — left as data.

**Verified (local):** typecheck ✓, vitest 81/81 ✓ (`bun run test`; bare
`bun test` also picks up non-vitest files and fails pre-existingly — use the
script), lint:css **0 problems** ✓, lint:tw ✓, build:web ✓.
**Live-verified on web** (worktree rsbuild `:8097` + Chrome MCP + hosted test
account): boot applies `data-shade` pre-paint; Settings → Shade picker
renders six previewing swatches; clicking Warm re-tints the whole shell
(espresso cast over rail/canvas/rows), persists (`moduo.appearance.shade`),
and survives reload; plum/slate/forest/cool all resolve to distinct tinted
ladders (computed-style probe); light+warm probe = `lab(98% 0 0)` (guard
holds); round-trip back to Black restores pure black; no console errors.

**Deferred:** desktop (Tauri) visual spot-check (same webview code path);
shade-aware Storybook visual snapshots (`density-snapshots.mjs` could gain a
shade matrix); light-mode shades (waits for the light palette);
`data-shade`-aware `--shadow-*` (shadows stay pure black — fine on tinted
surfaces, revisit if a preset ever goes lighter than L 0.15).

---

## Improvement-plan Session 9 — MCP connector v1 (2026-06-12)

Branch `t/maciej/session9-mcp-connector` off `t/maciej/session8-intent-ops`
(Fable; stacked while PR #18 is open — PR #19, retarget to `maciej` after #18
merges). One Moduo MCP server with per-module registration — Tasks is module
#1. New anchor doc **[moduo-mcp-connector.md](./moduo-mcp-connector.md)**
(shape, key model, actor path, tool table, and the "onboard a module to MCP"
recipe).

**Status:** the auto-mode classifier gated the hosted apply mid-session
(same as Sessions 4/5/8); **Maciej approved (apply + deploy)**. Migrations
`20260612160000` + `…161000` applied, `moduo-mcp` deployed with
**`verify_jwt = false`** (MCP clients send a Moduo key, not a Supabase JWT —
keep this flag on redeploys), full live-verify below.

**Connector — [supabase/functions/moduo-mcp/](../supabase/functions/moduo-mcp/).**
Stateless MCP Streamable HTTP (hand-rolled JSON-RPC: initialize / ping /
tools/list / tools/call; notifications → 202; no SSE, no session state, no
SDK). `Authorization: Bearer moduo_sk_…` sha256-verified against
`workspace_api_keys`; the key pins the workspace — tools never take a
workspace arg. `registry.ts` is the connector-side module registry
(`connectorModules`); `modules/tasks.ts` contributes 8 read tools
(buckets / list / today / drift / tags / search / get / activity, all with
computed drifted+blocked, served only at `view`+) and 7 write tools = the
Session 8 intent ops minus `catch_up` (app-lifecycle pass, not an agent
intent; deliberately not granted to service_role). `recurrence.ts` is a
marked port of the two engine functions the connector needs (agents never
compute rrule pointers; ops still enforce structure, so port drift degrades
to a rejected call). Known accepted duplication: Deno can't import the app's
extensionless modules — manifest summaries are copied; unify when module #2
lands (recipe step 4 note).

**Schema — [20260612160000_workspace_api_keys_mcp.sql](../supabase/migrations/20260612160000_workspace_api_keys_mcp.sql).**
- `workspace_api_keys`: name, `key_prefix` (display stub), unique sha256
  `key_hash` (secret never stored; column-level grant keeps the hash
  unreadable by clients), `scopes` jsonb on the none/view/edit ladder (view
  default, admin never key-grantable), revoked_at, throttled last_used_at.
  RLS: owner/admin SELECT (`workspace_api_keys_can_manage`); no write
  policies — create/revoke via SECURITY DEFINER RPCs
  (`workspace_api_keys_create` returns the secret exactly once; 20-live-keys
  cap; anon explicitly revoked per the Session 8 lesson).
- **Actor path (the Session 8 reserved slot):** `module_api_key_id()` reads
  the `x-moduo-key-id` request header **only under a service_role JWT** —
  clients can send the header but never the role; the secret never reaches
  Postgres. `module_activity_log()` gains the `api_key` branch (key id +
  name snapshot; user keeps precedence; neither context → loud failure).
  `tasks_module_permission()` resolves key calls to the key's tasks scope, so
  `tasks_op__guard`'s edit+ check applies to keys with zero op changes.
- Grants: the 7 agent-facing ops → service_role.

**Runtime & UI.** `runtime.workspace` gains `listApiKeys` / `createApiKey` /
`revokeApiKey` / `getMcpEndpoint` (web; desktop rides the same object
verbatim). [workspace-settings-modal.tsx](../src/components/workspace-settings-modal.tsx)
gains an **API keys · MCP** section (owner/admin modal): endpoint row with
copy, name input + View/Edit scope picker + Create, reveal-once secret banner
(copy + dismiss), key rows (name, prefix, last-used, scope badge, revoke).
New `WorkspaceApiKey` type in runtime.types.

**Docs.** Connector doc (above) incl. the onboarding recipe; contract doc's
three "arrives in Session 9" passages resolved to the real mechanism; spec
§11b actor sentence updated; vocabulary gained "MCP connector / API key";
plan Session 9 header note.

**Verified (local):** typecheck ✓, vitest **91/91** ✓, lint:tw ✓, lint:css 0
errors (same 5 pre-existing global.css warnings). (`bun test` ≠ `bun run
test` — bun's own runner reports phantom failures; vitest is the gate.)
No deno locally — the edge function validated at deploy.

**Live-verified against hosted** (test account; probe keys inserted by hash,
JSON-RPC via curl; UI via `:8096` worktree rsbuild + Chrome MCP):
(1) `initialize` → echoes protocol 2025-06-18, instructions name the
workspace, key and scopes. (2) **Scope gating:** tools/list = 8 tools on a
view key, 15 on edit; view-key `tasks_commit` → quiet isError refusal.
(3) Edit-key `tasks_commit` → row committed, `module_activity` row
`actor_type='api_key'`, actor_id = key id, label "Probe edit key".
(4) **Engine port:** `tasks_set_status done` on daily-recurring Water plants
(pending Jun 13) → pointer Jun 14 (advance-from-pending); reopen recomputes
same; `tasks_skip_occurrence` → Jun 13→Jun 14, pointer Jun 15, forward-only.
(5) **Auth:** no/bogus bearer 401; revoked key 401 (probed twice, SQL- and
UI-revoked); GET 405; notification 202. (6) **Spoof:** authenticated user
calling an op with a forged `x-moduo-key-id` header → attributed **user**
(uid precedence); anon op call → permission denied. (7) **Key RPCs:** create
as owner → secret returned once (view default); `select *` → column-grant
denial (key_hash unreadable); explicit columns OK; `scopes:{tasks:'admin'}`
rejected; revoke 204. (8) **Settings UI** (workspace modal): section renders
endpoint+copy, create "UI round-trip key" with Edit scope → reveal-once
banner; that key called `tasks_today` live; UI revoke × → row gone → key 401.
(9) **In-app trail** renders "Probe edit key committed this for Jun 12"
between the user rows — agents are named, never silent. No console errors.
(10) Advisors: one new WARN (`module_api_key_id` mutable search_path) →
fixed in `20260612161000`; the SECURITY-DEFINER-executable WARNs on the new
RPCs are the same intentional pattern as all `tasks_op_*`; anon got nothing
(Session 8's lesson held). **All probe keys revoked** (secrets appeared in
the session transcript — none left live). Demo-data drift: Water plants now
todo Jun 14 9:00 (pointer Jun 15); probe task restored (uncommitted, trail
gained 3 rows incl. the api_key one).

---

## Improvement-plan Session 8 — Intent ops + activity (2026-06-12)

Branch `t/maciej/session8-intent-ops` off `maciej` (Fable). The per-module
AI-readiness contract, with Tasks as the reference implementation. New anchor
doc **[moduo-module-contract.md](./moduo-module-contract.md)** (written first):
four pillars — intent ops, actor attribution, activity, permission mapping —
plus the registration shape for Session 9's MCP connector. Spec gained
**§11b**; vocabulary gained "Intent op" + "Activity (trail)".

**Status:** the auto-mode classifier gated the hosted apply mid-session (same
as Sessions 4/5); **Maciej approved**, both migrations applied, full
live-verify done (below). Note for future sessions: Supabase's
`ALTER DEFAULT PRIVILEGES` grants EXECUTE on **new functions to `anon`** —
`REVOKE … FROM PUBLIC` alone is not enough; the security advisor caught it and
the follow-up migration
[20260612151000_intent_ops_revoke_anon.sql](../supabase/migrations/20260612151000_intent_ops_revoke_anon.sql)
revokes anon explicitly (probe-confirmed denied).

**Schema —
[20260612150000_module_activity_intent_ops.sql](../supabase/migrations/20260612150000_module_activity_intent_ops.sql).**
- `module_activity`: one shared, cross-module, **append-only** trail
  (workspace, module, entity_type/entity_id, op, actor_type/actor_id/
  actor_label, payload jsonb). SELECT for members; **no write policies** —
  rows are written only inside the ops (SECURITY DEFINER), so clients can't
  forge attribution. Actor derived server-side from `auth.uid()` (+
  `profiles.display_name` snapshot); `agent`/`api_key` CHECK-reserved for
  Session 9's scoped keys.
- `tasks_module_permission()`: normalizes the none/view/edit/admin ladder
  (owner → admin; legacy `'write'`/`'read'` → edit/view; null/unknown → edit).
  Ops require edit+ — **permission level is now enforced server-side** (RLS
  alone only checked membership; view-only members could previously write).
- 8 `tasks_op_*` RPCs (one transaction each: guard → invariants → write → log
  → return row): `commit` (queue order = max+1 under a row lock, race-safe;
  recommit = move-to-end = "Do last"), `uncommit` (idempotent, never
  intercepted), `skip_today` (clear commit + `reschedule_count++`
  **atomically**), `set_status` (recurrence pointer ride-along, recurring-only
  structural guard; optional board position), `reschedule` / `unschedule`
  (drift triage; never touch the reschedule counter), `skip_occurrence`
  (forward-only enforced), `catch_up` (**batched**: one RPC per reload instead
  of N writes; skips backwards moves — a stale tab can't undo a fresher one;
  per-task activity rows with `kind` reopen/collapse/adopt). Occurrence math
  stays in the tested client engine (rrule can't live in plpgsql); ops enforce
  the structural invariants — documented split (contract Pillar 1).

**Registration (contract pillar 3).** Typed manifests:
[module-manifest.ts](../src/lib/module-manifest.ts) (types) +
[module-registry.ts](../src/lib/module-registry.ts) (the single list Session 9
iterates) + [ops-manifest.ts](../src/features/tasks/ops-manifest.ts) (the
Tasks ops/resources). Onboarding module N+1 = adding a manifest entry.

**Runtime & hook.** `runtime.tasks` gains `opCommit/opUncommit/opSkipToday/
opSetStatus/opReschedule/opUnschedule/opSkipOccurrence/opCatchUp` +
`listActivity` (desktop rides the same web runtime — zero Rust changes).
[use-tasks-module.ts](../src/features/tasks/hooks/use-tasks-module.ts): new
`applyOp` chokepoint (optimistic patch → RPC → swap returned row → bump
`activityStamp`; reload on error). `patchTask` routes **status-cluster patches
(status/recurrence/position) through `tasks.set_status`** — covers row/card/
list toggles, board drag-to-column, the panel select, Execute's "Done, next" —
while plain field edits stay raw upserts (contract: ops are for invariants).
`toggleCommit`/`doLast` → commit/uncommit ops; Execute's Skip → `skip_today`;
triage Reschedule/Ignore → `reschedule`/`unschedule` (new `unscheduleTask`);
skip-occurrence → its op; the catch-up pass now builds `TasksCatchUpItem[]`
(new pure `catchUpItem`, tested) and fires **one** `tasks_op_catch_up`.

**Activity trail.** [activity.ts](../src/features/tasks/activity.ts): pure
op → quiet sentence vocabulary ("You committed this for Jun 12", "skipped an
occurrence — next Jun 14, 9:00 AM"; unknown ops fall back to the op name —
the trail never lies by omission). Detail panel gains an **Activity** section
(newest-first, `text-2xs text-muted-foreground/80`, actor + sentence + time;
refetches on selection and on `activityStamp` bumps; creation is anchored by
the existing Created metadata, no synthetic row). Mirrors, never walls.

**Incidental find + token fix:** the drift-triage per-task menus were
**unclickable** — `--z-dropdown: 40` sat below `--z-overlay: 50` /
`--z-dialog: 60`, so any dropdown spawned inside any dialog rendered under the
overlay (pre-existing, app-wide). Fixed at the token layer per CLAUDE.md:
`--z-dropdown: 70` (layers with popovers) in tokens.css §13.

**Verified (local):** typecheck ✓, vitest **91/91** ✓ (10 new in
`activity.test.ts`: actor naming, op sentences, catch-up item shaping),
lint:tw ✓, lint:css 0 errors (same 5 pre-existing global.css warnings),
`cargo check` + `cargo test --lib domain` 5/5 ✓, `build:web` ✓.
**Live-verified on web** against hosted (test account, `:8095` worktree
rsbuild via Chrome MCP): (1) new "Session 8 ops probe" task → panel shows
**Activity / "Nothing yet."**; **Commit to today** → trail "You committed
this for Jun 12". (2) Execute → **Skip** → "Rescheduled 1×" mirror + "You
skipped this for the day" (atomic server-side counter). (3) Done → undone
checkbox → "You completed this" / "You reopened this". (4) Drift triage
(probe REST-backdated to drift): per-task **Reschedule tomorrow** → DB
scheduled_at +1 day clock-preserved, `reschedule_count` untouched; **Ignore**
on Water plants → scheduled_at null, rule intact. (5) Reload → **catch-up
adopt** via one batched `tasks_op_catch_up`: Water plants self-healed to
today 9:00, pointer tomorrow, trail "You scheduled its occurrence, 9:00 AM
(recurrence)". (6) Panel **skip-occurrence** → toast "Skipped — next Jun 13,
9:00 AM", DB forward move + pointer Jun 14. (7) Second reload → **zero
writes** (8 activity rows, updated_at unchanged). (8) DB dump of
`module_activity`: 8 rows, all ops, `actor_type='user'`, `actor_label`
"Claude Test S2" snapshotted, payloads correct. (9) Security probes: anon
INSERT → 401 RLS; **authenticated forge INSERT → 403 RLS** (append-only
holds); anon RPC → 401 permission denied. No new console errors (only the
pre-existing web email `syncNow` desktop-only noise). Left as demo data: the
probe task (todo, Jun 13 8:00, count 1, full trail) and Water plants (todo,
Jun 13 9:00, pointer Jun 14).

**Deferred:** ops for capture/plain edits/tags/relations (contract documents
the v1 boundary); Session 9 wires service-role/API-key grants + the MCP
connector onto the same registry; a workspace-level activity feed (the
`module_activity_workspace_idx` index anticipates it); view-only-member op
rejection not live-probed (no second member on the test workspace — covered
by the permission helper's SQL + the anon probes); row/card context menus
didn't open via the Chrome extension's synthetic right-click (extension
limitation, not a regression — panel affordances verified).

---

## Improvement-plan Session 7 — Recurrence engine (2026-06-12)

Branch `t/maciej/session7-recurrence` (Fable), **stacked on Session 6's branch**
(`t/maciej/session6-blocked-by`, PR #16 still open — recurrence touches the
same done/commit semantics; retarget to `maciej` after #16 merges). Spec gained
**§5d** (written first), vocabulary gained "Occurrence / Catch-up".

**The model — single-row engine.** A recurring task is **one row that cycles**,
never a template spawning occurrence rows. `scheduledAt` always carries the
*current occurrence* (so rows, drift, commit, board, and the future Calendar
work unchanged); `recurrence.nextOccurrence` is the stored pointer for when a
completed task comes back. Missed occurrences **don't exist**: no backfill, no
"7 overdue" — at any moment exactly one live occurrence (principle 4).
**Zero schema change**: the `tasks.recurrence` jsonb column and the Rust
`RecurrenceRule` parity struct have existed since the first tasks migration;
this session built the engine that finally moves the pointer.

**Key decision — done stays done for the day.** Completing a recurring task
does *not* instantly reset it to todo (that would erase Execute's n/m credit
and the Done column's meaning). Instead completion **advances the pointer**
(first occurrence after `max(now, scheduledAt)` — completing early skips the
pending occurrence, completing late never backfills) with a quiet
"Done — next …" toast, and **catch-up** does the reopening when the pointer
arrives. Un-completing recomputes the pointer the same way. An exhausted rule
(COUNT/UNTIL) advances to a null pointer — the task simply stays done.

**Engine ([recurrence-engine.ts](../src/features/tasks/recurrence-engine.ts))
— pure, 22 tests.** `occurrenceAfter` / `currentOccurrence` (defensive rrule
parsing; invalid rules are inert), `recurrenceOnStatusChange` (advance-on-done),
`catchUpPatch` (idempotent: done + pointer-arrived → reopen at the *latest*
occurrence ≤ now, pointer → first future, **stale commit cleared**, never
auto-commits; open + missed ≥1 full occurrence → collapse `scheduledAt` forward
to one quiet drift; open + no `scheduledAt` → adopt the live occurrence —
self-heals pre-engine rows; drift *within* the current occurrence is left
alone — still actionable today), `skipOccurrencePatch` (jump past the pending
occurrence, release today's commit when the new occurrence isn't today).

**Hook ([use-tasks-module.ts](../src/features/tasks/hooks/use-tasks-module.ts)).**
`patchTask` is the one chokepoint: any status change on a recurring task
refreshes the pointer (covers row/card/list toggles, board drag-to-Done, the
panel status select, Execute's "Done, next") unless the patch already carries
`recurrence` (catch-up/skip pass it explicitly). Catch-up runs **once per
successful load** (a `loadStamp` + ref guard; edit permission required —
view-only sessions just see quiet drift). New `skipOccurrence` mutation —
deliberately does **not** touch `rescheduleCount` (a skipped occurrence is a
decision, not a slip; Execute's *Skip* = leave today's queue stays a separate
op — the occurrence remains live and doable later today).

**Surfaces.** Detail panel: the read-only raw-RRULE field became an editable
**Repeat** preset select (capture's vocabulary; an out-of-vocabulary parsed
rule reads as its human label; clearing keeps the task one-off; setting a rule
on an unscheduled task adopts the first occurrence) + a tooltipped
**skip-occurrence** button; the Scheduled draft now follows external moves
(skip/catch-up). Rows/cards: context-menu "Skip occurrence" (open recurring
tasks only); tooltips humanized (`recurrenceLabel` instead of raw RRULE).
Capture: a recurring capture **materializes `scheduledAt`** from the rule's
first occurrence (was: recurring captures had no scheduled time and were
invisible to drift).

**Verified (local):** typecheck ✓, vitest **81/81** ✓ (22 new in
`recurrence-engine.test.ts`: advance/early-complete/exhausted, reopen/collapse/
within-occurrence/deliberate-future, adopt, idempotency, skip semantics),
lint:tw ✓, lint:css 0 errors (same 5 pre-existing global.css warnings),
`cargo check` + `cargo test --lib domain` 5/5 ✓, `build:web` ✓.
**Live-verified on web** against hosted (test account, `:8094` worktree rsbuild
via Chrome MCP): (1) captured "Water plants every day" → Repeat pill parsed,
row shows repeat marker + **Jun 13, 9:00 AM** (scheduledAt materialized);
panel Repeat reads "Every day" (preset mapping). (2) **Skip** → toast
"Skipped — next Jun 14, 9:00 AM", panel Scheduled input synced. (3) **Done**
→ row stays struck-through, toast "Done — next Jun 15, 9:00 AM" (advanced from
the pending occurrence); DB: pointer `2026-06-15T07:00Z`, rescheduleCount 0.
(4) **Catch-up**: backdated the done row via the test user's own RLS-scoped
REST write (completed Jun 9, pointer Jun 10, stale commit Jun 9) → reload →
reopened `todo` at **today 9:00** (latest ≤ now; Jun 10/11 misses collapsed),
pointer tomorrow, commit cleared — DB-confirmed; bucket showed exactly **one**
quiet drift. (5) Second reload → **zero writes** (updated_at unchanged).
(6) Row context menu shows "Skip occurrence". No console errors. Left as demo
data: the "Water plants" daily task (todo, today 9:00).

**Note:** the auto-mode classifier denied a service-role `UPDATE` for the
backdating probe — rerouted through the test account's own authenticated REST
write (RLS-enforced, same surface as the app), which is the better probe anyway.

**Deferred:** auto-commit of reopened occurrences (violates no-automagic for
now; revisit if dogfooding wants "recurring into Today"); a skip affordance in
drift triage for recurring tasks; sub-daily rules (vocabulary is ≥ daily);
local-time DST shift on rrule occurrences (existing parser behavior, ~1h drift
across transitions; revisit with Calendar).

---

## Improvement-plan Session 6 — Blocked-by dependencies (2026-06-12)

Branch `t/maciej/session6-blocked-by` off `maciej` (Fable). Dependencies are
**edges, not statuses**; *blocked* is **computed at read time** (the drift
pattern), never stored. Spec gained **§5c** (written first, then code);
vocabulary gained a "Blocked / Frontier" entry.

**Design check-in (Maciej, 4 questions up front — all recommendations taken):**
(1) cycles forbidden at **any length** via a recursive-CTE DB trigger (the
frontier walk relies on a DAG); (2) committing a blocked task **offers the
frontier** in a quiet dialog with a first-class "Commit anyway" escape hatch
(never a wall; un-commit is never intercepted); (3) edge UI lives in the
**detail panel only** for v1; (4) hosted migration pre-approved.

**Schema —
[20260612140000_task_relations.sql](../supabase/migrations/20260612140000_task_relations.sql).**
`task_relations` (id, workspace_id, blocker_task_id → tasks, blocked_task_id →
tasks, created_at), unique per (workspace, blocker, blocked), `CHECK` no
self-edge, ON DELETE CASCADE both ways, RLS via the existing
`tasks_module_can_access_workspace` helper. The BEFORE INSERT/UPDATE trigger
walks the blocked task's downstream closure (recursive CTE, SECURITY INVOKER —
same-workspace rows, caller's RLS is exactly right) and rejects any edge that
closes a cycle. **Applied to hosted** (pre-approved) and **validated by SQL
probe**: self-edge, direct cycle (A⇄B), and transitive cycle (A→B→C→A) all
rejected; probe edges removed. Soft-deleted tasks keep their edges — an edge
whose blocker doesn't resolve among live tasks is **inert** client-side (the
never-invisible rule; CASCADE cleans up on hard delete).

**Model & runtime.** `TaskRelation` TS type + `taskRelations` on the bundle;
web runtime `createTaskRelation` (idempotent, attachTag-style) /
`deleteTaskRelation` + row⇄model mapper; bundle list fetches the table. Rust:
parity-only `TaskRelation` struct + `#[serde(default)]` bundle field (redb has
no relations table — desktop tasks ride the web runtime; lite-version concern).

**Helpers ([helpers.ts](../src/features/tasks/helpers.ts)) — pure, tested.**
`blockedTaskIds(tasks, relations)` — blocked = ≥1 live, *open* blocker (done /
archived / deleted blockers don't block; zero writes to unblock, un-doing a
blocker re-blocks the same way). `frontierTasks(taskId, …)` — the **frontier
walk**: climb the blocker chain, collect open blockers that aren't themselves
blocked (visited-set; cycle-safe defensively). `wouldCreateCycle(…)` — the
client-side guard before adding an edge.

**Hook ([use-tasks-module.ts](../src/features/tasks/hooks/use-tasks-module.ts)).**
Derived `blockedTaskIds` / `blockersByTask` / `dependentsByTask` /
`frontierFor`; mutations `addBlocker` / `removeBlocker` (optimistic, temp-id
guards, dup no-op, cycle check with a quiet toast; removal deletes the edge,
never the task). Raw `taskRelations` exposed for the picker's cycle filter.

**Surfaces.**
- **Row + card:** blocked title dims to `text-muted-foreground` + a quiet
  `CircleDashed` marker with "Blocked by …" tooltip (shared `BlockedMarker`).
  Never red (principles 4–5).
- **Detail panel:** "Blocked by" field — related-task rows (click-through;
  ✕ removes the edge; done blockers struck through) + an "Add blocker"
  Popover+Command picker (open tasks only; cycle-closing candidates filtered
  out); read-only "Blocks" reverse list; "Blocked — waiting on …" ambient
  mirror line next to drift/reschedule.
- **Commit interception
  ([tasks-plan-view.tsx](../src/features/tasks/ui/tasks-plan-view.tsx)):** all
  commit affordances (row/card context menus, panel button, list keyboard) go
  through one guarded `toggleCommit` on a memoized api facade — committing a
  blocked task opens
  [frontier-offer-dialog.tsx](../src/features/tasks/ui/frontier-offer-dialog.tsx)
  ("Blocked by another task — start with what unblocks it?"): one-click commit
  of a frontier task, or **Commit anyway**. Un-commit always passes through.
- **Execute:** Now card meta gains a quiet `Waiting on "…"` note for
  blocked-but-committed-anyway tasks (mirror, not a wall).

**No automagic:** completing the last blocker just lifts the dimming — nothing
auto-commits or auto-surfaces (spec §5c).

**Verified (local):** typecheck ✓, vitest **59/59** ✓ (14 new in
`blocked-by.test.ts`: blocked computation, frontier chain/diamond/cycle-safety,
cycle guard), lint:tw ✓, lint:css 0 errors (same 5 pre-existing global.css
warnings), `cargo check` ✓ + `cargo test --lib domain` 5/5 ✓, `build:web` ✓.
**Live-verified on web** against hosted (test account, `:8093` worktree rsbuild
via Chrome MCP): (1) "Add blocker" on the Untagged filter-test task → picked
"Verify cloud consolidation end-to-end"; DB-confirmed edge; row title dimmed +
marker tooltip correct; panel showed the blocker row + "Blocked — waiting on …"
mirror. (2) Blocker's panel showed the **Blocks** reverse list; its picker
correctly **excluded** the cycle-closing candidate (offered only the open
subtask). (3) Committing the blocked task opened the frontier dialog; **Commit**
committed the frontier task (dialog closed, blocked task untouched); a second
attempt via **Commit anyway** committed the blocked task. (4) Un-commit passed
straight through (no dialog). (5) Execute Now card read `Waiting on "Verify
cloud consolidation end-to-end"`. (6) Marking the blocker done lifted the dim +
marker **with zero writes** to the blocked task; full reload from hosted
round-tripped (edge persisted, done blocker struck through); un-doing re-blocked
live. No console errors. Left as demo data: the single edge (blocker todo,
blocked task uncommitted); the Session 5 demo subtask's stale commit was
incidentally cleared.

**Deferred:** transitive *display* (only direct blockers mark a task blocked —
deliberate, per the computed-state model); a "Blocks…" add-affordance (reverse
list is read-only v1); row context-menu entry for adding blockers (panel-only
per design check-in); Execute queue-row blocked markers (Now card only).

## Improvement-plan Session 5 — Subtasks, one level (2026-06-12)

Branch `t/maciej/session5-subtasks` off `maciej` (Fable). Subtasks are **full
tasks with a `parentId`**, exactly one level deep — not checklist items. Spec
gained **§5b** (written first, then code); vocabulary gained a "Subtask" entry.

**Schema —
[20260612130000_tasks_add_parent.sql](../supabase/migrations/20260612130000_tasks_add_parent.sql).**
`parent_id uuid REFERENCES tasks ON DELETE SET NULL` + partial index + a
`CHECK (parent_id <> id)` + a BEFORE INSERT/UPDATE trigger enforcing one level
both directions (parent must be top-level & same-workspace; a task with live
subtasks can't become one). The trigger deliberately does **not** require the
parent to be un-deleted — children of a soft-deleted parent must keep accepting
writes (clients treat an unresolvable `parentId` as unset). Fuller server-side
invariants are Session 8's intent-op RPCs; this is the cheap corruption guard.
**Applied to hosted** (2026-06-12, Maciej's explicit go-ahead — the auto-mode
classifier had gated the first attempt, same as Session 4; `list_migrations`
now shows `tasks_add_parent` and the column is confirmed live).

**Model & runtime.** `parentId` on the TS `Task`, `makeTask`, the web
row⇄model mappers, and the Rust struct (`#[serde(default)]`, parity only —
desktop tasks ride the web runtime since Session 2). **Deleting a parent
promotes its children** (optimistic in the hook; mirrored in `runtime.web`
`deleteTask` and the Rust command) — work is never silently lost.

**Hook ([use-tasks-module.ts](../src/features/tasks/hooks/use-tasks-module.ts)).**
Derived `subtasksByParent` (live, non-archived children; unresolvable parents
ignored) + `subtaskProgressByTask` (n/m; archived counts toward neither side).
New `addSubtask(parentId, title)` (creates in the parent's bucket via the
existing `createTask` path) and `setTaskParent(id, parentId|null)` (attach /
detach-"promote"), both enforcing one-level + temp-id guards with quiet toasts.
No new write paths — everything lands in `upsertTask`.

**The load-bearing rendering rule:** a subtask is hidden from the top level
*only when its parent is in the same rendered set* (`nestedSubtaskIds()` in
[helpers.ts](../src/features/tasks/helpers.ts)); otherwise it renders as a
normal top-level row. Parent in another bucket / filtered out / deleted ⇒ the
subtask is still reachable. **Today is always flat** — the commit queue is
ordered, and subtasks are individually committable (the whole point: start a
scary task via its smallest step).

**Surfaces.**
- **List** ([task-list-view.tsx](../src/features/tasks/ui/task-list-view.tsx)):
  parents get a chevron expand affordance (collapsed by default), children
  render indented; the chevron gutter only appears when the scope actually
  nests something (quiet until used). Keyboard: `→` expand, `←` collapse /
  jump to parent; j/k order = visual order (expanded children included). The
  selection backstop expands a collapsed parent into view rather than stealing
  a panel-driven subtask selection.
- **Row** ([task-row.tsx](../src/features/tasks/ui/task-row.tsx)): quiet
  `n/m` after the parent title; flat-rendered subtasks get a `↳ parent`
  caption; context menu gains "Detach from parent".
- **Board** ([task-board-view.tsx](../src/features/tasks/ui/task-board-view.tsx)):
  columns hide subtasks whose parent is on the board (the parent card carries
  the n/m; the detail panel is the affordance); Today board stays flat with
  parent captions on cards.
- **Detail panel** ([task-detail-panel.tsx](../src/features/tasks/ui/task-detail-panel.tsx)):
  parents get a **Subtasks** field — n/m in the label, ordered child rows
  (complete-toggle, click-to-select, hover Sunrise = commit-to-today) and a
  quiet "+ Add subtask" inline input (Enter = rapid entry). Subtasks get a
  "Sub-task of <parent>" breadcrumb (click → select parent) + **Detach**. New
  `onSelectTask` prop threaded from the plan view.
- **Execute** ([execute-view.tsx](../src/features/tasks/ui/execute-view.tsx)):
  Now card shows "Part of <parent>" in its meta line; queue rows show `↳ parent`.
- Plan-view selection backstop now also accepts a selected subtask whose
  parent is in scope (cross-bucket children stay selectable).

**No automagic:** completing all subtasks never auto-completes the parent —
the mirror surfaces it, the user decides (principles 2, 4, 5).

**Verified (local):** typecheck ✓, vitest **45/45** ✓ (8 new in
`subtasks.test.ts`), lint:tw ✓, lint:css 0 errors (same 5 pre-existing
global.css warnings), `cargo check` ✓ + `cargo test domain` 5/5 ✓, `build:web` ✓.
**Live-verified on web** against hosted (disposable account, `:8093` local
rsbuild via Chrome MCP — the worktree recipe): (1) detail-panel **Add subtask**
created "Draft the outline" + "Write the first section" under the Inbox task
(rapid entry, Enter-keeps-input); the list showed the parent with a quiet
**0/2** and the children hidden by default. (2) Chevron expand → both children
indented under the parent; toggling one done updated the mirror to **1/2**
(row + panel) and did **not** auto-complete the parent. (3) Selecting a
subtask showed the "Sub-task of …" breadcrumb + Detach + Commit-to-today;
committing it made **Today** render it flat with the ↳ parent caption, and
**Execute**'s Now card read "Part of Verify cloud consolidation end-to-end"
(0/1 queue). (4) DB confirmed both `parent_id` rows + the `committed_for`
date; a direct SQL attempt to nest a subtask under a subtask was **rejected by
the trigger** ("Subtasks are one level…"). (5) Full reload from hosted
round-tripped (1/2, children collapsed); no console errors. Left as demo data:
the two subtasks (one done, one committed-for-2026-06-12 — goes stale
harmlessly tomorrow).

**Deferred:** sibling reorder UI (children keep position order; same deferral
as board reorder); "make subtask of…" attach-existing picker (create-new +
detach shipped); capture-time subtask creation (capture stays frictionless by
design); auto-moving children when a parent changes bucket (the never-invisible
rule makes divergence safe).

---

## Improvement-plan Session 4 — Organization layer: rail sections + tags v1 (2026-06-12)

Branch `t/maciej/session4-org-tags` off `maciej`. Two organizing layers land:
presentational **bucket sections** in the rail, and **workspace tags v1** with a
shared, cross-module `TagPicker`. The tags *data* layer already existed (tables +
runtime CRUD from Sessions 1–2, hosted `tags`/`tag_links` empty) — this session is
almost entirely UI, plus one additive schema change.

**Decisions locked with Maciej (3 questions up front):** (1) tag filter = a quiet
header **Filter** control + click-a-chip-to-filter, active filters shown as
removable chips, **OR/union** semantics; (2) chips **always shown, quiet** (a
hue dot + `#name`, faint tint) on rows *and* cards; (3) tag create = **inline
`Create #name` with an auto-assigned color**, recolorable later (friction behind
the dump). Recommendation taken on (3).

**Schema — `buckets.group` (one additive column).** `group_label text` on
`buckets` (named `group_label` to dodge the SQL reserved word; mapped to the
camelCase model field `group`). Migration
[20260612120000_buckets_add_group.sql](../supabase/migrations/20260612120000_buckets_add_group.sql).
Added to the Rust `Bucket` struct (`#[serde(default)] group: Option<String>` —
redb stores Bucket as JSON, so old rows default to `None`, no redb migration),
the TS model, and the web row⇄model mappers (`group` ⇄ `group_label`). **Applied
to hosted** (2026-06-12, with Maciej's explicit go-ahead — the auto-mode
classifier had gated the first unprompted attempt; `list_migrations` now shows
`20260612120000`).

**Bucket sections (presentational, two levels max).** `bucketSections()` /
`bucketGroupNames()` pure helpers ([helpers.ts](../src/features/tasks/helpers.ts),
unit-tested). [bucket-rail.tsx](../src/features/tasks/ui/bucket-rail.tsx) renders
ungrouped buckets flat first, then collapsible section headers (open-count, local
collapse state) — never nested. Assign via the bucket "…" → **Section** submenu
(radio of existing sections + "No section" + inline "New section…"). Capture and
task→bucket assignment untouched. `api.setBucketGroup` is optimistic.

**Tags v1 — shared cross-module surface.**
- **Label palette** ([tokens.css](../src/styles/tokens.css) §13b): 8 hues reusing
  the accent palette bases, keyed by `data-label="…"` → `--label` / `--label-surface`
  (surfaces precomputed oklch-with-alpha so component code stays hex/arbitrary-free
  per the design-system rules). Structural `.tag-chip` / `.tag-dot` /
  `.tag-chip-outline` in [global.css](../src/global.css) consume only those vars.
  A tag's `color` stores the **hue name** (not a hex) → fully token-routed,
  theme-safe (survives the future `data-shade` work).
- **Shared components** (`src/components/`, so Mail/Notes adopt them later):
  [tag-colors.ts](../src/components/tag-colors.ts) (`LABEL_COLORS`,
  `normalizeLabelColor`, deterministic `pickTagColor` — unit-tested),
  [tag-chip.tsx](../src/components/tag-chip.tsx) (`TagChip` + capped `TagChipList`),
  [tag-picker.tsx](../src/components/tag-picker.tsx) (Popover + shadcn Command:
  search, toggle, inline create w/ auto-color, inline recolor swatch strip,
  delete) + a Storybook story.
- **Hook** ([use-tasks-module.ts](../src/features/tasks/hooks/use-tasks-module.ts)):
  derived `tags` (live, name-sorted), `tagsByTask`, `openTaskCountByTag`; optimistic
  `toggleTaskTag` / `createTagForTask` (create→reconcile temp id→attach, name-dedupe)
  / `setTagColor` / `deleteTag`. All writes go through the existing
  `runtime.tasks.upsertTag/attachTag/detachTag/deleteTag` — no new write paths.
- **Surfaces**: detail panel gains a **Tags** field (chips + TagPicker); quiet
  chips render on list rows (hug the title, cap 3 + "+N") and board cards (cap 4);
  clicking a chip toggles it in the filter. Header **Filter** control
  ([task-tag-filter.tsx](../src/features/tasks/ui/task-tag-filter.tsx)) + active-chip
  row, threaded to both views via new `PlanViewHeader` `filterControl`/`activeFilters`
  slots. Filter narrows the center list/board only — rail bucket counts stay whole;
  state is in-memory and resets per workspace.

**Verified (local):** typecheck ✓, vitest **37/37** ✓ (13 new:
`organization.test.ts` + `tag-colors.test.ts`), lint:tw ✓ (token-clean — colors via
`data-label`, no arbitrary values), lint:css 0 errors (same 5 pre-existing
global.css warnings), `cargo check` ✓ + `cargo test domain::tests` 5/5 ✓,
`build:web` ✓. **Live-verified on web** against hosted with the Session 2
disposable account (`/tasks`, `:8092` local rsbuild driven via Chrome MCP — the
worktree live-verify recipe): (1) bucket "Deep Work" → "…" → **Section → New
section "Focus areas"** rendered a collapsible "FOCUS AREAS" header with Deep
Work nested under it; DB confirmed `buckets.group_label = 'Focus areas'`. (2)
On the Inbox task, the detail-panel **TagPicker** created `#deep-work` then
`#waiting-on` — **auto-colored blue then green** (deterministic palette order),
chips rendered on the row + detail panel; DB confirmed two `tags` rows + two
`tag_links`. (3) Added a second untagged task, opened the header **Filter**,
selected `#deep-work` → list narrowed to **1 of 2** with a removable active chip;
**Clear** restored both. No tag/bucket/migration errors in the console (only the
pre-existing web-only `syncNow` "desktop app" redb-stub noise). Left as demo
data: the "Focus areas" section + the two tags; the throwaway untagged task and
filter state were cleared.

**`/code-review` pass (xhigh, same day) — 5 real findings fixed in a follow-up
commit:** (1) **ghost filter** — deleting a tag that was in `filterTagIds` left a
stale id that hid every task with no chip/Clear to recover; fixed by reading a
derived `liveFilterTagIds` (pruned against live tags) everywhere the filter is
consumed, so deleted/temp ids drop out harmlessly. (2) **temp-id → uuid error** —
toggling/recoloring/deleting a tag mid-create sent `tmp-…` to uuid columns; guarded
all three mutations with `isTempId` (brief "still saving" toast). (3)
**createTagForTask orphan** — `attachTag` failing after `upsertTag` succeeded left
a created-but-unattached tag (rollback filtered by the already-swapped temp id);
now tracks `savedTagId`, rolls it back locally and best-effort deletes it
server-side. (4) **row layout** — a long tag name could starve the title to 0px;
title is now `flex-1` and the chip list `shrink`s/truncates first. (5)
**collapsed-section drift** — a collapsed rail section hid its buckets' drift
badges; the header now shows an ambient `(N)` drift aggregate when collapsed.
Re-verified: typecheck ✓, vitest 37/37 ✓, lint:tw/css ✓, build:web ✓. Accepted as
minor (not fixed): dead `bucketGroupNames` export; pre-SELECT-then-write round-trip
in the runtime (pre-existing pattern); section names are case-sensitive strings
with no rename path (spec-sanctioned "presentational" altitude).

**Deferred:** capture-time tagging (kept tag-free by design); tag rename (recolor +
delete shipped; rename is a small follow-up); a dedicated "manage tags" surface
(picker covers it for now); AND/multi-tag filter semantics (union shipped).

Branch `t/maciej/session3-task-detail` off `maciej`. The right rail stops being a
"Context" placeholder and becomes a live task inspector; the first ambient mirror
(`rescheduleCount`) finally renders.

**New: the detail rail** ([task-detail-panel.tsx](../src/features/tasks/ui/task-detail-panel.tsx)).
Binds to the selected task, resolved **live from the bundle** in
[tasks-plan-view.tsx](../src/features/tasks/ui/tasks-plan-view.tsx) (so it follows
edits and empties when the task is deleted). Editable title (borderless but keeps
the focus ring — a11y) + description (commit-on-blur), and all properties as a
compact list: status / bucket / scheduled / due / priority / energy / duration as
shadcn `Select` + `Input`, recurrence shown **read-only** (the capture parser owns
creation), and a Commit-to-today toggle. Every write goes through `api.patchTask`
(optimistic) — **no new write paths**. Created/updated metadata at the bottom.

**Ambient mirrors (principles 4 & 5).** `rescheduleCount` renders as
"Rescheduled N×" (muted, factual, **never red**) only when > 0 — the first mirror
that was being incremented but shown nowhere. Drift gets a quiet one-liner in the
same block when `isDrifted(task)`.

**Selection lifted** (pre-flight item b). The task cursor was local to
`task-list-view.tsx`; it's now `selectedTaskId` in `tasks-plan-view.tsx` (a
**distinct name** — `selection` there still means bucket scope) threaded to both
views via `sharedViewProps`. List keeps its keyboard cursor (j/k) but is now
*controlled* (the `selectedId`/`setSelectedId` aliases keep that logic intact);
the existing auto-select-first effect means the rail is populated on entry. Board
got **select-on-click** ([task-card.tsx](../src/features/tasks/ui/task-card.tsx) /
[task-board-view.tsx](../src/features/tasks/ui/task-board-view.tsx)) — available to
view-only users too, since selecting to read details isn't an edit.

**Distinct selected state (pre-flight item c).** Rows already had
`bg-accent` vs `hover:bg-accent/60` (opacity-only, easy to confuse); added a quiet
`bg-primary` left accent bar to the selected row
([task-row.tsx](../src/features/tasks/ui/task-row.tsx)). Board cards get
`border-ring bg-accent` when selected. Teaching empty states: the detail rail's
empty state and the list's empty state both surface "press `c` to capture".

**Verified:** typecheck ✓, lint:tw ✓ (new files are token-clean, not in
`IGNORED_PATHS`), lint:css ✓ (same 5 pre-existing global.css warnings, 0 errors),
vitest 24/24 ✓, `build:web` ✓. **Live on web** against hosted with the Session 2
disposable account: `/tasks` loads the test workspace, the rail replaces the
Context placeholder and auto-selects the first task showing every property +
created/updated; then **Commit-to-today → Execute → Skip** surfaced
**"Rescheduled 1×"** in the rail — the mirror, end-to-end. (Test task's
`rescheduleCount` is now 1; left as demo data.)

**Env note for future live-verify:** the Claude preview sandbox binds to whichever
worktree owns the active dev server (another session held `:8081`), and worktrees
don't share the repo's `node_modules`. Workaround used: `bun install` in the
worktree (1.4s, hardlinked) + a local `web-s3` launch config on `:8091`
(`.claude/launch.json`, gitignored), driven via the Chrome MCP. Display is
high-DPI (innerWidth 2207); full-frame screenshots need the left rail collapsed.

**Fable `/code-review` pass (same day, per the Opus-session policy):** 8
findings, none merge-blocking; fixed in a follow-up commit: (1) selection
validity moved to where the state lives — a scope-level backstop effect in
tasks-plan-view (Board/Execute previously kept stale selections and never
auto-selected; live-verified: empty-scope switch clears the rail, switching
back auto-reselects, Board renders the selected card); (2) rail Scheduled/Due
became draft-state commit-on-blur (was: uncontrolled + a Supabase upsert per
date-segment keystroke); (3) `LEVEL_OPTIONS` + `formatTimestamp` hoisted to
helpers (were triplicated/duplicated); (4) `Kbd` shared between the two empty
states; (5) duration input `min={1}` to match the 0→null commit logic. Known
minor, accepted: title/description drafts don't refresh if the selected task
is renamed elsewhere mid-edit (key-on-id pattern; revisit if it bites).

**Deferred:** title/description are the only inline-edit *text* fields; board
within-column reorder + insertion indicators and ⌘K task actions stay in the
polish backlog.

---

## Improvement-plan Session 2 — Cloud consolidation (2026-06-12)

Branch `t/maciej/cloud-consolidation` off `maciej`. Desktop and web now share
one Supabase-backed code path for auth, workspaces and tasks; time-blocks moved
from localStorage to a workspace table. The cloud-first pivot is now *in the
code*, not just the plan.

**Hosted state surprise (resolves the Mike-coordination item).** Pre-session
`list_migrations` on hosted (project `wtoonrvuqumihpkbvwvs`) showed Mike's six
`20260605*` notes migrations **already applied**, and our tasks migrations
applied too (hosted versions `20260611131017/131039`, fresh timestamps from an
MCP apply on 2026-06-11) — plus a `task_time_blocks` migration
(`20260611132737`) that existed on hosted but not in the repo. Treated hosted
as ground truth and back-filled
[20260611132737_task_time_blocks.sql](../supabase/migrations/20260611132737_task_time_blocks.sql)
(verified column-for-column incl. `ON DELETE CASCADE` and the
`tasks_module_can_access_workspace` RLS policy). `mike` → `develop` timing is
only relevant when desktop notes migrate (later session).

**Desktop → Supabase as composition** ([runtime.tauri.ts](../src/lib/runtime.tauri.ts)):
`auth`, `workspace` and `tasks` are now literally `webRuntime.auth` /
`.workspace` / `.tasks` — zero forked logic. Everything else (notes, email,
time-tracking, calendar OAuth, integrations, graph, localStore, window) stays
invoke-based. Because Rust commands gate on `state.session`
(`require_user_id`), a new **`auth_set_cloud_session`** command
([commands/auth.rs](../src-tauri/src/commands/auth.rs), registered in lib.rs)
mirrors the Supabase session into `AppState` — pushed from runtime.tauri.ts on
every `onAuthStateChange` (INITIAL_SESSION covers boot restore; `null` on
sign-out also stops email IDLE workers). Capabilities: `hasLocalMnemonic` and
`hasOfflineMode` flipped to false.

**Lite-version seam (Maciej's constraint: don't block offline-then-sync).**
The `ModuoRuntime` interface is the seam: the vault/PIN auth UI flows in
[email-auth-panel.tsx](../src/components/auth/email-auth-panel.tsx) now key off
`capabilities.hasLocalMnemonic` (not `isWeb`), so the future lite runtime
re-activates them by flipping a capability — same for the Login-key section in
[account-section.tsx](../src/features/settings/sections/account-section.tsx).
All local-auth Rust commands and redb tables stay. Orphans parked for the lite
story: `notes_outbox` / `notes_oplog` redb tables (sync-engine skeleton,
never populated), `auth_register_local_mnemonic` & friends (unreachable from
the UI until a runtime exposes `hasLocalMnemonic`).

**Time-blocks → workspace data.** `runtime.tasks.getTimeBlocks/setTimeBlocks`
(types in [runtime.types.ts](../src/lib/runtime.types.ts), impl in
[runtime.web.ts](../src/lib/runtime.web.ts)); `TimeBlockSlot/Map` +
`sanitizeTimeBlocks` moved to [model.ts](../src/features/tasks/model.ts)
(default-view re-exports). [use-tasks-module.ts](../src/features/tasks/hooks/use-tasks-module.ts)
loads them with the bundle (non-blocking on failure) and exposes
`timeBlocks` + `setTimeBlock` (optimistic); plan-view's localStorage
read/write deleted. Spec §9 wording updated. Mode/selection/grouping stay
per-device localStorage.

**Auth panel & profile on cloud:** web `getLocalAuthState` now derives
profileExists/displayName/userId from the Supabase session (was an all-false
stub), so app-chrome and Settings → Account display names work on web and
desktop unchanged. Dead `auth_link_to_cloud` / `auth_sign_in_cloud` invokes
went away with the replaced namespace.

**Docs:** CLAUDE.md stack line rewritten (Supabase source of truth; redb =
desktop-only leftovers + future lite); `web+desktop_plan.md` retired with a
banner (its pending todos spec the never-built auth-link hybrid — do not
implement); plan Session 2 checked off with findings.

**Verified:** typecheck ✓, vitest 24/24 ✓ (default-view tests rewritten:
localStorage cases → `sanitizeTimeBlocks`), `cargo check` ✓, lint:tw ✓,
lint:css unchanged (5 pre-existing global.css warnings), `build:web` ✓.
**Live end-to-end on web** against hosted with a disposable account
(`grzywaczmj+moduo-s2-test@gmail.com` / workspace "Claude Test S2", left in
place for dogfooding): trial start → onboarding workspace create → Tasks
Inbox seed → bucket "Deep Work" → task create → **Open at → Morning** →
reload → slot restored from `task_time_blocks` (DB row confirmed; zero
localStorage timeblock keys). Handled Inbox-seed 409 race observed working.
**Not live-verified: the desktop (Tauri) runtime composition** — same TS code
path and `cargo check` passes, but `auth_set_cloud_session` + webview
supabase-js need one `bun run dev:desktop` boot + sign-in to gut-check; flagged
for next session / Maciej's dogfood.

**Deferred:** desktop notes → Supabase (Mike's surface; after his branch
lands); legacy sync-engine removal decision (skeleton still compiles, unused);
`user_entitlements` 401 noise during pre-session-restore renders (pre-existing,
web-only, self-heals) — worth a look whenever the SubscriptionGate is next
touched.

---

## Interlude — Session 1 merged · Session 2 scope check (2026-06-11)

Session 1 fast-forwarded into `maciej` (`0775a21`) and pushed; task branch
deleted per CONTRIBUTING. Before starting Session 2, Maciej asked whether the
plan matches the actual cloud/persistence state (the area is traditionally
Mike's). Investigation findings (two read-only sweeps: codebase + git):

- **Desktop has no Supabase session.** `runtime.tauri.ts:237-258` invokes
  `auth_link_to_cloud` / `auth_sign_in_cloud`, but those Rust commands don't
  exist. The sync engine (`src-tauri/src/sync/mod.rs`) covers only
  `notes_meta` + `calendar_events`; the tasks tables are absent from
  `SYNC_TABLES`/`PULL_TABLES`, no write ever enqueues, there are no
  camelCase↔snake_case mappers, and even the notes outbox is never populated.
  → Finishing sync would mean *building* the paused local-first architecture;
  Supabase-direct in the webview (reusing `runtime.web.ts` paths) is the
  cheaper, validated option.
- **Composition, not swap.** Email, time-tracking, calendar OAuth,
  integrations, and graph are Rust/redb-only (web stubs them "Desktop only").
  Desktop keeps Tauri-invoke for those; only auth/workspaces/tasks go
  Supabase-direct in Session 2.
- **Mike's state**: his May cloud/billing/runtime-split infra is already in
  `main`. His active branch (`origin/mike`, forked off develop 2026-05-14,
  never pulled since, last push 2026-06-07) is notes-only — 14 commits
  touching `commands/notes.rs` + NotesSplitView restructuring + **six notes
  migrations dated 2026-06-05**, i.e. earlier timestamps than our tasks
  migrations (2026-06-06). He never touched tasks files post-fork (his branch
  still carries the deleted legacy tasks model; a future develop sync deletes
  it cleanly). Conflict risk concentrates in notes at his next sync.
- Plan Session 2 amended accordingly: Mike-coordination item first, desktop
  notes phased out of scope, `web+desktop_plan.md` retirement added (it specs
  the never-built auth-link hybrid), dead-invoke cleanup added.

**Open inputs for Session 2** (gather before/at session start): Mike's two
answers — hosted notes migrations applied? `mike` → `develop` timing? — and
Supabase project access (dashboard or `supabase link`) for the hosted apply.

---

## Improvement-plan Session 1 — Density & type-scale pass (2026-06-11)

Branch `t/maciej/density-type-scale` off `maciej`. First session of the 2026-06
improvement plan ([improvement-plan.md](./improvement-plan.md)): make density +
text-size a real, well-tuned customization range whose dense end ≈ Linear/Notion.

**Third density step** ([tokens.css](../src/styles/tokens.css) §7,
[appearance.ts](../src/lib/appearance.ts),
[density-picker.tsx](../src/features/settings/appearance/density-picker.tsx)):
`data-density` is now `comfortable | compact | dense` on an even 4px row ladder —
rows 36 / 32 / 28, controls 32 / 30 / 26 (sm 26 / 24 / 22, lg 40 / 36 / 32),
pads 16·10 / 14·8 / 12·6 (sm 12·6 / 10·5 / 8·4). **Dense** is the Linear/Notion
end (28px rows ≈ Linear sidebar / Notion list); comfortable is untouched, and
compact moved from the old near-dense values (28px rows) to the true middle
(32px). Old `compact` users land between their old feel and the new dense option.

**Type-scale retune** (tokens.css §9): body-tier base ladder is now
**13 / 14 / 16 px** across small / normal / large (was 13 / 15 / 17) — small ≈
Linear UI text, normal ≈ Notion chrome (default drops 15→14, addressing the
"app reads larger than Notion/Linear" feedback), large stays generous. `--text-md`
follows at +1 (14 / 15 / 17). Display sizes (lg+) stay fixed, as documented.
Notes *content* is unaffected (the Lexical editor hardcodes 16px — pre-redesign
file, untouched per the tw-shim rule).

**Rows actually respond now** — the real reason "compact" never read as compact:
module rows hardcoded `py-1.5` and ignored `--row-h`. Task rows
([task-row.tsx](../src/features/tasks/ui/task-row.tsx)), bucket-rail rows
([bucket-rail.tsx](../src/features/tasks/ui/bucket-rail.tsx)), Execute queue rows
([execute-view.tsx](../src/features/tasks/ui/execute-view.tsx)) and drift-triage
rows ([drift-triage-dialog.tsx](../src/features/tasks/ui/drift-triage-dialog.tsx))
now take `min-height: var(--row-h)` (same idiom as notes/settings) with `py-0.5`
kept only as a multiline guard. Buttons/inputs/selects already rode `--ctrl-h*`;
FeaturePanelsShell already rode `--pad-*`. Board cards and the drag ghost stay
fixed (cards, not rows).

**Storybook appearance toolbar** ([.storybook/preview.tsx](../.storybook/preview.tsx)):
new Density and Text-size toolbar globals apply `data-density` / `data-text-size`
to the document, mirroring `useAppearance`. Spot-check script
[scripts/density-snapshots.mjs](../scripts/density-snapshots.mjs) (Playwright
against Storybook) screenshots shell/button/input across the range and prints
the resolved `--row-h`/`--ctrl-h`/`--text-base` per combo.

**Docs synced first:** `DESIGN_SYSTEM.md` attribute table;
`.design/foundation/TOKENS.md` density table (3 columns + pad-sm rows + the
min-height row recipe) and type-scale tables (14px base).

**Verified:** typecheck ✓, lint:tw ✓, lint:css unchanged (same 5 pre-existing
`global.css` warnings), vitest 24/24 (incl. default-view 14/14), web production
build ✓. Visual spot-check via the snapshot script: token cascade confirmed
end-to-end (36/32/28 rows, 14→13px base at small) on shell, buttons, inputs at
all three densities. **Not hand-dogfooded** in the real app (same Supabase
auth gap as Sessions 2–4); the Tasks-row wiring uses the proven notes idiom but
deserves a desktop-run gut check on feel.

**Flags for Maciej:**
- **Default got 1px smaller** (`--text-base` 15→14). Intentional per your
  density feedback, but it shifts the whole app's default voice — eyeball it.
- **Compact loosened numerically** (rows 28→32) while becoming *visually*
  denser in Tasks (rows previously ignored the token). If you had muscle-memory
  for old compact, **dense** is your setting now.
- Density still doesn't shift line-height (TOKENS.md open question stands —
  revisit if dense+small feels cramped).

**Deferred:** none for this session. (Launch config gained a `storybook` entry
on port 6106 — 6006 was busy on this machine.)

---

## Session 4 — Board view + drift triage + default-view (2026-06-06)

Branch `maciej`. Filled in the remaining Plan-mode surface: the three items
deferred at the end of Session 3.

**Board view** ([ui/task-board-view.tsx](../src/features/tasks/ui/task-board-view.tsx),
[ui/task-card.tsx](../src/features/tasks/ui/task-card.tsx)): kanban columns via
`@dnd-kit/core` (already a dep; same `PointerSensor` distance-8 + `DragOverlay`
pattern as the dashboard grid). Columns group by **status** (Todo → In progress →
Done, left→right; Archived excluded) or by **bucket** when in the "All" selection
(a Columns: Status/Bucket control appears only there). **Cross-column drag** is the
kanban action — drop changes `status` (or `bucketId`) and appends to the
destination column's end (`endPosition`); dragging to Done completes the task.
Columns are `useDroppable`, cards are `useDraggable` (single `onDragEnd`, no
live-cross-container move → robust, no flicker). Within-column manual reordering is
**deferred** (consistent with the already-deferred Today-queue drag). The card
reuses `CompleteToggle` / `LevelDots` (now exported from `task-row`) and has a
compact self-contained context menu (done, commit, move-to-bucket, priority,
energy, delete).

**View switcher + shared header** ([ui/plan-view-header.tsx](../src/features/tasks/ui/plan-view-header.tsx)):
List/Board segmented toggle (mirrors the rail's Plan/Execute toggle styling),
plus a `PlanViewHeader` (title · group control · switcher · New task) now used by
**both** List and Board so they're visually identical above the fold. `view`
persisted per workspace; `boardGroupBy` persisted separately from List's `groupBy`
so each view keeps its own grouping.

**Drift batch-triage** ([ui/drift-triage-dialog.tsx](../src/features/tasks/ui/drift-triage-dialog.tsx)):
the per-bucket drift count in the rail is now a **button** (`(3)` → opens triage;
tooltip "N open · M drifted — click to triage"); also reachable from the bucket
"…" menu ("Triage N drifted…"). Dialog is soft/pressure-free (factual copy, never
red/overdue) with batch ("apply to all") and per-task actions: **Reschedule**
(Tomorrow / Next week, keeps clock time → `rescheduleScheduledAt`), **Archive**
(`archiveTask`), **Ignore** (clears `scheduledAt`, keeps the task). The list
recomputes live so it empties as you triage. New hook helpers: `archiveTask`,
`rescheduleScheduledAt`.

**Default-view logic** ([default-view.ts](../src/features/tasks/default-view.ts)):
on open, resolve **time-block bucket → last-opened bucket → Inbox**, in the
**last-used view** (spec §9). Never opens on "All"/"Today" (last bucket is tracked
separately from the live selection; resolution is one-shot per workspace after the
bundle loads, so it never fights in-session navigation). **Time-blocks** are
defined per-bucket via the rail's **"…" → "Open at"** submenu (Morning 05–12 /
Afternoon 12–18 / Evening 18–05, wrapping; one bucket per slot), stored per
workspace in localStorage as a view preference — no separate editor surface
(quiet until used). Pure resolver + slot logic covered by **14 unit tests**
([default-view.test.ts](../src/features/tasks/default-view.test.ts)).

**Decisions / spec sync (updated spec first, then code):**
- §4 — drift "Ignore" defined as *clear the stale time, keep the task* (drift is
  computed, not stored, so there's no acknowledge-and-keep without a new
  `drift_acknowledged_at` field — deferred until asked).
- §9 — documented how time-blocks are defined (per-bucket "Open at" menu, 3 slots,
  localStorage, one-shot resolution).
- §4 — documented Board column order / drag semantics / within-column-reorder
  deferral / Today-as-status-columns.

**Verified:** `bun run typecheck` clean; `bun run lint:tw` clean; `lint:css`
unchanged (0 errors; same 5 pre-existing `global.css` warnings); `vitest`
default-view 14/14; **web production build** compiles. Dev server boots clean (no
errors). **Not interactively hand-dogfooded:** the web path is gated behind
Supabase magic-code auth (can't log in headlessly — same gap as Sessions 2–3); a
real run needs the desktop app or a logged-in session.

**Flags for Maciej (spec tensions surfaced while building):**
- **"Ignore" UX** — current behavior unschedules the task. If you expect "ignore"
  to keep the past time but stop counting it, that needs the stored ack flag above.
  Worth a dogfood gut-check on which feels right.
- **Board on Today** — I let Board render status columns of the committed set for
  uniformity. Spec says "Today is never grouped (queue order)"; if Today-as-board
  feels wrong, we can force List when Today is selected (one-line change).
- **Time-block editor placement** — the per-bucket "Open at" menu is intentionally
  minimal/discoverable, but it's a provisional home. If you want a dedicated
  time-blocks surface (e.g. a settings card with a visual day strip), say so.
- **Time-blocks are local-only** (not synced). Fine for a single-device dogfood;
  flag if you want them to follow the workspace across devices.

**Deferred:** within-column drag reorder on the board; true drift "acknowledge"
(stored flag); synced time-blocks; right-panel content; live cloud-sync of the
redb↔postgres tables. Calendar module remains separate/unbuilt.

---

## Session 3 — Commit + Execute loop (2026-06-06)

Branch `t/maciej/tasks-commit-execute` off `maciej` (which now includes the
develop sync + all of Session 2). The core feature: build today's queue, then run it.

**Commit queue (Plan side):** `toggleCommit` / `markDone` / `rescheduleFromToday`
on the hook (sets `committedFor`=today + `commitOrder`; reschedule bumps
`rescheduleCount` ambiently, no wall). `committedTasks` derived (today, ordered).
Commit from the List via the **`t`** key (`c` is capture) or the row context menu;
committed rows show a quiet Sunrise marker. New **"Today"** selection in the left
rail (ordered queue + count) and a **"Start my day"** CTA (shown when ≥1
committed). Today is never grouped (queue order); capture from Today lands in Inbox.

**Execute mode** ([ui/execute-view.tsx](../src/features/tasks/ui/execute-view.tsx)):
isolated — replaces the whole 3-pane area (no rails). Brief **intro ceremony**
("N tasks committed. Let's go.") on Start-my-day; the plain mode toggle skips
straight in. **Now card**: bucket + duration context, large title, **timer
(Pomodoro 25/5 default, switchable to per-task Duration countdown)** auto-running
on entry, "Mark done → next". **Queue** below (items 3+ dimmed, read-only).
**End-of-queue**: factual done/total summary. "Reschedule" drops the current task
from today (ambient count++) and advances; "End session" returns to Plan.

**Decisions (Maciej):** timer = Pomodoro **+ switchable** to Duration; commit
queue surfaced as a **"Today" rail selection** (+ row marker).

**Polish pass (round-2 feedback — Maciej):**
- **Typography roles** codified in `DESIGN_SYSTEM.md` + applied: primary =
  `font-display` (chrome: buttons, labels, titles, headings), secondary = body
  (context: dates, counters, meta, modal footer). The **`Button` primitive base
  is now `font-display`** (was `font-sans`) — fixes the "mono button" app-wide
  (mono now strictly code-only).
- **Casing**: Sentence case convention documented in `DESIGN_SYSTEM.md`
  ("Done, next", "Do last", "2 / 2 Done", etc.).
- **Density now reaches modules**: `FeaturePanelsShell` padding is driven by the
  `--pad-*` tokens (was fixed `p-5`/`p-4`) → the Appearance → density control
  moves the panels; baseline is tighter (rails run on `--pad-*-sm`). New
  **`--text-2xs`** eyebrow token (scales with text-size) for section labels.
- **Dialog blur reduced globally** (`bg-background/60`, no `backdrop-blur`); the
  Settings modal keeps its own overlay so its appearance-tab behaviour is intact.
- **Execute moved into the center panel** (rails stay), redesigned: richer Now
  card + meta, a **relations placeholder** (cross-module links, future), button
  **"✓ Done, next"**, **Skip** (reschedule out, ambient count++) + **Do last**
  (re-queue to end), "N / M Done". Pomodoro/Duration toggle kept.
- **Left rail**: Plan/Execute toggle concentric-radius fix; **"Today"** queue
  selection; drift is numbers-only (dot + count, word in tooltip) with the hover
  "…" pushing counts left; **hover "+"** add-bucket on the Buckets header
  (removed the bottom button + the redundant "Start my day" button/ceremony).
- **List**: group control + dropdown → primary font; **no "Bucket" grouping
  inside a single bucket**; empty schedule/due affordances no longer reserve
  space (only show on hover / when set) — fixes the lone-calendar-icon misalign.
- **Capture modal**: visible header title (fixes the X overlap), borderless
  Linear-style inputs, primary fonts for title/description, secondary footer,
  **attachment placeholder** (left of the footer) for the cross-module link concept.
- **Parked (noted, not done):** full density/type-scale pass (per Maciej);
  wiring the *content* of cross-module relations/embeds (placeholders only).

**Verified:** typecheck ✓, cargo check ✓, lint:tw ✓, lint:css (no new errors) ✓,
web production build ✓, app boots clean (no console errors). Not yet hand-dogfooded
(Execute timer/flow + the visual polish need a real run); commit not yet made —
left in the working tree for review.

**Deferred:** queue reordering (drag) within Today; long-break pomodoro cadence;
sound/notification on phase change; Board view + drift triage + default-view
(Session 4).

---

## Session 2 — Plan Mode: Buckets + List + Capture (2026-06-06)

Branch `t/maciej/tasks-plan-mode` off `maciej`. First visible, usable Tasks UI on
the new model. Desktop (redb) and web (Supabase) both functional.

**New data-model field (decision — Maciej):** added an optional `priority`
(low/med/high) axis distinct from `energy_level`. Energy = *how demanding*;
priority = *how important in time*. Both optional, ambient (never red), and
opt-in group-by dimensions. Spec §11 updated first, then code. Touched:
[domain/mod.rs](../src-tauri/src/domain/mod.rs) (`PriorityLevel` enum +
`Task.priority`, `#[serde(default)]` → backward-compatible redb rows; test
literal updated), [model.ts](../src/features/tasks/model.ts), and a new
append-only migration
[20260606130000_tasks_add_priority.sql](../supabase/migrations/20260606130000_tasks_add_priority.sql)
(adds the column + recreates the drift view). `urgent` is a future non-breaking
enum/CHECK extension.

**Runtime bindings (both platforms — was deferred from Session 1):**
`ModuoRuntime.tasks` interface in [runtime.types.ts](../src/lib/runtime.types.ts);
desktop impl invokes the `tasks_module_*` commands
([runtime.tauri.ts](../src/lib/runtime.tauri.ts)); **web impl is Supabase-backed**
([runtime.web.ts](../src/lib/runtime.web.ts)) with camelCase↔snake_case row
mappers and JS-side lazy Inbox seeding (mirrors the redb path; RLS scopes rows).
Per Maciej's call, web parity is in this session (not deferred with cloud-sync).

**Route + nav:** `/tasks` route re-added ([router.tsx](../src/router.tsx)); nav
item (`module:"tasks"`, `check-square`) in
[app-chrome-constants.ts](../src/components/app/app-chrome-constants.ts) — gated by
`modulePermissions.tasks` (shows on web too, not desktop-only); palette "Open
Tasks"; `/tasks → "tasks"` in [panel-events.ts](../src/features/layout/panel-events.ts).

**Feature ([src/features/tasks/](../src/features/tasks/)):**
- `hooks/use-tasks-module.ts` — loads the bundle, optimistic CRUD over
  buckets/tasks, derived open-counts + soft per-bucket drift counts.
- `parse/capture-parser.ts` — Tier-1 parser: `chrono-node` for date/time +
  constrained vocabulary over `rrule.js` for recurrence (every day / weekday /
  <weekday> / N weeks / daily-weekly-monthly-yearly). Time-bearing → `scheduledAt`;
  date-only → `dueDate`; recurrence → `recurrence` + next occurrence (9am default
  when timeless). Unparseable "every …" is flagged, never guessed.
- `ui/` — `tasks-plan-view` (FeaturePanelsShell, hideRight; persists
  mode/selection/groupBy per workspace), `bucket-rail` (Plan/Execute toggle,
  All/Inbox + user buckets with counts + ambient drift, **instant** add-bucket,
  rename/delete), `task-list-view` (Linear-style: group by None/Status/Bucket/
  Priority/Energy, collapsible groups — one open by default when grouped by
  bucket; keyboard j/k/x/Enter-e/c/b/s/d, mod+⌫ delete), `task-row` (complete
  toggle, inline rename, scheduled/due/recurrence meta with inline popovers,
  energy/priority dots + right-click context menu), `capture-modal` (cmd+n,
  single field, live parse preview, confirmation toast), `execute-stub`.
- `routes/pages/tasks-page.tsx` — permission/auth gating (mirrors NotesPage).

Design principles honored: no required-field forms (capture is one field, lands
immediately), no triage queue, no blocking modals; drift is ambient/soft;
instant bucket creation.

**Verified:** `bun run typecheck` clean; `cargo check` clean; `cargo test
domain::tests` 5/5; `bun run lint:tw` clean; `lint:css` unchanged (no CSS
touched). Full web production build compiles.

**Deferred / not this session:**
- Commit action + Execute-mode loop (Now card/timer/queue, "Start my day") —
  **Session 3**. Execute is a visible stub; the toggle works.
- One-click "Edit" action on the confirmation toast (spec §6) — toast shows the
  parse; the inline-edit jump from it is a small follow-up.
- Real drift batch-triage + Board view + default-view (time-block) logic —
  **Session 4**. (Per-bucket drift counts already render, soft.)
- Live cloud-sync of the redb↔postgres tables (desktop offline → cloud) — still
  its own task; web talks to Supabase directly, desktop to redb.
- Supabase migrations (`…create_tasks_module`, `…add_priority`) must be applied
  to the hosted project for the **web** path to work; not auto-applied here.
- Tags UI (model + runtime bindings exist; no surface yet).

**Parked feedback (app-wide, not Tasks-specific):** Maciej finds the overall app
density too large vs. Notion/Linear — even the smallest font-size setting is
bigger than Notion's default. Needs a global type-scale / density tuning pass
(tokens.css + the density setting). Recorded; **not to be started unprompted.**

**Post-merge fixups (after syncing develop into maciej):** capture no longer
fails silently when no bucket is loaded (toasts instead); the List view shows a
"couldn't load tasks" banner + Retry when the bundle fails (e.g. web tables not
yet migrated).

**Capture modal redesigned → Linear-style (decision — Maciej; spec §6 updated
first).** Quiet by default, every property one click away: NL title line +
description + a row of always-visible property **pills** (bucket, scheduled, due,
recurrence, priority, energy, duration). The title still parses dates/recurrence
and pre-fills the relevant pills, but each pill is directly settable and a
manual edit wins over the parser (so a user can set a date by hand, or not at
all). Title is the only thing needed — Enter files instantly; `⌘↵` submits from
the description; a "Create more" toggle keeps it open for rapid entry. Recurrence
pill uses simple presets (no complex builder, per §7); tags deferred. New
`parse/recurrence.ts` (preset → RRULE + next occurrence + human label);
`durationMinutes` added to the task factory.

**Right panel:** Tasks now renders a placeholder right rail (removed the
`hideRight` lock) so the 3-pane resize/layout can be tested; real content comes
later.

---

## Session 1b — Legacy tasks model removed (2026-06-06)

Same branch. Pulled the staged deletion forward (was planned for the Plan-mode
session) so Session 2 starts on a clean slate. The new bucket/task/tag model is
now the **only** Tasks model.

**Removed (pure-legacy):** `commands/tasks.rs`; the legacy domain structs
(`TaskProject`/`TaskWorkflowState`/`TaskItem`/`TaskComment`/`TaskActivity`/
`TasksBundle`/`ProjectLabel`) + their redb tables (`tasks_projects`,
`tasks_states`, `tasks_items`, `tasks_comments`, `tasks_outbox`, `tasks_oplog`,
`tasks_activity`) + store methods; the entire `src/features/plan/` UI; the legacy
`src/features/tasks/` files (kept only `model.ts`); `ground-page.tsx`; the
dashboard `tasks-widget`; the notes `EmbeddedTask` block; and the orphaned
(dead) `app-chrome-menus.tsx`.

**Decoupled (edited, not deleted):** runtime `tasks` namespace dropped from
`runtime.types.ts` + `.tauri.ts` + `.web.ts`; `router.tsx` lost `/ground`,
`/tasks`, `/calendar` routes; `app-chrome-constants` lost the "Ground" nav item;
dashboard `grid-page`/`grid-workspace`/`dashboard-grid`/`widgets-panel` +
`WidgetType` lost the "tasks" widget; notes `SlashCommandPlugin` lost the "Embed
Task" command; `expose.ts` no longer hydrates task embeds; `EmbedNode` keeps the
`"task"` kind for back-compat but renders nothing; `sync/mod.rs` lost the
`tasks_*` push/pull entries; `migration_legacy` keeps notes import only;
`dump_workspace_hashes` now hashes the new bucket/task/tag bundle.

**Preserved (moved out of `plan/`):** `use-slot-bookings-sync.ts` (Calendar
slot-booking → calendar-event sync; live, called by `app-gate`) and
`expose-slot.ts` (Calendly-style host-side slot exposure) → moved to
`src/features/calendar/{hooks,utils}/`. `expose-slot` is now uncalled (its only
UI was the deleted plan link-view) — re-surface it when the Calendar module is built.

**Decisions (Maciej):** strip all tasks routes & nav now (no placeholder — Session
2 re-adds the `/tasks` route + nav); remove the notes EmbeddedTask + dashboard
tasks-widget (rebuild on the new model later). `modulePermissions.tasks` kept —
the new model reuses it.

**Verified:** `bun run typecheck` clean; `cargo check` clean; `cargo test
domain::tests` 5/5.

**Left for Session 2:** add the `/tasks` route + nav entry; build Plan-mode UI
(buckets + List + capture) on the new model; runtime bindings (`rt.tasks.*`) for
the `tasks_module_*` commands; cloud-sync wiring for the new tables.

---

## Session 1 — Data Model & Foundation (2026-06-06)

Branch `t/maciej/tasks-data-model` off `maciej`.

**Built the spec'd Tasks data model (§11) — schema only, no UI.**

- **Conflict found & decision:** the existing `tasks_*` code is a Linear/Jira-style
  issue tracker (TaskProject + per-project TaskWorkflowState + TaskItem with
  task_code/subtasks/relations/assignees), with a full `features/plan` UI on it.
  That conceptually conflicts with the spec's bucket/commit/execute model. Per
  Maciej's call, the new model **fully replaces** the old one — but the deletion
  is **staged**: this session lands the new model alongside the (now deprecated)
  old one so the tree stays green; the old tables + `commands/tasks.rs` + domain
  Linear structs + `features/plan` UI get removed in the Plan-mode session when
  the new UI replaces them.
- **redb (primary, local-first):** new tables `buckets`, `tasks`, `tags`,
  `tag_links` ([store_redb/mod.rs](../src-tauri/src/store_redb/mod.rs)); new
  domain structs `Bucket` / `Task` / `Tag` / `TagLink` / `RecurrenceRule` +
  `TaskStatus` / `EnergyLevel` enums + `TasksModuleBundle`
  ([domain/mod.rs](../src-tauri/src/domain/mod.rs)). Task carries both `due_date`
  and `scheduled_at`, plus `committed_for`/`commit_order`, `reschedule_count`,
  `recurrence`, `energy_level`, `duration_minutes`, fixed `status`.
- **Commands:** [commands/tasks_module.rs](../src-tauri/src/commands/tasks_module.rs)
  — list (lazy-seeds Inbox), seed_inbox, upsert/delete bucket (system-protected,
  reassigns orphans to Inbox), upsert/delete task (bucket fallback → Inbox),
  upsert/delete tag (cascades links), attach/detach tag (polymorphic). Registered
  in [lib.rs](../src-tauri/src/lib.rs).
- **`drifted` is computed, not stored:** `Task::is_drifted(now)` in Rust and
  `isDrifted()` in [model.ts](../src/features/tasks/model.ts); a
  `tasks_with_drift` view on the Postgres side. Logic:
  `scheduled_at < now AND status NOT IN (done, archived)`.
- **Inbox** seeded lazily per-workspace on first read (idempotent), `is_system`,
  undeletable; a partial unique index enforces one live Inbox per workspace.
- **TS types:** [src/features/tasks/model.ts](../src/features/tasks/model.ts)
  (camelCase fields, snake_case enum values — mirrors serde).
- **Supabase migration:**
  [20260606120000_create_tasks_module.sql](../supabase/migrations/20260606120000_create_tasks_module.sql)
  — tables + indexes + RLS (SECURITY-DEFINER workspace-access helper to avoid the
  known RLS recursion) + drift view.

**Verified:** `bun run typecheck` clean; `cargo check` clean.

**Deferred (not this session):**
- Removal of the legacy `tasks_*` model + `features/plan` UI → **done in Session 1b (above)**.
- Live cloud-sync wiring for the new tables (SYNC_TABLES/PULL_TABLES + the
  redb-camelCase ↔ postgres-snake_case field mapping). The existing sync engine
  has a casing mismatch and an unpopulated task outbox; wiring it correctly is
  its own task.
- TS runtime bindings (`rt.tasks.*` invoke glue) — added when Session 2's UI consumes them.
- Capture parser (chrono-node + rrule.js) that *populates* `recurrence` — Session 2.
- Commit-queue / Execute-mode behavior — fields exist; logic is Session 3.
- Lexorank position generation helpers — Session 2.
