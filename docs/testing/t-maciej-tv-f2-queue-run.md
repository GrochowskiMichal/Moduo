# Manual test checklist — TV-F2 Queue run

> Generated 2026-10-09 · branch `t/maciej/tv-f2-queue-run` · **Live-verified:** partial. In a temporary harness (the real Tasks page and run chip over an in-memory runtime with two members and a run server that follows the ops' control rules; deleted before landing): the line-up (numbers, capacity, Pomodoro/Stopwatch, "Add to queue…"), ⌘↵ Start run, the run view (Now, Up next with the 3rd dimmed, rail "0/4" with a live dot, chip with phase, clock and task, right panel on Now), ⏎ = Done with the pomodoro kept (24:54 after the switch), "Mike completed …" when Now left by his hand, read-through when another device took over (engine stopped here, chip "on your other device", clock carried on), Skip taking control back, "Mike is on this" with a live dot in a bucket list, the chip returning to the Queue, Pause and End run reaching the server, and the 4-day stale line. The migration round-trips on a local Postgres replica (`supabase/probes/focus-runs.probe.sql`, 9 checks). **Not driven:** two real devices, a signed-in hosted session, desktop.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The line-up (no run)
- [ ] **Do:** open Tasks → Queue with 3+ queued tasks, some with estimates → **Expect:** a numbered list (grip on hover), "N · ~Xh Ym lined up · K without estimate" next to the title, Pomodoro | Stopwatch, ▶ Start run. No Plan/Focus switch anywhere in the rail. _(both)_
- [ ] **Do:** drag a row to a new place → **Expect:** the numbers follow; reload keeps the order. _(both)_
- [ ] **Do:** type in "Add to queue…" (or press `c`) and Enter → **Expect:** the task appears at the end, created in Inbox, assigned to you. _(both)_
- [ ] **Do:** pick Stopwatch, reload, open the Queue on your other device → **Expect:** Stopwatch is still picked (synced with Focus prefs). _(both)_
- [ ] **Do:** leave the line-up untouched for 3+ days (or ask an agent to age it) → **Expect:** "Lined up N days ago — still want all of these? Keep all · Review". Keep all hides it; Review shows ✕ on each row, Done keeps the rest. _(both)_

## Running (F2-1, F2-2)
- [ ] **Do:** ▶ Start run (or ⌘↵) → **Expect:** "Queue · ● Running · 0 of N done", the phase pill (Focus 25:00 ▾), Pause, End run; the Now card (bucket · priority · due · "Xm of ~Ym" · # tags; title, description, subtasks, linked items); Up next numbered, 3rd and later dimmed; the right panel shows the Now task. _(both)_
- [ ] **Do:** ⏎ (or Done) → **Expect:** the next task becomes Now, the pomodoro keeps counting (no reset), "1 done this run · Xm · show". _(both)_
- [ ] **Do:** Skip → **Expect:** Now goes to the end of Up next; the task's reschedule count doesn't change. Alone in the queue, Skip is disabled. _(both)_
- [ ] **Do:** ⋯ on an Up next row → Do now → **Expect:** it becomes Now; the old Now tops Up next. _(both)_
- [ ] **Do:** ⋯ on Now → Remove from queue → **Expect:** the next task becomes Now; the task is out of your queue. _(both)_
- [ ] **Do:** Pause, then Resume → **Expect:** "Paused" in the header, the chip shows a pause icon, the clock stands still; resumes from where it was. _(both)_
- [ ] **Do:** End run → **Expect:** back to the line-up with "Run ended · N done · Xm focused" (dismissible). _(both)_
- [ ] **Do:** Done on the last task → **Expect:** the run ends by itself. _(both)_
- [ ] **Do:** ⌘N during a run → **Expect:** capture opens with "Add to my queue" on; the new task joins the end of your queue (F2-5). Outside a run and outside the Queue it starts off. _(both)_

## Leaving Tasks, reload, other device (F2-3, F2-4)
- [ ] **Do:** during a run, go to Notes or Calendar → **Expect:** the chip shows the phase, clock and Now task; the clock keeps going; clicking the chip opens the Queue run. _(both)_
- [ ] **Do:** reload mid-run → **Expect:** the run is still on, same Now, the clock continued. _(both)_
- [ ] **Do:** start a run on the desktop app, open app.moduo.app in a browser → **Expect:** the browser shows the same run within a couple of seconds ("Running on your other device"), the same countdown, the chip says "on your other device". _(both devices)_
- [ ] **Do:** press Done (or Pause) in the browser → **Expect:** the browser takes the run over; the desktop stops its clock within a few seconds and shows the run read through. The task's time isn't counted twice (check Time spent on the panel). _(both devices)_
- [ ] **Do:** End run on one device → **Expect:** the other stops showing the run. _(both devices)_

## Claims (F2-6)
- [ ] **Do:** Mike runs his queue on a task you can see → **Expect:** within a minute, that row/card shows his ringed avatar with a live dot, "Mike is on this"; the panel header's queue button says so too. Nothing else about his run (no clock, no queue) shows anywhere. _(both)_
- [ ] **Do:** Mike pauses, or closes his laptop for 3+ minutes → **Expect:** "is on this" goes away (his "In Mike's queue" stays if it's queued). _(both)_
- [ ] **Do:** Mike runs a task in a bucket that's private to him → **Expect:** you see nothing. _(both)_

## Edge cases
- [ ] **Do:** while your run is on a task, Mike completes it → **Expect:** the run moves on with "Mike completed “…”." (dismissible); it doesn't count as done for your run. _(both)_
- [ ] **Do:** complete the Now task yourself from the bucket list → **Expect:** the run moves on and counts it, no line. _(both)_
- [ ] **Do:** someone deletes the Now task, or unshares its bucket → **Expect:** the run moves on with "“…” was deleted or is no longer shared with you." _(both)_
- [ ] **Do:** view-only member opens the Queue → **Expect:** no Start run, no Pomodoro/Stopwatch, no Add row; claims still show. _(both)_
- [ ] **Do:** start a run in workspace A, switch to B, open the Queue → **Expect:** "Your run is on in A. Starting one here ends it."; the chip still shows A's run. _(both)_

## Migrations / data
- [ ] **Do:** after the apply, in the SQL editor: `select count(*) from focus_runs;` and `select has_function_privilege('anon','public.focus_claims(uuid)','EXECUTE');` → **Expect:** a number; `false`. _(prod)_
- [ ] **Do:** start and end one run → **Expect:** one row, `status = 'ended'`, `done_task_ids` and `focused_seconds` filled. _(prod)_

## Known gaps / not-yet-testable
- Two real devices and a signed-in hosted session weren't driven (no session in the preview pane); the takeover was checked in the harness and by `src/features/focus/run.test.ts`.
- A device that lost control can only take back time it hadn't saved yet; anything it saved before hearing (up to a minute in a background tab) counts on both. Recorded in docs/decisions/tasks.md.
- TV-F3 brings the soft break, the real end-of-run summary, the empty-queue invitation and the Home widget; TV-F4 hand-off and In flight; TV-F5 Calendar's Start focus.
