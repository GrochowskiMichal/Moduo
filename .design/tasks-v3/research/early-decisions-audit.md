# Lane 3 — Audit of the early Tasks decisions: which ones bind us wrongly

> Raw research report from the Tasks re-plan, 2026-10-09 (`maciej` @ 95d988b0), kept for its evidence. The synthesis and the open calls are in [../REPLAN.md](../REPLAN.md). Nothing here is decided.

_Read-only audit on `maciej` @ `95d988b0`, 2026-10-09. Sources: the 2026-06-06 feature spec + playbook + vocabulary (commit `1693b521`), the 2026-06-12 improvement-plan sessions 4–9, the 2026-06-24 product brief, `.design/tasks-polish/*` (June), `.design/tasks-dogfood/REVIEW.md` + `RESEARCH-2026-10.md` (October), `specs/tasks-v2.md`, `tasks-timeline.md`, `calendar.md`, the tasks migrations, `model.ts`, `vocabularies.ts`, `moduo-mcp/modules/tasks.ts`. Decided last round and NOT re-argued here: "complete but calm", `MOD-142` handles, "Waiting on…" as a field extending Blocked by, agents as delegates, single assignee + claims, MCP task-write tools, bucket↔client link, team-load widget._

## 0. The pattern behind the "poor early decisions"

The Tasks model was written on 2026-06-06 for one person: "Target user: people with ADHD… Maciej is the dogfooding user" (feature spec §1). Every decision that has since had to be reversed shares one root: **a solo-planner assumption encoded as a column on `tasks`.** `committed_for` (the whole workspace shares one "today"), `owner_id` doubling as assignee, `time_spent_seconds` as one unattributed number, `task_time_blocks` as workspace data, `reschedule_count` as a personal-discipline mirror. Tasks v2 has already paid for four of these with expand→migrate→contract shims for old desktop builds, and every further `tasks` column or CHECK change before TV-D7 adds another shim and lengthens the adoption window. That is the single most important sequencing fact in this report (see §5).

Verdict key: **KEEP** (a real strength) · **ADJUST** · **REVERSE** · **OPEN** (needs the designer) · **DONE** (already reversed in v2; listed because it is evidence for the thesis). Cost: S/M/L · "data" = data migration · "shim" = old desktop builds need a compatibility path.

## 1. Inventory

### A. Containers

1. **One exclusive bucket per task; `bucket_id NOT NULL … ON DELETE RESTRICT`** — spec §5 + migration `20260606120000`. Served: no "which lists is this in" ambiguity; Inbox always catches the dump. Costs now: nothing — Linear, Todoist, Jira, Trello are all single-container. **KEEP.** Cross-cutting needs (client, course, tag) go through tags and the spine, not a second container.

2. **Inbox as a system bucket (`is_system`, one per workspace, seeded app-side)** — same migration. **KEEP**, with one adjustment: Inbox is seeded by the app layer ("not by a DB trigger"), so the decided server-side MCP create op must resolve or seed Inbox itself. S, no shim.

3. **Buckets carry no metadata** — name, `is_system`, `group_label`, `position`; colour and `archived_at` arrive in TV-U6. Served: "nothing to over-engineer". Costs now: the bucket↔client link, the bucket overview ("4 of 18 done · due this week · waiting on…"), templates per bucket, "course = bucket" with a term end date, a lead for teams — all want a description, a client link, a target date, a status and a progress roll-up. **REVERSE** (additive columns: `description`, `target_date`, `lead_id`; the client link rides `entity_links`). S/M, no data migration, no shim (old builds ignore unknown columns on read). This is the cheapest container fix and it unblocks ❓8, ❓9 and students in one go.

4. **The word "bucket"** — spec §5, vocabulary. Served: it said "a category, not a project plan" to an ADHD planner. Costs now: every target segment says "project" (freelancer: project per client; student: course; dev: project; PM: project). "Bucket" reads as a dumping category and makes "client ↔ bucket", "bucket overview" and "project lead" sound wrong; the MCP tool names (`tasks_list_buckets`) carry it to agents. **OPEN → recommend REVERSE in the UI only** ("Project"; keep `buckets` in the schema and the MCP as an alias). S, zero data migration. Designer call (§6 Q3).

