# Tasks v3 polish: deferred

> Written 2026-10-14 by the TV-POLISH batch (`t/maciej/tv-polish`). Every "Polish later" line in the `docs/testing/t-maciej-*.md` checklists and every known item was either fixed in that batch (see [t-maciej-tv-polish.md](./t-maciej-tv-polish.md)) or is listed here: one line each, with a recommendation.
> **Why deferred:** 🧭 needs a product or design call · 🗄 needs a migration · 🔧 engineering that isn't quick or safe enough for a polish batch (data flow, sync, performance) · 🖼 the visual round · 🧪 test debt.

## Attachments everywhere (AT-3)
- 🔧 Settings → Storage: a file's task name doesn't open the task. **Recommend:** add a "close Settings" event (`settings-events.ts`) and make the task name a link that closes Settings and opens the task.
- 🔧 Calendar's day columns redraw on every file change (the whole counts map is passed in); ⌘K reads counts only when results change; your own upload re-reads the strip twice. **Recommend:** pass each column its own counts; debounce the strip's re-read.
- 🔧 Focus's Now card reads each subtask's files on open. **Recommend:** read the store's counts (`attachmentCounts`), like the List.
- 🧭 Timeline: a point's hover text could add "· 2 files". **Recommend:** yes, after the visual round (one more word on every hover).
- 🖼 Visual baselines for the 📎 marks and the Storage section.

## Time entries and report (TV-D14)
- 🔧 The Print… layout stays mounted up to two minutes when the desktop's print dialog doesn't report closing. **Recommend:** verify on a signed desktop build first; unmount on `afterprint` or on the next focus.
- 🔧 Removing an entry reads your entries twice. **Recommend:** skip the second read when the total's change came from your own removal.
- 🔧 Undo after removing a Focus entry logs it back as plain logged time (its run and start are lost). **Recommend:** a restore op that un-deletes the row instead of re-adding it (🗄 if the op doesn't exist yet).
- 🧭 Two projects you can't see show as two sections both called "Private project" in a whole-workspace report. **Recommend:** merge them into one "Private projects" section.
- 🔧 Chat's memoised message rows show a Time & region change only at their next redraw. **Recommend:** subscribe the rows to `useTimeRegion`, as the Timeline's rows do.
- 🗄 `tasks_time_totals`' "since" dates a logged entry at UTC midnight. **Recommend:** date it in the saved zone, in the release migration train.
- 🔧 A very long report re-reads the server function per 1,000-row page. **Recommend:** a keyset page parameter on the report read when a busy year shows up in practice.

## Focus extras (TV-F8)
- 🗄 Bell and OS copy for a check-back still says "Reminder". **Recommend:** a reminder kind `check_back` with its own words.
- 🔧 The panel's Details ▾ menu shows no count for In flight. **Recommend:** a count slot in the panel registry's view entry.
- 🧭 "Offer quick tasks along the way" is long for the menu. **Recommend:** check at 90–125% zoom in the visual round; if it wraps, "Offer quick tasks".
- 🧭 The meeting divider reads "attending" as "on my own calendar". **Recommend:** use attendance once events carry it (Calendar v2).
- 🔧 Pick up keeps a check-back that's still ahead (it fires later as a plain reminder). **Recommend:** Pick up removes your ahead-of-time check-backs on that task.
- 🔧 The offer shows while the session already runs on the next task. **Recommend:** start the next task's timer only after the offer closes.
- 🧭 List rows' `w` (Hand off) isn't bound; Hand off lives in Focus only. **Recommend:** bind `w` on List rows to the same hand-off dialog.
- 🔧 Hand-off's people list shows everyone in the workspace, not only those who can see the task. **Recommend:** filter by a batched "can see" read.
- 🔧 Hand-off's Undo edges (a check-back not yet on the server, a fast Undo racing the wait's save, the comment that stays, no session restart). **Recommend:** queue the Undo behind the hand-off's writes and remove the comment it added.
- 🧭 Pick up ends every wait on the task, a teammate's too; its Undo re-adds them as new entries. **Recommend:** Pick up ends only your own waits.
- 🔧 "Once per change" is remembered only while Focus is open. **Recommend:** keep it in the session's preferences for the day.

## Home widgets (TV-H1)
- 🖼 The widgets' visual round (Maciej's call: after all modules) and their baselines.
- 🔧 Time widget: a running session's unsaved seconds aren't added live; the week edge can differ near midnight in another zone; the report re-reads on every tracked total that moves. **Recommend:** add the running session's seconds on a 1-minute tick; debounce the re-read.
- 🔧 Tasks widget: a check-off in flight shows Done with the old status id; no Undo grouping for several quick check-offs. **Recommend:** group check-offs within 3 s into one toast.
- 🔧 Team widget: Chat's "now" line is read once on mount; a person row isn't clickable. **Recommend:** subscribe to Chat's registration; link a person to a "their tasks" filter once Tasks has one.
- 🔧 Upcoming widget: "+n more" opens Tasks, not Upcoming. **Recommend:** a `?place=upcoming` link (the Tasks search only takes `id` and `view` today).

