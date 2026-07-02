# Spec: Calendar (Wave 2) — the schedule-to-completion loop

> Status: **Ready** · Owner: maciej · Related briefs: [.design/calendar/BRIEF.md](../.design/calendar/BRIEF.md) (product), [.design/calendar/DESIGN_BRIEF.md](../.design/calendar/DESIGN_BRIEF.md) (the build spec — **authoritative for all UX detail below**), [.design/calendar/COMPETITIVE_RESEARCH.md](../.design/calendar/COMPETITIVE_RESEARCH.md) (the Morgen bar).

## Scope

The Wave 2 flagship: a time-blocking calendar sharing one data model with Tasks, whose plan **self-corrects** — complete work inside a block, triage elapsed blocks with one click, roll unfinished work forward in one gesture. v1 = **the loop + manual scheduling + read-only external events** (Google/Outlook mirrored to Supabase so web sees them too). The user's bar: at least Morgen's planning surface (research Tier A) plus the execution loop no incumbent ships. Reflow, rituals, and external write-back are v2 (DESIGN_BRIEF §11).

## Product behavior & UX

DESIGN_BRIEF §2–§10 is the behavioral spec (concept model, three-pane anatomy, grid interactions, right-panel switcher, the loop, creation/repeats, connectivity, states, persistence). Summary of the load-bearing behaviors:

