# Manual test — SCALE-1 (bounded, paged module reads + "showing N of M")

Branch `claude/scale-1-select-limits-a95241`. Everything below was run against the
hosted test account during the build; this is the re-run recipe.

## Seeding (needed — the bug is invisible under ~1000 rows)

Workspace `24dc8419-5343-4c94-94e1-8cc89ae6aa9c` ("Claude Test S2"),
user `cb8a22cf-2cd0-45db-8d61-d3dad78c7318`. Run in the Supabase SQL editor:

```sql
-- A: cross PostgREST's 1000-row ceiling but stay under the 5000 cap
insert into tasks (workspace_id, owner_id, bucket_id, title, position)
select '24dc8419-5343-4c94-94e1-8cc89ae6aa9c', 'cb8a22cf-2cd0-45db-8d61-d3dad78c7318',
       (select id from buckets where workspace_id='24dc8419-5343-4c94-94e1-8cc89ae6aa9c' and is_system order by created_at limit 1),
       'SCALE1SEED task ' || lpad(g::text, 5, '0'), 'zz' || lpad(g::text, 5, '0')
from generate_series(1, 1500) g;
```

Bump `1500` → `5100` for scenario B, and add the calendar rows for D/E:

```sql
insert into calendar_events (workspace_id, owner_id, calendar_id, title, start_time, end_time, all_day, recurring, recurrence_rule)
values
 ('24dc8419-5343-4c94-94e1-8cc89ae6aa9c','cb8a22cf-2cd0-45db-8d61-d3dad78c7318','moduo','SCALE1SEED ancient one-off','2019-03-14T10:00:00Z','2019-03-14T11:00:00Z',false,false,null),
 ('24dc8419-5343-4c94-94e1-8cc89ae6aa9c','cb8a22cf-2cd0-45db-8d61-d3dad78c7318','moduo','SCALE1SEED ancient weekly series','2019-03-11T09:00:00Z','2019-03-11T09:30:00Z',false,true,'FREQ=WEEKLY');
```

**Clean up afterwards** — 5,000 tasks makes the account unpleasant for the next session:

```sql
delete from tag_links where entity_type='task' and entity_id in (select id from tasks where title like 'SCALE1SEED%');
delete from tasks where title like 'SCALE1SEED%';
delete from calendar_events where title like 'SCALE1SEED%';
```

## Checks

| # | Step | Expected | Surface |
|---|------|----------|---------|
| A | Seed 1,500 tasks → open `/tasks` | Scroll to the bottom of Inbox: **`SCALE1SEED task 01500` is present**. Pre-fix the list stopped at ~1,000 with no warning. No "Showing…" strip (1,510 < the 5,000 cap). | Tasks |
| B | Seed 5,100 tasks → reload `/tasks` | A strip above the panels: **"Showing 5,000 of 5,110 tasks. This workspace is bigger than one load — the rest isn't on screen yet."** The number after "of" must be the real total, not a guess. | Tasks |
| C | Delete the seed → reload `/tasks` | Strip gone; layout identical to before the block (no leftover gap). | Tasks |
| D | With the two 2019 events seeded, open `/calendar` on today | The **weekly series still shows occurrences this week** (its stored start is 2019 — a naive date window would have hidden it). The **2019 one-off is NOT loaded** (correct: outside the window). | Calendar |
| E | Page the calendar back to March 2019 (or set `localStorage['moduo:calendar:view:<userId>:<workspaceId>'] = '{"view":"week","anchor":"2019-03-14"}'` and reload) | The window widens and **`SCALE1SEED ancient one-off` appears**. Paging forward again and back must NOT refetch (the window only grows). | Calendar |
| F | Open `/calendar?event=<id of the 2019 one-off>` from today's anchor | Lands on **Mar 11–17 2019** with the event selected. **No "Couldn't find that event" toast** — the window is dropped and retried before an id is called stale. | Calendar |
| G | Settings → Advanced → Export workspace, with the 2019 events seeded | The exported `calendar` module contains **both 2019 events**. An export must never inherit the page's date window. | Settings |
| H | Open `/notes`, `/contacts`, `/email` with normal data | Unchanged — no strip, no layout shift. | All |

## Not covered / known gaps

- **Crossing the cap on notes / contacts / events / email threads** was not seeded — only tasks. The code path is shared (`readPaged` + `selectCapped`), but the per-module strip copy is unproven for those scopes.
- **A widening calendar window shows an empty grid for the duration of the refetch** — `calendar.loading` exists but the grid doesn't render a loading state. Brief, and only when navigating past the window edge.
- **The legacy `notes.list` (dashboard preview widget) and the `workspace_notifications` read are still unbounded** and will silently stop at 1,000.
- **Home's aggregate bundles carry `truncated` but never render it** — a truncated Home shows no strip.
- `PGRST_MAX_ROWS = 1000` mirrors the project's `db-max-rows` API setting. Lowering that setting server-side would reintroduce silent truncation; there is no client-side way to detect it.