## Timeline (TV-TL1, TV-TL2)
- 🔧 The header's month name can show a fragment ("…ber") under the name column's edge. **Recommend:** hide a label whose month is narrower on screen than its name.
- 🔧 A phase that began off screen has no name until you scroll back. **Recommend:** a sticky label inside `overflow-clip` segments (see gotchas/ui.md first).
- 🔧 Indent and the hint offset are inline styles. **Recommend:** move them to classes if the kit grows a tree-indent token.
- 🧪 Year zoom's frame time isn't measured. **Recommend:** add a Year step to `tests/perf/tasks-timeline-2k.spec.ts`.
- 🔧 The menu's date picker opens at the end of the name cell, not at the point. **Recommend:** anchor it at the point when the point is on screen.
- 🧭 Project rows have no context menu (Open project, Expand, Set dates…). **Recommend:** yes, with the project panel's actions.
- 🔧 A selection carried over from the List can be a task inside a folded project at All. **Recommend:** expand its project when you arrive.
- 🧭 The late-tone mark and the backwards line are very quiet in dark mode. **Recommend:** one step stronger in the visual round (still never red).
- 🔧 A dependency stub doesn't follow its point while it's dragged. **Recommend:** read the point's drag delta in the stub, as the late mark does.
- 🧪 Not covered by an automated test: a selection's drag, click-to-date on a task or project row, the edge scroll, Esc cancelling a drag, Undo of section and project dates, ⌘A, a read-only person's canvas. **Recommend:** extend `tests/tasks-timeline.spec.ts`.
- 🧭 Lines draw only between rows on screen (by design for 2,000 tasks). **Recommend:** keep.
- 🧭 The No date view has no keyboard way to place a task. **Recommend:** `d` on a No date row opens the date picker, like the canvas.
- 🔧 Per-project handles at All are asked once per project while the page stays; a grant changed meanwhile shows at the next visit (the server still refuses). **Recommend:** re-ask on the store's access event.
- 🖼 Visual baselines for the five Timeline stories and the new marks.

## Multi-select (TV-U12)
- 🧭 The bar's row is wider than an 800 px window. **Recommend:** keep (the app's minimum is 1024 px).
- 🔧 The panel's header still says "Details ▾" over "4 tasks". **Recommend:** a title override in the panel registry.
- 🔧 The Board's card drag preview doesn't count the others ("+3"). **Recommend:** reuse the List's count chip.
- 🧭 Triage keys (Accept, Snooze) aren't offered on a selection. **Recommend:** yes, as bulk actions on the Inbox only.
- 🧭 Upcoming's day drop moves only the row you hold. **Recommend:** move the selection when the held row is in it.
- 🔧 A task whose field write saved but whose status or assignee was refused stays half-changed, and Undo doesn't put back the part that saved. **Recommend:** record the saved part in the Undo set.
- 🔧 Bulk Complete offline says "Offline" instead of queuing. **Recommend:** queue through the store like a single check-off.
- 🔧 Bulk status changes out of Backlog/Won't do don't offer "Restore the reminder?"; a bulk repeat check-off doesn't say "Done — next: …". **Recommend:** reuse the single-task prompts with counts.
- 🔧 The page's combined view-key handler is a new function each render. **Recommend:** wrap it in `useCallback` with a ref.
- 🖼 Visual baselines for the bar's selection row and the panel's Mixed view.

## Detail panel follow-ups (TV-U13b)
- 🔧 The date picker's popover stays visible behind the "Just this one · Change the pattern" dialog. **Recommend:** open the dialog on the next frame, after the popover's exit (needs a live look; not reproducible without the app).
- 🧭 A narrow centre pane drops the source chip so the title shows. **Recommend:** keep.
- 🔧 The repeat history lists at most the newest 100 cycles. **Recommend:** an "Older" link that pages.
- 🧭 Reopening a repeat's cycle drops "n done" by one (D12's rule). **Recommend:** keep; it's correct.
- 🔧 Bulk Undo edges after a partial change (the reverse write refused too; Focus place put back while the task stays done; the access message in a mixed toast; the status-saved branch traced only by reading). **Recommend:** one pass over `use-bulk-ops.ts`'s partial paths with a unit test per branch.
- 🔧 The agent chip asks once per task per session. **Recommend:** ask again when the task's agent sessions change (Realtime).

