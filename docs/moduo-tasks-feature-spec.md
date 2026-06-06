# Moduo Tasks Module — Feature Spec (Context Anchor)

**Purpose of this file:** the canonical, stable description of the Tasks module. Keep it loaded in every Claude Code session for this feature so context isn't lost between sessions. It describes *what the feature is*. The separate build playbook describes *what to build in each session*.

This is a living spec. When a decision changes, update this file first, then code.

---

## 1. Project Context

Moduo is a modular productivity desktop/web app by **Maciej** (designer/founder) and **Mike** (developer). The app shell — top bar, bottom bar, 3-panel layout — is already built. This spec covers the **Tasks module** content and behavior inside the middle area.

**Target user:** people with ADHD who get overwhelmed by traditional task apps. Maciej is the dogfooding user.

**Companion docs:** `docs/architecture-vocabulary.md` (terminology — defer to it).

---

## 2. App Shell (already built — context only)

3×3 layout. Top bar: module/workspace selectors + avatar. Bottom bar: global add, search, settings, panel toggles. Middle area: left (navigation), center (content), right (support/context, collapsible). Tasks owns the middle area when active. Do not rebuild the shell.

---

## 3. Architecture: Two Modules

Tasks and Calendar are **separate modules** that integrate but stay independent.

- **Tasks module** (this spec): buckets, Plan/Execute modes, List/Board views, capture, commit queue.
- **Calendar module** (separate spec): timeline showing scheduled tasks + events, drag-to-schedule.
- **Independence:** each must work fully with the other hidden. Task scheduling (`scheduled_at`) is a plain field — it works even if Calendar is disabled; the user just loses the visual timeline.

---

## 4. The Two Modes

Toggled at the **top of the left panel**. The split is the heart of the module: make *starting work* easier than *reorganizing work*. Plan once, then stop planning.

### Plan Mode (default)

**Left panel:**
- Mode toggle (Plan / Execute) at the very top.
- Bucket list: name + task count. One bucket open by default; all expandable.
- Per-bucket **drift indicator** — ambient, soft (e.g. "Fitness · 3 drifted"). Never red, never "overdue". Click → batch-triage for that bucket (reschedule / archive / ignore).
- Add-bucket control — instant, no cooldown.
- A cross-bucket "All" selection and the reserved "Inbox" bucket.

**Center panel:**
- View switcher: **List | Board** (Gantt deferred).
- **List view** — modeled on Linear: keyboard-first, dense-but-scannable rows, grouping (status/priority/bucket), inline quick-edit (no modals), command-palette speed. Row shows: complete-checkbox, title, scheduled time (if any), due-date marker (if any), bucket tag.
- **Board view** — kanban columns; groupable by status (or bucket in the "All" selection).
- **Commit action** on a task → adds it to **today's commit queue** (ordered). Deliberate, visually distinct. Means "doing this today", not "scheduled at a specific time".

### Execute Mode

Entered via a ceremonial **"Start my day"** (or the mode toggle). Brief confirmation: "N tasks committed. Let's go." View is **isolated** — bucket list, backlog, other views all hidden.

- **Now card** (dominant, top): current committed task — large title, bucket, timer, prominent "Mark done → next". Timer auto-runs on entry (assume the user is working).
  - **Timer:** pomodoro (fixed work/break) as default; show the task's estimated duration as context. (Open: per-task duration countdown is an alternative — default to pomodoro unless told otherwise.)
- **Queue** (below): remaining committed tasks; items 3+ away dimmed; read-only while a task is in progress. "Mark done" slides the next task into the Now card.
- **End of queue:** factual summary — done vs committed (e.g. "3 / 4"). No streaks, no gamification.
- **Reschedule from Execute:** allowed; returns to limited Plan. Track a reschedule count as **ambient** info on the task — never a modal, never a forced reason, never a blocked save (principle 5: mirrors not walls).

---

## 5. Buckets

Exclusive (one task = one bucket). No cooldown. Inbox is reserved/undeletable. Tags are a separate, workspace-level cross-cutting concept.

Example buckets: Junction, Fitness, Diet, Money, Moduo, Plugin Client, EP, Hangout Realm, Godot Game, Inbox.

