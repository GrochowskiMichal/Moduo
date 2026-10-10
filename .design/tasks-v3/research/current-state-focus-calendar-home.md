# Lane 1 · Part B: Tasks outside the Tasks page (code audit, `maciej` @ 95d988b0)

> Raw research report from the Tasks re-plan, 2026-10-09 (`maciej` @ 95d988b0), kept for its evidence. The synthesis and the open calls are in [../REPLAN.md](../REPLAN.md). Nothing here is decided.

Paths are under `src/` unless they start with `supabase/`, `specs/` or `src-tauri/`. In (d), **L** = live, **S→X** = a stopgap waiting on block X, **F** = forgotten.

## 1. Focus engine (`features/focus/engine*.ts` + `components/app/focus-session-chip.tsx`)
- (a) One app-wide clock outside React, timed by the wall clock (engine.ts:1-4).
  - States: idle → task picked → running or paused, as a stopwatch or a pomodoro (work, break, long break) (engine-core.ts:108-131).
  - Kept in localStorage under `moduo:tasks:focus:<user>` (engine.ts:23-25).
  - Saves every 60 s and on pause, stop, task switch and block end, with an idempotency key (engine.ts:91, 315, 501, 546-553; use-tasks-module.ts:1032-1038).
  - One tab runs the clock; the others mirror it and take over on any action or after 75 s (engine.ts:27-33).
  - Chime at each phase end; in the background also a toast and a desktop notification (phase-alert.ts:59-70).
  - Pomodoro lengths come from the synced Focus settings (focus-prefs.ts:38-44).
  - The bottom-bar chip opens /tasks Focus (focus-session-chip.tsx:21-24).
- (b) Start and pause only in the Tasks Execute view (execute-view.tsx:359-411). The chip never pauses (focus-session-chip.tsx:11-13).
  - No clock shared across devices.
  - The save path (the "sink") exists only while /tasks is mounted (tasks-plan-view.tsx:203-209), and `flush()` exits without one (engine.ts:382). Time tracked anywhere else stays local, despite the comment at engine.ts:90.
- (c) The chip shows mm:ss with minutes past 59 (focus-session-chip.tsx:81-85); Calendar shows H:MM:SS (calendar/focus.ts:11-20). The chip can't see Calendar's or Home's timers.
- (d) The chip switches /tasks to Execute mode (tasks-plan-view.tsx:221-233): Plan/Execute S→TV-F2. Parallel focus timers S→TV-F5/F3.
- (e) Defensive gap for viewers: a viewer's save returns `Promise(false)` (use-tasks-module.ts:1031), and the engine counts that as failed (engine.ts:372-374). "Not saved yet" would never clear and retries would never stop (engine.ts:433-434).
  - "Track time" isn't gated on edit rights (execute-view.tsx:395-416). But a viewer only reaches it with a queued task, for example after a role downgrade, because adding to a queue goes through the server guard (supabase/migrations/20261008171500_tasks_personal_queue.sql:271).
  - Deleted task: its time is dropped with a toast, but the task stays attached (engine-core.ts:580-585; use-tasks-module.ts:1041-1046). Likely one toast a minute until the Execute view switches task.
  - A task completed elsewhere keeps getting time. Two devices can both credit the same person.
- (f) Desktop notification permission is first asked at a random phase end (phase-alert.ts:75-76).
- (g) The record is written to localStorage every second (engine.ts:217-218, 330-332). Fine.

## 2. Away prompt (`focus/ui/away-prompt.tsx`)
- (a) A gap over 90 s holds the time: "You were away 42m · Keep [15m] · Discard/Dismiss · Count as break" (engine-core.ts:25, 342-364; away-copy.ts:40-50).
  - A full and a compact copy exist; only one shows at a time (away-prompt.tsx:8-28).
  - Gaps add up (engine-core.ts:350-362). An unanswered prompt is discarded on stop (engine-core.ts:395-410).
