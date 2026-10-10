# Lane 1: Tasks today, a code-level audit

> Raw research report from the Tasks re-plan, 2026-10-09 (`maciej` @ 95d988b0), kept for its evidence. The synthesis and the open calls are in [../REPLAN.md](../REPLAN.md). Nothing here is decided.

**Baseline:** `maciej` @ 95d988b0, 2026-10-09. Landed: TV-Q1, TV-F1, TV-D1–D4, TV-T1, TV-U1, TV-U3, AT-1 (data only), DS-1–4. Read only. The one thing I ran was a probe of the capture parser (bun, Europe/Warsaw).

**Where the detail lives.** Fuller notes: [current-state-focus-calendar-home.md](./current-state-focus-calendar-home.md) (Focus engine, Calendar, Home, spine) and [current-state-board-timeline-dnd.md](./current-state-board-timeline-dnd.md) (Board, Timeline, drag and drop). The data/runtime/MCP sub-notes stay out of the repo.

**Citations.** Paths are relative to the repo root.

| Short name | File |
|---|---|
| `UTM` | src/features/tasks/hooks/use-tasks-module.ts |
| `TPV` | src/features/tasks/ui/tasks-plan-view.tsx |
| `TLV` | …/ui/task-list-view.tsx |
| `ROW` | …/ui/task-row.tsx |
| `RAIL` | …/ui/bucket-rail.tsx |
| `BRD` | …/ui/task-board-view.tsx |
| `CARD` | …/ui/task-card.tsx |
| `TL` | …/ui/task-timeline-view.tsx |
| `DP` | …/ui/task-detail-panel.tsx |
| `DPROP` | …/ui/task-detail-properties.tsx |
| `DHDR` | …/ui/task-detail-header.tsx |
| `EXEC` | …/ui/execute-view.tsx |
| `CAP` | …/ui/capture-modal.tsx |
| `RTW` | src/lib/runtime.web.ts |
| `MCP` | supabase/functions/moduo-mcp/modules/tasks.ts |

Any other file is cited by its basename.

**How each surface is written up:**
- **a** what it does
- **b** what it can't do
- **c** where it disagrees with other surfaces
- **d** an old decision still showing
- **e** a smell or bug
- **f** accessibility
- **g** scale

"Traced" means I followed it through the code but didn't run it.

---

## 0. Under the hood (true for every surface)

**Loading**
- Each page that shows tasks runs its own `useTasksModule` and loads the whole workspace when it mounts: Tasks (tasks-page.tsx:41), Calendar (calendar-page.tsx:37), Notes (notes-page.tsx:189), Email (email-page-view.tsx:174).
- About six more places fetch the same full bundle without caching: Home, ⌘⇧K capture, the bell, contact hubs, export (partA §A3g).
- The bundle holds:
  - every live task, with done and archived kept forever
  - every bucket and tag
  - every tag link for every kind of item
  - every dependency
- It's read in sequential 1,000-row pages. Caps are 5,000 tasks and 10,000 tag links, and the cut is made by `position`, not by status (RTW:2049-2110; paged-select.ts:32-38).
- Desktop uses this same Supabase runtime (runtime.tauri.ts:316-318). runtime.types.ts:840-842 still says redb; that's stale.

**Sync.** Tasks has no Realtime, no refetch when the window regains focus, and no polling. Notes has realtime and focus refetch (notes-page.tsx:47, 211).
- A teammate's change appears only after you navigate away and back.
- Any failed write reloads everything (UTM:381-393, 430-433).

**Writes**
- All writes update the screen first. Status goes through `tasks_op_set_status`, assignee through `tasks_op_assign`, queue and time through their own ops. Everything else is a field-level UPDATE: the last write to a field wins, and `updated_at` is stamped by the client (UTM:742-825; RTW:3439-3448).
- About a dozen triggers are attached to `tasks`; partA counts 14, and several fire only when particular columns change. The row-level security check runs `can_access` per row, with up to three nested bucket checks (partA §A1).

**Rendering.** The hook returns a new object on every render (UTM:1552-1623), and its callbacks depend on `bundle.tasks` (UTM:815-824). So any edit re-renders every row and card. No view is virtualized.

**Recurring tasks.** A repeating task only comes back when a page that hosts tasks loads (UTM:837-864). There's no server job.

**Adding a status is a trap.** The row schema's status enum is strict, and rows that fail it are dropped silently (contracts/rows.ts:58, 485-499). A new status would make those tasks vanish on older clients.

---

## 1. Surfaces

### 1.1 Tasks rail
- **a** Top to bottom:
  - A Plan/Focus switch (RAIL:154, 282-303).
  - All.
  - Queue (its internal key is still `today`).
  - My tasks, shown only with two or more members (default-view.ts:108-111).
  - Inbox, with a drift dot. Its menu is Triage, and only appears while something has drifted (RAIL:184-211).
  - Buckets, then sections.

  A bucket's ⋯ menu has Rename (also F2), Share, Triage, **Open at** (Morning / Afternoon / Evening), Section and Delete…. Delete asks first, gives 8 s to undo, then moves the bucket's tasks to Inbox (RAIL:389-444; UTM:1449-1484).
- **b** Missing:
  - Views, Archived and Recently deleted.
  - Bucket colour, icon or description.
  - Reordering buckets (their order is creation order).
  - Rail rows as drop targets (no drag-and-drop import in RAIL:1-20).
  - Renaming or deleting a section.
  - Renaming the Inbox.
  - Arrow keys.
