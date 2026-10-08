# Moduo — Calendar Brief

> **Status:** Planned — flagship differentiator, post-Tasks. Supabase-first; no UI shipped yet (calendar logic + OAuth tokens are localStorage-only today per [data-layers.md](../../docs/data-layers.md) §2).
> **Pairs with:** [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md), [ROADMAP.md](../../docs/ROADMAP.md), [data-layers.md](../../docs/data-layers.md), [moduo-module-contract.md](../../docs/moduo-module-contract.md). Built directly on Tasks (shipped, Supabase 5/5).

---

## 1. What it is & job-to-be-done

A time-blocking calendar that shares one app with the tasks it schedules. The job, in the user's words: **"Help me plan a realistic day, then actually get through it — and when the day slips, fix the plan without making me feel like I failed."**

Every time-blocking tool on the market (Motion, Morgen, Sunsama, Akiflow, Routine) nails the *planning* half — the day **looks** organized at 9am — and abandons the *execution* half. Worse, Morgen and Akiflow sync calendars **one-way into an external task store**: your tasks live in app A, your calendar in app B, and the two drift apart the moment reality diverges from the plan. Moduo's tasks and calendar are the **same data in the same app**, so a block and its task stay in lockstep, and completing work *self-corrects the plan*.

The user is a solo or partner operator: their calendar is half client meetings, half "the work itself." Moduo treats both as first-class blocks and closes the loop between them.

## 2. Depth ceiling & explicit non-goals

**Ceiling — Morgen-lite:**
- Day / week views, drag-to-schedule, time-blocking, multi-source account sync (Google, Microsoft, CalDAV via metadata refs).
- Booking links (Calendly-like) as a **fast-follow**, not alpha.

**Non-goals (deliberate light ceiling — but the loop must be *great*):**

| Not building | Why |
| --- | --- |
| Opaque AI auto-scheduling that seizes the calendar | Motion's reshuffle is its **#1 churn cause**. We schedule *with* you, not *at* you. |
| Real-time collaborative calendar editing / live cursors | Multiplayer is **shared-workspace async** (data-layers §7). Changes appear on refresh. |
| A meeting-scheduling AI assistant / NLP "schedule a 1:1 next week" | Out of scope at alpha; drag + reflow only (see Open Questions). |
| Full two-way write-back of *task fields* to external task managers | We *are* the task manager. External sync is calendar events only. |
| Resource booking, room management, team availability matrices | Team-tool territory; audience is ≤5. |
| Recurring-event authoring richness rivaling Google Calendar | Lean on imported recurrence; don't rebuild rrule UI beyond what Tasks already has. |

## 3. The "one great moment"

**The schedule-to-completion loop.** This is the entire reason Calendar is the flagship, and it is the one thing no incumbent ships:

1. **Complete from inside the block.** A time-block backed by a task carries the task's checkbox. Tick it *in the calendar* — no context-switch to a list. The block flips to a done state; the task's status moves via the existing `tasks.set_status` op.
2. **Block elapsed → gentle prompt.** When a block's end time passes and it's still open, a quiet inline prompt offers four moves: **Done · Push · Shrink · Drop**. Never a modal, never red, never a guilt wall.
3. **Roll forward in one gesture.** Unfinished blocks from earlier today (or yesterday) roll forward into a gentle queue with a single action — no per-item dragging.
4. **Focus timer writes actuals back.** Starting a focus session on a block records actual minutes into `tasks.time_spent_minutes` (the column already exists). The plan **learns**: next time you block "invoice run," the suggested duration reflects what it actually took.

The net effect: the plan **self-corrects** instead of rotting. By 4pm the calendar still reflects reality, which is exactly when every other tool's plan is fiction.

## 4. Must-have features

Each: one line + the insight + spine wiring.