- (b) Keep is all or nothing (engine-core.ts:478-486). In a pomodoro, it keeps time only up to the end of the work block (engine-core.ts:63-65).
- (c) Calendar block focus and the Home pomodoro have no away handling at all (use-block-focus.ts:58-61; pomodoro-widget.tsx:43-55).
- (f) `role="status"` wraps buttons; focus never moves there (away-prompt.tsx:55-61).
- (d)(e)(g) None notable.

## 3. Calendar Tasks panel (`calendar/panel.ts`, `calendar/ui/calendar-tasks-panel.tsx`)
- (a) Title search plus three groups: Queue (mine) · Due soon (overdue + 7 days, by `dueDate`) · Backlog (open, unscheduled, not queued) (panel.ts:43-86).
  - Row: checkbox, title, duration "Nm", scheduled time or due date (calendar-tasks-panel.tsx:263-287).
  - Click, Enter or Space opens `TaskDetailPanel` in the side panel (calendar-page-view.tsx:892, 928-939).
  - Mouse drag onto a day schedules it in 15-min steps (calendar-page-view.tsx:570-607).
  - Review mode: tick boxes, "Move N to today", Remove (calendar-tasks-panel.tsx:104-199). The empty state has a Capture button (79-88).
- (b) No add row, inline edit, reorder, queue changes, assign, sort, filter or completed view. Done rows vanish (panel.ts:21-23).
  - Backlog stops at 50 with no "+N" (panel.ts:19, 82). Search matches titles only (panel.ts:32-34).
- (c) Queue puts scheduled tasks last (panel.ts:80), so it isn't in my queue order.
  - Subtasks are kept out of Due soon and Backlog, but not out of Queue (panel.ts:58 vs 67).
  - Due soon and Backlog are team-wide (panel.ts:65-77).
  - "Late" means three things: past due here (panel.ts:72), past scheduled start in Tasks and the bell (tasks/model.ts:310-317), past block end in the strip (strip.ts:53-54).
  - Home rows navigate to /tasks instead (tasks-widget.tsx:57).
- (d) Capture lands in the Inbox bucket (calendar-page-view.tsx:1186-1189) L. Duration doubles as the estimate (calendar-tasks-panel.tsx:270-272) L. One level of subtasks (panel.ts:67) L.
- (e) Enter or Space on a row's checkbox bubbles to the row, which calls `preventDefault()` and opens the task (calendar-tasks-panel.tsx:250-255). `CompleteToggle` stops only the click (complete-toggle.tsx:33-36). So keyboard check-off likely opens the task instead. No tests.
- (f) The `role="button"` row wraps a button (calendar-tasks-panel.tsx:243-268).
  - Mouse sensor only (calendar-page-view.tsx:553): no keyboard scheduling.
  - Checkbox 16 px (complete-toggle.tsx:38). Review checkbox is a native 14 px input (calendar-tasks-panel.tsx:188).
- (g) Calendar mounts its own `useTasksModule` (routes/pages/calendar-page.tsx:37-41). Each mount loads the full task list, the queue and unused time blocks (use-tasks-module.ts:145-147), and runs a recurrence catch-up that writes (836-864). No refresh on window focus.

## 4. Calendar blocks and block focus (`lens.ts`, `strip.ts`, `gap-finder.ts`, `roll-forward.ts`, `triage.ts`, `hooks/use-block-focus.ts`)
- (a) A block is the task row itself: `scheduledAt` + `durationMinutes`, 30 min if empty. Done is dimmed; archived and deleted are hidden (lens.ts:15-16, 114-142).
  - Drag or resize writes the schedule and duration (calendar-grid.tsx:381-391).
  - Popover: checkbox, Start focus (blocks started or due within 60 min), Pause/Resume/Stop, Later today / Took longer / Remove, Open (task-popover.tsx:63-138; focus.ts:8, 35-38).
  - Strip "N unfinished from earlier" looks back 7 days. Move to today or Review, one Undo (strip.ts:11, 36-57; calendar-page-view.tsx:816-848).
  - Keys T/D/W/←/→/Delete, none for tasks (calendar-page-view.tsx:646-672).