---

## 6. Capture

Keyboard: `cmd+n` → new item in current module (Tasks → new-task modal). `cmd+shift+n` → numbered module selector, then `cmd+number`. `cmd+k` (separate workstream) → Spotlight-like search.

New-task modal: single text field, natural language. Parser extracts dates + recurrence only. Bucket defaults to selected/last-used. Enter submits; task lands immediately. **Land directly, fix lazily** — no triage queue; a confirmation toast shows the parse ("Take vitamins — recurs daily at 8:00 AM. Change?") with one-click edit.

Anti-patterns: required-field forms before submit, triage queues, multi-step wizards, forced bucket dropdowns.

---

## 7. Parsing (No AI in v1)

**Does:** dates/times via `chrono-node`; recurrence via a constrained vocabulary ("every day", "every weekday", "every monday", "every 2 weeks") → `rrule`-compatible structure + next-occurrence datetime.
**Doesn't:** semantic bucket inference, subtasks, duration/energy estimation, tag suggestion.
**Fallback:** Inbox when nothing applies.
**Visible interpretation** after submit (the toast).
**Recurrence impl:** `chrono-node` + `rrule.js` + small wrapper for the vocabulary; on no-match, a polite "couldn't parse" message rather than a guess. No complex recurrence picker in v1.
**AI deferred** entirely for v1.

---

## 8. Scheduling & Calendar Relationship

- Two optional time fields per task: **due_date** (when due) and **scheduled_at** (when planned). Both in the data model now, even if UI surfaces scheduled time first.
- **Commit ≠ schedule.** Commit = today's queue. Scheduling a clock time is separate and optional.
- The Calendar module renders scheduled tasks + events and owns rich drag-to-schedule.
- Scheduling must work with Calendar hidden (`scheduled_at` is just a field). Don't gate it behind Calendar being enabled.
- Rich drag-to-schedule UI and the Tasks right-panel calendar surface are **deferred**.

---

## 9. Default View (opening Tasks)

1. Time-blocks defined → show the bucket mapped to the current time-of-day block.
2. No time-blocks → last-opened bucket.
3. Open in last-used view (List/Board).
4. Never the full cross-bucket list first.

---

## 10. Design Principles (load-bearing)

1. Quiet and minimal until the user decides otherwise.
2. Decisions live with the designer, not the user.
3. Friction behind the dump, not in front of it.
4. ADHD-aware defaults — identical behavior whether productive or crashed.
5. Mirrors, not walls — ambient information, never blocking acknowledgment.

---

## 11. Data Model (suggested — adjust to codebase)

**Task:** `id`, `workspace_id`, `bucket_id` (req), `title`, `description`, `due_date?`, `scheduled_at?`, `duration_minutes?` (default-on-drop, resizable), `recurrence?` (rrule), `energy_level?` (low/med/high), `priority?` (low/med/high), `status` (todo/in_progress/done/archived), `committed_for?` (date), `commit_order?` (int), `reschedule_count` (int, ambient), `created_at`, `updated_at`, `drifted` (computed: `scheduled_at < now() AND status NOT IN (done, archived)`).

**Energy vs. priority (two distinct optional axes).** `energy_level` = *how demanding* a task is (the cost to do it); `priority` = *how important* it is to get done (its weight in time). Both are optional, unset by default, and rendered **ambiently** — never red, never alarming (principles 4 & 5). Both are offered as opt-in group-by dimensions in List view alongside None / Status / Bucket. `priority` uses low/med/high to mirror `energy_level`; an `urgent` tier is a non-breaking future enum extension if dogfooding wants it.

**Bucket:** `id`, `workspace_id`, `name`, `is_system` (Inbox), `created_at`. No cooldown field.

**Tag:** `id`, `workspace_id`, `name`, polymorphic association.

**Event** (Calendar module — here for completeness): fixed-time, no completion, native or read-only feed.

---

## 12. Deferred (not v1)

Right panel content for Tasks; all AI (capture inference, "Stuck?" breakdown, suggestions); Gantt view; weekly review / accuracy charts; team & collaboration; two-way calendar sync (read-only only); native events UI (model can anticipate).