- **c** The counts include subtasks (UTM:204-211), while lists nest subtasks collapsed.
- **d** Old decisions still showing:
  - The Plan/Focus mode.
  - "Open at" (`task_time_blocks`) picks the bucket you land in on every visit, ahead of the one you last used (default-view.ts:81-104; TPV:258-282).
  - A section is only a `group_label` string on each bucket (helpers.ts:443-462).
  - Inbox is a system bucket per person (RTW:3385-3420).
- **e** Bucket problems:
  - Rename and Section re-save the whole bucket row, including `deleted_at`, so a stale client can overwrite another change or undelete (RTW:2117-2146).
  - Deleting a bucket runs two client calls, and the result of "move its tasks to Inbox" is never checked (RTW:2148-2169).
- **f** The drift dot is a 16 px target (RAIL:318-323).

### 1.2 Toolbar
- **a** Title, then Group (List only), then the tag filter (once tags exist), then Display. Display offers Completed (Hidden / 7 days / All) and which properties show on rows (display.ts:20-41). Then the List / Board / Timeline switch, then New (plan-view-header.tsx:41-63).
- **b** Missing:
  - Sort.
  - A search box.
  - Any filter beyond tags. The tag filter is OR only, kept in memory, and cleared per workspace (TPV:173-181, 330-338).
  - Saved views.
  - Group by assignee, due date or tag (TLV:104-110).
- **c** Remembered in different places:
  - Display is remembered per scope (display.ts:60-63).
  - Grouping, view and zoom are remembered per workspace (TPV:236-240).
  - The Timeline gets no Display at all (TPV:652-685).

  The DS-4 FilterBar exists but nothing imports it (partC).

### 1.3 List
- **a** A row reads left to right:
  - checkbox
  - title: rename with double-click, Enter or `e`; one line only
  - counts: tags, subtasks done/total, blocked, repeats (task-meta.tsx:78-120)
  - "↳ parent"
  - the bucket, when the scope doesn't already imply it
  - fixed columns for priority, energy, date, assignee and queue. A column disappears when no row in the list uses it (row-layout.ts:55-68).

  The date shown is whichever of scheduled and due comes first (row-layout.ts:122-145). Completed tasks fold into "N completed · show". A task you check off stays in place until you change scope (TLV:193-222). Subtasks nest under their parent, collapsed (TLV:163-177).

  Keys (list-keys.ts:68-115):

  | Key | Action |
  |---|---|
  | j / k, ↑ / ↓ | move |
  | → / ← | expand / collapse |
  | Space, x | done |
  | Enter, e | rename |
  | c | capture |
  | b / s / d | bucket / schedule / due popovers |
  | q | queue |
  | ⌘⌫ | delete |
- **b** **You can't reorder tasks within a bucket.** Drag-to-reorder exists only in the Queue (TPV:693; TLV:561). In a flat bucket list, dragging a task onto another makes it a subtask (TLV:576-630). Grouped lists have no drag at all.

  Also missing: multi-select, bulk edit, sort, moving with the keyboard, an inline add row, and wrapping titles.
- **c** Mixed behaviour:
  - In All, grouped by bucket, only the first group opens, and that resets every time you change scope (TLV:229-236).
  - Nothing in the list sets "In progress".
- **e** The schedule and due popovers use native inputs that save on every `onChange`, so typing a date fires several server writes (ROW:596-599, 626-629). Scheduling from a row also bypasses `tasks_op_reschedule`, so it never reaches the activity trail.
- **f** Screen reader and target problems:
  - The list is a `role="grid"` with no gridcells. Rows aren't focusable and there's no `aria-activedescendant`, so a screen reader never hears the cursor move (TLV:663-679; ROW:145-150).
  - Group headers lack `aria-expanded` (TLV:759-778).
  - The checkbox, queue and expand targets are 16 px (complete-toggle.tsx:38; ROW:186).
  - The list's keys aren't in the `?` sheet (global-shortcuts-dialog.tsx:24-33).
- **g** Each row mounts a context menu, 2 popovers and 3–6 tooltips (ROW:345-431, 547-566, 674-716). In All grouped by status, every row of the workspace renders.

### 1.4 Board (partC)
- **a** Columns are status (todo / in progress / done) or bucket. Bucket columns are offered only in All and My tasks (BRD:75-77, 128-129, 165-185).
  - Dragging within a column writes `position`.
  - Dragging across columns writes status (through the op) or bucket (BRD:244-251).
  - Display applies, with an "N completed · show" line per column.
  - Subtasks are hidden; the parent shows n/m (BRD:134-164).
  - Card menu: done, queue, skip occurrence, move, assign, priority, energy, delete (CARD:132-214).
- **b** Missing:
  - Rename, schedule and due on the card. The List has all of them.
  - Add per column, WIP limits, collapsing columns, swimlanes.
  - Grouping by assignee, priority or date.
  - An empty-board state.
- **c** Board and List disagree:
  - Both use the same `position`, so a Board reorder silently rewrites the List order, which the List itself can't change (UTM:185-189).
  - Bucket columns show empty buckets and ignore the rail's sections (BRD:166).
- **e** Bugs, traced:
  - **A reorder in the Queue scope writes a `position` worked out from neighbours in queue order.** The card snaps back and the bucket's order changes (BRD:237-246; reorder.ts:56-61; helpers.ts:154).
  - Dropping a card into another column shows no gap or highlight over the cards, and it always lands *before* the card you hovered (reorder.ts:65-67).
  - Columns accept drops into buckets you can't edit; the server refuses, you get an error toast and a full reload (BRD:374).
