# Manual test checklist — Moduo for Claude Code

> Generated 2026-10-08 · branch `t/mike/mcc-1-connector-mine` (PR #271) · **Live-verified:** no. MCC-1 is proven by unit tests only; the live checks below wait for the `moduo-mcp` redeploy (production deploy needs the designer's go-ahead after merge to `develop`).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Connector (MCC-1) — needs a Tasks edit key and a view-only Tasks key
- [ ] **Do:** `tasks_list` with `{assignee:"me", top_level:true}` → **Expect:** only your own open top-level tasks, in the app's bucket order (Inbox first), each with `assignee_id`; parents carry `subtask_count` (archived subtasks not counted). _(AC1, connector)_
- [ ] **Do:** `tasks_list` with `{assignee:"anyone"}` → **Expect:** every open task the key can see. _(AC2)_
- [ ] **Do:** on a workspace with >200 open tasks, `tasks_list` with `limit:200` and `offset:0/200/400` → **Expect:** complete, no duplicates; the last page is shorter than `limit`. _(AC2)_
- [ ] **Do:** `tasks_focus_settings` → **Expect:** your Moduo Focus settings (defaults 25/5/15, 4 blocks, no auto-start, chime on). Change work length in Settings → Focus and call again → new value. _(connector)_
- [ ] **Do:** same calls with a view-only Tasks key → **Expect:** all read tools work. _(AC1/AC2)_
- [ ] **Do:** `tasks_today` / `tasks_commit` with an explicit local `date` just after local midnight → **Expect:** the local day's queue, not the UTC day. _(AC14, connector side; full proof in MCC-4's client test)_

## Smoke test after redeploy
- [ ] **Do:** call the calendar tools that were waiting on a redeploy (e.g. `calendar_day`, `calendar_list_events`) → **Expect:** normal answers, no errors. _(whole connector)_

## Known gaps / not-yet-testable
- Live results are not recorded yet (no deploy).
- "blocked by <title>" and "Done today" data for the panel are decided in MCC-4 (see PR #271 validator notes).