5. **Sections = a free-text `group_label` on buckets, presentational, two levels max** — Session 4, 2026-06-12. Served: quiet rail grouping. Costs now: a section is a string, not an entity, so it can't be renamed in one place, coloured, shared, linked to a client, or carry a count. And it groups *buckets in the rail*, not *tasks within a bucket*: there is no Todoist-section / milestone equivalent inside a project. **ADJUST** sections into a small `bucket_sections` row (id, name, position) — S, data migration trivial, no shim. Within-bucket sections stay **OPEN** (§6 Q9); don't build them on speculation, Group-by covers most of it.

6. **Time-of-day → bucket mapping ("Open at", `task_time_blocks`) and "default view never 'All'"** — spec §9, built Session 4 (2026-06-10), moved to workspace data 2026-06-11. Served: Maciej's morning/evening routine. Costs now: it is *workspace* data in a team workspace (Mike's Tasks open on Maciej's morning bucket); it fights the personal Queue / My tasks as the natural landing and sits beside DF-19f's landing-view preference (module-level) as a second, computed landing rule the user can't set; no segment asked for it; `default-view.ts` still enforces "never All first". **REVERSE**: default = Queue when non-empty, else My tasks (teams) / last-opened; retire "Open at" and drop `task_time_blocks` in TV-D7. S, no shim (old builds just stop reading the row).

### B. Workflow

7. **Four statuses `todo · in_progress · done · archived`, CHECK + contract** — migration `20260606120000`, `vocabularies.ts`. Served: calm, no workflow editor. Costs now: `in_progress` is near-dead — nothing in the app sets it automatically (only the Board column, the Status picker and MCP `tasks_set_status`); Focus runs and claims ("Mike is on this") have taken its job. `archived` is the problem child (next item). **KEEP the four values** (the decided "waiting" field covers review/waiting; the research's "no feature packs" holds), but **ADJUST** the Board (item 10) so the fixed set stops being the only column source.

8. **"Archived" means won't-do on tasks, hide/restore on buckets** — tasks-v2 §6 ("Archived ('won't do') tasks"), TV-U3 menu "Archive · won't do", drift triage "Archive — terminal status" vs TV-U6 "Archive bucket — hidden everywhere, restorable", plus "Recently deleted" as a third tier. One word, opposite semantics, and the task one is a contract + CHECK value. Costs now: a PM reads "Archive" as "put away", not "cancel"; MCP agents get `archived` with no hint it means cancelled. **REVERSE the label now** ("Won't do" everywhere a task is meant, "Archive" only for buckets) — S; **rename the value to `cancelled` at TV-D7** — M, data migration + contract + CHECK + MCP alias, shim for old builds that write `archived`.

9. **Depth ceiling "Linear-light — no workflow-status customization, no cycles, no estimates-as-points"** — PRODUCT_BRIEF §6 (2026-06-24, "built, 5/5"), repeated in tasks-v2 §Out of scope (2026-10-07). Contradiction: the new ambition is to replace Linear, Jira and Trello for small teams. Served: the weakest-leg guard against building Jira. Costs now: the sentence will be quoted against every feature these segments need. **REVERSE the wording, keep two of the three non-goals**: still no custom *status* workflows (the field route + Board group-by serve the same need), still no story points (estimates are minutes, calibrated against actuals — ❓10). Cycles stay **OPEN** (§6 Q8): a target date on the bucket + the Timeline is the calm version; sprints are a ritual Moduo need not host. Doc edit only.

10. **Board columns hard-wired to status (bucket in "All")** — Session 4 (2026-06-10), spec §4. Costs now: a Trello user wants columns per stage, an agency wants a Waiting column, a PM wants columns per assignee; tasks-v2 §7 already lets Lists group by assignee/priority/tag/time/waiting and U4-3 already rewrites the field on a cross-group drop — the Board is the odd one out. **ADJUST**: Board columns = any Display group-by, status is just the default. S/M, no migration. This is the ADJUST that serves Trello users without a workflow editor and without a fifth status.

### C. Fields

11. **Priority = low/medium/high (+ unset), no Urgent** — migration `20260606130000`; research N4 (mere-urgency effect) rejects Urgent. **KEEP.** The only visible cost is Jira/Linear imports mapping Urgent→High; acceptable.

12. **Energy level** — first migration. Served: the ADHD persona. Costs now: weak evidence (research §5), off rows by default since TV-U1, no segment asked for it, but it costs nothing and "Group by Energy" is a small differentiator. **KEEP as optional; never expand it.** OPEN only if the designer wants a leaner property set (§6 Q5).