- **f** Cards are Tab stops: Space lifts a card, but no key opens one (CARD:91-118). Screen readers hear dnd-kit's default announcements, which read raw ids and task UUIDs.
- **g** No memo or virtualization. Bucket mode filters every task once per bucket.

### 1.5 Timeline, its tray and dragging (partC)
- **a** The zoom levels are Week, Month (the default) and Quarter. The time window is fixed, capped at 120, 400 and 800 days respectively. Bars come from `scheduledAt` and `dueDate`, not from the duration (timeline-geometry.ts:221-267). The lanes are buckets only.
  - A today line and dependency arrows (blocker → blocked), plus a connector dot that adds a blocker (TL:597-645).
  - The tray holds undated tasks. Dropping one on a day sets 09:00 that day; dragging a bar's ends writes the scheduled start and the due date (timeline-geometry.ts:444-508).
- **b** Missing:
  - Display.
  - Assignee lanes.
  - Bar meta: priority, assignee, tags.
  - Creating a task on the axis.
  - Removing a dependency arrow.
  - Dragging past the window edge.
  - Undo.
  - Keyboard control. The only things that take focus are a bar's checkbox and the tray chips, which open on Enter (TL:1064-1066, 778-788).
- **c** Disagrees with the other views:
  - Dated subtasks get their own bars, while List and Board nest them.
  - Selection is drawn as a ring, not the tint.
  - The fallback lane is "Other", where the Board says "Inbox".
  - The Timeline isn't part of the page-level drag context, so nothing can be dropped onto the link hub from it.
- **d** Single-row recurrence: catch-up moves `scheduledAt` but never `dueDate`, so a recurring task that has a due date collapses into a 1-day bar (recurrence-engine.ts:121-124, 147-150).
- **e** Bugs, traced:
  - **The tray's drop target is only as tall as the lanes.** On an empty timeline it's an 8 px strip, so the "drag a task up from the tray" hint leads nowhere (TL:478, 515-518, 745, 247-253, 651-657).
  - Tray chips have no `data-task-id`, so a deep link can't reveal them.
  - The whole tree re-renders every minute and on every hover (TL:131-140).
- **f** Bars are unfocusable divs with no role. Move, resize and connect are mouse only. The edge hit zone is about 4.7 px at Quarter zoom.
- **g** With no virtualization the canvas runs to about 34–36k px wide. The two SVG overlays span the whole canvas.

### 1.6 The drag-and-drop system (partC)
- **a** Built on dnd-kit 6.3.1, with one page-level context whose collision rules change with the view (TPV:735-770). List rows and Board cards can also be dropped on the link hub to link them (TPV:790-833). The Timeline runs its own nested context.
- **b** Not possible:
  - Dropping on rail buckets, the Queue row or My tasks.
  - Dragging from Tasks to the Calendar.
  - Dragging several items at once.
  - Undo for any drag.
- **e** Unused parts:
  - In this setup each view's own sensors are ignored (task-dnd.tsx:175-177).
  - The "column" target type is declared but never used.
  - DS-4's InsertionLine, NestPreview and DROP_TARGET are never mounted in Tasks.
  - Drag visuals are hand-rolled, four ways.
- **f** No custom screen-reader announcements are passed. Rows can't be focused, so only Board cards can be dragged with the keyboard.

### 1.7 Queue (the List's Queue scope)
- **a** My own `task_queue`. Drag to reorder (UTM:649-677). Done tasks stay until the next load. A task in someone else's queue shows their avatar with a ring. Queuing a blocked task first offers its unblocked blockers (TPV:391-404).
- **b** You can only see your own queue: there's no team view. Never grouped.
- **c** **New from the Queue creates the task in Inbox without queuing it, so it never shows up there** (TPV:354-356, 889). Undoing a delete doesn't put the task back in queues (UTM:1168).
- **d** The legacy commit ops are still in the ops manifest (ops-manifest.ts:48-78), and the recurrence engine still clears `committedFor` (recurrence-engine.ts:125, 168, 189).

### 1.8 Focus view, focus engine and away prompt
- **a** The Now card shows the bucket, due date, tags, title, a sub-line, the description and a subtask checklist. Below it:
  - Opt-in tracking: pause/stop, pomodoro on/off, +5/15/30 min, set total.
  - Skip (to the end of the queue) and Done.
  - A read-only "Up next".
  - At the end, "x / y Done" and "Add one more…" (EXEC:130-659).

  The engine keeps wall-clock time per user in localStorage and saves every 60 s with idempotent keys. Only one browser tab runs the clock. After a gap of more than 90 s it asks: Keep, Discard, or Count as break. A bottom-bar chip shows the session (partB §1-2).
- **b** In the Focus view you can't:
  - pick another "Up next" task
  - remove a task
  - reorder
  - open details
  - use keys

  The only exits are the rail switch and "Back to Plan".
- **c** Mismatches:
  - The right panel keeps showing the task selected in Plan, not the Now task (TPV:835-857).
  - **Tracked time is saved only while /tasks is open.** The save target is registered only there (TPV:203-209), and `flush()` gives up without one (engine.ts:382). Time tracked elsewhere is held back until you next open Tasks.
  - Three separate clocks exist: this engine, Calendar's block focus, and the Home pomodoro.
