# Moduo Tasks Module — Build Playbook

How to build the Tasks module with Claude Code, start to finish. Pairs with `moduo-tasks-feature-spec.md` (the context anchor) and `docs/architecture-vocabulary.md` (terminology).

---

## The Process (start to finish)

**Setup, once:**
- Put `moduo-tasks-feature-spec.md` and `docs/architecture-vocabulary.md` in the repo (e.g. `docs/`).
- Make sure Claude Code can read both.

**Every session, in order:**
1. **Anchor.** Start the session by telling Claude Code to read `docs/moduo-tasks-feature-spec.md` and `docs/architecture-vocabulary.md` before doing anything. This rebuilds context that doesn't carry between sessions.
2. **Orient.** Have it read the relevant existing code and report back its understanding + a short plan, *before* writing code. Correct the plan if it's off.
3. **Scope.** Paste that session's prompt (below). One session = one coherent, shippable chunk. Resist letting it run ahead into later sessions.
4. **Build.** Let it implement. Keep it inside the scope.
5. **Verify.** Run it. Dogfood the slice. Note what's wrong or friction-y.
6. **Checkpoint.** `git commit` the working state. Have Claude Code append a 3–5 line entry to `docs/build-log.md`: what it built, key decisions, anything deferred or broken. This is the breadcrumb the next session reads.
7. **Feed back.** If dogfooding changed a decision, update the spec *first*, then carry on. The spec is the single source of truth; code follows it, not the reverse.

**Rules of thumb:**
- If a session balloons past its scope, stop and split it. Sprawl is where context and quality die.
- One decision changes → update the spec, not just the code.
- The spec + vocab + build-log together let any fresh Claude Code session pick up cleanly.

---

## Session 1 — Data Model & Foundation

> Read `docs/moduo-tasks-feature-spec.md` and `docs/architecture-vocabulary.md` first, then the existing data layer and any current tasks/calendar code. Report your understanding and a plan before writing.
>
> Scope for this session: the **data model only**. Implement the Task, Bucket, and Tag schemas per section 11 of the spec, with migrations. Include both `due_date` and `scheduled_at`, `committed_for` / `commit_order`, `reschedule_count`, `recurrence`, and the computed `drifted` logic. Seed the reserved Inbox bucket. No UI this session.
>
> If existing merged tasks/calendar code conflicts with the separated-module model, propose a migration path before changing anything — don't silently rewrite.
>
> When done: summarize the schema, list anything you deferred, and append a build-log entry.

---

## Session 2 — Plan Mode: Buckets + List + Capture

> Read `docs/moduo-tasks-feature-spec.md`, `docs/architecture-vocabulary.md`, and `docs/build-log.md` first. Then the existing shell/layout code so you build inside it.
>
> Scope: **Plan mode, visible and usable.**
> - Left panel: mode toggle (Plan/Execute — Execute can be a stub this session), bucket list (one open by default, all expandable), instant add-bucket (no cooldown), the "All" and "Inbox" selections. Per-bucket drift indicator can be a placeholder for now.
> - Center: **List view**, Linear-style — keyboard-first, dense rows, grouping, inline quick-edit, no modals for small changes. Row: checkbox, title, scheduled time, due marker, bucket tag.
> - Capture: `cmd+n` new-task modal, single text field, Tier-1 parser (dates + recurrence via `chrono-node` + `rrule.js` + vocabulary wrapper). Land directly with a confirmation toast showing the parse. No AI.
>
> Follow design principles 1–5. No required-field forms, no triage queue, no blocking modals.
>
> When done: summarize, note deferrals, append a build-log entry.

---

## Session 3 — The Plan → Commit → Execute Loop

> Read the spec, vocabulary, and build-log first. This is the core feature — the reason the module exists.
>
> Scope: **commit + Execute mode.**
> - **Commit action** in Plan mode (List view): adds a task to today's queue (`committed_for` = today, ordered via `commit_order`). Visually distinct committed state.
> - **"Start my day"** ceremonial transition into Execute mode, with a brief "N tasks committed. Let's go." confirmation.
> - **Execute mode**, isolated (hide buckets/backlog/other views):
>   - Now card: current task (large title, bucket), auto-running timer (pomodoro default — fixed work/break; show estimated duration as context), "Mark done → next".
>   - Queue below: remaining committed tasks, items 3+ away dimmed, read-only while a task is active. "Mark done" advances the next task into the Now card.
>   - End of queue: factual done-vs-committed summary.
> - Reschedule from Execute: allowed, returns to limited Plan; increment `reschedule_count` as **ambient** info only — no modal, no forced reason, no blocked save.
>
> When done: summarize, note deferrals, append a build-log entry.

---

## Session 4 — Completion: Board, Drift, Default View

> Read the spec, vocabulary, and build-log first.
>
> Scope: **fill in the remaining Plan-mode surface.**
> - **Board view**: kanban columns, groupable by status (or bucket in the "All" selection).
> - **Drift handling**: real per-bucket ambient indicators in the left panel ("Fitness · 3 drifted"), soft styling, never red/overdue. Click → batch-triage (reschedule / archive / ignore). No nagging, no per-task red flags.
> - **Default-view logic**: on opening Tasks, show the time-block-mapped bucket if time-blocks exist, else the last-opened bucket, in the last-used view. Never the full cross-bucket list first.
>
> When done: summarize, note deferrals, append a build-log entry. Flag anything in the spec that dogfooding has shown should change.

---

## After v1

Once the four sessions are shipped and you've dogfooded for a stretch, revisit (in roughly this order): the Tasks right-panel calendar surface + drag-to-schedule, then the Calendar module itself (its own spec + playbook), then the deferred items (AI, Gantt, weekly review, two-way sync). Let dogfooding friction set the priority, not this list.