- Two chip kinds on the grid: **events** (native writable; external read-only, attributed) and **task blocks** (the task row itself, rendered via `scheduledAt`+`durationMinutes` — the lens model; checkbox completes in place).
- **Week (default) + Day** views, remember-last-used; left rail = mini-month + calendar list; right panel = **switchable** (Tasks | Detail — the app-wide switcher principle's first adopter).
- Draw-to-create native events (+ presets/NL-custom repeats with a plain-English echo); drag/resize to move; drag tasks in from the right panel.
- **The loop:** elapsed task blocks grow a quiet 4-action row (Done · Later today · Took longer · Remove); the strip above the grid offers **Move to today** (auto-place all, one Undo) and **Review** (curate then move); focus timer on a block accrues actual time to the task.
- Everything optimistic and sub-200ms perceived; never red, never a modal, never a notification.

## Edge cases

- **Elapsed block, no fitting gap today** → "Later today" lands it in the strip with explicit copy, never silently drops it; strip's Move-to-today reports "N moved · M didn't fit."
- **Empty draw / empty title** → ghost discards; no untitled events.
- **Completing a recurring task from a block** → the pointer advances (existing engine); the block shows done for that occurrence's day.
- **Two chips (or many) overlapping** → cluster layout, "+N" overflow popover; drop-target logic still picks the pointed slot.
- **External chip drag/resize/edit attempts** → resisted with a read-only tooltip; no write path exists (structural).
- **DST / timezone**: chips render in the viewer's local zone from stored instants (timestamptz); the 23h/25h DST day renders correctly (gap-finder operates on real instants, not hour indices).
- **`due_date`/day comparisons** normalize to local calendar dates first (the CO-5 timestamptz gotcha).
- **View-only member** → grid visible, every mutation affordance disabled with tooltip; popovers/panels read-only.
- **Deploy gap** (calendar migration not applied) → all `calendar_*` reads degrade to empty; the page still works as a task-lens calendar (rides shipped Tasks reads/ops).
- **Sync staleness / account error** → chips persist from the last mirror; toolbar timestamp ages honestly; account row shows Reconnect.
- **Removing an account** → its mirrored events tombstone (registry cascade cleans spine links).
- **Tab asleep at elapse time** → the 30s tick catches up on wake; chips appear then (no missed-forever state).
- **Concurrent edit** (partner moved the same native event) → last-write-wins + reconcile on refetch; optimistic rollback toast if the op rejects.
- **NL recurrence un-parseable** → inline "couldn't read that" + presets remain; nothing saves without a correct echo.

## Acceptance criteria

- **AC1 — Page & views.** `/calendar` opens the rebuilt page (three panes; legacy exploratory page fully replaced). Week view default on first run; Day/Week switch (`D`/`W`), `T`/`←`/`→` navigation; last-used view + date restored per user/workspace. 7-day week honoring week-start + show-weekends settings; mini-month navigates; all-day lane; now-line in today's column.
- **AC2 — The lens.** Any open task with `scheduledAt` in the visible range renders as a task block (duration = `durationMinutes` or 30m), visually distinct from events; the same task edited in Tasks moves on the calendar (one row, no copy); done tasks render checked/dimmed on their day. No double-render anywhere.
- **AC3 — Create.** Click-drag on empty grid → ghost + inline title + quick popover (time, all-day, calendar, repeat); Enter saves a native event visible to other workspace members after reconcile; empty title discards; the event registers into `entities` and logs creation-free activity per the module contract (creation = the row itself).
- **AC4 — Edit native events.** Drag moves, edges resize, popover/Detail edits title/times; delete confirms (repeats: series language) and tombstones (registry cascade); every mutation is an attributed `calendar_op_*` writing `module_activity`; the Detail panel renders links (EntityHub) + the activity trail.
- **AC5 — Repeats.** Presets daily/weekdays/weekly/monthly + Custom NL: the pinned phrase set (incl. "every tuesday and thursday at 9") parses to a correct rule with a live plain-English echo; un-parseable input shows the polite fallback and saves nothing; recurring native events expand into every visible range; v1 edits apply to the series and say so.
- **AC6 — Drag-to-schedule.** A task dragged from the right panel onto a slot gets `scheduledAt` (+ default duration), optimistic <200ms, appears as a block, its row shows the scheduled affordance; drag/resize on the block updates the task's schedule/duration; the drop rides the universal drag contract (a task drag payload accepted by the grid target).
- **AC7 — Complete in block.** The block checkbox completes the task via `tasks.set_status` (recurrence pointer advances); the block flips to done in place; uncheck reopens. Identical result to completing in Tasks.
- **AC8 — Elapsed triage.** When a task block's end passes (task open), the block shows Done · Later today · Took longer · Remove — no toast/badge/sound. Later-today moves to the next fitting gap after now within working bounds (skipping events/blocks), inline "→ HH:MM" + Undo, or strips with the no-room copy; Took-longer logs the planned span to the task's actual time, closes the block as "worked," task stays open, no remainder object; Remove unschedules, task survives; every action attributed in activity.
- **AC9 — The strip.** Lists open tasks whose scheduled time passed within today + 7 days ("N unfinished from earlier"), only when non-empty. **Move to today** places all into remaining gaps in original order, one Undo reverses all placements, non-fitting items remain with honest copy. **Review** opens the right-panel list (untick to exclude · "Move N to today" · rows draggable · per-row Remove). Older-than-window items drop off the strip silently; the tasks survive in Tasks.
- **AC10 — Focus timer.** Start focus on a current/elapsed task block → the block shows the live treatment + elapsed readout; time accrues to the task via the existing accumulation path (periodic flush); stop reports "Xm logged"; starting a second session quietly stops the first.
- **AC11 — Right-panel switcher.** The panel header switches Tasks | Detail (the typed per-module variant registry); Tasks view = Today / Due soon / Backlog groups + search, rows draggable, checkbox completes, scheduled rows show their time; opening a chip enters Detail (task blocks reuse the existing task detail panel; events get the event detail with links + activity); back returns to Tasks; last variant persists.
- **AC12 — External read-only.** A Google/Outlook account connected on desktop mirrors event metadata to Supabase; those events render on **web and desktop** with source attribution (color + named source in popover/Detail), are structurally read-only, register into `entities` (linkable to contacts/notes/tasks), and disappear when the account is removed. The toolbar shows last-sync age + manual refresh.
- **AC13 — Permission & degradation.** View-only members see everything, mutate nothing (disabled + tooltip). With the calendar migration unapplied, `/calendar` still renders the task-lens calendar + right panel with all calendar-table reads degrading to empty (no crash, no blank page).
- **AC14 — Module DoD.** Calendar manifest registered app-side + connector-side (reads `calendar_list_events`, `calendar_day`; writes create/update/delete event, schedule_task, move_block, complete_block, roll_forward); the **Today** dashboard widget ships (mini-timeline, next-up, strip count + inline Move-to-today, deep-links via `moduo:entity:open`); activity trails render in Detail surfaces.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/calendar/lens.test.ts` · range selector + block shaping | AC2 | A task scheduled Tuesday 9:00/45m becomes exactly one 45-minute block on Tuesday — done/archived/out-of-range tasks don't; 30m default applies. |
| `src/features/calendar/lens.test.ts` · done rendering + no dupes | AC2, AC7 | A completed task renders as a checked block on its day and never twice on any surface. |
| `src/features/calendar/grid-layout.test.ts` · overlap clusters | AC1 | Three overlapping chips split the column side-by-side; a fourth collapses into "+1". |
| `src/features/calendar/grid-layout.test.ts` · DST day | edge | The clocks-change day lays out 23/25 real hours without drifting chip positions. |
| `src/features/calendar/gap-finder.test.ts` · next fitting gap | AC8 | "Later today" picks the first gap after now that fits the duration, skipping meetings/blocks and off-hours; returns none when the day is full. |
| `src/features/calendar/roll-forward.test.ts` · placement plan + undo plan | AC9 | Move-to-today places queued items in order into real gaps, reports non-fitting leftovers, and the inverse plan restores every original time. |
| `src/features/calendar/strip.test.ts` · strip window | AC9 | Open tasks scheduled in the past ≤7 days populate the strip; older ones and events never do. |
| `src/features/calendar/elapsed.test.ts` · elapse detection | AC8 | A block whose end passed while its task is open flags for triage; events and done tasks never flag; wake-up catch-up flags missed ones. |
| `src/features/calendar/triage.test.ts` · took-longer / remove semantics | AC8 | Took-longer adds the planned span to the task's time and keeps it open with no remainder; Remove clears the schedule and nothing else. |
| `src/features/calendar/recurrence-nl.test.ts` · the pinned phrase set | AC5 | "every tuesday and thursday at 9", "every other friday", "first monday of the month" (et al.) parse to the right rule + echo string; garbage input flags unparsed and produces no rule. |
| `src/features/calendar/recurrence-expand.test.ts` · range expansion | AC5 | A weekly Tue/Thu event yields exactly the Tue/Thu chips inside a visible week and nothing outside it. |
| `src/features/calendar/mirror.test.ts` · provider→row mapper | AC12 | A synced Google event maps to the mirror row shape (times, all-day, source ids) idempotently — re-syncing updates, never duplicates. |
| `src/features/calendar/prefs.test.ts` · calendar prefs domain | AC1, AC8 | Working-hours bound, week start, and weekend visibility default sanely and round-trip through the prefs domain. |
| `src/features/calendar/ops-manifest.test.ts` · manifest registered | AC14 | The calendar manifest is present in the module registry with the promised ops/resources. |
| `src/features/dashboard/.../calendar-today.test.ts` · widget shaper | AC14 | The Today widget shaper picks the right next-up chip, today's remaining chips, and the strip count from raw inputs. |
| Storybook + `e2e/visual` specs · grid week/day, chip states (event/task/done/elapsed/external), strip, popovers, switcher | AC1–AC4, AC8, AC11 | Every visual state has a story + snapshot spec (baselines = human capture per gotchas). |
| `e2e/calendar/create.spec.ts` · draw → event | AC3 | Drawing on the grid and typing a title yields a saved event that survives reload. |
| `e2e/calendar/schedule.spec.ts` · drag task → block → complete | AC6, AC7 | A task dragged onto Tuesday appears as a block; ticking it completes the task in the Tasks page too. (Frame-stepped pointer events per the dnd gotcha.) |
| `e2e/calendar/loop.spec.ts` · elapse → later-today → strip → move-to-today | AC8, AC9 | With a mocked clock, an elapsed block offers triage; the strip moves items into real gaps and Undo restores them. |

## Assumptions & technical decisions

1. **The lens model — no `time_blocks` table in v1.** A task block IS the task row (`scheduled_at` + `duration_minutes` + `time_spent_seconds`); BRIEF §7's `time_blocks` sketch is deliberately deferred to the post-alpha multi-session upgrade. Zero drift by construction; the strip = the existing drift computation. *(Rejected: the mirror-table design — two truths, sync bugs, bigger migration.)*
2. **The loop rides shipped Tasks ops** — Done=`tasks_op_set_status`, Later-today/Move-to-today=`tasks_op_reschedule` (specific datetime; payload notes `origin:'calendar'`), Remove=`tasks_op_unschedule`, time=the existing accrual path. The moat works **before any new migration deploys**.
3. **New tables (one migration): `calendar_accounts` + `calendar_events`** (BRIEF §7 shapes, minus `time_blocks`), RLS = member SELECT + op-only writes; ops `calendar_op_event_create/_update/_delete`, `calendar_op_account_upsert/_remove`, `calendar_op_mirror_events` (batched idempotent upsert by `(source_account_id, external_event_id)`, owner-scoped) — each guard→write→`entities` upsert→activity, mirroring the contacts pattern (incl. the composite-NULL and RETURNS TABLE gotchas). **Permission lane = Tasks lane at alpha** (same call CT-1/CO-1 made).
4. **External sync = the existing desktop Rust engine, re-pointed:** OAuth/keychain/sync code stays; the redb/localStorage store is retired; sync output upserts to Supabase via `calendar_op_mirror_events`. Web renders from Supabase only. Read-only is structural (no outward write ops exist in v1). Cadence: foreground + ~15min timer + manual refresh, last-sync surfaced. *(Rejected for v1: edge-function relay — that's the v2 write-back round.)*
5. **NL recurrence is in-house:** extend the capture parser's constrained recurrence vocabulary (+ chrono-node for time-of-day), NOT `RRule.fromText` (docs state incomplete support). Echo-before-save is the consent gesture; the promised phrase set is pinned by unit tests; unparseable → the existing `unparsedRecurrence` posture.
6. **Native repeats = rrule text on the event row, client-side expansion** into the visible range (rrule is already a dependency). Series-edit only in v1. *(Tasks keep their single-row pointer model — different job, both documented.)*
7. **Prefs:** view state + panel widths in localStorage (Tasks pattern); working-hours bound, week start, weekends, per-calendar visibility/color in a new `user_preferences.calendar` domain (appearance/focus pattern).
8. **The right-panel switcher** is a typed per-module variant registry (`{id,label,icon,render}[]`), built inside Calendar but shaped for extraction to the app shell (the recorded Moduo-wide principle). No existing switcher exists to reuse (recon-verified).
9. **Elapse detection is a 30s client tick** with wake catch-up; no server cron in v1. Undo = client-held inverse plans applied through the same ops (server undo tokens arrive with v2 reflow).
10. **Colors:** bounded token-routed swatch palette; raw hex persists only in `calendar_accounts.color`/prefs storage (R1 posture, same as tags).
11. **Route rebuild, not addition:** `/calendar` layout key, route mapping, and icon already exist; the legacy exploratory page + `use-calendar` localStorage store are replaced. `slot_bookings`/`exposed_slot_links` plumbing untouched (booking links are a fast-follow).
12. **Vitest imports:** all new pure modules use relative `lib/` value-imports (the alias gotcha); new-RPC reads wrapped + degrading (the deploy-gap gotcha); `due_date` comparisons normalize to local dates (the timestamptz gotcha).

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **CAL-1 — Page shell + task-lens grid (no migration)** | Rebuilt `/calendar` page on `FeaturePanelsShell`; toolbar + Week/Day grid (hour lines, now-line, all-day lane, overlap layout, DST-safe); left rail (mini-month + Moduo calendar row); scheduled tasks render as blocks (lens selector); view persistence + keyboard nav; empty/loading/error/view-only states. Pure-logic tests: lens, grid-layout, prefs (localStorage half). | AC1, AC2, AC13 (degrade half) | — |
| 2 | **CAL-2 — Native events end-to-end** | The migration (`calendar_accounts`, `calendar_events`, ops incl. mirror op) + runtime `calendar` namespace + draw-to-create (ghost, inline title, popover) + move/resize/delete + repeats (presets + NL custom + echo + expansion) + event Detail (links via EntityHub, activity trail) + entities registration + deploy-gap wrapping. Tests: recurrence-nl, recurrence-expand, op round-trip notes (manual post-deploy). | AC3, AC4, AC5 | CAL-1 |
| 3 | **CAL-3 — Right panel + drag-to-schedule + complete-in-block** | The switcher (variant registry) + Tasks view (Today/Due soon/Backlog + search) + drag task→grid via the universal drag contract + block drag/resize writing schedule/duration + task-block popover + checkbox complete (recurrence-aware) + task Detail reuse. Tests: panel selectors; e2e schedule spec. | AC6, AC7, AC11 | CAL-1 |
| 4 | **CAL-4 — The loop: elapsed triage + the strip** | 30s tick + elapse detection; the 4-action row (gap-finder for Later-today); Took-longer/Remove semantics; the strip (7-day window, Move-to-today placement+undo plans, Review sub-state in the right panel); working-hours bound in the prefs domain (cloud half). Tests: gap-finder, roll-forward, strip, elapsed, triage; e2e loop spec. | AC8, AC9 | CAL-3 |
| 5 | **CAL-5 — Focus timer on blocks** | Start-focus on current/elapsed blocks; live block treatment + readout; accrual via the existing flush path; single-session rule; stop toast. | AC10 | CAL-3 |
| 6 | **CAL-6 — External read-only (mirror + accounts)** | Desktop engine re-pointed to `calendar_op_mirror_events`; Settings→Integrations rework onto `calendar_accounts`; left-rail account groups + visibility/colors (prefs cloud half); attribution in chips/popover/Detail; sync staleness + manual refresh; account removal cascade. Tests: mirror mapper; manual-test surfaces for the OAuth round-trip. | AC12 | CAL-2 |
| 7 | **CAL-7 — DoD: MCP manifest + Today widget** | App-side + connector-side manifests (the AC14 tool list); the Today dashboard widget (timeline, next-up, strip count + inline move-to-today, deep-links); widget shaper tests; BUILD_ORDER/decisions reconciliation. | AC14, AC13 (final walk) | CAL-2, CAL-3, CAL-4 |

Parallelism: CAL-2 ∥ CAL-3 after CAL-1 (disjoint: migration/events vs panel/dnd — both touch `runtime.web.ts`, the known high-contention file: sequence the runtime edits or expect a trivial merge). CAL-5 ∥ CAL-6 after their deps. CAL-4 before CAL-7.

## Out of scope

Everything in DESIGN_BRIEF §11 (reflow · rituals · write-back + default-target · ⌘K NL create · month/agenda views · multi-session blocks · day-fullness · occurrence exceptions · booking links · Apple/ICS), plus the permanent anti-goals (no opaque auto-scheduling, no rebuilt provider meeting stack, no red, no guilt). Depth ceiling: Morgen-lite (BRIEF §2).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous (behavior detail delegated to DESIGN_BRIEF §2–§10, ratified line-by-line with the designer 2026-07-02).
- [x] **Every AC has at least one test** with a plain-English note (table above).
- [x] **Open questions is empty** — all product forks answered by Maciej; all technical unknowns researched and recorded under Assumptions (recon agents + competitive research, 2026-07-02).
- [x] **Data model named and Supabase-first**: one migration — `calendar_accounts`, `calendar_events`, `calendar_op_*` RPCs; the loop deliberately rides shipped Tasks ops; prefs via `user_preferences.calendar`.
- [x] **Module feature wiring enumerated**: spine (entities registration, EntityHub links, drag contract, activity, tags via registry), MCP tool list (AC14), dashboard widget defined.
- [x] **Execution blocks** decomposed (7), sequenced, each context-sized, self-contained, recoverable from this spec + docs/decisions.md.
- [x] **Design constraints acknowledged**: tokens-only, shadcn-wrapped primitives, control rungs, motion tokens, DESIGN_RULES R1–R10 (DESIGN_BRIEF §13).
- [x] **Manual-test surfaces identified**: migration round-trip (deploy-gated per gotchas), OAuth + mirror round-trip (desktop), dnd live-verify (frame-stepped), visual baselines (human capture) — to be listed in `docs/testing/<branch>.md` at each wrap.

## Open questions

- [ ] (none)
