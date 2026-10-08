# Manual test checklist — Moduo for Claude Code

> Generated 2026-10-08 · branch `t/mike/mcc-1-connector-mine` (PR #271) · **Live-verified:** yes for MCC-1, 2026-10-08, against production `moduo-mcp` (deployed from `develop` after #283) with a view-only Tasks key in Mike's workspace. Results are noted on each item.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Connector (MCC-1) — needs a Tasks edit key and a view-only Tasks key
- [x] **Do:** `tasks_list` with `{assignee:"me", top_level:true}` → **Expect:** only your own open top-level tasks, in the app's bucket order (Inbox first), each with `assignee_id`; parents carry `subtask_count` (archived subtasks not counted). _(AC1, connector)_ **Live:** 59 tasks, all with `assignee_id`, one distinct assignee (Mike), 1 with `subtask_count`, grouped in bucket order. Some rows carry `parent_id`: subtasks whose parent is outside the result (done, or someone else's) stay visible by design, as in the app.
- [x] **Do:** `tasks_list` with `{assignee:"anyone"}` → **Expect:** every open task the key can see. _(AC2)_ **Live:** 82 open tasks.
- [x] **Do:** on a workspace with >200 open tasks, `tasks_list` with `limit:200` and `offset:0/200/400` → **Expect:** complete, no duplicates; the last page is shorter than `limit`. _(AC2)_ **Live (82 tasks, so pages of 50):** 2 pages, 82 total, same as one 200-row call. Beyond 200 is covered by the unit test.
- [~] **Do:** `tasks_focus_settings` → **Expect:** your Moduo Focus settings (defaults 25/5/15, 4 blocks, no auto-start, chime on). Change work length in Settings → Focus and call again → new value. _(connector)_ **Live:** returned the defaults (25/5/15, 4, no auto-start, chime on). The change-and-recheck step is still open; MCC-6 exercises it.
- [x] **Do:** same calls with a view-only Tasks key → **Expect:** all read tools work. _(AC1/AC2)_ **Live:** the whole check ran on a view-only key.
- [x] **Do:** `tasks_today` / `tasks_commit` with an explicit local `date` just after local midnight → **Expect:** the local day's queue, not the UTC day. _(AC14, connector side; full proof in MCC-4's client test)_ **Live:** `tasks_today` with `date: 2026-10-08` answered for that date (0 queued). Run at 04:50 Warsaw, so local and UTC days matched; the midnight case stays with MCC-4's test.

## Smoke test after redeploy
- [ ] **Do:** call the calendar tools that were waiting on a redeploy (e.g. `calendar_day`, `calendar_list_events`) → **Expect:** normal answers, no errors. _(whole connector)_

## My tasks panel (MCC-4) — terminal and the desktop Code tab
Setup once: after this is on `develop`, open Claude Code in the repo, run `/plugin`, find **moduo-tasks** (marketplace `moduo-local`) and paste your Moduo **edit** key (Workspace settings → API keys, Tasks = edit, everything else none) into its *Moduo API key* field. Leave *Time zone* empty unless "today" looks wrong.
- [ ] **Do:** without a key, type `/mine` → **Expect:** one line on how to add a key; no panel, no "Moduo" line above the prompt. _(AC13)_
- [ ] **Do:** with the key, start a session → **Expect:** within a few seconds a line above the prompt: "Moduo · Queue N" (plus "· N drifting" in amber when any). _(band)_
- [ ] **Do:** `/mine` → **Expect:** "Moduo · My tasks" opens beside the conversation: your open tasks by bucket in the same order as the app's bucket list, drifting ones in amber with "drifting N days", "blocked", "repeats", "N subtasks", "Queue #n" on queued tasks; today's queue on top with the planned total. _(AC1)_
- [ ] **Do:** compare with the Moduo app → **Expect:** the same tasks, the same queue numbers. _(AC1)_
- [ ] **Do:** press `e` (Everyone), then `m` (Assigned to me) → **Expect:** Everyone adds other people's tasks and their queue items; Assigned to me shows only yours. _(AC2)_
- [ ] **Do:** press `d` → **Expect:** "Done today (N)" opens the tasks from today's queue you've finished; `d` again closes it. _(AC1)_
- [ ] **Do:** change a task in the app (rename it, or commit it), wait a minute with the panel open → **Expect:** the panel shows the change without pressing anything; `r` refreshes at once. _(AC3)_
- [ ] **Do:** turn off Wi-Fi with the panel open → **Expect:** "Offline · retrying" and the list stays, greyed; turn Wi-Fi on → it recovers within a minute. _(AC13)_
- [ ] **Do:** close the panel, quit, start a new session → **Expect:** the panel stays closed; open it, quit with it open, start again → it reopens. _(reopen)_
- [ ] **Do:** after midnight (or set *Time zone* to a zone where it's already tomorrow) → **Expect:** the queue shown is that day's. _(AC14)_
- [ ] **Do:** revoke the key in Moduo, wait a minute → **Expect:** "Moduo rejected the key…", and it stops retrying. _(AC13)_

## Known gaps / not-yet-testable
- Calendar smoke test not run: the check key was Tasks-only, so calendar tools are hidden from it. Run it with a key that has Calendar view.
- The panel says "blocked" without the blocker's title (the connector doesn't return it), and "Done today" lists today's queue items that are done; a task finished today without being committed isn't there. Both decided in MCC-4.
- The mod's live panel needs your edit key in the plugin settings, so its live check is the section above, run by you.