- **d** The Plan/Focus split survives, remembered per workspace: leave Tasks in Focus and it reopens in Focus (TPV:98-100, 236).
- **e** Bugs:
  - For a view-only member, "Focus time not saved yet" never clears (UTM:1031). It's an edge case: a viewer only gets here with a task already in their queue, for example after their role was downgraded.
  - The pomodoro inputs save on every keystroke (EXEC:569-591).
- **f** The Skip button has no focus ring (EXEC:436-442). The away prompt never moves focus to its buttons.

### 1.9 Detail panel (with comments, hub and mention)
- **a** Header: a bucket breadcrumb that moves the task, the parent, Queue (showing who has claimed it), Copy link, and ⋯ with Duplicate / Detach / Archive · won't do / Delete (DHDR:84-171).
  - Title, plus a description that saves on blur, where @ or / inserts a link to an item (DP:230-250).
  - Always shown: Status, Assignee (with a warning when the person can't see the bucket), Priority, Due, Tags.
  - Shown once set: Energy, Scheduled, Time, Repeat (DPROP:92-209).
  - Sections: Subtasks, Blocked by, Blocks (read-only), Linked, then comments and activity (DP:255-305).
- **b** Missing:
  - Attachments.
  - A start date.
  - More than three priority levels.
  - Custom repeat rules: four presets only (parse/recurrence.ts:12-17).
  - Task↔task links other than "blocked by", or any link to an email (DP:73).
  - Editing subtasks from the panel.
  - People mentions in the description (entity-text-editor.tsx:233-252).
  - Rich comments: text only, with no edit or delete (partB §8).

  **The trail only records changes made through ops.** Edits to title, due date, priority, bucket, tags, estimate, or creating and deleting a task leave no history (activity.ts:47-112; partA §A4).
- **c** Mismatches:
  - **"Reopen" can't be reached.** Archived tasks are filtered out of every scope and every deep link (TPV:321, 325, 534-540).
  - The same field is called "Estimate" here (DPROP:584-586) and "Duration" in capture (CAP:389-422).
  - Linked tasks in the hub show no status, and its "Open work" section includes done tasks (use-entity-hub.ts:57).
- **d** Recurrence and duration:
  - A repeat rule needs `scheduledAt`, so picking a preset sets one (DPROP:388-394).
  - The Time row's estimate is `duration_minutes`.
- **e** Performance and leftovers:
  - The blocker picker runs a cycle check on every task, on every render, even while closed (DP:619-659).
  - The panel remounts for each selected task (DP:90-93) and loads activity, comments and hub with no debounce (task-feed.tsx:53-65; use-entity-hub.ts:35), so holding j floods requests.
  - "Rescheduled N×" (task-feed.tsx:216) reads a counter nothing has incremented since TV-D2 (20261008171500_tasks_personal_queue.sql:505-512).
- **f** Hover-only buttons: the remove-link ⋯ in the hub and the remove-dependency ✕ (DP:598-611).

### 1.10 Capture: the New dialog, ⌘⇧K and the parser
- **a** The dialog has:
  - A title that's parsed for dates.
  - A plain-text description.
  - Pills for bucket, assignee, priority, energy, schedule, due, repeat and duration.
  - "Create more" (CAP:184-441).

  A new task lands in the selected bucket, or in Inbox. ⌘⇧K works from anywhere: it parses the line, then writes to Inbox, assigned to you, and reads the full bundle just to work out the end position (capture-command.ts:210-236).
- **b** Not supported:
  - Tags, a parent, the queue, dependencies or attachments.
  - ⌘⇧K can't set a bucket, priority or assignee. Its Open button goes to /tasks, not to the new task.
  - The parser's `unparsedRecurrence` flag is never shown (capture-parser.ts:182-200).
- **e** What the parser did with sample input (Friday, 10:00):

  | Typed | Result |
  |---|---|
  | "Send March report" | title "Send report", due 1 Mar 2027 |
  | "Read chapter 3 May" | title "Read chapter", due 3 May 2027 |
  | "Pay rent every month on the 1st" | monthly from **9 Nov**, title "Pay rent on the 1st" (`dtstart` = today, capture-parser.ts:186-188) |
  | "Call Mike at 5" | **05:00 tomorrow** |
  | "…by Dec 15 #school @ola p1" | title keeps "by #school @ola p1" |

  The time of day stored with a due date depends on where you set it: chrono's time (noon, or "now"), local midnight (CAP:357; ROW:628), or the DateField's value (DPROP:137). `due_date` is a timestamptz, so a teammate in another timezone can see a different day. This is already in docs/gotchas/spine.md:37 and still open.
- **f** The pill "×" buttons have no focus style (CAP:511-519).

### 1.11 Context menus, drift triage, the frontier dialog
- **Row menu** (ROW:345-431): Rename, Done, Queue, Skip occurrence, Schedule…, Due…, Move…, Detach, Assign, Priority, Energy, Delete.
  - Missing: Archive, tags, duplicate, copy link, add subtask, make subtask of…, blocked by…, start focus.
  - View-only members get no menu at all (ROW:343).
- **Drift triage.** Drift means a scheduled time has passed (model.ts:310-317). Triage works per bucket: +1 day, +7 days, Archive or Ignore, for one task or all of them.
  - A passed **due date** is never flagged anywhere (row-layout.ts:135-136).
  - "Apply to all" fires one RPC per task, and there's no Undo for a bulk Archive.
- **Frontier dialog.** Offers the blocked task's unblocked blockers, or "Queue anyway".

### 1.12 Empty, loading and error states; toasts and Undo
- **a** States:
  - An error banner with Retry. The "not migrated" version tells you to "use the desktop app" (TPV:700-720).
  - A notice when the list was truncated (TPV:877).
  - "Nothing here yet" when empty (TLV:802-829).

  Undo lasts 8 s (undo-toast.tsx:11) and covers deleting a task, a bucket or a tag.
- **b** No Undo for marking done, archiving, moving, a bulk triage or a capture. After those 8 s a deleted task can't be brought back from the app, and it's purged after 30 days (purge-deleted/index.ts:4-6).
- **c** **List and Board have no loading state.** "Nothing here yet" flashes on every visit until the data arrives (TPV:656-698). Only the Timeline waits for it (TL:203, 651). The same message shows when a filter hides everything.
- **e** Server error text is shown to people as-is (UTM:388, 431).

### 1.13 Deep links (`?id=`) and search
- **a** `?id=` takes a task id (select it, switch scope, reveal it) or a bucket id (switch scope). The URL follows the selection after 250 ms. Copy link gives a UUID URL (search.ts:29-44; TPV:521-610; DHDR:63-72).
- **b** There's no search inside Tasks. ⌘K matches titles only (an `ilike` on `entities.label`), sorted by name, 20 results (RTW:2707-2719).

  **And ⌘K, like @ and / mentions (use-mention-search.ts:100), can't find most tasks at all.** A task only gets a row in `entities` from `entities_op_ensure`, which runs when the task is first given a link, a dependency or a comment (20260627130000_tasks_relations_to_links.sql:44-47). Creating a task never registers it. That insert is `ON CONFLICT DO NOTHING` (20260625120000_spine_entity_links.sql:230-232), so renames never reach the registry either. Nothing on the task path calls `entities_op_upsert`; contacts, events and notes all do.
- **e** Silent failures:
  - Links to archived tasks are dropped without a word.
  - **Assign someone a task in a bucket they can't see.** That's supported, and the preview warns "they'll only see this task" (20261008130000_definer_reads_item_visibility.sql:271-296). For that person, the task's bucket reads "Inbox" (TPV:311-317), and every deep link to it, including the notification, ends up on a different task (TPV:290-299, 501-508, 559). Traced.

### 1.14 Assignee, claims, My tasks; tags
- **a** People:
  - Each task has one assignee, or none.
  - View-only members are listed but can't be picked (assignee-options.ts:47-58).
  - My tasks = assigned to me, not archived (default-view.ts:118-121).
  - A claim is someone else's queue entry, shown as their avatar.

  Tags live in one shared workspace store: a count on each row, chips in the panel, and an OR filter.
- **b** Missing:
  - Filtering or grouping by assignee, or a "created by me" view.
  - A workload view inside Tasks.
  - Assignee keys.
  - Tags in capture, AND filters, grouping by tag.
- **e** `previewAssign` calls Supabase directly and skips the runtime layer (assignees.ts:7, 23-30).

### 1.15 Recurrence, subtasks, dependencies, time, attachments
- **Recurrence** reuses one task row:
  - `scheduledAt` holds the current occurrence, and the next date is stored in the rule's `nextOccurrence` pointer.
  - Marking it done shows "Done — next …".
  - The task comes back only when the app next loads after that date, and missed occurrences collapse into one.
  - There's no `completed_at`, so no completion history or streaks. The "7 days" completed view goes by `updated_at` (completed.ts:20-22).
  - **Checking a repeating task off on Home, or through MCP's `calendar_complete_block`, can undo itself.** Traced. Neither updates the rule's pointer (tasks-widget.tsx:92-94; the op keeps `recurrence` when `p_recurrence` is null, 20260612150000:277-278). On a task whose rule hasn't cycled yet, the pointer still equals the current occurrence, because the parser and the presets set both to the same instant (capture-parser.ts:189-196; parse/recurrence.ts:56-60). So on the next load, catch-up sees the pointer has passed and reopens the task the same day, now drifted (recurrence-engine.ts:109-127).
- **Subtasks** are one level, enforced by a trigger (20260612130000_tasks_add_parent.sql:28-58).
  - **Moving a parent leaves its subtasks in the old bucket.** Nothing cascades (RTW:2211-2217). They then show at the top level with a "↳ parent" caption.
  - Deleting a parent promotes its subtasks to the top level (RTW:2229-2233).
- **Dependencies** are `task_relations` edges, with a cycle guard in the client and a trigger. "Blocked" is computed when read.
  - "Blocks" can't be added from the blocker's side (DP:552-571).
  - **Two stores:** links of kind `blocks` are copied one way into `entity_links`. The hub or MCP can create or retype a `blocks` link that never touches `task_relations`, so it doesn't block anything. `blocks-bridge.ts:22` is dead code (partA §A7.5).
- **Time:** focus stretches and manual adjustments are saved through an op with idempotency keys (UTM:892-1073). There's no timesheet, report or back-dated entry, and the estimate is `duration_minutes`.
- **Attachments (AT-1):** the server side works — storage, a 50 MB per-file cap, and a 30-day trash. **The app has no attachment UI at all** (task-feed.tsx:6; task-meta.tsx:59-61). MCP can read files the app can't show.

### 1.16 Notifications and activity (partA §A4, partB §12-13)
- **a** Notifications come from triggers: assigned (to the new assignee), completed (to the creator, non-recurring only), unblocked, and comments (people mentioned, plus the assignee, creator and earlier commenters).
  - The bell's "overdue" list covers passed scheduled times, at most 6.
  - Home's Activity widget shows the same cards.
- **b** Nothing is sent for due dates, edits or claims. There are no reminders: no reminder field exists anywhere.
- **c** Cards never name the task: "Mike assigned this to you" (notifications.ts:190-201). The Home Activity widget shows notifications you dismissed.
- **g** `notifications_list` scans all workspace activity using a jsonb containment test.

### 1.17 MCP task tools (partA §A6)
- **a** 23 tools (MCP:206-688):
  - Read: list, get, search, buckets, tags, assignees, activity, attachments, drift, focus settings.
  - Queue: add, remove, reorder.
  - Change: set status, reschedule, unschedule, assign, skip occurrence.
  - Legacy: the commit ops and `tasks_today`, kept until TV-D7.
- **b** **An agent can't** create, edit, delete or move a task, create a bucket, tag, add subtasks, write a dependency that actually blocks, change recurrence, track time, upload a file or read comments.
- **e** `loadWorkspace` runs plain selects with no paging (MCP:84-87). It's silently cut at 1,000 rows, in no particular order, and done tasks count toward that. Search applies its limit before the visibility filter (MCP:354-361).

### 1.18 Calendar's Tasks panel and time blocks (partB §3-4)
- **a** The panel has a title search and three groups: Queue; Due soon (overdue plus the next 7 days); Backlog (capped at 50, with no "+N"). Clicking a row opens the detail panel. Dragging a row onto the grid schedules it, in 15-min steps, with the mouse only. A review mode can move several tasks to today. On the grid, a block is the task itself: `scheduledAt` plus `durationMinutes`, or 30 min if empty.
- **b** Missing:
  - Inline editing, queueing or assigning from the panel.
  - Seeing completed tasks.
  - Tasks that have only a due date: they never appear on the grid (lens.ts:121).
  - Saving block focus: it lives in React state and ends when you leave /calendar.
- **c** Mismatches:
  - The Queue group puts scheduled tasks last.
  - The strip, the free-slot search and Move to today count and **move teammates' tasks**.
  - "Late" means three different things (panel.ts:72; model.ts:310-317; strip.ts:53-54).
  - Dropping a task with no estimate saves an invented 30 min (calendar-page-view.tsx:596-604).
- **e** Block-focus bugs:
  - Block focus credits a whole sleep gap.
  - Refused or failed saves are dropped without a sign (use-block-focus.ts:58-70).
  - Enter or Space on the panel checkbox probably opens the task instead of checking it off (calendar-tasks-panel.tsx:250-255; traced).
- **f** Blocks on the grid can't be reached with the keyboard (calendar-grid.tsx:900-910), and there's no keyboard drag.

### 1.19 Home widgets (partB §5-7)
- **Tasks:** shows my queue, or, if that's empty, every open task (team-wide, subtasks included). The row cap depends on widget size. You can check tasks off and open them.
  - A load error shows "No open tasks. Enjoy the calm." (tasks-widget.tsx:109-112).
  - A task reopened elsewhere stays hidden until the widget remounts.
- **Pomodoro:** a standalone timer, not linked to any task. It saves nothing and ignores the Focus settings.
- **Time tracking:** desktop only. It reads today's entries from redb and never `task_time_entries`, so focus time from Tasks never appears there (timetracking.rs:61-69).
- **Today:** shows at most 4 rows. Move to today has no Undo and also moves teammates' tasks.
- **Team load:** there's no such widget. Last round decided on one, but none of the 17 catalog entries is it (catalog.ts:21-172).

---

## 2. Old decisions still in the code

| Decision | Where it still lives | Status |
|---|---|---|
| Plan/Execute mode | TPV:98-100 (localStorage), RAIL:22; the chip forces Execute (TPV:221-233) | live → TV-F2 |
| `committed_for` | columns, legacy ops, a queue trigger (20261008171500:398-401, 579-652); `task-rows.ts:37-38`; recurrence-engine.ts:125, 189; MCP `tasks_commit`/`tasks_today` | stopgap → TV-D7 (engine writes it: forgotten) |
| `owner_id` as assignee | a create fallback (RTW:2197-2206), `updateTaskRowLegacyOwner` (RTW:3451-3460), a trigger (20261008150000:134-188) | stopgap → TV-D7 |
| Inbox is a bucket; `bucket_id` NOT NULL | 20260606120000:66; `ensureWebInbox` on every `list()` (RTW:2053); bucket delete and capture send tasks to Inbox; unknown bucket labelled "Inbox" (TPV:314) | live |
| Buckets are the only container | no project table; Linear-era tables still in the generated types (partA §A2) | live / forgotten tables |
| Sections = `group_label` | helpers.ts:443-462; MCP:214 | live; ignored by Board and Timeline (forgotten) |
| Time of day → bucket ("Open at") | default-view.ts:81-104; fetched on every non-Tasks mount and never used there (UTM:147) | live / wasted |
| `duration_minutes` = estimate = block size | DPROP:449; calendar-page-view.tsx:596-604 (made-up 30 min); not the Timeline bar | live, three meanings |
| A repeating task is one row | recurrence-engine.ts:1-13; recurrence needs `scheduledAt` (DPROP:388-394; CAP:153-155) | live, no history |
| One level of subtasks | 20260612130000:28-58; parent delete promotes children (RTW:2229-2233) | live |
| `archived` = won't do | DHDR:157-160; hidden from every scope and every deep link | live, can't be undone |
| `time_spent_seconds`, `reschedule_count`, `tasks_with_drift` view | 20261008225500 legacy triggers; task-feed.tsx:216 | stopgap (time) / **forgotten** (count, view) |

---

## 3. Capability matrix

Y = yes · P = partial · N = no. The evidence is in §1 and in partB/partC.

| Capability | List | Board | Timeline | Queue | Focus | Calendar panel | Home widget |
|---|---|---|---|---|---|---|---|
| create | Y (dialog) | P (New → todo) | P (New) | P (lands in Inbox, not queued) | P (only "Add one more" at the end) | P (only from the empty state) | N |
| edit inline | Y | P (menu only) | P (dates, done) | Y | N | N | N |
| reorder | **N** | Y (Queue scope breaks it) | N | Y | N | N | N |
| nest | P (drag onto a task, flat bucket list) | N | N | N | N | N | N |
| multi-select | N | N | N | N | N | P (review) | N |
| bulk | N | N | N | N | N | P (move to today) | N |
| group | Y (5 ways) | P (status / bucket) | P (bucket lanes) | N | N | P (fixed) | N |
| sort | N | N | N | N | N | N | N |
| filter | P (tags, OR) | P (tags) | P (tags) | P (tags) | N | N | P (bucket setting) |
| search | N | N | N | N | N | Y (titles) | N |
| show completed | Y | Y | P (always shown) | P (until reload) | P (count) | N | N |
| keyboard nav | Y (silent to screen readers) | P (lift only) | P (Enter on a tray chip; bars only expose their checkbox) | Y | N | P (checkbox bug) | P (Tab) |
| drag to another view/target | P (onto the link hub) | Y (status / bucket) | P (tray → day) | P (link hub) | N | Y (to the grid, mouse) | N |
| open detail | Y | Y | Y | Y | N (shows the Plan task) | Y | Y (navigates) |
| schedule | Y | N | Y | Y | N | Y (drop) | N |
| set due | Y | N | Y (end edge) | Y | N | N | N |
| assign | Y (menu) | Y (menu) | N | Y | N | N | N |
| queue | Y | Y | N | Y | P (Skip only) | P (read-only) | P (read-only) |
| start focus | N | N | N | N | Y | P (a separate clock) | N |
| see subtasks | Y | P (n/m) | P (own bars) | P (flat) | Y (checklist) | N | N |
| see dependencies | P (mark) | P (mark) | Y (arrows) | P (mark) | P ("Waiting on…") | N | N |
| attachment / comment counts | N | N | N | N | N | N | N |

---

## 4. Top 15 limitations for someone trying to use Tasks as their only tool

Personas: S = student, D = developer, PM = project manager, T = 3-person team. Ranked.

1. **No live collaboration (T, PM).** No Realtime and no refetch. Each page loads its own snapshot, the last write to a field wins, and changes appear only after you navigate. Notifications never say which task (§0; partB §12).
2. **You can't find or slice your work (all).** No search in Tasks. ⌘K and @-mentions can't find a task until it has been linked, blocked or commented on, and they never see renames. No sort, filtering by tags (OR) only, no saved views, and no grouping by assignee or date. DS-4's FilterBar isn't mounted (§1.2, 1.13).
3. **No multi-select or bulk edit anywhere (all).** The only batch actions are Calendar's review mode and drift triage (§3).
4. **Students' date workflow is missing (S).** Specifically:
   - no Today, Upcoming or Overdue views
   - passed due dates never flagged
   - due-only tasks never on the calendar
   - no reminders
   - checking off a fresh repeating task on Home can reopen it the same day
   - repeats tied to the scheduled time, not the due date, with four presets
   - a parser that eats words ("Send March report") and misreads "at 5" and "on the 1st" (§1.10-1.11, 1.15)
5. **Manual order is broken (S, PM).** You can't reorder within a bucket. One global `position` is shared by Board and List. A Board reorder in the Queue scope corrupts the order. Rail buckets aren't drop targets (§1.3-1.6).
6. **Nothing is recoverable or reviewable (all).**
   - Archive is one-way: Reopen can't be reached and there's no Archived view.
   - Delete gives you 8 s, then the task is purged after 30 days.
   - There's no `completed_at`, and the trail ignores field edits, creation and deletion (§1.9, 1.12, 1.15).
7. **Projects are just buckets (PM, founders, T).** No dates, status, lead, description or client. Sections are strings. No colour and no reordering. Tasks in a bucket you can't see are labelled "Inbox", and their deep links fail (§1.1, 1.13).
8. **Hierarchy is shallow and loses work (D, PM).** One level only. Subtasks stay behind when the parent moves. Deleting a parent promotes its subtasks. No epics or milestones (§1.15).
9. **Collaboration content is thin (PM, T).** No attachments in the UI. Comments are plain text with no edit or delete. No people mentions in descriptions. The hub hides task status (§1.9, 1.15).
10. **Developer workflow is missing (D).** No task handles (MOD-142 has no number column yet), so links are UUIDs. No git or PR links. No keys for assign, priority or labels. The list keys aren't in `?`. No estimates beyond minutes, no cycles (§1.3, 1.13).
11. **Agents can read but barely act (all; MCP is the only AI path).**
    - No tool to create, edit, delete, move, tag, add subtasks or add dependencies.
    - Lists are cut at 1,000 rows, in no particular order.
    - `blocks` links written by MCP don't block.
    - Completing a calendar block (`calendar_complete_block`) can make a repeating task come back the same day (§1.15, 1.17).
12. **Board and Timeline are too shallow for a PM (PM).**
    - Board: no swimlanes, WIP limits or add-per-column, and no rename or dates on cards.
    - Timeline: bucket lanes only, no Display, no keyboard, and the empty-timeline drop target is 8 px (§1.4-1.5).
13. **Focus and time are split across three clocks (S, founders).**
    - Engine time is saved only while /tasks is open.
    - Calendar's block focus credits sleep and drops failed saves.
    - Home's pomodoro and time widget aren't connected to tasks.
    - In Focus you can't choose the next task.
    - No timesheet (§1.8, 1.18-1.19).
14. **No way to move in (all).** There's no importer from Todoist, Trello, Linear, Jira or CSV. The only export is the raw data export in Settings (advanced-section.tsx:81).
15. **It hits limits with real use (all).** Every task ever made reloads on each page mount, across about 10 surfaces. There's a 5,000-task cap, cut by position, and no virtualization. And screen readers can't follow the list cursor or reach Timeline bars (§0, 1.3, 1.5).

---

## 5. Top 10 code smells and latent bugs to fix before any redesign

1. **How data is loaded and kept fresh.**
   - Each page mounts its own full snapshot, with no Realtime.
   - Any failed write reloads everything.
   - The hook's identity changes on every edit, and nothing is virtualized (UTM:128-174, 381-393, 1552-1623; RTW:2049-2110).

   A redesign built on this inherits stale screens and slow re-renders.
2. **Adding statuses isn't safe yet.** The strict enum combined with `mapKnownRows` silently drops unknown statuses (contracts/rows.ts:58, 485-499). On top of that, the "is open" rule is hand-written in about 10 places: UTM:207, 312; TPV:359; default-view.ts:124-126; helpers.ts:547; queue.ts; task-meta.tsx:27-29.
3. **The ordering model.**
   - One global `position` serves every view.
   - A Board reorder in the Queue scope computes keys from queue-ordered neighbours (BRD:237-246; reorder.ts:56-61).
   - Legacy keys grow without bound (`maxStr + "i"`, helpers.ts:76-85).
   - The 5,000-task cut is made by position.
4. **Tasks are only half connected to the spine.**
   - Dependencies are stored twice, `blocks` links and `task_relations`, joined by a one-way copy (20260627130000:29-80). The hub and MCP can write a `blocks` link that blocks nothing. `blocks-bridge.ts:22` is dead code.
   - A task gets an `entities` row only when first linked, blocked or commented on, and that row is never updated (`entities_op_ensure` is ON CONFLICT DO NOTHING). So search, mentions and hub labels miss tasks or show stale titles.
5. **Recurrence runs only in the client, on load.**
   - Repeating tasks come back only after a load (UTM:837-864).
   - Checking off on Home or through MCP `calendar_complete_block` skips the next-date update, so a task whose rule hasn't cycled yet reopens on the next load (tasks-widget.tsx:92-94; calendar.ts:344-349; recurrence-engine.ts:109-127). Traced.
   - Catch-up moves `scheduledAt` but not `dueDate` (recurrence-engine.ts:121-124).
6. **Date semantics.**
   - `due_date` is an instant, stored at a time of day that depends on the surface (ROW:628; CAP:357; capture-parser.ts:204-211).
   - "Late" means three things.
   - `duration_minutes` serves as estimate and block size, with an invented 30 min (calendar-page-view.tsx:596-604).
   - The parser misreads plain words.
7. **Writes are unsafe or wasteful.**
   - Several multi-step client writes never check for errors: bucket delete, task delete, tag delete (RTW:2148-2169, 2229-2233).
   - Bucket and tag rows are re-saved whole, including `deleted_at` (RTW:2117-2146).
   - Native date inputs and the pomodoro inputs save on every keystroke (ROW:596-599, 626-629; EXEC:569-591).
   - Row scheduling bypasses `tasks_op_reschedule`.
8. **Focus time paths.**
   - The save target exists only on /tasks (engine.ts:382; TPV:203-209).
   - `use-block-focus` credits sleep and loses failed saves (use-block-focus.ts:58-70).
   - For viewers, "not saved yet" never clears (UTM:1031). An edge case.
   - Three clocks can run at once.
9. **Visibility edge cases in the UI.**
   - Tasks in buckets you can't see get the "Inbox" label, and their deep links fail (TPV:290-317, 501-508).
   - `inbox = find(isSystem)` assumes you can see only one system bucket (UTM:184).
   - Board drops into read-only buckets fail only after the fact, with an error and a full reload (BRD:374).
10. **The detail panel and leftover code.**
    - Each selection change fires a request burst with no debounce (DP:90-93; task-feed.tsx:53-65).
    - The blocker picker does O(tasks × relations) work on every render (DP:619-629).
    - Dead or stuck pieces: `reschedule_count` is frozen but still displayed, `unparsedRecurrence` is never read, Reopen can't be reached, and the `tasks_with_drift` view and the Linear-era tables are still around.

---

## 7. Couldn't verify

- Nothing ran live; anything marked "traced" is a reading of the code.
- The prod catalog may differ from the migrations.
- The point where 2,000 tasks or 60 buckets start to hurt is reasoned from structure, not measured.
- Unchecked, needs a runtime check:
  - the Calendar panel's Enter/Space checkbox behaviour
  - Board's "insert before" drop
  - the 8 px tray strip
  - whether PostgREST also caps the row-returning RPCs at 1,000

The sub-notes list their own gaps.

**Correction to partA §A3(g).** It says `tasks_time_totals` / `listTimeTotals` has no caller. That's wrong: the detail panel's "you 50m" share calls it (use-task-time-share.ts:58). It's a workspace-wide, unpaged read, cached for 30 s.