- (b) Tasks with only a due date never appear (lens.ts:121). ⌘N and drag-to-create make events only (calendar-grid.tsx:567; event-quick-create.tsx:24-32).
  - Block focus is page state: leaving /calendar ends it silently, a reload loses up to 60 s, no pomodoro (use-block-focus.ts:87-88).
- (c) The engine and block focus can run on two tasks at once. Calendar never imports the engine (calendar-page-view.tsx:54, 721).
  - The grid, strip and free-slot search include teammates' tasks (lens.ts:114-142; strip.ts:36-57; calendar-page-view.tsx:735-739). "Move to today" can move other people's tasks; the bell counts only mine (overdue-inbox.ts:44).
  - "Took longer" logs the planned length as worked time (triage.ts:6-21).
- (d) Duration = estimate = block size, L: a drop saves `task.durationMinutes || 30` (calendar-page-view.tsx:596-604), and a move saves the default 30 (lens.ts:129-130; calendar-grid.tsx:387-390). Tasks with no estimate get an invented one.
  - Parallel timers S→TV-F5 (specs/tasks-v2.md:665). Calendar's place-on-top-of-queue option has no caller (tasks/model.ts:139-140) S→TV-F5.
  - Single-row recurrence: only the current occurrence shows, L. Archived treated as final (lens.ts:120) L. `committedFor` is left only in a comment (lens.ts:51) F.
- (e) Block focus has no away limit: after sleep, waking credits the whole gap (use-block-focus.ts:58-61, 79-80).
  - `addTime` returns nothing, so refused or failed saves still count as sent (use-block-focus.ts:66-70; use-tasks-module.ts:955-963). Those seconds are lost.
  - No idempotency key (use-tasks-module.ts:957-962). No tests.
- (f) Grid blocks only take mouse input: no tabIndex, role or keys (calendar-grid.tsx:900-910). Start focus and Open are mouse-only.
  - The popover is anchored to an `aria-hidden` span with no trigger (chip-popover.tsx:18-31), so focus likely has nowhere to return.
- (g) The live clock re-renders only itself (focus-readout.tsx:17-31). Fine.

## 5. Home Tasks widget (`dashboard/ui/widgets/tasks-widget.tsx`, `tasks/queue.ts:165-192`)
- (a) My open queue in order, headed "Queue". When the queue is empty: all open tasks by position, headed "Open". Optional bucket filter (queue.ts:171-192).
  - Row: checkbox plus a title that opens /tasks?id (tasks-widget.tsx:30-64).
  - Row counts S3/M5/L9, a few more at denser settings, then "+N more" (widget-density.ts:24-38).
- (b) Read and check off only. No create, undo, dates, assignee or focus.
- (c) Check-off skips the Tasks write path, so a repeating task doesn't move to its next date (tasks-widget.tsx:92-94 vs use-tasks-module.ts:749-757). The SQL also keeps it unchanged (supabase/migrations/20260612150000_module_activity_intent_ops.sql:277-278).
  - Custom checkbox, not `CompleteToggle` (tasks-widget.tsx:41-54).
  - The "Open" fallback is team-wide and includes subtasks (queue.ts:177-182).
  - Leaving the queue on done is a database trigger, so that part is safe (supabase/migrations/20261008171500_tasks_personal_queue.sql:662-686).
- (d) The setting `projectIds` actually holds bucket ids (tasks-widget.tsx:72-80) F.
- (e) A failed load shows "No open tasks. Enjoy the calm." (tasks-widget.tsx:109-112). A task reopened elsewhere stays hidden until remount (70, 91, 107). No tests.
- (f) Checkbox 16–20 px depending on density (tasks-widget.tsx:47). No arrow keys.
- (g) The full bundle, up to 5,000 tasks (lib/paged-select.ts:33), reloads on every window focus. One check-off reloads every widget's data (dashboard-data-context.tsx:161-173).