| # | Feature | One line | Insight / evidence | Spine wiring |
| --- | --- | --- | --- | --- |
| 1 | **Drag-to-schedule** | Drag a task from any list/queue onto the calendar to create a block. | Table-stakes for the category; the differentiator is that the dragged thing is a *real task*, not a copy. | Uses the universal **drag-payload contract** (spine #3). A `time_block` is an `entity_link` (kind=`scheduled_as`) between a task and a calendar slot. |
| 2 | **Completion loop** | Done/push/shrink/drop a block at-elapse; complete tasks in-block. | The category-defining gap — planning without execution (§1, §3). | Block-complete calls `tasks.set_status`; every move appends `module_activity`. |
| 3 | **Roll-forward incomplete** | One gesture moves all unfinished blocks forward. | Sunsama's daily carry-over is *loved* but manual; Motion's auto-move is *resented*. One-gesture-but-user-initiated splits the difference. | New op `calendar.roll_forward` (batched, one RPC per pass — mirrors `tasks.catch_up`). |
| 4 | **"Reflow my remaining day"** | One tap re-packs remaining blocks into open time; **reversible**, reason-annotated. | Graceful slippage. Gentle overdue queue, **not a red wall** (module-contract §3 rendering rule). | `calendar.reflow` op returns a preview + an undo token; annotates each move ("moved because 2pm ran 20m long"). |
| 5 | **Day-fullness signal** | Arithmetic capacity bar: committed minutes vs. available minutes. | **None** of Motion/Morgen/Sunsama/Akiflow model capacity. Pure arithmetic, **no AI** — sum of block durations against working-hours window. | Reads `time_blocks` + working-hours pref; surfaces on the dashboard widget. |
| 6 | **Multi-source accounts + source attribution + default-target picker** | Every event shows which calendar it's from; a clear default for *where new events go*. | Sending an invite to the wrong calendar is an **instant-uninstall** bug. Source attribution is non-negotiable. | `calendar_accounts` + per-event `source_account_id`; events become `entity_link`-able refs. |
| 7 | **Assistive / transparent / reversible scheduling** | Suggestions you accept, with a stated reason; never auto-seize. | "We schedule with you, not at you." Motion's opaque reshuffle = #1 churn. | Every assistive move is an op with a `reason` payload + undo; shows in activity. |
| 8 | **Opt-in daily-plan + evening-shutdown ritual** | Pre-assembled morning plan; a 2-minute evening review. | Steal Sunsama's *loved* habit loop; **fix its 15–20 min/day manual tax** by pre-assembling. **Skippable, never gating.** | Plan pulls committed tasks + today's events; shutdown rolls leftovers via `calendar.roll_forward`. |

## 5. Key flows / interactions

- **Schedule:** drag task → calendar → block created, sub-200ms optimistic, task gains a "scheduled" affordance in its list. Drag the block to move; resize edges to change duration.
- **Execute:** block is live → click checkbox in-block to complete, or start focus timer (timer overlays the block, writes actuals on stop).
- **At-elapse triage:** quiet inline chip on the elapsed block → Done / Push (to next open slot) / Shrink (mark partial, keep remainder) / Drop (unschedule, task survives).
- **Day slips:** "Reflow remaining day" → preview of moves with reasons → Accept (one undo token) or Dismiss.
- **Morning:** open app → optional pre-assembled plan ("Here's a draft day — edit or accept"). Never blocks entry to the app.
- **Evening:** optional shutdown ritual → reviews done/undone → one-gesture roll-forward of leftovers → close.
- **Wrong-calendar guard:** creating an event always shows the target account inline; default-target picker lives in calendar settings and is confirmable per-event.

## 6. Spine wiring

| Spine system | Calendar's participation |
| --- | --- |
| **Links / attachments** | A `time_block` is itself a typed `entity_link` (task ↔ time slot). Events link to contacts (attendees), notes (agenda/minutes), emails (the thread that spawned the meeting). Drag an email onto the calendar → meeting block + `entity_link`. |
| **@mentions** | In event notes/agenda, `@member` resolves to a workspace member → notification + a comment on the event entity. |
| **/refs** | `/ref` a task, contact, note, or email into an event's agenda; renders as a typed inline chip, not raw text. |
| **Notifications** | Ride `module_activity` (spine #6). Calendar emits: invite assigned to you, block rolled forward, reflow applied. **Quiet, grouped, digest-default.** |
| **Activity** | Every op appends `module_activity` (`calendar` module, `entity_type` ∈ {`event`, `time_block`}). Trail renders quietly in the event/block detail surface. |
| **Tags** | `tag_links` already polymorphic — add `event` + `time_block` to `entity_type` coverage. |
| **MCP tools** | Read: `calendar.list_events`, `calendar.day_view`, `calendar.fullness`. Write: `calendar.schedule_task`, `calendar.move_block`, `calendar.roll_forward`, `calendar.reflow`, `calendar.complete_block`. Agents get **ops only**, read-default scope (module-contract Pillar 4). |
| **Dashboard widget** | "Today" widget: timeline of blocks + the fullness bar + next-up + one-tap roll-forward. Live, interactive — definition-of-done. |

## 7. Data model sketch (Supabase-first)

> Note: the existing `task_time_blocks` table is a **slot→bucket map** for the Tasks rail ("morning/afternoon" grouping) — it is **not** a calendar block and must not be overloaded. Calendar needs its own real scheduled-block entity below.

```
calendar_accounts (
  id uuid PK,
  workspace_id uuid → workspaces ON DELETE CASCADE,
  owner_id uuid → profiles,
  provider text,              -- 'google' | 'microsoft' | 'caldav' | 'moduo'
  external_id text,           -- provider account id
  display_label text,         -- "work — me@studio.com" (source attribution)
  is_default_target boolean,  -- where new events go (instant-uninstall guard)
  color text,                 -- token-routed in UI, raw hex stored here only
  sync_token text, updated_at timestamptz
)

calendar_events (
  id uuid PK,
  workspace_id uuid → workspaces ON DELETE CASCADE,
  source_account_id uuid → calendar_accounts,  -- attribution, always shown
  external_event_id text,     -- null for Moduo-native events
  title text, starts_at timestamptz, ends_at timestamptz,
  all_day boolean, rrule text NULL,            -- imported recurrence
  status text,                -- 'confirmed' | 'tentative' | 'cancelled'
  owner_id uuid, created_at, updated_at, deleted_at timestamptz NULL
)

time_blocks (                 -- the schedule↔execution bridge (NOT task_time_blocks)
  id uuid PK,
  workspace_id uuid → workspaces ON DELETE CASCADE,
  task_id uuid NULL → tasks,          -- backing task (most blocks)
  event_id uuid NULL → calendar_events, -- backing external event (meeting blocks)
  starts_at timestamptz, ends_at timestamptz,
  state text,                 -- 'planned' | 'active' | 'done' | 'pushed' | 'dropped'
  rolled_from_block_id uuid NULL,     -- roll-forward provenance
  reason text NULL,           -- assistive-move annotation ("2pm ran 20m long")
  actual_minutes int NULL,    -- focus-timer write-back mirror of tasks.time_spent_minutes
  owner_id uuid, created_at, updated_at, deleted_at timestamptz NULL
)
-- CHECK: exactly one of (task_id, event_id) non-null for a backed block;
--        free-standing blocks (both null) allowed for ad-hoc focus time.
```

**Polymorphic links:** events and blocks become first-class spine citizens via the **`entity_links`** keystone (data-layers §5 #1) — `entity_type` ∈ {`event`, `time_block`} on both ends. A scheduled task is modeled as `entity_link(task → time_block, kind='scheduled_as')` *and* the denormalized `time_blocks.task_id` for fast day queries (the link is the source of truth; the column is the index).

**Intent ops (module-contract Pillar 1):** `calendar_op_schedule_task`, `calendar_op_move_block`, `calendar_op_complete_block`, `calendar_op_roll_forward` (batched), `calendar_op_reflow` (returns preview + undo token), `calendar_op_set_target_account`. Each: actor + permission check, `FOR UPDATE`, invariant enforcement, write, `module_activity` append, return updated rows. Reflow/roll-forward occurrence math (rrule) stays **client/edge-side** (per contract — plpgsql can't do rrule); the op enforces structural invariants (forward-only roll, undo-token issuance, capacity bounds).

## 8. Module-specific open questions

| Question | Recommendation |
| --- | --- |
| **Any assistive scheduling at alpha?** | **No** beyond drag + reflow. Assistive *suggestions* (feature #7) ship after the loop is proven. The loop is the moat; opaque scheduling is the trap. Keep alpha to manual drag + one-tap reflow + roll-forward. |
| **External sync write path** (Google/MS) — server relay vs. desktop-only, mirroring the Email decision? | **Mirror Email (data-layers §6):** sync lightweight **event metadata refs** to Supabase so events participate in `entity_links` on every client; do **full read/write sync against providers from a thin edge function** (calendar OAuth is far lighter than IMAP/SMTP — no body relay, no security review of equal weight). Native Moduo events are Supabase-first from day one. |
| **Is a `time_block` an `entity_link` or its own table?** | **Both, deliberately:** own table for day-view query performance + execution state (`state`, `actual_minutes`), with the canonical relationship also expressed in `entity_links` so the spine sees it. Denormalized `task_id`/`event_id` are indexes, not truth. |
| **Capacity model granularity** | Pure arithmetic against a **working-hours preference** (per workspace member, in `user_preferences`). No ML. A simple committed-vs-available bar beats every incumbent because they ship *nothing*. |
| **Booking links surface** | Fast-follow, not alpha. When built: a public booking page writes a native `calendar_event` into the default-target account + creates a `contact` + `entity_link`. Keeps it inside the spine. |
| **Recurring time-blocks** (vs. recurring events) | Don't author recurrence on blocks at alpha — blocks are per-day instances of work. Recurrence lives on tasks (existing engine) and imported events. |

## 9. Dependencies & sequencing notes

- **Hard dep: Tasks (shipped, Supabase 5/5).** Calendar reuses `tasks.set_status`, `tasks.time_spent_minutes`, and the task entity directly. Do not start Calendar UI before the spine primitives exist.
- **Spine timing:** the **drag-payload contract** (data-layers §5 #3) and **`entity_links`** (#1) are prerequisites. Per data-layers §5, these are built **once alongside the second real module**. Recommendation: **Contacts is the second module** (near-pure spine, the architecture's proof), and **Calendar is the third** — it is the heaviest *consumer* of the drag contract and `entity_links`, so it should land *after* those primitives are battle-tested, not be the one to invent them.
- **Within Calendar, sequence:** (1) `calendar_events` + `calendar_accounts` + native CRUD + day/week view; (2) `time_blocks` + drag-to-schedule; (3) the completion loop (the moment — do not ship Calendar without it); (4) roll-forward + reflow; (5) day-fullness + dashboard widget; (6) daily-plan / shutdown ritual; (7) external provider sync (edge function); (8) booking links (fast-follow).
- **Definition of done** (module-contract): intent-op RPCs, attributed activity on every op, trail rendered in event/block detail, manifest entry in `module-registry.ts`, MCP tools registered, and the "Today" dashboard widget live. Sub-200ms optimistic interactions are a P0 bar — drag, complete, and triage must feel instant locally and reconcile against Supabase.

Brief is complete and self-contained. The one load-bearing correction surfaced during grounding: do **not** reuse the existing `task_time_blocks` table (it is a slot→bucket map for the Tasks rail, not a calendar block) — Calendar needs the distinct `time_blocks` entity sketched in §7.
