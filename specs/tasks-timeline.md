# Spec: Tasks Timeline view (lightweight roadmap)

> Status: **Ready** · Owner: maciej · Related briefs: [docs/moduo-tasks-feature-spec.md](../docs/moduo-tasks-feature-spec.md) (§views — "Gantt deferred" is this spec un-deferring it), [docs/PRODUCT_BRIEF.md](../docs/PRODUCT_BRIEF.md) ("Lightweight Timeline/roadmap view"), [docs/ROADMAP.md](../docs/ROADMAP.md) §Open Questions ("slot in Wave 2 or shortly after")

## Scope

A third Plan-mode view — **List | Board | Timeline** — that lays tasks out as bars on a horizontal date axis with bucket swimlanes, dependency arrows, and drag-to-reschedule. It rides entirely on existing data (`scheduledAt`, `dueDate`, `task_relations`, buckets); **no migration, no new route, no new module**. This is the deferred "lightweight Gantt" from the Tasks spec, explicitly *not* MS Project.

## Product behavior & UX

Sketch of record: the widget shown in the planning session (view switcher + zoom + Today; bucket swimlanes; today line; fading open-ended bars; milestone-free grammar; dependency arrow; bottom unscheduled tray).

- **Entry**: the Plan-view switcher gains a Timeline segment. Choice persists per workspace like List/Board. Selection (bucket/All/Today) and the tag filter scope the view identically to the other two.
- **Axis**: horizontal, scrollable into past and future. Zoom = Week / Month / Quarter (Month default, persisted). Sticky date header; a quiet accent "today" line with a small Today pill; a **Today** button recenters.
- **Rows**: bucket swimlanes (collapsible, matching the left rail), tasks within a lane sorted by start (known date first). Single-bucket selection shows just that lane's rows.
- **The bar grammar** (one concept, no diamonds): a solid edge = a known date, a **faded edge = an unknown one**.
  - `scheduledAt` + `dueDate` → solid bar spanning both.
  - `scheduledAt` only → solid left edge, right side fades out ("starts here, end open").
  - `dueDate` only → left side fades in, solid right edge ("we see the end approaching, not the start" — the designer's framing).
  - Neither → not on the axis; lives in the **Unscheduled tray** (collapsible bottom strip with drag chips).
- **Bar anatomy**: complete-checkbox, title, blocked lock when applicable. Done = muted. Clicking a bar selects the task and opens the same right-rail detail panel as List/Board.
- **Drag**:
  - Bar body → moves the known date(s) by whole days, preserving clock time (existing reschedule semantics). Optimistic, rolls back on error.
  - Solid edge → adjusts that date.
  - Faded edge → *sets* the missing date (the bar solidifies).
  - Tray chip onto a day → sets `scheduledAt` on that day.
- **Dependencies**: arrows from a blocker bar's end to the blocked bar's start, drawn from the shipped blocked-by data. Subtle at rest; hovering/selecting either task highlights its arrows. Light **creation**: hovering a bar shows a small connector dot at its right edge; drag it onto another bar → `addBlocker`. Removal stays in the detail panel (v1).
- **Drift stays quiet**: an open bar whose end is past gets the same ambient dot as the left rail. Never red, never "overdue".
- **Read-only** (`!canEdit`): bars render, all drags disabled, tray shows without grips.

## Edge cases

- No dated tasks at all → axis renders with the today line, a one-line hint, and the tray prominent (expanded).
- A bar dragged so start would pass end (or vice versa) → clamp to a 1-day minimum span, never invert.
- Task with `dueDate` before `scheduledAt` (bad data) → render as a 1-day bar at `scheduledAt`; fixing either date via drag heals it.
- Reschedule RPC fails → optimistic move rolls back + existing toast (same infra as List/Board).
- Dependency-drag onto the same task or an existing blocker → no-op, no error modal.
- Subtasks render as their own bars only when dated; no parent rollup bars.
- Very long lanes (100s of tasks) → accept full render at v1 (parity with List/Board); virtualize only if dogfooding hurts.
- Collapsed bucket with arrows into it → arrows to hidden bars are not drawn (no dangling endpoints).
- Timezone: all day-bucketing in **local** time (`due_date` is a timestamptz written from local midnight — the gotchas.md off-by-one).

## Acceptance criteria

- **AC1** — Timeline appears as the third Plan view, persists per workspace, and honours the active selection + tag filter exactly like List/Board.
- **AC2** — Bars follow the date grammar: both dates = solid span; scheduled-only = fade-right; due-only = fade-left; undated = tray only. Day maths are local-time correct.
- **AC3** — Week/Month/Quarter zoom (Month default, persisted) with sticky header, today line, and a working Today recenter.
- **AC4** — Bucket swimlanes are collapsible; lanes order tasks by start date.
- **AC5** — Dragging a bar body moves its known date(s) by whole days preserving clock time; dragging a solid edge adjusts that date; dragging a faded edge sets the missing one. All optimistic with rollback on error; spans never invert (1-day minimum).
- **AC6** — Dragging a tray chip onto a day sets `scheduledAt` on that day and the task leaves the tray.
- **AC7** — Dependency arrows render from blocked-by data; hover/selection highlights them; blocked bars carry the lock treatment.
- **AC8** — Dragging a bar's connector dot onto another bar creates a blocker relation; self/duplicate targets are a silent no-op.
- **AC9** — Done bars are muted; past-end open bars show the ambient drift dot; nothing on this surface is red or says "overdue".
- **AC10** — With no dated tasks the empty state renders (hint + expanded tray); with `canEdit=false` everything is visible but inert.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/tasks/timeline-geometry.test.ts` · "bar span per date shape" | AC2 | Each of the four date shapes maps to the right span/fade flags, including the local-midnight due-date case. |
| `timeline-geometry.test.ts` · "day snapping preserves clock time" | AC5 | Moving a bar N days keeps the original hh:mm; spans clamp at 1 day and never invert. |
| `timeline-geometry.test.ts` · "lane ordering + collapse" | AC4 | Tasks sort by start within a bucket lane; collapsed lanes contribute no rows. |
| `timeline-geometry.test.ts` · "axis window per zoom + today position" | AC3 | Week/Month/Quarter produce the right day widths and the today x-position. |
| `timeline-geometry.test.ts` · "arrow endpoints" | AC7 | Blocker→blocked pairs resolve to end→start anchor points; pairs with a hidden endpoint are dropped. |
| `timeline-geometry.test.ts` · "tray membership" | AC2, AC6 | Undated tasks (and only those) land in the tray. |
| `timeline-drag.test.ts` · "drop resolution" | AC5, AC6, AC8 | A drag result (body/edge/tray/connector) maps to the right mutation args; self/duplicate blocker drops resolve to no-op. |
| `task-timeline-view.stories.tsx` + visual baseline | AC1–AC4, AC9, AC10 | The populated, empty, and read-only states render to spec (fades, muted done, drift dot, lock). |
| `e2e/tasks/timeline.spec.ts` · smoke | AC1, AC5 | Switch to Timeline, drag a bar one week, see the persisted new schedule (per-frame pointer events — the dnd gotcha). |

## Assumptions & technical decisions

- **Custom-built; no gantt library.** frappe-gantt / gantt-task-react / SVAR all carry their own CSS systems — untokenizable, and they'd bypass the existing dnd-kit + optimistic-mutation infra. Scope is small enough that custom is less code.
- **Geometry is a pure module** (`timeline-geometry.ts`): date→x, bar spans, lanes, arrow anchors — unit-testable, view renders from its output. All date maths via date-fns in local time.
- **Rendering**: absolutely-positioned bar divs in a relative track; hairline grid + today line as divs; arrows as one SVG overlay (`pointer-events: none`, hover hit-testing via the bars).
- **Drag**: pointer-capture with day snapping for bar move/edge resize/connector (continuous drags — dnd-kit's discrete droppables fit badly); dnd-kit only for tray→axis, using the reserved timeline slot in `task-dnd.tsx` (`TaskDropTarget` gains `{ type: "timeline-day"; day: string }`).
- **Mutations**: reuse `api.patchTask` / `rescheduleScheduledAt` / `addBlocker` and the `applyOp` optimistic infra — no new ops, no migration, no MCP change (Tasks' manifest already covers reads/writes; a timeline is presentation).
- **Fades** via CSS `mask-image` on the bar (token-colored fill underneath — no raw hex; fade length a constant ~80px, it encodes direction, not data).
- **Tray drop sets `scheduledAt` at 09:00 local** — scheduling implies a morning anchor and keeps `formatScheduled` output sensible; a due date is deliberately *not* set (the designer's call: schedule ≠ deadline).
- **Zoom + view persisted** via the existing per-workspace `lsKey` localStorage pattern.
- **No virtualization at v1** (parity with List/Board); revisit on dogfooding pain.
- Spine/module contract: **N/A** — this is a view inside the shipped Tasks module, not a new module.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| TL-1 | Static timeline | View registration + switcher segment, axis/zoom/today, bucket swimlanes, bar grammar incl. fades, done/drift/lock styling, click→detail panel, empty + read-only states, `timeline-geometry.ts` + tests, story + visual | AC1–AC4, AC7 (render only), AC9, AC10 | — |
| TL-2 | Drag interactions | Bar move + edge resize (incl. faded-edge set), clamps, tray strip + drop-to-schedule, optimistic wiring, drag tests, e2e smoke | AC5, AC6 | TL-1 |
| TL-3 | Dependency layer | Arrow overlay + hover/selection highlight, connector-dot creation → `addBlocker` with self/duplicate guard | AC7, AC8 | TL-1, TL-2 |

*TL-3's creation half is the designated cut if the block runs long — arrows-render-only still ships AC7.*

## Out of scope

Critical path, % complete, baselines, resource lanes, parent rollup bars, manual row reordering, within-view dependency **removal** (detail panel does it), dependency arrows across collapsed lanes, virtualization, mobile. The depth ceiling is Linear's timeline, not MS Project.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous.
- [x] **Every AC has at least one test** with a plain-English note.
- [x] **Open questions is empty** — the five product calls were answered by the designer 2026-07-02 (fade grammar both directions, bucket swimlanes, bottom tray, light dependency-creation in v1); technical unknowns recorded above.
- [x] **Data model named and Supabase-first** — rides existing columns; deliberately no migration.
- [x] **Module contract** — N/A (view inside Tasks; manifest/widget already shipped).
- [x] **Execution blocks** decomposed, sequenced, context-sized.
- [x] **Design constraints acknowledged** — tokens-only, shadcn `SegmentedControl`/`Tooltip` reuse, motion tokens for hover transitions, no red on this surface.
- [x] **Manual-test surfaces identified** — switcher persistence, all four bar shapes, three drags, tray drop, arrows + creation, zoom persistence (web + desktop).

**Ready to execute.**

## Open questions

- [ ] (none)