## Importers (TV-U18)
- 🔧 A task the server matches to an earlier import the app hadn't read gets the file's place and status. **Recommend:** read the earlier import's rows before the preview.
- 🧭 Trello members missing from the board's member list all read "A Trello member". **Recommend:** one picker per missing id, labelled "Trello member 1, 2…".
- 🧭 The project's name can't be changed in the preview. **Recommend:** an editable name field in the preview.
- 🧭 Section dates (Jira epics' due dates, Linear milestones' targets) aren't carried. **Recommend:** carry them as section end dates.

## Onboarding (TV-U17)
- 🔧 A later first open on a new device can miss the role's first view (the default selection runs before preferences arrive). **Recommend:** wait for `usePreferencesReady` in `tasks-plan-view.tsx`'s default-selection effect.
- 🔧 A later first open shows a PM's or creator's first project as a List, not its Board. **Recommend:** apply the Board the way `openFirstView` does.
- 🔧 The forward-only merge of "welcome seen" stays on the device. **Recommend:** push the merged copy when it differs from the cloud's.
- 🔧 A failed preferences read counts as "read" (the welcome can open). **Recommend:** mark the domain ready only after a real answer.
- 🧪 The e2e doesn't check the developer's Detailed rows; no test for the shared-browser guard. **Recommend:** add both to `tests/onboarding.spec.ts` / `lib/preferences` tests.
- 🧭 Resending a starter with a deleted id answers with the deleted row (the app never does it). **Recommend:** keep.
- 🔧 A workspace with only archived projects counts as empty for the teaching tasks; switching workspace mid-seeding sends the rest to the new one. **Recommend:** count archived projects; capture the workspace id once at the start.
- 🔧 `TASKS_ROLES` lives in `features/tasks/onboarding.ts`, not `@contracts`. **Recommend:** move it (preferences JSON only, no CHECK needed).
- 🧭 Closing the role question counts as Skip for good, and there's no place to change the role. **Recommend:** a "Your role" line in the Settings rebuild.
- 🖼 Visual baselines for the welcome dialog.

## Project overview (TV-U16)
- 🔧 Files re-read only when the project's task list changes; each open reads the workspace's whole attachment list. **Recommend:** a per-project files read, refreshed on the store's attachment counts.
- 🔧 "Done this month" uses the device's month but dates completions in the saved zone; left open across midnight on the 1st it shows last month. **Recommend:** use the saved zone's month and re-read on the day change.
- 🗄 The server trims only trailing spaces from a description; the app trims all trailing whitespace. **Recommend:** match the app in the release migration.
- 🗄 With an archived default project, `teams__route_project`'s message still says "give the team a default project". **Recommend:** "The team's default project is archived."
- 🔧 Done or Archive with Move shows its toast before the moves land. **Recommend:** await the moves, then toast.
- 🧭 A starter template's description now lands on the project. **Recommend:** Maciej reads the three starter descriptions once.
- 🔧 The ⌘K "Archived" tag reads the store when results arrive, not live. **Recommend:** keep (search results are short-lived).
- 🔧 The overview's helpers each scan the workspace's task list. **Recommend:** filter the project's tasks once and pass them in.
- 🔧 A view-only reader's overview is briefly editable-looking while access is asked. **Recommend:** render read-only until the answer.
- 🧪 No tests for the hub rollup's rendering, the ⌘K tag, archived deep links or the dimmed rows. **Recommend:** stories with structure checks.

## Saved views (TV-U8)
- 🧭 View rows carry no count. **Recommend:** a deferred count computed on idle, if wanted.
- 🧭 Drag to reorder views; hide someone else's shared view. **Recommend:** both, in the sidebar's Customize.
- 🧭 Filter → Completed → a date range isn't built. **Recommend:** build with the Completed filter's next pass.
- 🧭 A former member named only on tasks you can't see can't be kept in a saved filter. **Recommend:** the chip says "Former member · can't be saved".
- 🔧 Copy link on the desktop app may need the hosted web origin. **Recommend:** verify on a signed desktop build; use `app.moduo.app` there.
- 🖼 Visual baselines for the Views group and the unsaved-changes line.

## e2e and SQL tests (known items 1–2)
- 🔧 Every e2e spec signs in as `dev@moduo.local` in one shared workspace, so the e2e project now runs one spec at a time (`workers: 1`, about 5 minutes). **Recommend:** if the suite grows past ~10 minutes, give each spec its own workspace (a `workspaceFor(spec)` helper in `tests/support/local-stack.ts`, with cleanup that soft-deletes) and lift the limit.
- 🖼 `bun run e2e` also runs the visual project, whose screenshot specs have no baselines yet (they fail until the visual round captures them), and the perf project (its own gate: `bun run perf`).