## 6. Home Pomodoro widget (`pomodoro-widget.tsx`)
- (a) Standalone 25/5 timer: Start, Pause, Reset, Skip, auto-switch (pomodoro-widget.tsx:32-122).
- (b) No task, saves no time, no long break, no chime. Resets when you switch Home pages (3-4).
- (c) Ignores the Focus settings (focus-prefs.ts:38-44) and the engine. Three timers can run at once.
- (d) S→TV-F3/F5 (specs/BUILD_ORDER.md:115, 122).
- (e) After a long background gap it doesn't catch up; it restarts from now (pomodoro-widget.tsx:49-54).
- (f) Start button is 22–26 px (pomodoro-widget.tsx:104-114). The progress bar has no role (94-99).
- (g) Re-renders every 250 ms while running (pomodoro-widget.tsx:57).

## 7. Home time widgets
- **Time tracking:** desktop only (catalog.ts:52-60). It sums today from the local redb store (src-tauri/src/commands/timetracking.rs:61-69).
  - It never reads `task_time_entries`, so Tasks focus time never appears on Home.
  - (d) S→TV-F5 (specs/tasks-v2.md:665). It relies on redb, which AGENTS.md rule 6 marks paused: F.
- **Today:** today's timed blocks and events, the strip and Move to today (calendar-today-widget.tsx:29-167).
  - Never more than 4 rows: the default limit isn't overridden (today.ts:86-88; calendar-today-widget.tsx:46).
  - Week start and working hours are hardcoded (60-76).
  - Move to today has no Undo, unlike the page (calendar-page-view.tsx:835-845). It fires N moves in parallel with one error message (77-93).
  - "Now" is frozen when data loads (45-48). Counts and moves teammates' tasks.
- **Team-load widget:** none exists. The catalog's 17 widget types include nothing for team load (dashboard/registry/catalog.ts:21-172).
- (f)(g) None notable beyond §5 (g): Today shares the dashboard's full task reload.

## 8. Comments panel (`spine/ui/comments-panel.tsx`, `tasks/ui/task-feed.tsx`)
- (a) Comments mixed oldest-first with activity, with a "Show N earlier" fold (task-feed.tsx:77-81).
  - ⌘↵ posts. @ opens a member list you can use with arrows, Enter or Tab, and Esc (comments-panel.tsx:270-294).
  - Notifies people mentioned plus the task's people (task-feed.tsx:4-6).
- (b) Plain text only. No edit, delete, reactions, threads or files (use-comment-thread.ts:13-21). The @ list shows 6 people at most (spine/comments.ts:71).
  - No live updates: reloads only on your own post or on task activity (task-feed.tsx:67-75).
- (c) Two mention systems: comments mention people only; descriptions mention items only (spine/editor/entity-text-editor.tsx:233-252).
- (e) Mentions match on display name. Blank names become "Member" (use-comment-people.ts:28). Duplicate names can notify the wrong person (spine/comments.ts:34-38).
- (f) The textarea has no combobox role or `aria-expanded` (comments-panel.tsx:264-267).
- (d) None notable. (g) Re-reads the whole thread after each post; no paging (use-comment-thread.ts:55-67, 95).

## 9. Linked items hub (`spine/ui/entity-hub.tsx`, `spine/hooks/use-entity-hub.ts`)
- (a) Sections by type: Open work / Money / Conversations / Notes / Other. 8 rows, then "Show all". Row menu: Open, Change relation, Remove (rollup.ts:20-50; entity-hub.tsx:182-273).
- (b) Linked tasks show no status or due date: the hook never passes them in (use-entity-hub.ts:57). "Open work" includes done tasks (rollup.ts:31-35).
- (c) The Contacts hub does show status and due (features/contacts/rollup.ts:163).
- (e) Shows "loading" forever if something it needs is missing (use-entity-hub.ts:26, 36).
- (f) The ⋯ button stays invisible when it has keyboard focus (entity-hub.tsx:242).
- (d)(g) None notable.

