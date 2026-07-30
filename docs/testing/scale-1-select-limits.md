# Manual test checklist — SCALE-1 (bounded, paged module reads + "showing N of M")

> Generated 2026-07-29 · branch `claude/scale-1-select-limits-a95241` · **Live-verified: yes, except the export row** (verified at the query layer instead — see Known gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

**This block is invisible without seeding.** Under ~1000 rows nothing here can fail, because
the bug it fixes only starts at row 1,001. Seed first.

## Seeding

Hosted test account, workspace `24dc8419-5343-4c94-94e1-8cc89ae6aa9c` ("Claude Test S2"),
user `cb8a22cf-2cd0-45db-8d61-d3dad78c7318`. Run in the Supabase SQL editor.

**Seed A — 1,500 tasks** (crosses PostgREST's 1000-row ceiling, stays under the 5,000 cap):

```sql
insert into tasks (workspace_id, owner_id, bucket_id, title, position)
select '24dc8419-5343-4c94-94e1-8cc89ae6aa9c', 'cb8a22cf-2cd0-45db-8d61-d3dad78c7318',
       (select id from buckets where workspace_id='24dc8419-5343-4c94-94e1-8cc89ae6aa9c' and is_system order by created_at limit 1),
       'SCALE1SEED task ' || lpad(g::text, 5, '0'), 'zz' || lpad(g::text, 5, '0')
from generate_series(1, 1500) g;
```

**Seed B — 5,100 tasks** (crosses the cap): run the cleanup block first, then re-run seed A
with `5100` in place of `1500`. The totals below assume you did — otherwise they won't line up.

**Seed C — two 2019 calendar events** (for the window checks):

```sql
insert into calendar_events (workspace_id, owner_id, calendar_id, title, start_time, end_time, all_day, recurring, recurrence_rule)
values
 ('24dc8419-5343-4c94-94e1-8cc89ae6aa9c','cb8a22cf-2cd0-45db-8d61-d3dad78c7318','moduo','SCALE1SEED ancient one-off','2019-03-14T10:00:00Z','2019-03-14T11:00:00Z',false,false,null),
 ('24dc8419-5343-4c94-94e1-8cc89ae6aa9c','cb8a22cf-2cd0-45db-8d61-d3dad78c7318','moduo','SCALE1SEED ancient weekly series','2019-03-11T09:00:00Z','2019-03-11T09:30:00Z',false,true,'FREQ=WEEKLY');
```

**Cleanup (do this at the end — 5,000 tasks makes the account unpleasant next session):**

```sql
delete from tag_links where entity_type='task' and entity_id in (select id from tasks where title like 'SCALE1SEED%');
delete from tasks where title like 'SCALE1SEED%';
delete from calendar_events where title like 'SCALE1SEED%';
```

## Tasks — paging past the ceiling

- [ ] **Do:** With seed A (1,500 tasks) loaded, open `/tasks` and scroll to the bottom of Inbox → **Expect:** `SCALE1SEED task 01500` is there. Before this block the list stopped around 1,000 with no error and no warning. _(web)_
- [ ] **Do:** Same state, look above the panels → **Expect:** **no** "Showing…" strip — 1,510 is under the 5,000 cap, so nothing was cut. _(web)_

## Tasks — the visible "showing N of M"

- [ ] **Do:** With seed B (5,100 tasks), reload `/tasks` → **Expect:** a strip above the panels reading **"Showing 5,000 of N tasks. This workspace is bigger than one load — the rest isn't on screen yet."** N is `5100 + the account's existing live tasks` (10 at time of writing → "5,110"). The number after "of" must be the real total. _(web)_
- [ ] **Do:** Run the cleanup block, reload `/tasks` → **Expect:** strip gone, and the layout is identical to before this block (no leftover gap where the strip was). _(web)_

## Calendar — the date window

- [ ] **Do:** With seed C, open `/calendar` anchored on today → **Expect:** the **weekly series shows occurrences this week**. Its stored start is 2019, so a naive date window would have hidden a still-running meeting — this is the check that matters most. _(both)_
- [ ] **Do:** Same screen → **Expect:** the **2019 one-off is NOT loaded** (correct — it's outside the window and nothing links to it). _(both)_
- [ ] **Do:** Page back to March 2019 (or set `localStorage['moduo:calendar:view:<userId>:<workspaceId>'] = '{"view":"week","anchor":"2019-03-14"}'` and reload) → **Expect:** the window widens, refetches, and `SCALE1SEED ancient one-off` appears. _(both)_
- [ ] **Do:** From there, page forward a few weeks and back again → **Expect:** no refetch — the window only ever grows, so revisiting loaded months is free. _(both)_

## Calendar — deep links

- [ ] **Do:** Open `/calendar?event=<id of the 2019 one-off>` while anchored on today → **Expect:** lands on **Mar 11–17 2019** with the event selected, and **no "Couldn't find that event" toast**. The window is dropped and retried before an id is ruled stale. _(both)_
- [ ] **Do:** Open `/calendar?event=00000000-0000-4000-8000-000000000000` (an id that doesn't exist) → **Expect:** the toast **does** appear and `?event=` is cleared from the URL. The retry must not swallow a genuinely dead link. _(both)_

## Other modules — no regression

- [ ] **Do:** Open `/notes`, `/contacts` and `/email` with normal data → **Expect:** unchanged. No strip, no layout shift, no console errors beyond the pre-existing Radix `DialogTitle` warnings. _(web)_

## Edge cases

- [ ] **Do:** With seed C, open Settings → Advanced → **Export workspace** → **Expect:** the exported `calendar` module contains **both 2019 events**. An export labelled "everything" must never inherit the calendar page's date window. _(web)_
- [ ] **Do:** Link a contact to the 2019 one-off, then open that contact's hub → **Expect:** the linked-event row shows its date/time metadata (not a bare label). Spine snippets read all of history, not the page window. _(web)_
- [ ] **Do:** On `/calendar`, create an event and immediately page to a month outside the loaded window → **Expect:** the new event still exists when you page back; it is not dropped, and it does not appear twice. _(both)_
- [ ] **Do:** Switch workspace while on `/calendar` after having paged back to 2019 in the previous one → **Expect:** the new workspace loads its default window (one read), not the previous workspace's widened one. _(both)_

## Migrations / data

- [ ] **Do:** Nothing — **this block ships no migration.** It is read-path only: no schema change, no RPC, no grants. Confirm by checking that `supabase/migrations/` gained no file on this branch. _(n/a)_

## Known gaps / not-yet-testable

- **The export row was verified at the query layer, not through the UI.** The exact all-time filter the export now sends was run directly against the hosted project (HTTP 200, both 2019 rows returned), but the Settings modal's section switcher did not respond to synthetic or coordinate clicks in the preview pane, so the click-through is left for this checklist.
- **Only tasks were seeded past a cap.** Notes / contacts / events / email threads share the same code path (`readPaged` + `selectCapped`), but their strip copy ("Showing 5,000 of … notes/people/events/threads") is unproven live.
- **A widening calendar window shows an empty grid for the duration of the refetch.** `calendar.loading` exists but the grid doesn't render a loading state — brief, and only when navigating past the window edge.
- **Three unbounded reads survive, deliberately out of scope:** the legacy `notes.list` (the dashboard notes-preview widget) and the `workspace_notifications` read still stop silently at 1,000, and Home's aggregate bundles carry `truncated` without rendering it.
- **`PGRST_MAX_ROWS = 1000` mirrors a server setting the client can't read.** Lowering `db-max-rows` in the Supabase API settings would silently reintroduce this entire bug class; treat that setting as coupled to the constant.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
