# Spec: Moduo for Claude Code (My tasks, the queue, Focus)

> Status: **Ready** (2026-10-08) · Owner: mike · Related: [canvas "Moduo in Claude Code"](https://claude.ai/artifact/69ozuwkMrUAfjC13qE9Xox) (screens 5–7, private to Mike) · [docs/moduo-mcp-connector.md](../docs/moduo-mcp-connector.md) · [docs/moduo-module-contract.md](../docs/moduo-module-contract.md) · Tasks model: [src/features/tasks/model.ts](../src/features/tasks/model.ts)

## Scope

A Claude Code mod that brings Moduo's Tasks into the coding session: a **My tasks** panel (everything assigned to me, by bucket), the **commit queue** (commit, reorder, skip), **Focus** (pomodoro or stopwatch whose work time lands on the Moduo task) and **quick capture** (`/task …`). It talks only to Moduo's own MCP connector (`moduo-mcp`) with a per-person, Tasks-only API key, so every action goes through the same permission and activity rules as any other agent. Built for Mike and Maciej first (internal dogfooding of the connector, the MCP-1 goal), but nothing is Moduo-team-specific, so it could later ship as a public "Moduo for Claude Code" plugin.

The one great moment: type `/mine`, pick a task, press `f`, the ring starts; stop, and the task in Moduo shows the time.

## Product behavior & UX

Visual reference: canvas screens 6 (My tasks) and 7 (Focus); screen 5 for the terminal look and capture. Same quiet monochrome as Moduo, the pink dot marks only AI.

**Setup.** The mod ships from the repo (marketplace `moduo-local`) and is enabled for the project. Until a key is set it shows nothing and registers its commands silently; `/mine` without a key answers with one line on how to add it. The person creates a key in Moduo (Workspace settings → API keys, named e.g. "Claude Code (Mike)", Tasks = edit, every other module none) and pastes it once into the plugin's settings, where it is kept in secure storage. The connector URL is a second setting with Moduo's production endpoint as default.

**My tasks (`/mine`).** Opens a panel beside the conversation (the line above the prompt shows "Moduo · Queue 3 · 1 drifting" while the mod has a key).
- Filter chips: **Assigned to me** (default) and **Everyone**.
- Shows open tasks (to do and in progress), top-level only, each with a subtask count when it has subtasks. Grouped by bucket in the app's bucket order. Drifting tasks carry "drifting N days" in amber; blocked tasks carry "blocked by <title>"; recurring tasks appear once (next occurrence).
- At the top: today's queue as numbered cards with the planned total when tasks have durations.
- At the bottom: "Done today (N)", collapsed.
- Keys: ↑↓ move · `c` commit to today · `⇧c` commit to tomorrow · `u` remove from queue · `s` skip today · `[` / `]` move a queued task up / down · `f` focus · `⏎` work on this with Claude. The same actions exist as buttons for mouse users.
- Refreshes when opened, after every action and every 60 s while open.
- The panel reopens in the next session if it was open when the last one ended.

**Work on this (`⏎`).** Puts "Work on <title>: <description>" into the prompt box; nothing is sent. When the person sends that prompt, the task moves to In progress. If they clear it instead, nothing changes.

**Focus (`f` on a task, or `/focus` for queue #1).**
- Opens the Focus panel: task title, bucket and queue position, a ring with the clock, which round of how many, "today on this task" and "total" time, Pause (space), Done → next (`d`), Break now (`b`), Stop and log (`s`), and "Up next" from the queue.
- Pomodoro by default with the person's Moduo Focus settings (work and break lengths, long break rhythm, auto-start, chime); a toggle switches to stopwatch.
- The line above the prompt shows "● Focus 18:42 · <task> · work 2 of 4".
- When a work interval ends: a toast and a soft chime; the break starts by itself only if the Moduo setting says so.
- Only work time counts. It is added to the task's time spent when the person pauses, stops, presses Done, every 5 minutes while running, and when the session ends.
- Done → next: marks the task done, logs the time, and shows the next queued task with a Start button. It never starts by itself.
- While focus runs, Claude is told which task it is (title and description), so "help me with this" works. Claude never changes the task's status on its own.
- Focus lives in Claude Code only. The app's focus chip does not show it; the time arrives on the task as described.

**Quick capture (`/task <text>`).** Understands a title, one `#bucket` (matched to a bucket name, case-insensitive), `today`, `tomorrow` or a weekday name (next such day) as the due date, and a trailing `!` meaning "also commit to today". Shows what it understood, then adds on Enter. With no bucket, or one that doesn't exist, the task goes to Inbox and the confirmation says so.

## Edge cases

- **No key:** nothing visible; `/mine`, `/focus` and `/task` reply with how to add a key.
- **Key revoked or wrong:** panel shows "Moduo rejected the key. Create a new one in Workspace settings → API keys." and stops polling until the key changes.
- **Key is view-only for Tasks:** the list works; actions show "This key can only view tasks." and do nothing.
- **Offline / Moduo unreachable:** the last list stays, greyed, with "Offline · retrying"; actions are disabled; Focus keeps counting and logs the time once Moduo answers again.
- **Empty states:** no tasks assigned → "Nothing assigned to you. Everyone's tasks are one click away." with the Everyone chip; empty queue → "Nothing committed for today. Press c on a task."
- **Task changed elsewhere:** if a task was deleted, finished or reassigned in the app, the next refresh drops or moves it; an action on a task that no longer qualifies shows "This task changed in Moduo" and refreshes.
- **Focus on a task that gets deleted:** the time that could not be logged is reported in a toast; the timer stops.
- **Focus running in the app too:** both timers count; each logs its own time. Accepted for v1, documented in the checklist.
- **Midnight:** "today" is the person's local date at the moment of each action; the queue view switches at local midnight.
- **Session ends with focus running:** the unlogged work time is logged on session end; a crash loses at most 5 minutes.
- **Long logs:** a single log call adds at most 4 hours; a larger pending amount (laptop slept) is capped at 4 hours and the toast says so.
- **Capture with an unknown bucket:** lands in Inbox, confirmation says "No bucket named X, added to Inbox".
- **Two people with the mod:** each key acts as its creator, so "Assigned to me" is per person and activity reads "Claude Code (Mike)" or "Claude Code (Maciej)".

## Acceptance criteria

- **AC1** — With a valid key, `/mine` opens My tasks listing my open top-level tasks grouped by bucket in the app's bucket order, with drifting, blocked, subtask-count and recurrence handled as described; done-today tasks are in a collapsed section.
- **AC2** — The Everyone chip lists every open task in the workspace the key can see.
- **AC3** — The list refreshes on open, after every action and every 60 s while open.
- **AC4** — `c`, `⇧c`, `u` and `s` commit to today, commit to tomorrow, remove from the queue and skip today; the Moduo app shows the same state, and the task's activity names the key ("Claude Code (Mike)").
- **AC5** — `[` and `]` reorder the queue and the app shows the same order.
- **AC6** — `⏎` fills the prompt with the task; the task becomes In progress only when that prompt is sent.
- **AC7** — `f` or `/focus` starts Focus with the person's Moduo Focus settings (pomodoro default, stopwatch toggle), and the line above the prompt shows the running clock.
- **AC8** — Work time (never break time) is added to the task's time spent on pause, stop, done, every 5 minutes and session end; the app's time spent matches the panel's total.
- **AC9** — When a work interval ends, a toast and chime play; the break auto-starts only if the Moduo setting says so.
- **AC10** — Done → next marks the task done, logs time, and offers the next queued task without starting it.
- **AC11** — During Focus, Claude is told the current task, and the mod never changes a task's status without the person's action.
- **AC12** — `/task` creates a task from title, `#bucket`, today/tomorrow/weekday and `!`, defaulting to Inbox, and the app shows it.
- **AC13** — No key: silent mod and helpful command replies. Rejected key, view-only key and offline each show their message and never lose focus time.
- **AC14** — "Today" is always the person's local date.
- **AC15** — The connector's new actions only touch tasks in the key's workspace, refuse writes from a view-only key, log activity as the key, and refuse a time log above 4 hours or below 1 second.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `supabase/functions/_shared/tasks-connector.test.ts` · "filters by assignee" | AC1, AC2 | "Me" keeps only the key creator's tasks; "everyone" keeps all open ones. |
| `supabase/functions/_shared/tasks-connector.test.ts` · "shapes subtasks, drift, blocked, recurrence" | AC1 | The panel gets one row per top-level task with the right markers. |
| `supabase/functions/_shared/tasks-connector.test.ts` · "orders by bucket position" | AC1 | Buckets come back in the app's order. |
| `supabase/functions/_shared/tasks-connector.test.ts` · "pages past 200" | AC2 | With `offset`, a workspace of 450 open tasks comes back complete in three pages. |
| `supabase/functions/_shared/tasks-connector.test.ts` · "validates reorder and time log input" | AC5, AC15 | A reorder must name exactly today's queued tasks; time logs outside 1 s–4 h are refused. |
| Supabase-branch round-trip (`docs/testing/moduo-for-claude-code.md` §Connector) | AC4, AC5, AC8, AC12, AC15 | With a real edit key and a view key: each new action works, writes activity as the key, is refused for view-only and for another workspace's task. |
| `tools/claude-plugins/moduo-tasks/hooks/client.test.ts` · "maps connector errors" | AC13 | 401 becomes "rejected key", a scope error becomes "view-only", a network error becomes offline. |
| `tools/claude-plugins/moduo-tasks/hooks/panel.test.ts` · "groups and renders my tasks" (terminal and desktop) | AC1, AC2 | The panel draws buckets, markers, queue cards and the collapsed done section on both surfaces. |
| `tools/claude-plugins/moduo-tasks/hooks/panel.test.ts` · "keys call the right actions" | AC4, AC5 | c, ⇧c, u, s, [ and ] send the right connector call with the local date, then refresh. |
| `tools/claude-plugins/moduo-tasks/hooks/panel.test.ts` · "refreshes on a 60 s clock" | AC3 | A mocked clock triggers the refresh while the panel is open, not after it closes. |
| `tools/claude-plugins/moduo-tasks/hooks/work-on.test.ts` · "in progress only on send" | AC6 | Filling the prompt changes nothing; sending it sets In progress; clearing it doesn't. |
| `tools/claude-plugins/moduo-tasks/hooks/focus.test.ts` · "pomodoro with Moduo settings" | AC7, AC9 | Interval lengths, rounds, toast and chime, and break auto-start follow the settings. |
| `tools/claude-plugins/moduo-tasks/hooks/focus.test.ts` · "logs work time, never breaks" | AC8, AC13 | Pause, stop, done, the 5-minute tick and session end each log only unlogged work time; offline time is kept and logged later; over 4 h is capped. |
| `tools/claude-plugins/moduo-tasks/hooks/focus.test.ts` · "done then next" | AC10 | Done logs, sets done, shows the next queued task and doesn't start it. |
| `tools/claude-plugins/moduo-tasks/hooks/focus.test.ts` · "tells Claude the task" | AC11 | The session context names the task while Focus runs and drops it after. |
| `tools/claude-plugins/moduo-tasks/hooks/capture.test.ts` · "parses title, bucket, day and !" | AC12, AC14 | `#setup`, today/tomorrow/weekday (sent as local midnight) and `!` are understood; unknown bucket falls back to Inbox. |
| `tools/claude-plugins/moduo-tasks/hooks/client.test.ts` · "silent without a key" | AC13 | No panel, no band, commands reply with setup help. |
| `tools/claude-plugins/moduo-tasks/hooks/client.test.ts` · "uses the local date" | AC14 | Every date the mod sends is the local calendar day, including just after midnight in Warsaw. |

## Assumptions & technical decisions

- **Talk to `moduo-mcp`, not Supabase directly.** The mod calls the connector's JSON-RPC endpoint with `$.http.fetch` and `Authorization: Bearer moduo_sk_…`. Rejected: a Supabase session in the mod (would bypass intent ops, activity and key scopes).
- **The key is a sensitive `userConfig` field** of the plugin (kept in secure storage by Claude Code, never in the repo or settings files); the endpoint is a plain field defaulting to production's `moduo-mcp` URL. Rejected: env vars (end up in shell profiles) and `.mcp.json` headers (committed file, public repo).
- **"Mine" = `tasks.owner_id = key creator`.** The key already acts as its creator (`ctx.key.createdBy`, PERM-0). `tasks_list` gains `assignee: "me" | "anyone"` (default `anyone`, unchanged behavior) and `offset` for paging past its 200-row cap (the mod pages until a short page; the return shape stays an array so existing clients are untouched) and `shapeTask` gains `assignee_id` and `subtask_count`; top-level filtering and bucket ordering happen in the connector so every agent benefits. No migration.
- **Local dates come from the client.** `tasks_today`, `tasks_commit` and the new tools take an explicit date; the mod always sends the local date. The connector's UTC default stays for backwards compatibility and is recorded as a gotcha.
- **Three new intent ops** (one migration, written as new functions, `tasks_op__guard` for permission, `module_activity` rows like the existing ops, `module_api_key_id()` path so keys can write):
  - `tasks_op_reorder_queue(p_for date, p_task_ids uuid[])`: the named tasks trade the queue slots they already hold, in the requested order (other tasks, e.g. other people's, are never written); the connector requires the array to be exactly that day's queue the key's creator can see, the op requires every named task to be committed that day and editable by the caller. Only the named tasks are returned.
  - `tasks_op_log_time(p_task_id uuid, p_seconds int)`: adds to `time_spent_seconds`; 1 ≤ seconds ≤ 14400. Logs by the same actor on the same task within 30 minutes fold into one activity row (Focus logs every 5 minutes).
  - `tasks_op_create(p_title text, p_bucket_id uuid, p_due_at timestamptz, p_commit_for date)`: `tasks.due_date` is a `timestamptz` and the app stores local midnight, so the mod sends the local-midnight instant, never a bare date; null bucket = the workspace's Inbox (`is_system`); owner = caller (key creator for keys); commit appends to the queue.
  Each gets an `ops-manifest.ts` entry and a connector tool (`tasks_reorder_queue`, `tasks_log_time`, `tasks_create`, all `edit`). Rejected: raw row writes from the connector (breaks the "intent ops only" contract).
- **Focus settings read:** a new `view` tool `tasks_focus_settings` returns the key creator's `user_preferences.focus` (the same synced object the app uses) with the app's defaults (25/5) filled in. No migration.
- **Focus state lives in the mod** (`$.state` for the session, `$.store` for the reopen flag and unlogged seconds across a crash). Time is logged with `tasks_log_time`. Live cross-device focus is out of scope (designer call 2026-10-08).
- **Claude learns the focused task via `prompt.compose`** (a session-scoped system section with title and description), not by injecting chat messages.
- **"Work on this" uses `prompt.fill`** to put the text in the composer; the mod watches `prompt.submit` for that exact prompt to set In progress via `tasks_set_status`.
- **Capture parsing lives in the mod** (title, `#bucket`, today/tomorrow/weekday, `!`), matching buckets from `tasks_list_buckets`. Rejected for v1: the app's chrono-based parser (needs npm packages the mod sandbox can't load; can move to the connector later).
- **One connector contract:** each connector block updates [docs/moduo-mcp-connector.md](../docs/moduo-mcp-connector.md) (tool catalog, and in MCC-3 the note that capture isn't exposed) in the same change.
- **Plugin location and shape:** `tools/claude-plugins/moduo-tasks/` (hooks module `hooks/register.tsx`, `types/index.d.ts` for state), listed in `.claude-plugin/marketplace.json`, enabled in `.claude/settings.json`. Tests run with `claude plugin test tools/claude-plugins/moduo-tasks` and are part of each mod block's done gate (`bun run verify` doesn't run them).
- **Risk tier:** MCC-1…MCC-3 touch `moduo-mcp` and add a migration: Tier 2 (`/claude-security` + `/code-review ultra` before merging). MCC-4…MCC-7 are Tier 1.
- **Deploy order:** each connector block ships its migration first, then redeploys `moduo-mcp` (production deploys ask first via the permission rules); the mod blocks only start once their connector tools are live.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **MCC-1 — Connector: mine, shape, focus settings** | `assignee` filter, `offset` paging, connector doc, `assignee_id`/`subtask_count`, top-level + bucket order, `tasks_focus_settings`; pure helpers in `_shared/tasks-connector.ts` with tests; redeploy | AC1, AC2, AC14 | — |
| 2 | **MCC-2 — Connector: reorder queue + log time** | migration with `tasks_op_reorder_queue` and `tasks_op_log_time`, manifest entries, two tools, branch round-trip, redeploy | AC5, AC8, AC15 | MCC-1 |
| 3 | **MCC-3 — Connector: create task** | `tasks_op_create` migration, manifest entry, `tasks_create` tool, round-trip, redeploy | AC12, AC15 | MCC-2 |
| 4 | **MCC-4 — Mod: My tasks panel (read)** | plugin skeleton, key + endpoint settings, connector client with error mapping, `/mine` panel with filters, groups, queue cards, done section, 60 s refresh, band line, reopen flag | AC1, AC2, AC3, AC13, AC14 | MCC-1 |
| 5 | **MCC-5 — Mod: queue actions + work on this** | c, ⇧c, u, s, [ ], buttons, `⏎` fill + In progress on send | AC4, AC5, AC6 | MCC-2, MCC-4 |
| 6 | **MCC-6 — Mod: Focus** | Focus panel, pomodoro/stopwatch from Moduo settings, band clock, toast + chime, time logging rules, done → next, Claude context | AC7, AC8, AC9, AC10, AC11 | MCC-5 |
| 7 | **MCC-7 — Mod: quick capture** | `/task` parse + preview + create | AC12 | MCC-3, MCC-4 |

Parallel lanes: the connector lane (MCC-1 → 2 → 3) and the mod lane (MCC-4 after MCC-1) can run side by side. MCC-2 and MCC-3 both add migrations and edit `moduo-mcp/modules/tasks.ts`, so they run in order, never in parallel.

## Out of scope

- Live focus shared with the app's focus chip (server-side focus sessions): a later spec if missed.
- The meeting guard, comments back on the task, calendar info in the band, team chat posts, sending `/s2` "found" items to the inbox (canvas screens 2–5): later blocks.
- Energy and "fits in 1 h" filters; editing task titles, buckets or descriptions from the mod; subtasks as rows.
- Publishing the plugin outside this repo (product decision later).
- Any change to the Moduo app UI.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty**: product answers ratified by the designer on 2026-10-08 (all 30 recommendations accepted); technical unknowns (mods HTTP, secrets, panes, clock, prompt fill/submit, surfaces; connector ops and permission path) researched and recorded above.
- [x] **Data model is named and Supabase-first**: no new tables or columns; one migration per connector block adds intent-op functions over `tasks` (`commit_order`, `time_spent_seconds`, insert).
- [x] For a **module feature**: not a new module. It extends the Tasks MCP tools (listed above), writes activity like every op, and adds no dashboard widget.
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Design constraints acknowledged**: the mod draws with Claude Code's own elements (no app tokens apply); it follows Moduo's look from the canvas (monochrome, pink dot for AI only). No app UI changes.
- [x] **Manual-test surfaces identified**: `docs/testing/moduo-for-claude-code.md` (terminal and desktop Code tab, plus the Moduo app to confirm queue, status, time and activity).

**Ready to execute.**

## Open questions

- [ ] (none)