## 10. Mentions (`spine/mention.ts`, `spine/editor/mention-menu-plugin.tsx`)
- (a) `@` links an item, `/ref` adds a reference, a person gets notified, no match offers create (mention.ts:101-131). Shows 8 results (use-mention-search.ts:104).
- (b) Task descriptions can't mention people or create items (entity-text-editor.tsx:233-252; mention-menu-plugin.tsx:164). Comments can't mention tasks.
- (c) Notes can mention people (notes/ui/note-editor.tsx:434). (d)(e)(f)(g) None notable.

## 11. Global quick capture ⌘⇧K (`components/app/global-capture-bar.tsx`, `spine/capture-command.ts`)
- (a) Works anywhere, even inside text fields (lib/shortcuts.ts:52-67). `/` prefixes pick Task, Note, Event or Contact.
  - Reads title, schedule, due date and repeat, then saves into the Inbox. It loads the whole task list just to place it at the end (capture-command.ts:210-236).
- (b) No bucket, tag, priority, assignee or estimate. Not added to the queue, unlike captureToQueue (use-tasks-module.ts:684-720). Open goes to /tasks, not the new task (capture-command.ts:230-235).
- (c) The Home Quick capture widget skips date parsing, so "milk tomorrow" only gets a date through ⌘⇧K (quick-capture-widget.tsx:41-52).
- (d) Inbox bucket L. Captured tasks are assigned to you (lib/task-rows.ts:101) L. Old `owner_id` fallback (lib/runtime.web.ts:2197-2206) S→TV-D7.
- (g) Up to 5,000 tasks read per capture just to find the position (capture-command.ts:217).
- (e)(f) None notable.

## 12. Notifications for tasks (`spine/notifications.ts`, `spine/overdue-inbox.ts`, `components/notification-center.tsx`)
- (a) Cards grouped by item and action. Task actions: assigned, completed, unblocked, commented (activity.ts:68-95).
  - Optional overdue section: my overdue tasks, oldest first, at most 6 (overdue-inbox.ts:35-50; notification-center.tsx:280).
- (b) No due-date reminders. Overdue ignores the due date and uses the scheduled time only (tasks/model.ts:310-317).
- (c) Cards never name the task: "Mike assigned this to you" (notifications.ts:190-201).
- (f) A `role="button"` card contains a dismiss button (notification-center.tsx:211-259).
- (g) Loads the full task list every time the bell opens (notification-center.tsx:62).
- (d)(e) None notable.

## 13. Home Activity widget (`activity-feed-widget.tsx`)
- (a) The same grouped notifications, respecting mutes, each row linking to its item (activity-feed-widget.tsx:39-80).
- (c) Shows notifications you dismissed: the server returns them (supabase/migrations/20260713120000_notification_dismiss.sql:73-78), and the widget doesn't filter them like the bell does (activity-feed-widget.tsx:41-43).
  - Clicking doesn't mark as read (notification-center.tsx:133). "+N more" goes nowhere (activity-feed-widget.tsx:82).
- (b)(d)(e)(f) None notable. (g) Reads 40 rows (dashboard-data-context.tsx:240-242).

### B-matrix

