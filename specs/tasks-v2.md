# Spec: Tasks v2 — the dogfood rework

> Status: **Draft — awaiting designer approval** (all open questions answered 2026-10-08) · Owner: maciej · Source of truth for every product call: [`.design/tasks-dogfood/REVIEW.md`](../.design/tasks-dogfood/REVIEW.md) (T1–T28, U1–U14, decision rounds 1–3b) + the comp [`.design/tasks-dogfood/ui-proposal.html`](../.design/tasks-dogfood/ui-proposal.html) · Companion specs: [`design-state-layer.md`](./design-state-layer.md) (DS-*), [`attachments.md`](./attachments.md) (AT-*) · Supersedes the parts of [`docs/moduo-tasks-feature-spec.md`](../docs/moduo-tasks-feature-spec.md) it changes (Plan/Execute modes, commit-for-today, capture-is-tag-free) · Contract: [`docs/moduo-module-contract.md`](../docs/moduo-module-contract.md)

## Scope

Tasks was designed as a solo ADHD planner and is now used by a two-person team as its daily work tracker. Dogfooding showed that most friction comes from that gap. The biggest problems:

- The "today" Queue is shared by the whole workspace.
- Focus loses time in the background, can't follow agentic work, and sits behind a mode switch that empties the sidebar of meaning.
- Drag-and-drop nests instead of reordering.
- The filter only knows tags.
- Rows are cluttered.
- The detail panel looks unconsidered.

This spec turns the decisions from the 2026-10-06/07 review sessions into buildable blocks:
- a team-correct data model: single optional assignee + creator, a personal dateless Queue, time entries, live updates;
- Focus rebuilt as *running your Queue* (pomodoro per run, In flight for handed-off work);
- the list/board/detail/capture/sidebar UI from the comp;
- drag-and-drop, multi-select and bulk actions;
- filters, display options, search and saved views.

The cross-module visual foundation (state tokens, scrollbars, NavRow/MetaCount/FilterBar/DisplayMenu primitives) and attachments are in the companion specs because other modules reuse them.

**Landing rule for this whole spec (2026-10-07, Maciej):** work lands on `maciej` only. **Do not push or merge anything to `develop`** until Maciej says so — Mike is rebuilding on `develop`. This overrides AGENTS.md's standing "land on develop" authorization for these blocks.

## Product behavior & UX

### 1. Team model — assignee, creator, "My tasks"

- **Assignee** — every task has **one optional assignee**. Empty = **Unassigned** ("up for grabs").
  - New tasks default to the creator (today's behavior).
  - The capture modal and detail panel offer every active member plus **Unassigned**.
  - Members who can't take tasks (develop's PERM `canTakeTasks`) aren't offered.
- **Creator** — recorded on every task and never changes. It shows only in the detail panel's last metadata line ("Created by Maciej · Oct 6 · Updated 7:20 PM") and as a Filter dimension. It never appears on rows.
- **"My tasks"** — a sidebar row under All, shown only in workspaces with ≥2 members.
  - Scope = tasks assigned to me, across buckets, open by default.
  - The assignee avatar is hidden on rows there (it's always me).
- **Notifications** (the quiet core set; mute toggles in Settings → Notifications keep working):
  - *Assigned to you* — unchanged, now keyed on the assignee.
  - *Completed by someone else* — new. Sent to the creator when a task they created and someone else completes. Only when creator ≠ completer.
  - *Comment* — to the assignee + creator + earlier commenters, minus the author.
  - *Unblocked* — to the assignee, else the creator.
- **Overdue** in the bell = tasks assigned to me (unassigned ones: their creator).

### 2. The Queue — personal, not tied to a date

- **Each person has their own Queue:** an ordered line-up of tasks they intend to do next. Nothing resets at midnight (work runs past it). The rail's Queue row counts *my* queue.
- **Ways to add to the Queue:**
  - the row/card queue toggle;
  - `q`;
  - the context menu;
  - the detail header toggle;
  - dragging a task onto the Queue row;
  - capture's "Add to my queue" switch;
  - end-of-run suggestions;
  - Calendar "Start focus".

  New items go to the end, except Calendar "Start focus" → top.
- **A task leaves every queue when:**
  - it's completed (it's done for everyone — the run summary still counts it);
  - archived;
  - deleted;
  - or its bucket is archived/deleted.

  Restoring something never re-queues it. Reassigning or moving buckets doesn't touch queues.
- **Claims** — when someone else has a task queued, rows/cards/detail show their small ringed avatar ("In Mike's queue"). If it's the current task of their running run: "Mike is on this" with a small live dot.
  - Runs themselves are private.
  - Queuing a task someone else already has is allowed and gets a quiet toast note ("Also in Mike's queue").
- **Stale line-up** — when the line-up hasn't been touched for **3 days**, the Queue shows one quiet line: "Lined up 3 days ago — still want all of these? **Keep all** · **Review**".
  - Review = selection mode to remove items.
  - Never automatic removal, never red.
- **Capacity mirror** — the Queue header shows "7 · ~5h 20m lined up" (+ "2 without estimate"). Factual, no threshold, no warning.
- **Permission** — queuing needs edit access to Tasks (as today); view-only members don't get queue controls.

### 3. Focus = running your Queue

- **No more Plan/Focus switch.** The sidebar never changes in any mode; Focus is a state of the Queue view.
- **Line-up (Queue view, no run):**
  - a reorderable list (numbers; grip on hover), "Add to queue…" inline row (`c`), stale line and capacity mirror;
  - header: **Pomodoro | Stopwatch** (remembered per person) and **▶ Start run** (primary; `⌘↵` in the Queue view). The Home pomodoro widget can start/pause the same run.
