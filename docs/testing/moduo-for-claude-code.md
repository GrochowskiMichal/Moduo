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

## Known gaps / not-yet-testable
- Calendar smoke test not run: the check key was Tasks-only, so calendar tools are hidden from it. Run it with a key that has Calendar view.
- "blocked by <title>" and "Done today" data for the panel are decided in MCC-4 (see PR #271 validator notes).