| Capability | Calendar panel | Home Tasks widget | Focus engine/chip |
|---|---|---|---|
| create | partial: empty-state button (calendar-tasks-panel.tsx:79-88) | N | N |
| edit inline | N (calendar-tasks-panel.tsx:225-290) | N (tasks-widget.tsx:30-64) | N |
| reorder | N (panel.ts:80) | N | N |
| nest | N (panel.ts:67) | N (queue.ts:177-182) | N |
| multi-select | partial: Review ticks (calendar-tasks-panel.tsx:182-189) | N | N |
| bulk | partial: Move N to today (calendar-tasks-panel.tsx:140-147) | N | N |
| group | partial: fixed (panel.ts:79-83) | N (queue.ts:187-191) | N |
| sort | N (panel.ts:37-41) | N (queue.ts:189) | N |
| filter | N | partial: bucket (tasks-widget.tsx:72-80) | N |
| search | Y, titles (panel.ts:32-34) | N | N |
| show completed | N (panel.ts:21-23) | N (queue.ts:180) | N |
| keyboard nav | partial: check-off broken (calendar-tasks-panel.tsx:247-255) | partial: Tab only (tasks-widget.tsx:41-61) | partial: chip (focus-session-chip.tsx:53-57) |
| DnD across | Y, mouse only (calendar-page-view.tsx:553, 570-607) | N | N |
| open detail | Y, side panel (calendar-page-view.tsx:928-939) | Y, /tasks (tasks-widget.tsx:57) | partial: opens Focus (focus-session-chip.tsx:21-24) |
| schedule | Y, by drop (calendar-page-view.tsx:601-604) | N | N |
| set due | N | N | N |
| assign | N | N | N |
| queue | partial: read-only (panel.ts:58) | partial: read-only (queue.ts:184-187) | partial: follows Focus view (execute-view.tsx:92-109) |
| start focus | N (blocks only: task-popover.tsx:110-116) | N | Y, Tasks only (execute-view.tsx:405-411) |
| see subtasks | N | N | N |
| see dependencies | N | N | N |
| attachment/comment counts | N | N | N |

### B-top smells (ranked)
1. Focus time saves only while /tasks is open (tasks-plan-view.tsx:203-209; engine.ts:382).
2. Three timers can run at once and the chip shows one (calendar-page-view.tsx:721; pomodoro-widget.tsx:36-39).
3. Calendar block focus credits sleep and loses failed saves (use-block-focus.ts:58-70).
4. Strip, free-slot search and Home Today move teammates' tasks (strip.ts:36-57; calendar-today-widget.tsx:54-84).
5. Home check-off doesn't move repeating tasks to their next date (tasks-widget.tsx:92-94).
6. Time-tracking widget never sees task time (timetracking.rs:61-69).
7. Scheduling invents a 30-min estimate (calendar-page-view.tsx:596-604).
8. Grid blocks and drag are mouse-only; Enter on a panel checkbox opens the task (calendar-grid.tsx:900-910; calendar-tasks-panel.tsx:250-255).
9. Three meanings of "late" (panel.ts:72; tasks/model.ts:310-317; strip.ts:53-54).
10. Linked tasks show no status (use-entity-hub.ts:57).
11. Notifications don't name the task; Home Activity shows dismissed ones (notifications.ts:190-201).
12. A load error reads "No open tasks" (tasks-widget.tsx:109-112).
13. Every Calendar, Notes or Email mount reloads all tasks and runs catch-up writes (use-tasks-module.ts:145-147, 836-864).

### Old decisions still showing up here
- **Plan/Execute:** S→TV-F2.
- **committed_for:** a database trigger still copies it into queues (supabase/migrations/20261008171500_tasks_personal_queue.sql:579-650), S→TV-D7. A comment survives (lens.ts:51), F.
- **owner_id as assignee:** fallback writes remain (lib/runtime.web.ts:2197-2206, 3451), S→TV-D7.
- **Inbox as a bucket:** L (capture-command.ts:214; calendar-page-view.tsx:1186).
- **Time-of-day → bucket blocks:** fetched on every non-Tasks mount and never used (use-tasks-module.ts:147), F.
- **Duration = estimate = block:** L.
- **Single-row recurrence:** L.
- **One level of subtasks:** L.
- **Archived = won't do:** L.
- **Two focus implementations:** actually three. S→TV-F5/F3.

### Could not verify
- Whether a repeating task completed on Home reopens the next time Tasks or Calendar loads (recurrence-engine.ts:97-98).
- Anything at runtime: the checkbox key bug, popover focus, and whether the "couldn't be saved" toast repeats every minute.
- Whether permissions hide teammates' tasks for some roles. The code itself applies no assignee filter.
- Whether deleting a mention chip removes its link.
- Whether viewers can comment (task-feed.tsx:83 doesn't check).
- Whether the queue guard blocks viewers, which decides if the viewer "not saved yet" loop in §1(e) can happen (supabase/migrations/20261008171500_tasks_personal_queue.sql:271).
- No visual check.
