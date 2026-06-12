# Moduo Architecture Vocabulary

Defines the core concepts used when discussing Moduo's structure, features, and design.

**Rule of use:** if a conversation uses one of these terms in a way that doesn't match this doc, stop and clarify before continuing. This is a living spec — update it as decisions get made.

---

## Design Principles

These govern decisions at every level. When a choice is unclear, the principle wins.

1. **Quiet and minimal until the user decides otherwise.** Default to less. Configurable louder. No long lists on open, no notification spam, no panels full of options.
2. **Decisions live with the designer, not the user.** Pick the right default for ~80%; expose deep settings for the rest. "Let the user decide" is not a substitute for making a call.
3. **Friction lives behind the dump, not in front of it.** Capture is zero-friction; refinement happens lazily. Never block input with required fields.
4. **ADHD-aware defaults.** The app behaves the same whether the user is in a productive week or crashing. No shame loops, no piling-up red indicators, no guilt-inducing copy.
5. **Mirrors, not walls.** Surface information ambiently (a soft count, a quiet indicator). Never block the user to force acknowledgment. A reschedule count you can see is a mirror; a modal demanding you justify it is a wall. Always choose the mirror.

---

## Concepts

### Workspace
A user's isolated context for their data. Multiple per user (e.g. Personal / Work). Switched in the top bar. Not a bucket — a higher level of separation.

### Module
A primary functional area accessed via the top bar. Each handles a domain: Dashboard, Notes, Tasks, Calendar, Email, etc. Owns the middle area when active. Modules are exclusive in the center panel and can be hidden by the user (modularity is core).

**Tasks and Calendar are SEPARATE modules.** They integrate (scheduled tasks appear on the Calendar) but are independent — each must work fully with the other hidden.

### Mode
A modal state *within* a module. Currently only the Tasks module has modes: **Plan** and **Execute**, toggled at the top of the left panel.
- **Plan mode** — organize tasks, build today's commit queue. Normal views available.
- **Execute mode** — isolated focus. One task at a time (Now card + timer), rest queued and dimmed, everything else hidden.

A Mode is a deeper state than a View. Switching mode changes what the whole module is *for*; switching view changes how the same data is displayed.

### View
A way of looking at the same data within a module/mode. Switching views changes presentation, not data. In Tasks Plan mode: List, Board (Gantt deferred). In Calendar: timeline.

### Panel
A region of the screen layout. Top bar, bottom bar, and three middle panels (left = navigation, center = content, right = support/context, collapsible). Panels are layout, not content.

### Widget
A self-contained glance surface in the Dashboard module, aggregating data from other modules. Not a view or panel. Dashboard-only.

### Sub-feature
A capability inside a module that doesn't warrant its own module (e.g. bucket management within Tasks). Rule of thumb: meaningful without the parent → module; needs the parent's data → sub-feature.

### Bucket
A user-defined category for tasks, within the Tasks module.
- **Exclusive:** one task lives in exactly one bucket.
- **No cooldown.** Bucket creation is instant and frictionless.
- **Inbox** is a reserved system bucket for unclassifiable items; cannot be deleted.

### Tag
A workspace-level, cross-cutting label that can apply to items across modules (tasks, notes, emails). Not a bucket. Flat (no hierarchy) for now.

### Subtask
A **full task** with a `parent_id` — not a checklist item. Exactly one level deep (a subtask is never a parent; recursion forbidden). Hidden from top-level lists by default (expand affordance on the parent, which shows a quiet n/m progress mirror), individually committable to Today, and never invisible: if its parent isn't in the rendered scope, it renders top-level. Deleting a parent promotes its subtasks.

### Blocked / Frontier
**Blocked** is a *computed* read-time state (like Drift), never a stored status: a task with at least one live, open blocker via a `task_relations` edge (blocker → blocked). Renders dim/quiet — never red, never a wall: a blocked task stays editable, completable, committable. The **frontier** of a blocked task is the set of open, unblocked tasks found by walking up its blocker chain — "what's actually next." Committing a blocked task offers the frontier (with a Commit-anyway escape hatch). The edge graph is a DAG; cycles are forbidden at the DB level.

### Occurrence / Catch-up
A recurring task is **one task row that cycles** (never a template spawning
copies); its **occurrence** is the single live instance, carried in
`scheduled_at`, with the rule's stored `nextOccurrence` pointer marking when it
comes back. **Advance-on-done** moves the pointer when the task is completed;
**catch-up** (on app open / reload) reopens done recurring tasks whose pointer
has arrived and collapses missed occurrences forward — missed occurrences
don't exist: no backfill, no "7 overdue", only the next occurrence.
**Skip-occurrence** jumps to the next occurrence without done-credit (and
without counting as a reschedule).

### Commit
The act of adding a task to **today's queue** in Plan mode. Commit means "I'm doing this today," in priority order. It is NOT the same as scheduling a specific time — committing builds the queue; scheduling assigns a clock time (optional, and a Calendar-module concern).

### Drift
A scheduled task whose time has passed without completion. Marked with a soft, ambient indicator (per-bucket in the Tasks left panel), never red, never "overdue", never blocking. Batch-triage available on click.

### Event
A fixed-time item with no completion concept. Lives in the Calendar module — either native to Moduo or pulled from read-only connected feeds (Google/Outlook). Distinct from a scheduled task.

---

## Hierarchy

```
Workspace
└── Modules (Dashboard, Notes, Tasks, Calendar, Email, ...)   [user can hide any]
    ├── Modes (Tasks only: Plan / Execute)
    │     └── Views (Plan: List, Board | Calendar: timeline)
    ├── Sub-features (e.g. bucket management)
    └── Panels (Left, Center, Right — layout regions)
          └── Widgets (Dashboard only)

Cross-cutting:
- Tags connect items across modules.
- Buckets exist only in the Tasks module.
- Scheduled tasks (Tasks) render on the timeline (Calendar) — cross-module integration.
```

---

## Decision Rules

**Module or View?** Different data → Module. Same data, different presentation → View. (Calendar is its own module because events are different data from tasks, and because a calendar-only user must be able to hide Tasks.)

**Mode or View?** Changes what the module is *for* → Mode. Changes how data is displayed → View.

**Module or Sub-feature?** Meaningful without the parent → Module. Needs the parent's data → Sub-feature.

---

## Anti-patterns

- "The Calendar view of Tasks" — Calendar is a separate module now, not a Tasks view.
- "Make this a widget" for a sub-feature — widgets are Dashboard-only.
- Treating Plan/Execute as separate apps or top-level areas — they are modes within the Tasks module.
- Blocking modals to force acknowledgment (reschedule reasons, etc.) — violates principle 5.
- Forced bucket-creation delays — removed; bucket creation is instant.

---

## Open Questions

- Tags structurally — workspace-level (current assumption) or a deeper home?
- Right panel content per module — configurable for every module, or opt-in? (Right panel content is deferred for Tasks v1.)
- Timer model in Execute mode — pomodoro (default) vs. per-task duration countdown.
- Native Moduo events UI — data model anticipates them; full UI timing TBD.

## Resolved (kept for history)

- Tasks + Calendar: **separate modules** (reversed from an earlier unified design).
- Bucket cooldown: **removed** (was a personal-discipline rule wrongly generalized to all users).
- AI in v1: **none** (parser-only; AI deferred until dogfooding reveals concrete use cases).
- Drift presentation: **ambient, per-bucket, left panel** (not a center banner).