13. **Two time fields, `due_date` and `scheduled_at`** — spec §8. **KEEP** (a real strength; Morgen/Sunsama users ask for exactly this). Two adjustments: (a) `due_date` is a `timestamptz` written from local midnight, so east-of-UTC users get off-by-one comparisons (gotchas/spine.md; it already bit CO-5) — **REVERSE to `date`**, M, data migration + shim; (b) the Timeline uses `scheduled_at` as a start date, so "starts Monday, due Friday, work on Wednesday" can't be said — a `start_date` is **OPEN**, only if multi-session scheduling (15) doesn't absorb it.

14. **Drift = `scheduled_at < now`, computed; nothing quiet for a passed due date** — spec §4/§11, `isDrifted`. Served: the "never overdue" principle. Costs now: students, PMs and anyone with a client run on due dates; today a late due date shows only in the bell's Overdue list and as the date-column emphasis. The research's own rule is "gentle overdue that always offers a fix". **ADJUST**: add a quiet "late" state on `due_date` (same muted treatment as drift, grouped as "Earlier", triage offers Move/Won't do/Break down), never red. S, no migration.

15. **`duration_minutes` is the estimate AND the calendar block; a task block IS the task row, so one task = one scheduled session** — spec §11, calendar spec assumption 1 ("no `time_blocks` table in v1… deferred to the post-alpha multi-session upgrade", 2026-07-02). Served: zero drift by construction, the loop shipped before any migration. Costs now: a 4-hour task can't be split across days; "plan my day" by an agent, capacity planning and calibrated estimates (❓10) all want planned sessions. TV-D3 now covers *actuals* (`task_time_entries`), so only *planned* sessions are missing. **REVERSE later, by design now**: a `task_blocks` table (task, start, end) with `scheduled_at`/`duration_minutes` kept as "next block" for old readers. L, data migration, shim; touches lens, drift, Timeline, reschedule ops, MCP. Decide the sequencing (§6 Q7); don't build before the Focus lane lands.

16. **`reschedule_count` as an ambient mirror of "skips out of today"** — spec §4, `tasks_op_skip_today` incremented it (Session 8). **It is orphaned**: TV-D2 rewrote `skip_today` to stop bumping it, `tasks_op_reschedule`/`unschedule` never did, Focus Skip is "to the end of the queue, never a reschedule", and the "Not today" action that was to be the only counter isn't built — yet TV-U3 still renders "Rescheduled N×". **REVERSE**: either redefine it as "moved later N×" on forward moves of `scheduled_at`/`due_date` (drift triage, Calendar "Later today"), or drop the column in TV-D7. S.

17. **Recurrence = one cycling row, no per-occurrence history, missed occurrences don't exist** — Session 7 (2026-06-12), spec §5d. **KEEP** (the no-backfill, no "7 overdue" rule is one of the best ADHD decisions in the module). Two costs to name: completions are visible only through `tasks.set_status` activity rows (a "done this week" list must read the trail — fine, derive it, S); and a recurring task can't have different occurrences assigned to different people or carry per-occurrence notes. Templates (❓9) cover the team case; don't open a template-spawning engine.

### D. Structure

18. **Subtasks = full tasks, exactly one level, DB trigger** — Session 5, migration `20260612130000`. Served: calm hierarchy, "start a scary task via its smallest step". Costs now: Jira migrators (epic → story → subtask) and Todoist users (4 levels) hit the wall on day one; bucket → task → subtask is three levels already. **KEEP one level for now**, but make the trigger depth-parametric so two levels is a migration, not a redesign, and note that checklist templates (❓9) and a lightweight in-description checklist would give PMs a cheaper third level than real tasks. **OPEN** (§6 Q10).

19. **Dependencies as a DAG, blocked computed at read time, cycles forbidden by trigger** — Session 6, migration `20260612140000`; decisions/product.md 2026-06-12. **KEEP** (a strength; "Waiting on…" was explicitly designed to extend it). One debt: edges live in `task_relations` *and* are mirrored into `entity_links` (`20260627130000`); two stores, one trigger. **ADJUST** to one store when relation writes become ops (TV-D7 or the handles block). M, data migration (the mirror already holds every edge), no UI change.

20. **Tags workspace-wide, polymorphic `tag_links`, flat, one shared store** — first migration + TV-T1. **KEEP.**

### E. Planning

21. **Plan / Execute as "Modes" of the module** — spec §4, vocabulary "Mode". **DONE** (reversed 2026-10-07: "no more Plan/Focus switch", TV-F2). Remaining cost: the vocabulary doc still defines Mode, Plan mode and Execute mode as canonical, and the feature spec §4 has no supersession banner. Doc fix (§4).

22. **Commit-for-today = `committed_for` date + `commit_order` on the task, workspace-wide** — spec §4/§11, Session 3 (2026-06-06). **DONE** (TV-D2/TV-D4: personal dateless `task_queue`). This was the single most harmful early decision — a two-person workspace shared one "today" — and the vocabulary doc still says "Commit = adding a task to today's queue". Columns drop in TV-D7.

23. **Focus = a run of the Queue; pomodoro per run; `f` on a task is out** — decided 2026-10-07, TV-F2–F5 open. **KEEP the run**, but **ADJUST** one rejected entry point: every competitor (Sunsama, Akiflow, Marvin, TickTick) starts focus from a task, and the research found "single-task Focus views" have weak evidence either way. "Focus on this" = start a run with this task on top is cheap and doesn't reintroduce single-task focus as a mode. S. (§6 Q11.)

24. **Tick-based Focus timer, session only in memory** — DF-11 (2026-07-11), ported "verbatim". **DONE** (TV-F1 wall-clock engine). Listed as evidence: another solo-desktop assumption (the window is always in front).

25. **Tracked time = one `time_spent_seconds` number, written through the normal save path; no sessions table** — chosen 2026-06-15 over the Round-D intent-op design (`.design/tasks-polish/CONTINUATION-2.md`, migration `20260615120000`). **DONE** (TV-D3 entries). Evidence again: the lightweight choice was right for one person and wrong the day a second timer or person appeared; it cost the most complex shim in v2.

26. **"In flight" lives inside a Focus run** — tasks-v2 §4. **DONE in direction** (decided: "Waiting on…" outside Focus; TV-F4 reshaped before it's built).

### F. People

27. **`owner_id` = creator, then reused as the assignee (#208, July), then restored (TV-D1)** — the model never had an assignee column. **DONE.** The lasting cost is `creator_unknown` on reassigned tasks: data was lost because the module contract said "entity creation needs no activity row — `created_at` + `owner_id` already say it" (contract Pillar 3). That sentence is wrong the moment a column is repurposed; **ADJUST the contract**: creation logs an activity row like any op (it also gives agent-created tasks a visible origin). S.

28. **Single optional assignee + queue claims; multi-assignee rejected** — decided 2026-10-07 after a one-day detour via `task_assignees + is_owner`. **KEEP.**

29. **Creator immutable, server-owned** — TV-D1. **KEEP.**

30. **Agents act as `api_key` named after the key; `agent` actor type reserved and unused** — module contract Pillar 2, research ❓6. **KEEP the delegate model**; ADJUST attribution copy so "Claude, via Maciej's key" reads as an agent, not an app, and decide whether a key can declare "this key is an agent" (one boolean, S).

### G. Capture

31. **A bare title is a complete task; capture is destination-free into Inbox / the selected bucket; no required fields** — spec §6, brief §7. **KEEP** (strength; every segment).

32. **Parsing = chrono-node dates + a constrained recurrence vocabulary; no AI** — spec §7. **KEEP**; MCP capture (decided) is the AI path.

33. **Capture is tag-free; no bucket / assignee / priority tokens** — spec §6 (2026-06-06). Dogfooding reversed the tag half (TV-U7 `#tag`), GR-0 owns the grammar. Remaining cost: students ("course = bucket") and teams ("+mike", "!high") type faster than they click pills; Todoist's `#project` habit will collide with `#tag`. **ADJUST inside GR-0**: reserve `+name` (assignee) and `!` (priority) now; bucket stays pill-only unless dogfooding asks. S.

### H. Principles

34. **"Quiet and minimal until the user decides otherwise"** — spec §10, vocabulary, brief §7. **DONE in direction** ("complete but calm", decided). The wording still lives in three documents (§4).

35. **"Target user: people with ADHD"** — spec §1 (2026-06-06). Contradicts the brief's segments (2026-06-24) and the new ambition; the research says ADHD is a lens across segments at roughly population rates. **REVERSE the sentence**: ADHD-aware defaults stay a principle; the persona is no longer the target user. Doc edit.

36. **"Decisions live with the designer, not the user… hide configurability"** — vocabulary §2, brief §7. Costs now: Display, Filter, saved views, row presets and density are all user configuration, and the research's strongest finding is "a good default, one active choice, 2–3 named presets". **ADJUST the wording**: defaults decide; options are few, named and discoverable; no system-building. Doc edit.

37. **"Mirrors, not walls" and "friction behind the dump"** — vocabulary §3/§5. **KEEP** (strengths; they are what makes the module calm for teams, not just for ADHD).

38. **Tasks and Calendar are separate modules; a task block is a lens, not a copy** — vocabulary, calendar spec. **KEEP**; the lens is why "complete a task from inside its block" needed no migration. Item 15 is the one place it binds.

### I. Platform

39. **Intent ops for invariant-bearing mutations; creation stays an upsert; plain field edits stay raw writes; triggers as corruption guards** — Session 8 (2026-06-12), module contract. Served: shipping fast. Costs now: no server-side create op is why MCP agents can't capture (23 tools, zero create/update/subtask/dependency tools); whole-row upserts from old builds are why every v2 shim is so intricate (TV-D1's nil-uuid trick, TV-D2's "never mirror removals", TV-D3's "ignore a lower value from an upsert"); handles need a counter that only a create op can own. **REVERSE**: `tasks_op_create` + `tasks_op_update` (field edits), raw table writes revoked after TV-D7. M, no data migration, shim until the adoption window closes.

40. **Expand → migrate → contract, with shims for old desktop builds; cleanup in TV-D7** — tasks-v2 assumption 1. **KEEP**, with one addition: a server-enforced minimum client build (one setting, one check at boot) so the *next* reversal costs one migration instead of three code paths. S.

41. **MCP shape: UUID-only arguments, JSON-in-text results, no output schema, no annotations** — Session 9. **DONE in direction** (handles + write tools decided). Note the sequencing dependency on item 39.

42. **Activity trail in `module_activity`; time ops write no rows** — contract + TV-D3 exception. **KEEP** (the exception is right; entries are the log).

43. **Realtime (TV-D5), Supabase-first, redb/Rust parity dropped** — **KEEP.** Stale comment: `model.ts` still says it "mirrors the Rust domain structs".

44. **Bundle reads: the whole workspace loads per module, paged to a cap (SCALE-1)** — 2026-07-29. Served: 2–5-person workspaces. Costs now: "replace Jira" implies thousands of tasks per workspace; the caps are sized for 2–5-person workspaces, not issue trackers, and every filter is client-side. **OPEN, platform**: per-scope server reads (completed hidden by default already helps). L. Not a Tasks-plan decision, but it bounds the ambition and should be named.

45. **Manual order = one Lexorank `position` per task, shared by everyone, used by List and Board alike** — first migration, TV-U1. **KEEP**; note that per-view manual order (Linear) is deliberately not offered.

46. **Saved views personal; bucket sharing via PERM `resource_grants` (bucket and task are share resources; `public_link` subject exists)** — decided 2026-10-08 / PERM-3…8. **KEEP**; the client status link (❓11) already has its data path.

47. **Attachments-only, no inline images in task descriptions** — decided 2026-10-07. **KEEP.**

## 2. The decisions most likely to bind future work, ranked by harm

1. **Buckets as a nameless, metadata-free "category" (items 3, 4, 5).** Every segment-specific feature the research found — client loop, bucket overview, templates per deliverable, course with a term end, a lead for teams, the team-load widget — wants the container to *be something*. Today it has a name and a position. Recommendation: add description, target date, lead and a client link now (additive, no shim), make sections an entity, and decide the word "Project" for the UI while the schema keeps `buckets`. This is the cheapest high-leverage reversal in the module.

2. **Raw upserts for creation and field edits (item 39).** This is the hidden tax on everything: it blocks MCP capture, it forced the nil-uuid and "ignore lower values" shims, and it means handles, templates and bucket overviews each need a create path that doesn't exist. Recommendation: `tasks_op_create` and `tasks_op_update` in the handles block, with Inbox resolution server-side; revoke raw writes at TV-D7.

3. **One task = one scheduled session (item 15).** The calendar spec knew this was a deferral; the ambition makes it a wall: agencies, students in crunch week and "plan my day" agents all need to spread work over days. Recommendation: design `task_blocks` now so `scheduled_at`/`duration_minutes` become the compatibility view of "the next block", and schedule the build after the Focus lane.

4. **Drift only on `scheduled_at`; no quiet lateness on `due_date` (item 14).** The ADHD-era rule protected the founder from red; it leaves the segments that live on deadlines (students, PMs, clients) with nothing but the bell. Recommendation: a muted "late" state with a fix attached, grouped as Earlier, never red, as the research's own "gentle overdue" line demands.

5. **The depth-ceiling sentence (item 9).** "Linear-light, no workflow customization, no cycles, no points" is in the brief and in tasks-v2 and will be quoted against the new ambition. Recommendation: rewrite it as a quality bar, not a feature cap: no custom status workflows and no story points stay; Board-by-anything, waiting-on, handles, templates and multi-session blocks are inside the bar.

6. **Board columns = status (item 10).** The one place the fixed status set turns into a product limit. Recommendation: columns from any Display group-by; status is the default. Serves Trello and agency users without a workflow editor.

7. **"Archived" with two meanings (item 8).** A contract value whose label contradicts the bucket feature shipping next. Recommendation: label "Won't do" now, value rename to `cancelled` folded into TV-D7.

8. **`task_time_blocks` + "never All first" (item 6).** Workspace-level data that is wrong the moment a second person exists, and a landing rule that fights the Queue. Recommendation: retire; default to Queue → My tasks → last-opened, honour DF-19f's setting.

9. **`due_date` as `timestamptz` (item 13a).** An off-by-one that has already produced a bug, in a product that wants Japanese and European users. Recommendation: `date` column with a read shim, in the same contract cleanup.

10. **`reschedule_count` (item 16).** An orphaned mirror still rendered in the panel; it tells users a number nothing updates. Recommendation: redefine on forward date moves or drop it; don't ship "Rescheduled N×" as it stands.

11. **Subtasks one level (item 18).** Not wrong, but the loudest day-one complaint from Jira/Todoist migrators. Recommendation: keep, make the trigger parametric, and let templates and a checklist give the cheap third level before reopening nesting.

12. **The three-store dependency debt (item 19) and the reserved `agent` actor (item 30).** Small, but both will be touched by the waiting-on target schema; fold them into that block rather than letting them drift.

## 3. Genuine strengths that must survive the re-plan

- Single exclusive bucket + Inbox as the universal catch-all (1, 2).
- Bare-title capture, destination-free, no required fields; chrono parsing with visible interpretation (31, 32).
- Two time fields: due vs scheduled; commit ≠ schedule (13).
- Drift as a computed, quiet state; blocked as a computed, quiet state over a DAG; the frontier walk (14, 19).
- Recurrence as one cycling row, no backfill, no "7 overdue" (17).
- Subtasks as full tasks with their own assignee and queue membership (18).
- Mirrors not walls; friction behind the dump; no streaks, no red (37).
- The personal dateless Queue, claims, single assignee + immutable creator (22, 28, 29).
- Intent ops + attributed activity + MCP registration as the contract; expand→migrate→contract discipline (39's good half, 40, 42).
- The lens model between Tasks and Calendar (38), tags as one polymorphic store (20), Supabase-first with no Rust parity (43).
- Attachments-only on tasks (47); bucket/task sharing through the one permission model (46).

## 4. Document text that would change if the reversals are accepted

- **PRODUCT_BRIEF §6** — Tasks row: replace "Linear-light + focus mode (built, 5/5)" with a bar statement ("pleasant and complete per role: students, developers, PMs, small teams; no custom status workflows, no story points") and drop "built, 5/5". **§7** — "Quiet and minimal until the user decides otherwise" → "Complete but calm: low visual weight, no alarm colours, no debt framing; the default shows what the next decision needs, nothing hidden without a count"; "Decisions live with the designer… hide configurability" → "defaults decide; options are few, named and discoverable; no system-building"; remove "Density/text-size are a customization axis" (text-size was dropped 2026-06-13). **§12** — the "Solo only → light multiplayer" row should note Tasks is now a team tracker, and the delta table should add "Plan/Execute modes → Focus as a run of a personal Queue".
- **docs/moduo-tasks-feature-spec.md** — add a supersession banner pointing at tasks-v2 for §4 (modes, Execute, commit), §6 (tag-free capture), §9 (default view); rewrite §1 "Target user" (ADHD is a lens; segments per the brief); §5 "Buckets" gains metadata and the possible rename; §10 principle 1 and 2 as above; §11 drops `committed_for`/`commit_order`/`reschedule_count` and documents `assignee_id`, `task_queue`, `task_time_entries`, the status label "Won't do", and `task_blocks` if accepted.
- **docs/moduo-architecture-vocabulary.md** — delete "Mode" (Plan/Execute) from Concepts and the Hierarchy; rewrite "Commit" as "Queue (personal, dateless)"; rewrite principle 1 and 2; amend "Bucket" if renamed; add "Waiting on", "Handle", "Run".
- **specs/tasks-v2.md §Out of scope** — remove "Depth ceiling: Linear-light — no workflow-status customization, no cycles, no estimates-as-points"; keep "no multiple assignees" and "no board cover images".
- **docs/moduo-module-contract.md Pillar 3** — delete "Entity creation needs no activity row — `created_at` + `owner_id` on the entity already say it"; creation is an op that logs. **Pillar 1** — "plain single-field edits may remain raw upserts for now" → dated to end at TV-D7.
- **specs/calendar.md assumption 1** — mark the multi-session upgrade as planned (`task_blocks`), not post-alpha.
- **docs/decisions/tasks.md** — one entry recording the re-plan verdicts, plus the index line.

## 5. Sequencing note (the one actionable line)

Every `tasks` column or CHECK change before TV-D7 means another old-build shim and a longer adoption window. The schema-touching reversals above — status label/value (8), waiting-on target schema (decided), handles counter + create op (39), bucket metadata and sections (3, 5), `due_date` type (13a), `reschedule_count` (16), `task_time_blocks` (6), dependency single-store (19), and the `task_blocks` design (15) — should be decided together now so TV-D7 is **one** contract cleanup, not three. Additive columns (bucket metadata, create op, label changes) can land any time; value renames and type changes wait for the cleanup.

## 6. Questions only the designer can answer (product calls), with recommended answers

1. **Does the default Board need a native "Waiting" column, or is a quiet mark + Group by "Waiting on" enough?** _Recommend: mark + group-by; it keeps the field route decided last round and the Board-by-anything change (item 10) gives agencies their column without a fifth status._
2. **Should a task's terminal "Archive" become "Won't do" (label now, `cancelled` value at TV-D7), leaving "Archive" to buckets?** _Recommend: yes._
3. **Keep the word "bucket", or show "Project" in the UI (schema unchanged)?** _Recommend: "Project"; "bucket" was a solo-planner word and every segment says project. If you keep "bucket", keep it everywhere including MCP._
4. **Add a quiet "late" state for a passed due date (muted, grouped as Earlier, always with a fix), never red?** _Recommend: yes; it is the research's own "gentle overdue" and the students/PMs segments run on due dates._
5. **Keep Energy as an optional, rows-off property, or retire it to simplify the property set?** _Recommend: keep, never expand; it costs nothing and Group by Energy is a small differentiator._
6. **Retire "Open at" (time-of-day buckets) and let Tasks open on the Queue (then My tasks, then last-opened)?** _Recommend: yes; it is workspace data that is wrong for teams and fights the Queue._
7. **Multi-session scheduling (one task across several calendar blocks): design it now and build it after the Focus lane, or leave it post-alpha?** _Recommend: design now, build after TV-F5; it is the biggest remaining ceiling for agencies, students and "plan my day" agents._
8. **Cycles/sprints: never, or "a target date on the project + the Timeline" as Moduo's calm version?** _Recommend: the calm version; no sprint object._
9. **Sections inside a project (Todoist-style), or Group-by only?** _Recommend: Group-by only until dogfooding asks; make rail sections an entity either way._
10. **Subtasks: stay one level, or allow two?** _Recommend: one level, with templates and a checklist as the cheaper third layer; revisit after the first Jira-migrating team._
11. **"Focus on this" (`f` starts a run with that task on top): allow it, or keep the Queue as the only entry?** _Recommend: allow it; it doesn't bring back single-task Focus as a mode, and it is how every competitor starts._
12. **Should `reschedule_count` become "moved later N×" (forward date moves) or disappear?** _Recommend: disappear; the behaviour it mirrored (skipping out of today) no longer exists, and a count of date moves reads as a wall for the very people it was meant to protect._
13. **Priority stays three levels with no Urgent?** _Recommend: yes (research N4); map imports' Urgent to High._
14. **Approve the doc edits in §4 as one PR before the next Tasks block?** _Recommend: yes; three documents currently state principles the last round reversed._