- **Running:**
  - **Header:** "Queue · ● Running · 2 of 7 done" · phase pill ("◐ Focus 18:42 ▾" / "☕ Break 4:12") · Pause · End run.
  - **Now card:**
    - bucket · priority · due · "18m of ~45m" · # tags · 📎;
    - title, description excerpt, subtask checklist (tickable);
    - linked items (open their module) + attachment thumbnails;
    - actions: **Done** (primary, ⏎) · **Skip** (moves Now to the *end* of my queue; never counts as a reschedule) · **Hand off** (`w`, §4) · ⋯ (Remove from queue, Do later today = move to end, Open task).
  - **Up next** — the rest in order (3rd+ dimmed), drag to reorder, "Do now" in ⋯ (the current Now goes back to the top of Up next).
  - **Inline "Add to queue…"** — ⌘N in a run opens capture with "Add to my queue" on.
  - **"2 done this run · 1h 12m · show"** line.
  - **Right panel** during a run = tabs **In flight N | Task** (Task = the Now task's full detail, incl. comments).
- **Leaving Tasks mid-run** — the run continues.
  - The top-bar chip shows phase + time + task; clicking it returns to the run.
  - The rail Queue row shows a live dot + "2/7".
- **Pomodoro per run:**
  - The rhythm belongs to the run, not the task — finishing or switching tasks never resets it.
  - When a work block ends mid-task it becomes a **soft break**: chime + (if backgrounded) one OS notification; the Now card shows "**Break.** Your task is waiting. **+5 min focus** · **Skip break**". Nothing is tracked on tasks during a break; in-flight waiting keeps running.
  - Long break every N blocks (Settings → Focus). Auto-start next block follows the pref, but **never while you're away**.
  - Starting another run within 15 minutes of the last one continues the block count.
- **End of run** (queue emptied or End run):
  - a plain summary: "6 / 7 done · 2h 14m focused · 5 focus blocks · 1 still in flight — kept at the top of your queue";
  - **Add more** · **Start another run**;
  - suggestion chips — *Drifted N · Due this week N · Quick, under 15m N · High priority N*. A chip opens a small review list to add from; never an auto-add.

  No streaks, no confetti.
- **Empty Queue:** "Nothing lined up" + how to add (Q on any task, drag onto Queue, capture straight in) + Add row + suggestion chips. Never "0 / 0 Done ✓".

### 4. In flight (handed-off work)

- **Hand off** (`w` or button) moves the current task to **In flight** and starts *waiting* time; the next task becomes Now.
  - A small inline popover (Enter skips it) takes three optional things:
    - a one-line **"where I left off"** note — saved as a comment on the task;
    - a **check-back** (5 / 15 / 30 min / custom / none; default none);
    - a **link** (PR, agent session, deploy).
- **Cards** live in the right panel's **In flight** tab:
  - each shows title · "in flight 18m" · check-back ring/time · note · link chip (**Open**) · counts;
  - click a card to expand its details;
  - **Pick up** makes it Now (the current Now goes to the top of Up next; waiting stops) · **Done** · ⋯.
- **Check-back due** → the card brightens (hairline, never red) and shows "Check now", plus **one** notification (desktop OS notification; web in-app toast). No repeats.
- **Natural check-back points** — after Done/Skip and at each break, one dismissible line at the top of Up next: "Pick up *X* (in flight 18m)?"
- **Linked waits** light the card up by themselves ("Ready to check: blocker done" / "new comment from Mike" / "reply on the linked email"). The email-reply signal only works where the email module runs (desktop).
- **Soft mirror** — "3 in flight" gets emphasis past three. No cap.
- **Keys** — `w` hand off, `1`–`3` pick up card N, `Tab` cycles Now ↔ cards.
- **When a run ends,** in-flight tasks stay at the top of my queue (in hand-off order).

### 5. Time tracking

- **The clock is wall-clock time.** It keeps counting correctly while the window is hidden, minimized, covered or in another Space.
  - The running session survives a reload, crash or restart.
  - It shows up on another device (one active run per person).
- **Away detection** — if the app was suspended or the machine slept (a gap of more than ~90 s), the run header and chip show "You were away 42m — **Keep** · **Discard** · **Count as break**".
  - Pending away time is held, not credited.
  - If it's still unanswered when the run ends, it's discarded (no inflated totals).
  - Idle detection without sleep is out of scope.
- **Missed pomodoro boundaries** — phase ends that passed while away are caught up from timestamps. The run says what happened ("Your 25-min focus ended at 14:25"), and a new work block never auto-starts while you're away.
- **Who sees what:**
  - Every member who can see a task sees its **total** focused time.
  - The detail panel adds "you 1h 10m" for your own share.
  - Other people's individual shares are not shown.
  - Waiting (in-flight) time is shown separately ("waited 1h 10m") and never counts as focus.
- **Corrections** — editing the Time value records an adjustment (the total becomes the typed value). Calendar "Took longer" is an adjustment and its Undo removes exactly that adjustment.
- **The Home time-tracking widget** shows *my tracked task time* (today / this week, by task and bucket) on web and desktop. It no longer reads the desktop window-activity tracker.

### 6. Lists, board, completed

- **Row anatomy** (comp §1/§2):
  - checkbox · title · quiet counts right after the title: `# 3` · 📎 2 · 💬 1 · ↳ 0/1 · blocked icon. Muted, hidden at zero.
  - **Fixed right-hand columns** so meta lines up down the list: priority glyph · date · assignee · queue/claim. A column that's empty for the whole view collapses.
  - **Priority glyph:** a fixed 3-bar footprint with ghost bars (level read by fill).
  - **Energy is off on rows by default** (Display toggle). It always shows in the panel.
  - **No bucket pill** where the bucket is implied (single-bucket scope, or grouped by bucket). In cross-bucket flat views the bucket shows as dot + name (muted text, no pill).
  - **Done rows dim as a whole** (except the checkbox).
  - **Selected = tint** (DS-2). No bar.
- **Board** — one quiet meta line per card. Columns flex (min 280 px, max 400 px). Tint selection. Done cards faded. No separate tag line.
- **Completed tasks are hidden by default.**
  - Each list/group ends with a quiet "5 completed · show" line. Display → Completed: **Hidden · 7 days · All**.
  - A task you check off stays in place, struck through, until you change scope or reload (undo stays one click away).
  - Archived ("won't do") tasks are reachable through Filter → Status: Archived.

*As built in TV-U1 (2026-10-09):* the date column shows the scheduled time or the due date, whichever comes first by day (scheduled wins a tie). "7 days" is measured from the task's last update, since no completion time is stored. A done parent with open subtasks stays listed. Display ships Completed and "Show on rows" (Priority, Energy, Date, Assignee) per scope; TV-U2 adds the rest. Details: [docs/decisions/tasks.md](../docs/decisions/tasks.md) 2026-10-09 TV-U1.

### 7. Filter, Display, search, saved views

- **Toolbar** (one control language, comp §1):
  - title + count;
  - Search (`/`) · **Filter** (`f`) · **Display**;
  - view switch (List / Board / Timeline, raised plate);
  - **New** (the one primary).
- **Filter:**
  - **Dimensions (v1):**
    - Assignee (incl. Me, Unassigned)
    - Creator
    - Tag
    - Status (incl. Archived)
    - Priority
    - Energy
    - Due (today / this week / no date / earlier)
    - Scheduled (today / this week / none / drifted)
    - In my Queue
    - Blocked
    - Recurring
    - Has subtasks
    - Has attachments
  - **Operators:** is / is not / any of. AND across dimensions.
  - Active filters show as sentence chips ("Assignee · is · Me ×") with "23 of 76 · Clear" and a count badge on the button.
  - **Filters are remembered per scope** (per device) and **seed capture**: New inside a filtered scope pre-fills those tags/assignee/priority.
- **Display:**
  - Layout;
  - Group by — None · Status · Bucket · Assignee · Priority · Energy · Tag · Due · Scheduled · **Time** (Earlier · Today · Tomorrow · This week · Later · No date);
  - Order — Manual · Due · Scheduled · Priority · Created · Updated;
  - Completed (Hidden · 7 days · All);
  - Subtasks (Nested · Flat);
  - Row properties on/off;
  - Reset.

  Remembered per scope.
- **Search** (`/`) filters the current scope live by title + description. Typing `#tag` or `@person` in the search box turns into the matching filter chip.
- **Saved views** (personal, synced across your devices; decided 2026-10-08):
  - "Save as view…" in Filter/Display stores the current scope + filters + display under a name.
  - Views appear in a **Views** section in the sidebar (counts like buckets), and are renamed/reordered/deleted via ⋯.
  - When you change a view, a "Save changes" action appears.
  - Views sync across your devices and have a link (`/tasks?view=…`).

### 8. Drag and drop, multi-select, bulk, keyboard

- **List drag — one gesture, two outcomes:**
  - pointer **left of the subtask indent** (~40 px into the row) = **reorder** (insertion line);
  - pointer **right of it** = **make subtask** (target tints, indented preview "Make subtask").
- **Ordering and grouping:**
  - Manual order is per bucket and shared by everyone.
  - Reordering inside a group needs Order: Manual. Otherwise the drop line is replaced by a quiet note: "Sorted by due date — switch to Manual to reorder."
  - Dropping **across groups rewrites the field** (into "High" = priority high; into another bucket's group = moves it; into another status = status).
- **Sidebar drop targets:**
  - a bucket row → move (subtasks follow their parent);
  - the Queue row → add to my queue;
  - My tasks → assign to me.

  Targets tint while a drag hovers them.
- **Multi-select:**
  - ⇧-click / ⌘-click / ⌘A / ⇧J ⇧K;
  - a quiet bulk bar: **Move · Assign · Tags · Priority · Add to queue / Remove from queue · Complete · Delete** (with Undo);
  - dragging a selection moves them all.
- **Keyboard (List):**

  | Key | Action |
  | --- | --- |
  | j/k, ↑/↓ | move the cursor |
  | x / Space | complete |
  | e / ⏎ | edit title |
  | c | capture |
  | b | bucket |
  | s | scheduled |
  | d | due |
  | q | queue |
  | a | assign |
  | i | assign to me |
  | l | tags |
  | p | priority |
  | f | filter |
  | / | search |
  | ⌘↑ / ⌘↓ | move |
  | ⌥⌘↑ / ⌥⌘↓ | move to top / bottom |
  | ⇧⌘M | type-to-move dialog — can create a bucket |
  | ? | Tasks shortcut sheet |
  | ⌘⌫ | delete (undo) |

  - Global shortcuts (⌘K, ⌘⇧K, ⌘N, ⌘1–7, ⌘C/⌘V…) always win — the List never swallows modified keys.

### 9. Detail panel (comp §1 + §5 option C)

- **Header** — bucket breadcrumb (dot + name) · queue toggle · copy link · ⋯ (Duplicate, Archive / won't do, Delete).
- **Title row** — checkbox next to the title (18 px, wraps).
- **Description** — auto-height, no reserved empty box; `@` / `/` refs as today.
- **Attachments strip** — directly under the description (AT-2).
- **Properties:** label column kept; every value starts at the same x behind a 14 px icon slot; no chevrons (hover shows the field); muted placeholders.
  - **Always shown:** Status, Assignee, Priority, Due, Tags (tags are a property row with chips and +).
  - **Shown once set:** Energy, Scheduled, Time, Repeat. Until then they sit in one quiet line "+ Energy · Scheduled · Time · Repeat".
  - The **Time** row reads "1h 20m of ~4h" with a hairline progress bar, plus "you 50m" for your share.
- **Collections** (same header style: label · count · +) — Subtasks, Blocked by, Blocks, Linked (spine hub).
- **Comments & activity** at the bottom:
  - a feed mixing comments and the quiet activity trail;
  - a composer: "Leave a comment… @ to mention" (text + @mentions, no attachments in comments yet).
- **Metadata line** — "Created by … · date · Updated …".
- The full-width white "Commit to Queue" button is gone.

### 10. Capture (comp §3)

- **Title:** dates parse as today.
  - **`#tag`** at a word start opens tag suggestions (fuzzy; last row "Create #name"). Picking one removes the token and adds a tag chip. Esc leaves a literal `#`. `#123` / `C#` stay text.
  - Parsed spans are highlighted while typing.
- **Pills** (one row, same height):
  - Bucket · Assignee (avatar at icon size) · Due · Tags · Priority · **More** (Scheduled · Energy · Estimate · Repeat).
  - A set pill = filled; an unset pill = hairline + muted.
  - Pills are pre-filled by the scope's filters.
- **Footer:**
  - **"Add to my queue"** switch (remembers its last state; on by default inside a run);
  - "Create more";
  - **Create ⌘↵**.
- **Paste** — a screenshot pasted into the modal attaches (AT-3). The task is always created even if the upload fails.

### 11. Sidebar (Tasks rail)

- **Rows:**
  - All
  - Queue (my queue; live state during a run)
  - My tasks (teams)
  - Inbox
  - **Views** (if any)
  - **Buckets**
  - **Archived** (collapsed; only when non-empty)
  - **Recently deleted** (bottom, quiet; only when non-empty)
- **NavRow behavior (DS-3):**
  - counts flush right; on hover/focus/open-menu the count fades and **⋯** fades in in the same slot (nothing reflows);
  - ⋯ also via right-click and keyboard;
  - hover ≠ active.
- **Bucket rows:**
  - an optional colour dot (8 label hues; default neutral);
  - drag to reorder;
  - ⋯ = Rename · Colour · Open at · Section · Share (PERM) · **Archive** · **Delete…**.
  - The section header's hover "+" adds a bucket; a bucket's hover "+" next to ⋯ captures straight into it.
  - Section collapse is remembered.
- **Archive bucket** — hides the bucket and its tasks from All, My tasks, search, counts and queues.
  - It's listed under **Archived** at the bottom; Unarchive restores it (without re-queuing).
  - *(Pending open question 2.)*
- **Delete bucket…** opens a confirm dialog:

  > Delete "Marketing"? It has 12 tasks.
  > ◉ Move the 12 tasks to Inbox · ○ Delete the 12 tasks too
  > [Cancel] [Delete bucket]

  - A toast with **Undo** follows and restores everything, including files and subtasks.
  - Everything deleted (tasks, buckets, files) stays in **Recently deleted** for **30 days** (Restore · Delete forever), then is purged.
  - *(Pending open question 2.)*

### 12. Live updates

- Changes by teammates appear without reloading, within a couple of seconds: tasks, buckets, queues/claims, tags, comments and attachment counts.
- Offline/reconnect → a full refetch on focus/reconnect.
- Optimistic local edits are never overwritten by an echo of themselves.

## Edge cases

- **Old desktop builds keep running** until updated.
  - They still write `owner_id` / `committed_for` / `commit_order` / `time_spent_seconds` and call `tasks_op_commit`/`uncommit`/`skip_today`.
  - Shims keep them working (writes land in the new model) until the cleanup block (TV-D7), which only runs after the adoption window.
- **Two people edit the same task at once** — field-level writes mean one person's priority change never reverts the other's assignee change. Same-field conflicts resolve last-writer-wins.
- **Assignee leaves the workspace** — their tasks there become Unassigned (PRIV-2 AC9; Maciej kept it over "stays assigned as Former member", 2026-10-08, TV-D1). "Created by" still names them as a former member.
- **Creator unknown** (tasks reassigned before this change — the old model overwrote the creator) — the metadata line omits "Created by". There is no guessing beyond the activity-log recovery done in the migration.
- **Queue a task you can't see anymore** (sharing revoked) — it drops out of your queue silently. If it was your Now in a run, the run advances and says "That task is no longer shared with you".
- **A task completed by someone else while it's your Now** — the run advances, with a quiet line "Mike completed *X*".
- **Your Now gets deleted by someone** — the run advances; the task is in Recently deleted.
- **The queue empties mid-run** → summary. **End run with in-flight tasks** → they stay at the top of the queue.
- **Two devices, same person, same run** — one run per person. The second device shows the run read-through and takes control when you act on it. The clock is computed from shared timestamps, so it never double-counts.
- **Laptop sleeps mid-pomodoro** → catch-up + away prompt (§5).
- **Recurring task completed from the queue** → leaves queues. Its next occurrence reopens later without re-queuing.
- **Drag with a sort active** → reorder refused with an inline note. Cross-group drop still works.
- **Multi-select across groups/buckets + Move** → all move. **Bulk delete** → one Undo for all.
- **Filters hide the selected task** → selection falls back (DF-1 rules stand). An inbound deep link clears a hiding filter (DF-1).
- **Saved view whose bucket/tag was deleted** → the dimension shows "deleted tag"; the view keeps working.
- **Recently deleted:**
  - restoring a task whose bucket was deleted → it goes to Inbox;
  - restoring after its files were purged → it comes back with "File removed after 30 days" tiles.
- **Archived bucket holding tasks that are in someone's queue** → removed from queues on archive.
- **A view-only member** — no queue/drag/bulk/capture controls. They still see claims, filters and views (their own).
- **Permission-revoked mid-drag** → the drop fails with a toast; the item snaps back.
- **Capture with storage full / offline** → the task is created and the attachment waits ("not attached · Retry").

## Acceptance criteria

IDs are per block (block → ACs). Plain product language.

**TV-Q1 — Quick fixes (start now)**
- **Q1-1** — With the task list focused, ⌘K opens the palette, ⌘⇧K opens the capture bar, and ⌘C/⌘V/⌘X behave natively. No modified key triggers a list action.
- **Q1-2** — Pressing Space/Enter on a button inside a queue or list row activates that button and does not start a keyboard drag.
- **Q1-3** — In a single-bucket scope or when grouped by bucket, rows show no bucket pill.
- **Q1-4** — Deleting a bucket asks first. The dialog shows the task count and "Move the N tasks to Inbox", and an Undo toast restores the bucket and its tasks' placement.
- **Q1-5** — The global shortcut sheet lists ⌘1–⌘7.

**TV-F1 — Focus engine (start now)**
- **F1-1** — A focus session running while the window is hidden, minimized, covered or on another Space for 10 minutes credits 10 minutes (±2 s).
- **F1-2** — Reloading or restarting the app during a session resumes it with the correct elapsed time.
- **F1-3** — If the machine slept or the app was suspended for more than ~90 s, an away prompt offers Keep / Discard / Count as break. Unanswered away time is never credited silently.
- **F1-4** — Pomodoro phase ends that happened while away are caught up correctly, and a new work block never auto-starts while away.
- **F1-5** — A phase end while the window is in the background produces one OS notification on desktop and an in-app toast on web.
- **F1-6** — Finishing or switching tasks mid-pomodoro keeps the rhythm (no reset, pomodoro stays on).
- **F1-7** — Time is never lost when a flush fails. It is retried and visible as "not saved yet".

**TV-D1 — Safer saves + assignee data (start now)**
- **D1-1** — Editing one field of a task (title, priority, …) never overwrites a different field another person changed meanwhile.
- **D1-2** — A task can be Unassigned. Assigning goes through a check that the person is an active member who can take tasks.
- **D1-3** — The creator of a task is recorded and can't be changed by later edits, including edits from old app versions.
- **D1-4** — Assigning someone else sends them "assigned to you" exactly once. Self-assignment sends nothing.
- **D1-5** — Completing a task someone else created and assigned to you notifies its creator once.
- **D1-6** — Comment, unblocked and overdue notifications go to the assignee (fallback: creator).
- **D1-7** — Old desktop builds that still write the assignee into `owner_id` keep working: their change lands as the assignee and the creator stays intact.
- **D1-8** — The detail panel shows "Created by …" in the metadata line. Capture, the detail panel and the context menus offer "Unassigned".
- **D1-9** — MCP agents see each task's `assignee` and can assign through a tool that applies the same membership check.

**TV-D2 — Personal queue (data)**
- **D2-1** — Each person's Queue holds only what they queued. Two people's queues never mix.
- **D2-2** — Add, remove, reorder and move-to-end are atomic, and survive reload and device switch.
- **D2-3** — Completing, archiving or deleting a task removes it from every queue. Restoring doesn't re-queue.
- **D2-4** — Today's existing commits carry over into the committer's queue once, in their order.
- **D2-5** — Old app versions' "commit / uncommit / skip today" calls land in the caller's queue.
- **D2-6** — MCP agents read and edit the queue of the key's creator. The old `tasks_today`/`commit` tools still work as aliases.

**TV-D3 — Time entries (data)**
- **D3-1** — Every tracked stretch is recorded with who/when/how long. Totals are exact, even with two devices or two timers.
- **D3-2** — A task's total is the same everywhere it's shown. A person sees their own share; nobody sees someone else's share.
- **D3-3** — Editing the Time value records an adjustment that makes the total match the typed value. "Took longer" and its Undo add and remove exactly one adjustment.
- **D3-4** — Existing totals are preserved as a legacy entry. They count toward totals but not toward "this week".
- **D3-5** — Old app versions writing `time_spent_seconds` keep working (their delta is recorded as an adjustment).

**TV-D4 — Queue & assignee in the UI**
- **D4-1** — Queue toggles, the `q` key, the rail Queue count, the dashboard Tasks widget and Calendar's tasks panel all read and write *my* queue.
- **D4-2** — A task in someone else's queue shows their ringed avatar with "In <name>'s queue". Queuing it anyway shows "Also in <name>'s queue".
- **D4-3** — "My tasks" appears in the sidebar for workspaces with ≥2 members and shows tasks assigned to me.
- **D4-4** — Rows/cards don't show the assignee avatar in My tasks.

**TV-D5 — Live updates**
- **D5-1** — A teammate's change to a task, bucket, queue, tag or comment count shows up within ~2 s without reloading.
- **D5-2** — Your own in-flight optimistic edit is never flickered back by its own echo.
- **D5-3** — After being offline, the module refetches on reconnect/focus.

**TV-T1 — Shared tag store**
- **T1-1** — Tags added or removed on a task show up immediately on every surface hosting that task (Tasks, Calendar, Notes, Email panels).
- **T1-2** — Creating a tag by name and attaching it in one step works before the task exists (for capture).

**TV-U1 — Rows, board, completed**
- **U1-1** — Rows follow the comp anatomy: quiet counts after the title; priority/date/assignee/queue in fixed columns that line up; columns empty across the view collapse.
- **U1-2** — Tags show as `# N` on rows/cards, never as chips.
- **U1-3** — Done rows dim as a whole. Completed tasks are hidden by default with a "N completed · show" line. Display → Completed 7 days/All works. A just-checked task stays visible until scope change or reload.
- **U1-4** — Board columns flex between 280 and 400 px. Cards have one meta line. Selection is a tint.
- **U1-5** — Everything holds at all 3 densities, 3 radii, 6 shades and 8 accents.

**TV-U2 — Toolbar, Filter, Display, search**
- **U2-1** — The toolbar uses one control style (comp). Group moves into Display.
- **U2-2** — Every listed filter dimension works with is/is not/any of. The chips read as sentences, the count badge and "N of M · Clear" are right, and filters are remembered per scope.
- **U2-3** — Display group/order/completed/subtasks/properties work and are remembered per scope, including the Time and Energy groupings.
- **U2-4** — `/` search filters by title + description. `#tag`/`@name` become chips.
- **U2-5** — New inside a filtered scope pre-fills the filter's tag/assignee/priority.

**TV-U3 — Detail panel + comments**
- **U3-1** — The panel follows comp §1/§5-C: header, checkbox+title, auto-height description, aligned values, core-always properties, the "+ Energy · Scheduled · Time · Repeat" line, and the Time row with the hairline bar.
- **U3-2** — Comments can be read and written on a task (text + @mentions). Mentions and participants are notified.
- **U3-3** — The "Commit to Queue" button is gone; the queue toggle lives in the header.

**TV-F2 — Queue run**
- **F2-1** — There is no Plan/Focus switch. ▶ Start run in the Queue view starts a run; Pause and End run work.
- **F2-2** — Done, Skip (= to the end) and Remove from queue do what they say. None of them changes the reschedule count.
- **F2-3** — The sidebar looks the same during a run, except the Queue row's live "2/7". Leaving Tasks keeps the run, the chip returns to it, and linked items open their module.
- **F2-4** — The run survives reload and shows on your other device.
- **F2-5** — Capture during a run adds to the queue by default.
- **F2-6** — A teammate sees "<name> is on this" on your Now task. Nothing else about your run is visible to them.

**TV-F3 — Pomodoro per run, break, summary, empty**
- **F3-1** — Completing or switching tasks never resets the pomodoro. Long breaks come every N blocks per run. A run started within 15 min continues the count.
- **F3-2** — The soft break shows "+5 min focus" / "Skip break". Nothing is tracked on tasks during a break.
- **F3-3** — The end-of-run summary shows done/total, focused time, blocks and the in-flight count, plus Add more / Start another run and suggestion chips (open a review list; no auto-add).
- **F3-4** — An empty Queue shows the invitation state (never "0 / 0 Done ✓").
- **F3-5** — The Home pomodoro widget shows and controls the same run.

**TV-F4 — In flight**
- **F4-1** — Hand off (`w`) moves Now to In flight, starts waiting time and promotes the next task. The note/check-back/link popover is optional and Enter skips it. A non-empty note becomes a comment.
- **F4-2** — In-flight cards live in the right panel's In flight tab with expandable details. Pick up / Done work, and Pick up returns the previous Now to the top of Up next.
- **F4-3** — A due check-back brightens the card and sends exactly one notification.
- **F4-4** — After Done/Skip and at breaks, a dismissible "Pick up X?" line appears when something is in flight.
- **F4-5** — A completed blocker, a new comment by someone else, or (desktop) a reply on a linked email thread marks the card "Ready to check".
- **F4-6** — Waiting time is recorded separately and never counts as focus.

**TV-F5 — Calendar & Home on one engine**
- **F5-1** — Calendar "Start focus" puts the task on top of my queue and starts or continues my run. If a run is on, it becomes Now and the previous Now moves to the top of Up next.
- **F5-2** — There is only one timer in the app: Calendar, Tasks, the chip and Home all show the same run.
- **F5-3** — "Took longer" and its Undo work through adjustments.
- **F5-4** — The Home time-tracking widget shows my tracked task time on web and desktop.

**TV-U4 — Drag and drop**
- **U4-1** — In a list, dragging with the pointer left of the indent reorders (insertion line); right of it makes a subtask (indented preview).
- **U4-2** — With a non-manual order, the reorder is refused with the inline "Sorted by … — switch to Manual" note.
- **U4-3** — Dropping across groups rewrites the group's field.
- **U4-4** — Dropping on a sidebar bucket moves the task (subtasks follow), on Queue adds it to my queue, and on My tasks assigns it to me.
- **U4-5** — Drags look the same everywhere (DS-4 visuals). The Timeline keeps its own behavior.

**TV-U5 — Multi-select, bulk, keyboard**
- **U5-1** — ⇧/⌘-click, ⌘A and ⇧J/⇧K build a selection. The bulk bar's actions apply to all selected tasks, and Delete has one Undo.
- **U5-2** — Dragging a selection moves all of it.
- **U5-3** — Every key in §8 works in the List. `?` opens the Tasks shortcut sheet, and global shortcuts are never swallowed.

**TV-U6 — Sidebar: buckets, archive, delete, recently deleted**
- **U6-1** — Bucket colour dots and drag-to-reorder buckets work. Section collapse is remembered. The hover "+" captures into a bucket.
- **U6-2** — Delete bucket offers Move-to-Inbox (default) or Delete tasks too, and Undo restores everything (incl. files and subtasks).
- **U6-3** — Recently deleted lists deleted tasks and buckets for 30 days with Restore / Delete forever. After 30 days they're purged together with their files.
- **U6-4** — Archive hides a bucket and its tasks everywhere and lists it under Archived. Unarchive restores it without re-queuing.

**TV-U7 — Capture v2**
- **U7-1** — `#tag` in the title suggests, creates on "Create #name", and becomes a chip. Esc keeps a literal `#`. Parsed spans highlight.
- **U7-2** — The pills follow the comp: one row, same height, avatar at icon size, set vs unset differ in one way, and rarer properties sit under More.
- **U7-3** — The "Add to my queue" switch remembers its state and adds the new task to the end of my queue.
- **U7-4** — Pills pre-fill from the current scope's filters.

**TV-U8 — Saved views**
- **U8-1** — "Save as view…" stores scope + filters + display under a name. The view appears in the sidebar's Views section with a count.
- **U8-2** — Changing an open view shows "Save changes". Rename / reorder / delete work.
- **U8-3** — Views sync across my devices and open by link.

## Tests that prove them

Layers per AGENTS.md:
- **Unit** — Rstest, `src/**/*.test.ts`.
- **SQL** — round-tripped on a branch DB / rolled-back transaction per the CT-1 pattern, then applied to prod in-session (memory: apply verified migrations).
- **Component/visual** — Storybook + Playwright `tests/visual`, human-captured baselines.
- **e2e smoke** — env-gated Playwright.
- **Manual desktop checks** — go into the block's `docs/testing/<branch>.md`.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/tasks/ui/list-keys.test.ts` · "ignores modified keys" | Q1-1 | ⌘K / ⌘⇧K / ⌘C reach the app or the OS; the list's handler bails on any modifier. |
| `src/features/tasks/ui/dnd/task-dnd.test.tsx` · "activator is the row only" | Q1-2 | A focused child button doesn't start a keyboard drag. |
| `src/features/tasks/helpers.test.ts` · "bucket pill implied" | Q1-3 | The "show bucket" rule is false for single-bucket scopes and bucket grouping. |
| manual · delete-bucket dialog + Undo | Q1-4, U6-2 | The count, both choices, and Undo restore. |
| `src/features/focus/engine.test.ts` · "wall-clock accrual under throttled ticks" | F1-1 | With fake timers firing once a minute, 10 real minutes credit 600 s. |
| `engine.test.ts` · "rehydrates from persisted state" | F1-2 | A saved session restored from storage shows the right elapsed time. |
| `engine.test.ts` · "gap > 90 s raises away, nothing credited" | F1-3 | Simulated sleep produces a pending away block. Keep/Discard/Break apply correctly. |
| `engine.test.ts` · "pomodoro catch-up never auto-starts while away" | F1-4 | Phase boundaries are computed from timestamps; no new work block starts in the gap. |
| manual desktop · background phase end | F1-5 | Hide the window across a phase end → one OS notification. |
| `engine.test.ts` · "task switch keeps rhythm" | F1-6 | Binding a new task doesn't reset phase, block count or the pomodoro flag. |
| `engine.test.ts` · "failed flush retains seconds" | F1-7 | A flush that reports failure keeps the seconds for retry. |
| `src/lib/runtime.web.test.ts` · "patchTask sends only changed columns" | D1-1 | The update payload contains just the edited fields. |
| SQL · `tasks_op_assign` round-trip | D1-2, D1-4 | Rejects non-members/viewers; assigns; logs exactly one `tasks.assigned` with the right notify target. |
| SQL · creator immutability + legacy owner shim | D1-3, D1-7 | An UPDATE of `owner_id` from an old client lands in `assignee_id`; `owner_id` is unchanged. |
| SQL · completion → creator notification | D1-5 | Completing a task created by A and assigned to B (completed by B) notifies A once; self-completion is silent. |
| `src/features/spine/notifications.test.ts` · re-keyed targets | D1-6 | The overdue/unblocked/comment targets use the assignee, falling back to the creator. |
| `src/features/tasks/assignees.test.ts` · "Unassigned option + former member" | D1-8 | The picker lists active, eligible members + Unassigned; a former member renders labelled. |
| `supabase/functions/moduo-mcp` tool tests · assign + shapeTask | D1-9 | The tool applies the same check; the task JSON has `assignee`. |
| SQL · queue ops + RLS | D2-1, D2-2 | Own rows only for writes; ordered positions; move-to-end; members can read claims. |
| SQL · completion/archive/delete cascade | D2-3 | Removes the queue rows; a restore doesn't re-add them. |
| SQL · commit backfill dry run | D2-4 | Today's commits map to the committer's queue in commit order. |
| SQL · legacy op shims | D2-5 | `tasks_op_commit`/`uncommit`/`skip_today` operate on the caller's queue. |
| MCP tool tests · queue + aliases | D2-6 | `tasks_queue_*` act for the key creator; the aliases behave the same. |
| SQL · `tasks_op_track_time` + totals RPC | D3-1, D3-2 | Concurrent entries from two sessions add up; totals equal the sum; my share is only visible to me. |
| SQL · adjustments | D3-3 | The typed total is reached exactly; Undo deletes the one adjustment. |
| SQL · legacy backfill + shim | D3-4, D3-5 | Old totals become legacy entries excluded from week sums; old-client writes become adjustments. |
| `src/features/tasks/queue.test.ts` · selectors | D4-1, D4-4 | My queue, counts, the widget source, avatar suppression in My tasks. |
| `src/features/tasks/claims.test.ts` | D4-2, F2-6 | Others' queue rows → claim markers; the run's Now → "is on this". |
| `src/features/tasks/default-view.test.ts` · My tasks | D4-3 | The row is visible only with ≥2 members; scope = assignee is me. |
| `src/features/tasks/live.test.ts` · merge echo/conflict | D5-1, D5-2 | A Realtime payload merges into the bundle; our own pending optimistic patch is never reverted by its echo. |
| manual · two browsers live | D5-1, D5-3 | A change shows up within ~2 s; offline → reconnect refetch. |
| `src/features/tags/store.test.ts` | T1-1, T1-2 | One store feeds every surface; create-or-attach by name works before the task id exists. |
| `src/features/tasks/row-layout.test.ts` + visual `tasks-list.spec.ts` | U1-1, U1-2, U1-5 | Column rules, count indicators; the visual baseline holds per density/shade/accent. |
| `src/features/tasks/completed.test.ts` | U1-3 | Hidden by default, "N completed" counts, the 7-days window, the just-checked task stays. |
| visual `tasks-board.spec.ts` | U1-4 | Column widths, one meta line, tint selection. |
| `src/features/tasks/filters.test.ts` | U2-2, U2-5 | Every dimension × operator; AND/any-of; per-scope persistence; the capture seed. |
| `src/features/tasks/display.test.ts` | U2-3 | Grouping incl. Time buckets and Energy; ordering; the subtasks mode. |
| `src/features/tasks/search.test.ts` (extend) | U2-4 | Title+description match; `#`/`@` tokens become chips. |
| visual `tasks-detail.spec.ts` | U3-1, U3-3 | The comp layout, property rules C, no Commit button. |
| `src/features/spine/comments-panel.test.tsx` | U3-2 | Read/write comments on a task; the mention picker targets people. |
| `src/features/focus/run.test.ts` · run state machine | F2-1, F2-2, F2-5 | Start/pause/end; done/skip/remove transitions; capture defaults in a run. |
| manual desktop · leave Tasks mid-run, second device | F2-3, F2-4 | The chip, the rail live state, linked items open; the second device sees the run. |
| `run.test.ts` · pomodoro per run | F3-1, F3-2 | The rhythm survives task switches; long-break cadence; the 15-min continuation; no tracking in breaks. |
| `src/features/focus/summary.test.ts` | F3-3 | Summary numbers; suggestion queries (drifted/due/quick/high). |
| visual · empty queue | F3-4 | The invitation state. |
| manual · Home pomodoro widget | F3-5 | Controls/shows the same run. |
| `src/features/focus/in-flight.test.ts` | F4-1, F4-2, F4-6 | Hand-off/pick-up transitions; waiting entries kind = waiting; the note becomes a comment. |
| `in-flight.test.ts` · check-back | F4-3 | Fires once at the due time (from timestamps, incl. after sleep). |
| `in-flight.test.ts` · check points + linked waits | F4-4, F4-5 | Offer lines after done/skip/break; blocker/comment/email signals mark the card ready. |
| `src/features/calendar/focus.test.ts` (rewrite) | F5-1, F5-2 | Start focus from a block → queue top + run; the single engine. |
| `src/features/calendar/triage.test.ts` (update) | F5-3 | Took longer / Undo via adjustments. |
| `src/features/dashboard/ui/widgets/timetracking.test.ts` | F5-4 | The widget aggregates my entries (today/week), web+desktop. |
| `src/features/tasks/dnd/drop-mode.test.ts` | U4-1 | Pointer x vs indent → reorder or nest. |
| `drop-mode.test.ts` · sorted refusal + cross-group | U4-2, U4-3 | Non-manual order refuses reorder; a cross-group drop yields a field patch. |
| `src/features/tasks/dnd/rail-drop.test.ts` | U4-4 | Bucket/Queue/My-tasks drop resolution (prefix-filtered `pointerWithin`). |
| visual · drag states | U4-5 | Insertion line, nest preview, target tint. |
| `src/features/tasks/selection.test.ts` | U5-1, U5-2 | Range/toggle/all selection; bulk actions; one Undo; multi-drag. |
| `src/features/tasks/ui/list-keys.test.ts` (extend) | U5-3 | Every listed key; `?` sheet; modifiers ignored. |
| `src/features/tasks/sidebar.test.ts` | U6-1, U6-4 | Colours, reorder positions, archive filtering, collapse persistence. |
| SQL · delete-with-tasks, restore, purge | U6-2, U6-3 | Soft delete with a shared marker; restore brings files back; purge after 30 days removes the rows + files (Storage API). |
| `src/features/tasks/parse/capture-parser.test.ts` (new) | U7-1 | `#tag` tokenizing, the literal escape, `#123`/`C#` untouched, highlight spans. |
| visual `tasks-capture.spec.ts` | U7-2 | Pill row per comp. |
| `src/features/tasks/capture.test.ts` | U7-3, U7-4 | Queue switch persistence + effect; the filter seed. |
| SQL + `src/features/tasks/views.test.ts` | U8-1–3 | View CRUD (own rows only), apply/serialize, `?view=` deep link. |

## Assumptions & technical decisions

1. **Expand → migrate → contract.** Every schema change is additive first (new tables/columns + shims for old clients). Old columns, RPCs and the `tasks_with_drift` view are dropped only in TV-D7, after ≥2 desktop releases + 14 days of the update toast. *Rejected: dropping columns immediately — PostgREST would reject every whole-row upsert from old desktop builds.*
2. **Field-level writes.** `patchTask` sends only the changed columns (`update … eq id`). Creation stays an upsert, and Undo snapshots restore only the fields they changed. This fixes last-writer-wins clobbering (whole-row upserts reverted teammates' edits). *Rejected: optimistic-concurrency version column — more machinery than this needs at 2–5 people.*
3. **Assignee** = new nullable `tasks.assignee_id`, backfilled from `owner_id`. `owner_id` reverts to *creator*; a BEFORE UPDATE trigger:
   - makes `owner_id` immutable;
   - maps a legacy client's `owner_id` change into `assignee_id`.

   Creator recovery for reassigned tasks uses the INSERT-branch actor of DF-9 `tasks.assigned` activity rows where present; otherwise the creator stays as-is. The UI hides "Created by" when it's flagged unknown (`tasks.creator_unknown`). Assignment goes through **`tasks_op_assign`** (membership + `canTakeTasks` check). *Amended in TV-D1 (2026-10-08):* `tasks.assigned` is logged by the DF-9 trigger for every way a task gets an assignee (INSERT and UPDATE branches, re-keyed to `assignee_id`), and the op doesn't log a second copy, so old builds' `owner_id` writes notify exactly once too. Old builds are recognised by the column default of `assignee_id` (a nil-uuid placeholder they leave in place). See `docs/decisions/tasks.md` 2026-10-08. *Rejected: multi-assignee (decided 2026-10-07: single + queue claims covers the duo).*
4. **Queue** = new table `task_queue(id, workspace_id, user_id, task_id → tasks on delete cascade, position text, queued_at, updated_at)`, unique `(user_id, task_id)`.
   - Lexorank `position` reuses `betweenPositions`.
   - **RLS:** members who can view the task can read rows (claims); only the row's user writes (through ops).
   - **Ops:** `tasks_op_queue_add / remove / reorder / move_to_end` (guard = `tasks_op__guard`, actor from `perm_actor_id()`, `module_activity` rows for add/remove; reorder logs nothing visible).
   - **Registered** in `perm_enforce_write` with the fixed `'edit'` action (no `deleted_at` on the table).
   - **Leaving queues** — completion/archive/delete/bucket-archive removal is a trigger on `tasks`.
   - **Backfill** — rows with `committed_for = current_date` (UTC±14h window) → the latest `tasks.commit` actor from `module_activity`, else the assignee, position from `commit_order`.
   - **Legacy shims** — `tasks_op_commit/uncommit/skip_today` redefine onto the caller's queue (skip_today = remove, no reschedule bump).
   - **Catch-up / recurrence:**
     - catch-up and recurrence stop touching commit columns;
     - `clear_commit` / `release_commit` are accepted and ignored (old clients);
     - "done leaves all queues" covers recurrence.
   - *Rejected:* keeping a date on queue rows — the designer explicitly doesn't want midnight semantics.
5. **Time entries** = new table `task_time_entries(id, workspace_id, task_id → cascade, user_id, kind focus|waiting|adjustment|legacy, started_at, ended_at null, seconds int signed, run_id null, created_at)`.
   - **Writes** go through **`tasks_op_track_time`**. It opens/heartbeats/closes the caller's open entry (one open entry per user+task), appends adjustments, and deletes own adjustments (for Undo).
   - **Totals** come from **`tasks_time_totals(workspace_id)`** (SECURITY DEFINER), which returns per task `total_focus_seconds`, `my_seconds`, `my_waiting_seconds`. Raw entries are readable only by their author.
   - The entry table *is* the attributed log, so time ops write **no** `module_activity` rows. That's a documented exception to keep the trail quiet; recorded in `docs/decisions/tasks.md`.
   - **Legacy:** `time_spent_seconds` is backfilled as one `legacy` entry per task (excluded from date-window sums). A trigger keeps `tasks.time_spent_seconds` = total for old clients until TV-D7, and turns old-client writes of that column into adjustments.

   *As built in TV-D3 (2026-10-09):* the op appends **closed** stretches (no open entries to heartbeat: the TV-F1 engine keeps the clock on the device), each Focus save under an idempotency key (`client_key`, one entry per task and key), plus `adjust`, `set_total` and `undo` (own adjustments only; a task never owes time). `tasks_time_totals(workspace_id, since)` also returns the caller's share since a time. A lower value from an old build's whole-row upsert is ignored. Details: [docs/decisions/tasks.md](../docs/decisions/tasks.md) 2026-10-08 TV-D3.
6. **Focus engine** lives outside React (module store, AppChrome-remount-safe):
   - state is `{run, phase timestamps, open stretch startedAt, banked}`;
   - elapsed = banked + (now − startedAt) via `Date.now()` (not `performance.now()`, which freezes in sleep on WebKit);
   - the 1 Hz tick only repaints;
   - recompute on `visibilitychange`/focus;
   - local persistence in `localStorage` under the `moduo:tasks:focus` key family. Settings → Advanced reset wipes `moduo.*` keys but not `moduo:tasks:*`, so a cache reset never kills a live run.

   *As built in TV-F1 (2026-10-08):* `src/features/focus/engine.ts` (pure model in `engine-core.ts`), one record per person (`moduo:tasks:focus:<user id>`), one clock-owner tab per device. Saves go through a per-workspace flush sink (it writes only the task's time total) called with `{ ownedSince, earnedAt }` — `true` saved, `false` not now, `"gone"` the task can never take the time (dropped, the person is told), a promise = the write (a failure shows "not saved yet" and retries). Saving is at-least-once. **TV-D3 replaces the Tasks sink with `tasks_op_track_time` (give entries an idempotency key); the engine API stays.** Details: [docs/decisions/tasks.md](../docs/decisions/tasks.md) 2026-10-08.

   **Server persistence** = new table `focus_runs(id, workspace_id, user_id, status running|paused|ended, mode pomodoro|stopwatch, started_at, ended_at, now_task_id, phase work|break|long_break, phase_started_at, phase_seconds, blocks_completed, updated_at)`. One non-ended run per user. Members can read only `(user_id, now_task_id, status)` through a SECURITY DEFINER `focus_claims(workspace_id)` → "<name> is on this".

   In-flight items: `focus_in_flight(id, run_id, user_id, task_id, handed_off_at, check_back_at null, link_url null, resolved_at null)`.
7. **Background accuracy on desktop:** `"backgroundThrottling": "disabled"` on the main window (Tauri ≥2.3, macOS 14+; verified in tauri-utils source). Wall-clock accrual stays the real fix (web, older macOS, sleep).
8. **Notifications for phase end / check-back:** `tauri-plugin-notification` (Cargo + npm + `notification:default` capability + web stub alias in `rsbuild.config.ts`). The timing is driven by the engine (immediate notification at the computed time; desktop scheduling isn't supported by the plugin).
   - **Spike first in TV-F1:** verify delivery on a Developer-ID-signed build — the plugin is known to fail silently on mismatched signing. Fallback is a small UNUserNotificationCenter command.
   - **Web:** in-app toast only (no browser permission prompt in v2).
9. **Away detection** = a heartbeat gap > 90 s → the away block. Idle detection (`user-idle2` crate) is out of scope.
10. **Live updates** = Supabase Realtime `postgres_changes` on `tasks`, `buckets`, `task_queue`, `tag_links`, `comments`, `attachments` (count), filtered by `workspace_id`, RLS-respecting. Add the tables to the `supabase_realtime` publication. The client merges by `updated_at` and skips echoes of pending optimistic ops (op id / local pending set). Plus refetch on focus/reconnect (throttled 5 s). *Rejected: polling — wasteful; claims would lag.*
11. **Tags:** one shared workspace tag store (moved out of `features/contacts`, event renamed), seeded by the Tasks bundle, with per-entity selectors. Tasks' `toggleTaskTag`/`createTagForTask` migrate onto it, plus `createOrAttachByName`. The broken `listEntityTags` is fixed first (separate chip; TV-T1 verifies it).
12. **Comments on tasks** reuse `comments_op_add` (no migration). The list + composer + mention picker are extracted from `note-comments-panel.tsx` into `src/features/spine/ui/comments-panel.tsx`. Notification targets: assignee + creator + participants (redefine `comments_op_add`'s task lookup).
13. **Filters/Display/views state** goes through one shared persisted-prefs helper (DS-4): `moduo:tasks:view:<ws>:<scope>`, read once per scope mount. Saved views = new table `task_views(id, workspace_id, user_id, name, position, scope, filter jsonb, display jsonb, created_at, updated_at, deleted_at)`, own rows only (personal), and a `?view=` URL param validated like `?id=`.
14. **DnD:**
    - one page `DndContext`;
    - the rail droppables get ids `rail:*` with a prefix-filtered `pointerWithin` branch;
    - the Queue stays `closestCenter`;
    - the list's reorder/nest is decided from the raw pointer x vs the row's indent edge at drop time (the notes `resolveDrop` pattern);
    - the Timeline keeps its own context;
    - `setActivatorNodeRef` is set on rows (fixes Q1-2).
15. **Buckets:**
    - new columns `buckets.color text null` (label hue name) and `buckets.archived_at timestamptz null`;
    - deleting with tasks = soft delete with a shared `deleted_batch_id` on bucket + tasks (+ attachments via AT spec), so Undo/Restore restore the batch;
    - purge after 30 days = a scheduled Edge Function (service role, Storage API deletes) — shared with the attachments purge.
16. **MCP** (contract pillar):
    - `tasks_queue`, `tasks_queue_add`, `tasks_queue_remove`, `tasks_queue_reorder`, `tasks_assign`;
    - `shapeTask` gains `assignee`, `creator`, `queued_by_me`, `time_total_seconds`;
    - `tasks_today` / `tasks_commit` / `tasks_uncommit` / `tasks_skip_today` stay as aliases until TV-D7;
    - new args in `_shared/contracts/mcp-tool-args.ts`; docs/moduo-mcp-connector.md updated.
17. **Dashboard:**
    - Tasks widget = "Queue" (my queue) or, when empty, "Open" (resolves the DF-15 naming collision);
    - Pomodoro widget = the run controller;
    - Time-tracking widget = my entries (desktop redb `tt_*` stays dormant).
18. **Rust:** the dormant Rust tasks layer is not updated (no parity needed; tasks are Supabase-direct on both platforms).
19. **Keys:**
    - the List handler bails on any `meta/ctrl/alt` except the explicitly bound ⌘↑/↓, ⌥⌘↑/↓, ⇧⌘M;
    - `?` is claimed in the capture phase on /tasks (email pattern);
    - `/` requires `!shiftKey`;
    - ⇧J/⇧K are checked before the lowercase match.
20. **Migrations are applied to prod in-session** after a round-trip check (designer standing preference), with a graceful-degrade guard for the merge-before-apply window. Probe the live function definitions before `CREATE OR REPLACE` (prod drift).

## Execution blocks

Lanes run in parallel where their files don't overlap (see BUILD_ORDER *Serialization points*).

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **TV-Q1** Quick fixes *(start now)* | keyboard modifier guard, DnD activator fix, implied-bucket pill rule, delete-bucket confirm + Undo, shortcut sheet ⌘1–7 | Q1-1–5 | — |
| 2 | **TV-F1** Focus engine *(start now)* | wall-clock + persisted engine, away prompt, catch-up, background throttling off, notification plugin + spike, pomodoro kept across task changes (current Execute UI keeps working) | F1-1–7 | — |
| 3 | **TV-D1** Safer saves + assignee data *(start now)* | field-level writes, `assignee_id` + creator trigger + legacy shim, `tasks_op_assign`, notification re-key + creator-on-completion, Unassigned + Created-by UI, MCP assign/shape | D1-1–9 | — |
| 4 | **TV-D2** Personal queue (data) | `task_queue` + ops + RLS + perm registration + cascade trigger + backfill + legacy shims + MCP queue tools | D2-1–6 | D1 |
| 5 | **TV-D3** Time entries | `task_time_entries` + `tasks_op_track_time` + totals RPC + legacy backfill/shim; engine flushes into entries; detail value edits → adjustments | D3-1–5 | D1, F1 |
| 6 | **TV-T1** Shared tag store | shared store + Tasks migration + create-or-attach-by-name | T1-1–2 | D1 |
| 7 | **TV-D4** Queue & assignee in the UI | my-queue consumers (rows, keys, rail, widget, calendar panel), claims, My tasks row | D4-1–4 | D2, DS-3 |
| 8 | **TV-D5** Live updates | Realtime subscriptions + merge + focus refetch | D5-1–3 | D2 |
| 9 | **TV-U1** Rows, board, completed | row anatomy + columns + counts + priority glyph + done handling + board cards/columns | U1-1–5 | DS-3, D4 |
| 10 | **TV-U3** Detail panel + comments | comp panel + property rule C + Time row + shared comments panel | U3-1–3 | DS-2, D1, D3 |
| 11 | **TV-F2** Queue run | line-up, run, Now/Up next, Skip/Done/Remove, `focus_runs` + claims "is on this", chip/rail state, mode switch removed | F2-1–6 | F1, D2, D3, DS-2 |
| 12 | **TV-F3** Pomodoro per run, break, summary, empty | run rhythm, soft break, summary + suggestions, empty state, Home pomodoro widget | F3-1–5 | F2 |
| 13 | **TV-U2** Toolbar, Filter, Display, search | toolbar, Filter dims, Display, search, capture seeding hooks | U2-1–5 | DS-4, U1, D4 |
| 14 | **TV-U4** Drag and drop | reorder vs nest, sorted note, cross-group, rail drop targets, shared drag visuals | U4-1–5 | U1, DS-4, D4 |
| 15 | **TV-U5** Multi-select, bulk, keyboard | selection model, bulk bar, multi-drag, full key map, `?` sheet | U5-1–3 | U4 |
| 16 | **TV-U6** Sidebar: buckets, archive, delete, recently deleted | colours, reorder, hover +, archive, delete-with-tasks, Recently deleted + purge | U6-1–4 | DS-3, D4, AT-1 |
| 17 | **TV-U7** Capture v2 | `#tag`, pills, queue switch, filter seed, paste hook | U7-1–4 | DS-2, T1, D2, U2 |
| 18 | **TV-F4** In flight | hand-off, right-panel tab, check-backs, check points, linked waits | F4-1–6 | F3, U3 |
| 19 | **TV-F5** Calendar & Home on one engine | Calendar start-focus → queue/run, adjustments, time widget, delete `use-block-focus` | F5-1–4 | F2, D3 |
| 20 | **TV-U8** Saved views | `task_views` + Views section + save/update/rename/delete + `?view=` | U8-1–3 | U2, U6 |
| 21 | 🔴 **TV-D7** Contract cleanup | drop legacy columns/view/shims/aliases | — | all above + adoption window |

## Out of scope

- **Multiple assignees** — single + claims, decided.
- **Board cover images** — no.
- **Inline images in descriptions** — attachments-only, decided.
- **The daily planning ritual (T27)** — parked.
- **Idle detection beyond sleep/suspension.**
- **Attachments on comments.**
- **Shared (workspace) saved views** — later, on top of the PERM sharing model.
- **The app-wide `@` / `#` / `/` reference grammar (T28)** — its own spec (GR-0); only `#tag` in capture + search ships here.
- **Light-mode palette tuning, mobile layouts.**
- **Redb/Rust tasks parity.**
- **Gantt/Timeline changes** beyond the attachment mark and the selection tint.
- **Depth ceiling:** Linear-light — no workflow-status customization, no cycles, no estimates-as-points.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous (decision rounds 1–3b + comp).
- [x] **Every acceptance criterion has at least one test** with a plain-English note.
- [ ] **Open questions is empty.** Five designer calls remain (below). Blocks TV-Q1, TV-F1, TV-D1 (and DS-1, AT-1 in the companion specs) don't depend on them.
- [x] **Data model is named and Supabase-first:** `tasks.assignee_id`, `task_queue`, `task_time_entries`, `focus_runs`, `focus_in_flight`, `task_views`, `buckets.color/archived_at`, `deleted_batch_id`; migrations identified per block.
- [x] **Module feature spine wiring:**
  - links unchanged;
  - attach (AT spec);
  - drag (U4 + DF-22 hub kept);
  - @mention (comments);
  - notifications (§1);
  - activity (queue/assign ops; time exception recorded);
  - tags (T1);
  - MCP tools listed (#16);
  - dashboard widgets defined (#17).
- [x] **Execution blocks** decomposed, sequenced, context-sized, self-contained.
- [x] **Design constraints:** tokens only (DS spec adds the needed tokens), shadcn-wrapped primitives, DESIGN_RULES R1–R10 with the R5 update (tint-only) and R6 respected (swap, no reflow).
- [x] **Manual-test surfaces:** desktop background/sleep/notifications, two-browser live updates, the second device's run, delete/restore/purge, old-desktop-build compatibility (keep one pre-v2 build installed for the shim checks).

**Ready to execute:** TV-Q1, TV-F1, TV-D1 now; the rest follow their dependencies.

## Open questions

- [x] **1 · Saved views — personal only?** → **Decided 2026-10-08: personal, and synced across your devices.** They ship in this wave (TV-U8). Sharing a view with the workspace comes later, on top of the PERM sharing model.
- [x] **2 · Sidebar additions — Archive bucket + Recently deleted (30 days)?** → **Decided 2026-10-08: both** (TV-U6), including "Delete the tasks too" in the bucket delete dialog.
- [x] **3 · HEIC on the web** → **Decided 2026-10-08: no in-browser decoder for now.** The desktop app and Safari convert natively; Chrome/Firefox/Edge keep the original as a file tile without a preview. See attachments.md open question 1.
- [x] **4 · Reference grammar, `#tag` in prose** — link or apply? → **Decided 2026-10-08: Link**, with two helpers: an "Add #tag" offer when an item mentions a tag it doesn't have, and a "Mentioned in" list on the tag page. Typing `#tag` in text never changes an item's tags; a new task's title still applies them. Input for the GR-0 spec.
- [x] **5 · Coordination with Mike's rebuild** → **Answered 2026-10-08:** the rebuild is the agent setup ("Harness v2": AGENTS.md-only instructions, knowledge split into `docs/decisions/` + `docs/gotchas/` area files, BUILD_ORDER/BUILD_LOG, Biome in verify/CI, Storybook 10). It doesn't touch Tasks code, `runtime.web.ts`, migrations or the MCP function. Tasks blocks start from a `maciej` that has develop's Harness v2 merged in.
