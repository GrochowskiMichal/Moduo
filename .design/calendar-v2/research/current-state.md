> Raw research report from the Calendar re-plan, 2026-10-10 (branch t/maciej/calendar-replan). Nothing here is decided.

# Lane 1: Calendar today, a code audit plus a live look

**Baseline:** `t/maciej/calendar-replan` @ e6fa89f3, cut from `t/maciej/tasks-v3-build`. Tasks v3 blocks already on this branch: TV-D5 (live updates), TV-P0 (trust pass), SH-1 (panel registry, capture shell), TV-U2 (toolbar). Read only, except the research data listed in §8.

**Version warning.** This branch does not contain TX-5 (booking emails, `t/maciej/tx-5-booking-emails`). TX-5's `booking-public` is live on prod, but its page changes are not merged anywhere. Everything below describes this branch. Where TX-5 changes the picture, it says so.

**Prior art.** [`../../tasks-v3/research/current-state-focus-calendar-home.md`](../../tasks-v3/research/current-state-focus-calendar-home.md) §3–§4 (cited as **PRIOR**) audited the Calendar Tasks panel, blocks and block focus on `maciej` @ 95d988b0. I re-checked every claim I reuse. Where nothing changed I cite PRIOR instead of repeating it.

**Citations.** Paths are relative to the repo root. Short names:

| Short name | File |
|---|---|
| `CPV` | src/features/calendar/ui/calendar-page-view.tsx |
| `GRID` | src/features/calendar/ui/calendar-grid.tsx |
| `QC` | src/features/calendar/ui/event-quick-create.tsx |
| `EDP` | src/features/calendar/ui/event-detail-panel.tsx |
| `POP` | src/features/calendar/ui/event-popover.tsx |
| `TPNL` | src/features/calendar/ui/calendar-tasks-panel.tsx |
| `RAIL` | src/features/calendar/ui/calendar-rail.tsx |
| `CALS` | src/features/calendar/ui/calendars-panel.tsx |
| `BL` | src/features/calendar/ui/booking-links.tsx |
| `BLD` | src/features/calendar/ui/booking-link-dialog.tsx |
| `BOOK` | src/routes/pages/book-page.tsx |
| `BP` | supabase/functions/booking-public/index.ts |
| `UCM` | src/features/calendar/hooks/use-calendar-module.ts |
| `SYNC` | src/features/calendar/hooks/use-calendar-sync.ts |
| `UBF` | src/features/calendar/hooks/use-block-focus.ts |
| `TODAY` | src/features/dashboard/ui/widgets/calendar-today-widget.tsx |
| `INT` | src/features/settings/sections/integrations-section.tsx |
| `MCP` | supabase/functions/moduo-mcp/modules/calendar.ts |
| `RTW` | src/lib/runtime.web.ts |
| `PERM` | supabase/migrations/20261006210000_perm_sharing.sql |
| `PERM0` | supabase/migrations/20261006180000_perm0_privacy.sql |
| `FIX` | supabase/migrations/20261002110000_booking_calendar_fixes.sql |

Any other file is cited by its basename or full path. "Live" means I saw it in the running app (§5). "Traced" means I followed the code but didn't run it.

---

## 0. The five things that matter most

1. **The calendar doesn't know whose time it is showing.** Every task you can see is drawn as a block, including teammates' tasks in shared projects. They count toward "N unfinished from earlier", and **Move to today** moves them (`lens.ts:114-142`, `strip.ts:36-57`, `CPV:815-846`). Live: the Review list held two of Tess's tasks, ticked by default. The MCP tool `calendar_roll_forward` does the same across the whole workspace (`MCP:354-380`).
2. **Two calendar systems sit side by side and don't talk.** The rail lists connected *accounts* (`calendar_accounts`). A second "Calendars" block below it lists sharing *calendars* (`calendars`, from PERM-2b). Its checkboxes mean "include in a set", not "show". Custom calendars can be created but can never hold an event (`CALS:60-237`; trigger in `20261006240000_perm_sharing_followups.sql:86-103`). Teammates' events arrive as "Busy" blocks that can't be hidden.
3. **External calendars are fragile.** Sync only runs while someone has the Calendar page open (`SYNC:16`, `SYNC:158-172`). Web syncs Google only. Each sync deletes every mirrored event outside "30 days back, 120 ahead", so past meetings and their links vanish (`SYNC:100-106`, `sync.ts:88-101`, `window.ts:16-17`). Desktop Google/Outlook tokens are never refreshed, so desktop sync likely stops about an hour after connecting (`calendar.rs:342-356`, `oauth_flow.rs:5-6`).
4. **"Two-way Google" only means "create".** An event you create on a Google calendar goes to Google and comes back as a read-only copy. From then on you can't move, edit or delete it in Moduo (`CPV:479-512`, `PERM0:436-439`, `EDP:53-55`). Settings still says "two-way copy" (`INT:324-326`).
5. **Several everyday interactions are broken or dishonest.** Live-reproduced:
   - Clicking any control inside the new-event popover (repeat, all day, calendar, time) throws the draft away and starts a new one where you clicked (`GRID:422-435`, `GRID:863`, `QC:139-182`).
   - The "+N" overlap marker can't be clicked.
   - Recurring events show as "Busy" to teammates only on their first occurrence (`PERM:1261-1274`).
   - An event's activity reads `calendar.event_create`.

---

## 1. Capability matrix

Each row is **Works** / **Missing** / **Wrong**. Evidence follows each row.

### 1a. The grid (Day and Week)

| Area | Works | Missing | Wrong |
|---|---|---|---|
| Views | Day and Week. D/W/T/←/→ keys. Last view and date remembered per device (`CPV:132-138`, `CPV:626-677`). | Month, agenda, 3-day, multi-person views. | — |
| All-day lane | Shows all-day events (`GRID:211-214`, `GRID:630-660`). Live: "offsite" on Thu. | Due-only tasks never appear, here or anywhere on the grid (`lens.ts:121`). Live: two due-only tasks were only in the panel. | A teammate's all-day event reaches you as a 24-hour timed "Busy" block that fills the whole column (`UCM:185-190` sets `allDay: false`). Live: Thu column shaded top to bottom. |
| Chips | Two kinds: events (filled, coloured per account) and task blocks (outlined, checkbox) (`GRID:889-972`). Done blocks dim and strike through. Recurring events show a repeat mark. | No attendees, location or join link on the chip. | Task blocks are drawn as a thin line with a circle. Live: a 30-minute block read like a list row, not a block. |
| Overlap | Up to 3 side-by-side columns, then "+N" (`grid-layout.ts:103-136`). | — | **"+N" is a hover tooltip only.** It can't be clicked, so hidden events can't be opened (`GRID:974-993`; the comment says "popover list arrives… CAL-2", it never did). Live: "+1" on a 4-event pile did nothing, even in Day view with room to spare. |
| Now line | Today's column, refreshed every 30 s and on wake (`GRID:103-116`). | — | — |
| Draw to create | Drag on empty space draws a ghost. A click makes a 30-minute ghost. Enter saves. Esc discards. Click-away with a title saves (`GRID:349-365`, `QC:150-182`). | — | **Any click inside the popover discards the draft.** The popover is a portal, but React still passes its pointer events up to the day column. The column's draw handler starts a new ghost (`GRID:422-435`, `GRID:863`; `QC:164-182` stops nothing). Live: twice; the draft vanished and a fresh ghost appeared at the click's height. Only "type the title, press Enter" works. |
| Drag and resize | Native events and task blocks move and resize. 15-minute snap; ⌥ for fine (`GRID:285-403`). External chips refuse with a tooltip (`GRID:484-491`). | No keyboard alternative. No drag between days for multi-day events. | Dragging one occurrence of a repeating event moves the **whole series**, with no prompt (`CPV:514-526`). Moving a task block with no estimate saves an invented 30 m (PRIOR §4(d); `lens.ts:129-130`, `GRID:385-391`). Anyone with edit rights can drag a teammate's task block (`GRID:509`). |
| Keyboard and screen readers | Page keys above. Task checkboxes and the triage buttons are real buttons. | Events have no role, no tab stop and no key handler. Live: the accessibility tree listed no event at all. Blocks have no keys either (PRIOR §4(f)). | — |
| Time formats | — | — | Three formats on one screen. Chips say "1:00 PM" (`ui/time-format.ts`). The quick-create time fields say "13:45" (`QC:197-206`). Detail uses the browser's date-time box, "10/10/2026, 20:45" (`EDP:173`, `EDP:191`). The block popover says "60m" (`task-popover.tsx:81`), where Tasks v3's one grammar says "1h". |

### 1b. Right panel

**Registered views** (`panel-views.ts:9-13`, via `src/lib/panel-registry.ts`): **Detail** and **Notes** ("about this"), then **Tasks** ("alongside"). They are the old tabs, registered unchanged by SH-1. The page still renders all three itself (`CPV:884-978`). ⌥1–3 switch them. Opening a chip's popover → Open enters Detail (`CPV:368-378`). Closing an event's Detail returns to Tasks (`CPV:919`).

| View | Works | Missing | Wrong |
|---|---|---|---|
| Tasks | Search plus three groups: Queue (my queue, in order) · Due soon (overdue + 7 days) · Backlog (open, unscheduled, max 50) (`panel.ts:43-86`). Rows drag onto the grid (mouse). The checkbox completes. Titles wrap since TV-P0. Review mode lists strip items with ticks (`TPNL:104-199`). | Add row, assign, sort, filter, done view, keyboard scheduling (PRIOR §3(b)). No "+N" past 50 (`panel.ts:82`). | Due soon and Backlog are team-wide (`panel.ts:65-77`). Live: a shared project's task appeared in my Backlog. Queue puts scheduled rows last (`panel.ts:36-41`, `:80`). The header still says "Queue"; Tasks v3 calls it "Up next". Enter or Space on a row's checkbox still reaches the row's key handler, which opens the task (`TPNL:249-256`, unchanged since PRIOR §3(e)). The empty state ("Nothing to schedule — capture a task or enjoy the calm.") shows while loading. Live: it flashed on every reload. |
| Detail (event) | Title, start, end, all day, repeat, notes with `@` and `/ref`, linked items (EntityHub), activity, delete (`EDP`). External events are read-only with a "managed in its source calendar" line. | Attendees, location field, join-link editing, calendar picker, time zone, reminders, availability (busy/free). | Activity lines show raw op names. Live: "You calendar.event_create" (`spine/activity.ts:46-` has no `calendar.*` cases). A teammate's "Busy" block opens a fake Detail: "External calendar", "Couldn't load links. Retry" (live; the id is `busy:…`, `UCM:177-195`). |
| Detail (task) | Reuses the Tasks `TaskDetailPanel` (`CPV:921-932`). | — | — |
| Notes | Notes linked to the selected event or task, plus "New linked note" (`CPV:940-960`). | — | — |

### 1c. Left rail

| Area | Works | Missing | Wrong |
|---|---|---|---|
| Mini-month | Navigates. Shows dots for days with any task or event (`CPV:311-323`). | — | Dots include teammates' tasks. |
| "Calendars" (accounts) | "Moduo" (always on, no eye: `RAIL:208`) plus one row per connected account: colour, show/hide, remove. CalDAV rows group under their server; feeds under "Feeds". "Connect calendar…" opens Settings (`RAIL`). | A way to hide your own Moduo events or a teammate's busy time. Reconnect for Google, Outlook or ICS (CalDAV only, desktop only: `RAIL:94-95`). | — |
| "Calendars" (sharing) | A second block with the same heading: your calendar, each teammate's ("Tess Mate's calendar"), integration calendars. Share (busy only, can view, can edit), "New calendar", "Save this set" (`CALS:156-237`). | — | The checkboxes look like visibility toggles but mean "include in a set". Screen readers hear "Include Moduo in a set" twice for two different people (live). Custom calendars can never receive an event: no op takes a calendar, and a trigger files every new event into its owner's Moduo or integration calendar (`20261006240000_perm_sharing_followups.sql:86-103`; `QC:225` offers Moduo and Google only). A saved set only toggles *accounts*, so a set of people's calendars does nothing useful (`CPV:1016-1022`). Failed saves are silent (`CALS:120`, `CALS:133`). It reads the database directly, outside the runtime (`CALS:5`, `CALS:66-98`). |
| Booking links | The list sits at the bottom of the rail (`CPV:1025-1030`). | — | See §1e. |
| Colours | Account colours, synced per user (`CPV:236-241`). | — | — |

### 1d. Settings and connecting

| Provider | Web | Desktop |
|---|---|---|
| Google | Connect through the web sign-in. One rail row per Google calendar, read-only holiday and birthday calendars included (`google-web.ts:116-133`). Syncs in the browser. | Keychain sign-in. One row per Google *login* (`google:{email}`). Different row shape from web (`google-web.ts:116-121`, `BP:311-333`). Tokens are never refreshed, so it likely stops after ~1 h (`calendar.rs:342-356`; `oauth_flow.rs:5-6` says calendar never refreshed). |
| Outlook | "Desktop only", disabled (`INT`). Rows seeded from desktop show as connected. The web skips them silently (`RTW:2035-2039`). | Keychain sign-in, read-only (`calendar.rs:251`). |
| CalDAV / iCloud / ICS | "Desktop only", disabled. | Connect dialog with iCloud, Fastmail and Nextcloud presets. Read-only. Credentials live in the keychain of the machine that connected, so only that machine syncs (`docs/gotchas/calendar.md`). |
| Zoom | Not in Settings at all. Only inside the booking-link dialog (`BLD:105-129`). | Same. |

- **Sync cadence:** on page open, on tab wake, every 15 min, and on manual refresh. Only while `/calendar` is mounted. No server sync (`SYNC:16`, `SYNC:158-172`).
- **"synced X ago"** shows the *freshest* account, so a stale one hides behind a fresh one (`accounts.ts:221-240`).
- The mirror op stamps `status='ok'` and `last_sync_at=now()` on every call, even when every row was skipped (`FIX:224-226`).

### 1e. Booking links

| Area | Works | Missing | Wrong |
|---|---|---|---|
| Create/edit dialog | Name, length (15–60 or 5–240), description, video (Meet, Zoom, guest's choice; "Moduo video · Later" shown greyed), short note, add guests (≤10), custom questions, weekly hours (one window per day), how far ahead (7–90 d), minimum notice, buffers, busy calendars, pause, delete (`BLD`). Live: matches. | Several windows per day, date overrides, start-time spacing, daily cap, reschedule, reminders, in-person or phone, round-robin. The host time zone can't be changed (`BLD:495`). | Saves a Meet link when Google isn't connected (only Zoom is checked, `BL:313`). Live: saved fine; the guest will see "paused". The default busy calendar is **Moduo only** (`BL:90`). Name looks pre-filled ("Intro call") but is a placeholder. Live: "Give the link a name." |
| Busy time | Moduo events plus checked accounts' mirrored events plus active bookings on *this* link. Live Google free/busy for the primary calendar (`BP:244-307`). | Task blocks never count. Other links' bookings don't count (`BP:280`). | **Recurring Moduo events block only their first occurrence** (`BP:252-273` reads raw rows). Google free/busy runs if any Google account is ticked, checks only the primary calendar, and treats a failed check as free (`BP:296-303`, `supabase/functions/_shared/google-calendar.ts:87`, `:90`). Cancelled and "free" events count as busy. |
| List | Name, "· paused", Copy (`BL:465-506`). | Bookings list, stats, preview, duplicate. Nothing in `src/` reads `slot_bookings`. The host can't see or cancel a booking except as a calendar event, and a Google-backed one is read-only. | Copy greys out with no reason when video isn't connected (`BL:67-72`). |
| Public /book page | One sentence the guest completes. 17 time zones plus the detected one. Open times come from the server. Confirmation with Join. Cancel page by token (`BOOK`, `book-cancel-page.tsx`). | Reschedule. Time-zone search. | Branch wording promises "a calendar invite" even for Zoom-only hosts (`BOOK:316`). A server error says "Check your connection" (live). A failed cancel is silent (branch). |
| Collective links | Database and server intersect hosts' free times (`BP:338-371`). | UI off: `COLLECTIVE_LINKS_ENABLED = false` (`BLD:61`). PERM-8b open. | The co-host "Accept / Decline" rows render anyway (`BL:430-464`). Co-hosts' own calendars mostly don't count. Each co-host gets their own copy of the event, and cancelling releases only the host's (`PERM:1646-1663`, `BP:527-533`). |
| Emails | Branch: Google sends invites (`sendUpdates=all`); Moduo sends one plain guest email via Resend. TX-5 (prod): outbox emails to guest, host and extra guests, plus a host bell. | Reminders (TX-6). | Branch: extra guests on Zoom-only bookings get nothing (`BP:607`, `BP:717-720`). |

### 1f. Home Today widget (`TODAY`, `today.ts`)

- **Works:** "N unfinished from earlier · Move to today", then today's remaining timed blocks and events, linking to the item (live).
- **Missing:**
  - All-day events: excluded on purpose (CAL-7).
  - Undo on Move to today.
  - Busy blocks.
- **Wrong:**
  - The count and the move include teammates' tasks. Live: "6 unfinished".
  - Never more than 4 rows: `today.ts:88` caps before the size budget at `TODAY:107-108`.
  - Week start and 08–18 hours are hard-coded (`TODAY:46`, `TODAY:61`, `TODAY:73-74`).
  - It ignores hidden calendars.
  - Its "Open" fallback in the neighbouring Tasks widget is team-wide. Live: "OPEN 11" including Tess's task.

### 1g. MCP: the app's declaration vs the connector

- **App** (`ops-manifest.ts:16-117`) declares 6 ops plus 2 resources, as metadata only.
- **Connector** (`MCP`) serves 8 tools with the same names: `calendar_list_events`, `calendar_day`, `create/update/delete_event`, `schedule_task`, `move_block`, `complete_block`, `roll_forward`.
- Gaps (`MCP:103-213`, `MCP:354-415`):
  - Recurring events appear only if their *first* occurrence is in range.
  - Days are computed in UTC (`MCP:91-96`).
  - `list_events` applies its row limit before the visibility filter, so results can come back short.
  - `calendar_day` includes every visible teammate's blocks.
  - `roll_forward` moves every visible overdue task, teammates' included (`MCP:359-380`).
  - No tools for accounts, booking links, attendees or availability.

### 1h. Capture

- **⌘N on the calendar:** opens a 30-minute quick-create at now (`GRID:541-567`). Live: works. Typing the title and pressing Enter is the only reliable path (see 1a).
- **⌘⇧K, type "Event" (⌘4 in the shell):** SH-1 registered the old one-line event capture unchanged (`capture-type.tsx:10-18`). It reuses the *task* parser (`capture-command.ts:165-176`).
  - A time gives a 1-hour event, a date an all-day event, nothing gives the next full hour (`capture-command.ts:83-107`).
  - A typed repeat is parsed and then **dropped**.
  - It always lands on Moduo.
  - It's gated on the **Tasks** permission (`capture-command.ts:35`), while the server checks Calendar's own permission (`calendar_module_permission`, newest in `20261006200000_perm1_roles_overrides.sql`).
- **"Capture" in the empty Tasks panel:** opens the old Tasks `CaptureModal` (`CPV:1171-1178`), not the new capture shell.

---

## 2. The data model as it is today

**Tables** (columns abridged; `src/types/supabase.ts:123-147` for events):
- **`calendar_events`**: an old table extended in place (`20260702130000_calendar_module.sql:85-106`).
  - title, description, location, start_time/end_time (instants only), all_day, recurrence_rule (RRULE text), attendees/reminders/tags (jsonb, unused by sync), color, status.
  - `calendar_id` (text: `moduo` or `google:{email}:{calId}`) **and** `calendar_ref` (uuid → `calendars`; `PERM:338`). Two ways to say which calendar.
  - `source_account_id` + `external_event_id` mark a mirrored event. One live row per pair.
- **`calendar_accounts`**: one row per connection (or per Google calendar on web). `status`, `last_sync_at`. `sync_token` holds the CalDAV/ICS connection details, not a sync token. **No incremental sync anywhere.**
- **`calendars`** (kind moduo, custom or integration; `publish_token`), **`calendar_sets`**, **`resource_grants`**, **`workspace_share_defaults.calendars`**: the sharing layer from PERM-2b (`PERM:8-46`, `PERM:318-375`). The workspace default is `freebusy`.
- **Booking:** `exposed_slot_links`, `slot_bookings`, `booking_link_hosts`, `booking_attempts`. Tokens live in `user_integrations`.
- **Task blocks are not a table.** A block is the task row (`scheduled_at` + `duration_minutes`). Tracked time is `task_time_entries` since TV-D3.

**Ops** (newest definitions; event ops in `PERM0`, mirror in `FIX`, sharing ops in `PERM`):
- `calendar_op_event_create/_update/_delete/_restore`: Calendar edit, and **owner only**. External events refused (`PERM0:414-446`, `PERM0:436-439`).
- `calendar_op_account_upsert/_remove`: owner only.
- `calendar_op_mirror_events`: batched, isolates per-event errors (`FIX:139-230`).
- `calendar_op_create_custom`, `calendar_op_publish`, `calendar_set_save`.
- `calendar_busy_blocks`: start/end only, for calendars you see at free/busy but not view (`PERM:1261-1274`).
- `booking_op_commit/_release`, `booking_hosts_set`, `booking_host_respond`, `booking_rate_check`.
- The loop verbs reuse Tasks ops: `tasks_op_reschedule`, `tasks_op_set_status`, `tasks_op_track_time`.

**Who sees what:**
- Events: the owner, or anyone with View on the event's calendar.
- Teammates get "Busy" blocks by default. Live: Tess saw my events as "Busy", and her own dentist event in full.
- An Edit or Full grant on a calendar does nothing for its events, because the guard is owner-only (`PERM0:429`).

**Written back to providers:**

| Provider | Create | Update / move | Delete |
|---|---|---|---|
| Google (web token) | Yes: `pushGoogleWebEvent` → `calendar-google-web` → Google → mirrored back (`CPV:479-512`, `google-web.ts:49-63`). Needs the web-stored token. The description isn't sent. | No | No (only booking cancel deletes, primary calendar only) |
| Outlook, CalDAV, ICS | No | No | No |

- The 2026-10-01 decision ("created in Google, then mirrored back") is **true for create only**.
- If Google accepts but the mirror save fails, the toast says "Couldn't save the event on Google." while the event exists in Google (`CPV:506-508`).
- The OAuth scopes would allow edits (`booking-google-connect/index.ts:46-52` asks for `calendar.events`; desktop `calendar.rs:148-149`).

**Sync:**
- Runs in the browser or desktop app, only while the Calendar page is open (`SYNC`).
- Window: −30 d to +120 d (`sync.ts:88-101`).
- Deletions are found by comparing the fetch with *everything loaded* for that account (12 months back, 24 ahead: `window.ts:16-17`; `SYNC:100-106`). So everything outside the sync window is tombstoned each time. A returning event gets a new row id.

**Recurrence:**
- Native events: one RRULE on the row, expanded in the browser in local wall-clock time (`recurrence-expand.ts`). Series edits only. No EXDATE or moved-occurrence storage.
- Google and Outlook mirror every occurrence as its own row (`singleEvents=true`). CalDAV/ICS expand with ical.js.
- The server never expands native rules. That's why booking, busy blocks and MCP miss repeats.

**Attendees, invites, RSVP:**
- Not mirrored: the mirror op never writes `attendees` (`FIX:163-199`), and `mapGoogleEvent` ignores them.
- Only bookings add attendees, to the Google event.
- No RSVP anywhere.

**Time zones:**
- No per-event time zone. Instants only.
- All-day events are stored as local midnight of whichever device created or synced them (`mirror.ts:24-29`).
- Booking links store `host_timezone`; bookings store the guest's zone.

**Calendar prefs** (`prefs.ts:126-145`): working hours 08–18, week start Monday, weekends shown, synced per user. **No screen changes them.** `updatePrefs` is only called for visibility and colours (`CPV:162`, `CPV:238`, `CPV:259`, `CPV:1018`). So the hours used by "Later today" and "Move to today" are effectively fixed for everyone. The rail honours `weekStartsOn` (`RAIL:197`). The Home widget and DateField hard-code Monday (`TODAY:46`, `date-field.tsx:145`).

---

## 3. Trust bugs, ranked

1. **Teammates' tasks are treated as mine.**
   - Blocks, the strip count, Review (pre-ticked), Move to today, the Home Today count and the MCP roll-forward all include any task I can see in a shared project (`lens.ts:114-142`, `strip.ts:36-57`, `CPV:815-846`, `TODAY:50-93`, `MCP:359-380`).
   - Live: "6 unfinished from earlier" included "Shared: Tess's task" and "Shared: Tess's own task".
   - Private Inboxes (PERM-0) hide teammates' Inbox tasks, so this bites exactly in shared projects.
   - Tasks v3 §18 says "Teammates' unassigned tasks stay out".
2. **Mirrored history disappears.** Every sync tombstones mirrored events older than 30 days or more than 120 days out, with their spine links (§2 Sync). A Google event you create 5 months ahead from Moduo is deleted on the next sync.
3. **Clicking inside the new-event popover loses the draft** (§1a). Live, twice.
4. **"Synced just now" can be untrue.**
   - The toolbar shows the freshest account (`accounts.ts:221-240`).
   - The mirror op stamps `ok` even if every row was skipped (`FIX:224-226`).
   - Web silently skips Outlook/CalDAV/ICS, so those rows look healthy on web (`RTW:2035-2039`).
   - Desktop tokens expire after ~1 h and flip to "error" with no reconnect button except for CalDAV (`RAIL:94-95`).
5. **Teammates see recurring meetings as free.** `calendar_busy_blocks` returns raw rows, so a weekly meeting shows as "Busy" only on its first occurrence. Booking availability has the same gap (`PERM:1261-1274`, `BP:252-273`). All-day busy turns into a 24-hour timed block (§1a).
6. **"Took longer" still logs the planned length as worked time.**
   - TV-D3 changed the write into one adjustment entry, but the amount is still the block's duration, or 30 m when there's none (`CPV:771-794`, `triage.ts:6-15`).
   - Tasks v3 default r: "a block's planned length is never recorded as worked time".
7. **Two clocks.**
   - Block focus (`UBF`) is page state, separate from the Focus engine. Leaving `/calendar` ends it silently; nothing shows in the top bar.
   - Live: started focus, navigated to Tasks. 14 s were saved as a `focus` entry with no idempotency key (`client_key: null`) and no run. No toast. The top bar showed no timer.
   - It still has no away limit (PRIOR §4(e)). It now passes `addTimeSpent`, which returns a result that `UBF:66-70` ignores.
8. **Due-only tasks never appear on the Calendar** (`lens.ts:121`). Live: confirmed.
9. **Dragging one occurrence moves the whole series, silently** (`CPV:514-526`). Delete at least asks "All occurrences go with it" (`CPV:1184-1189`). Drag doesn't.
10. **Overlapping events can be unreachable.** "+N" can't be clicked (`GRID:974-993`). Live.
11. **Week start and working hours are fixed and scattered.** The pref exists but has no screen. Home and DateField hard-code Monday. Tasks v3 Assumption #17 plans one Time & region setting.
12. **Booking links double-book by default.** Busy = Moduo only (`BL:90`). Other links' bookings, task blocks and secondary Google calendars don't count unless mirrored and ticked. Recurring Moduo events count once.
13. **Success shown when it isn't:**
    - "Couldn't save on Google" after Google saved it (`CPV:506-508`).
    - Booking cancel reports `{ok}` even when the Google, Zoom or Moduo steps failed (`BP:517-538`).
    - The guest page blames "your connection" for a server error (live).
    - The Calendar Tasks panel shows "Nothing to schedule" while loading (live).
14. **Native events don't update live.** Tasks blocks do since TV-D5, because Calendar mounts `useTasksModule` with its Realtime listener (`use-tasks-module.ts:278-290`). Events have no Realtime and no refetch on focus. They reload only after an external sync actually changed rows (`SYNC:149`). With no syncable account the sync returns early (`SYNC:61`); on web an Outlook/CalDAV/ICS account is skipped (`SYNC:30`). So a teammate's new event appears only when you leave and come back.

15. **Duplicates.**
    - A booking saved before the host had a matching Google account row is stored as a native event; the next sync mirrors the same Google event again (`BP:311-333` returns null).
    - A desktop row `google:{email}` and web rows `google:{email}:{calId}` can exist side by side, and the web only skips one direction (`google-web.ts:116-121`), so the same Google events may be mirrored twice. Not verified live.
    - Each co-host gets a copy of a booked event that a guest's cancel never removes (`PERM:1646-1663`, `BP:527-533`).

Checked and **not** a bug: deleting a native event asks first. View-only members can't draw (`GRID:426`, `GRID:549`).

---

## 4. Tasks v3 and Calendar

### 4a. Already on this branch

| Block | What changed inside Calendar | Evidence |
|---|---|---|
| SH-1 | The old `RightPanelSwitcher` is gone. Calendar's views (Detail, Notes, Tasks) are registered in `src/lib/panel-registry.ts` via `panel-views.ts`, with the "Detail ▾" title dropdown and ⌥1–3. | `5cf07205`; `panel-views.ts:9-13`; `CPV:882-978`, `CPV:1036-1041` |
| SH-1 | Calendar's capture type registered as the provisional one-line event (⌘4 inside ⌘⇧K). | `77879029`, `9ce032c9`; `capture-type.tsx` |
| TV-D3 | "Took longer" writes one time adjustment with an exact Undo (`logTimeAdjustment` / `undoTimeAdjustment`). Still the planned length. | `cb054a70`; `CPV:771-794` |
| TV-D4 | The panel's first group is my personal queue, in order (`queuedTasks`). The Home Tasks widget shows the queue. | `5d978a9b`; `panel.ts:43-61` |
| TV-P0 | Panel and Review rows wrap instead of truncating. The Review row uses the shared `formatDay/Time/Duration`. The Focus engine's time saver moved to the app shell. Calendar's block focus is **not** on it. | `f830d4d7`; `TPNL:169-195`, `TPNL:268-277` |
| TV-P0 (minors) | Remove's Undo goes through `patchTask`, which now logs a reschedule. | `086836ea`; `CPV:796-812` |
| TV-D5 | Calendar's task blocks now update live from teammates' changes (Realtime in `useTasksModule`). Events do not. | `use-tasks-module.ts:278-290` |

### 4b. Not built yet, and what each will change in Calendar

| Block | What it will change here | Source |
|---|---|---|
| TV-D10 | `task_sessions`: several blocks per task. `scheduled_at`/`duration_minutes` become a mirror of the next session until D7. The lens (`lens.ts`), strip, gap-finder, roll-forward, block drag (`CPV:530-538`, `CPV:567-604`) and MCP block tools all key on `scheduled_at` today and must move to sessions. Sessions count as busy for booking links, with a per-link switch. | tasks-v3 Assumption #4, block 10, §18 |
| TV-D11a | One shared task store. Calendar stops mounting its own `useTasksModule` full load (`calendar-page.tsx:37-41`) and so does the Today widget. | block 11 |
| TV-F6 | One time engine app-wide. Calendar block focus (`UBF`) and the Home pomodoro move onto `features/focus/engine`. ▶ on a block = "Focus on this". "Took longer" becomes an adjustment, never the planned length. AC7.3: the lens reads due dates as all-day chips and sessions as blocks. | Assumption #11, block 22, §18 |
| TV-D12 | Future repeat occurrences as faint ghosts on the Calendar. Reminders (pg_cron, OS and browser push, bell). Live: the daily task showed only today; nothing for tomorrow. | §2, block 27 |
| TV-D14 | Settings → General → Time & region (zone, week start, 12/24 h, date order). "The Calendar's own week-start pref migrates to it." One `formatDate/Time/Duration` in `src/lib/time-format.ts`; Calendar today uses its own `ui/time-format.ts`. | Assumption #17, block 29 |
| RF-1 | References: an **event** chip/card shows title · time · people. Calendar has no "people" data for events today (attendees aren't mirrored, §2). Deleted and private items read "Deleted …" / "Private item". Busy blocks will need a rule. | §11, block 18 |
| DS-6 | The north-star kit (Row, GroupHeader, Chip, DateField, EmptyState, Avatar…). Calendar's panel rows, popovers, native `datetime-local` and `time` inputs and raw checkbox (`TPNL:189`) are on the fix list's patterns. | block 8 |
| TV-H1 | Home widgets read the shared store and task time. The Today widget's teammates'-tasks count and 4-row cap are in scope only if Calendar claims them. | block 32 |

Contracts Tasks v3 hands Calendar (§18):
- My due-only tasks as all-day chips (the Month view is Calendar's own work).
- My sessions as blocks.
- Ghosts for future repeats.
- Drag from the Calendar's Tasks list to schedule.
- ▶ = Focus on this.
- "Took longer" is an adjustment.
- One clock.
- Teammates' unassigned tasks stay out.

Every one of these is unmet today; §3 has the evidence.

---

## 5. Live look (it worked)

**Setup:**
- Local stack at 127.0.0.1:54321; `.env.local` points at it (checked with `bun scripts/local/env.ts which`, values not read).
- Web app on port 8092, signed in with the seed user from `supabase/seed.sql` and the teammate from `tests/support/local-stack.ts`, by session injection.
- A fresh workspace "Calendar replan research", 1440×900.
- Not seen live: the public `/book` page. Locally `booking-public` fails to boot because it imports app files from `src/features/calendar/booking/*` (`BP:41-53`), which the local edge container doesn't mount (it is serving another worktree's path). The guest page said "We couldn't load the open times. Check your connection".

**What it looks and feels like:**
- **Shell:** three panes, quiet dark theme.
  - Left rail: mini-month, a "Calendars" heading (Moduo + accounts + "Connect calendar…"), then a **second** "Calendars" heading with checkboxes, Share buttons, "New calendar · Add" and "Save this set · Save" inputs, then "Booking links". The two same-named blocks read as a duplicate.
  - Toolbar: ‹ › Today, range label, "synced N min ago" + refresh, Day | Week.
  - Above the grid: the strip "· 6 unfinished from earlier · Move to today · Review".
- **Grid:**
  - Events are filled grey chips with title and time. The mirrored Outlook-shaped event is a blue outlined chip.
  - Task blocks are an outlined circle plus title on a thin line; elapsed ones of ≥55 min show "Later · Longer · Remove" under them.
  - Done blocks strike through. The now-line is a white line with a dot.
  - Four overlapping events: three columns plus a tiny "+1" that does nothing.
  - An event crossing midnight shows only its part in each day.
- **Popovers:**
  - Event: title, "Sat, Oct 10 · 1:00 PM – 2:00 PM", "Moduo", Open · Delete. No join, people or description.
  - Task block: checkbox + title, "Sat, Oct 10 · 9:00 AM – 10:00 AM · 60m", Start focus, Later today · Took longer, Remove, Open.
  - Start focus gives a dashed block outline with a ticking "00:14". Nothing in the top bar.
- **Quick create:** a ghost with an inline "Event title" field and a popover (two `time` inputs in 24 h, an All day toggle, a greyed "Moduo" calendar select, "Doesn't repeat", the hint "Enter saves · Esc discards"). Clicking inside it lost the draft (§3 #3). Typing + Enter saved.
- **Event Detail:** stacked fields (Starts/Ends as browser date-time boxes), Repeats, Notes, "Nothing linked yet", Activity "You calendar.event_create", Delete event.
- **Review:** right panel "UNFINISHED FROM EARLIER (6)", every row pre-ticked including two of Tess's, "Move 6 to today". At 20:47, after the 08–18 hours, nothing fits. The code's message is "No room left today." (`roll-forward.ts:78`); no toast was visible when I looked.
- **Booking dialog:** a large two-column modal.
  - Left: Event, Video, Guest form. Right: Weekly hours ("Europe/Warsaw", toggles + 09:00–17:00), Limits, Busy calendars (Moduo ticked, the Outlook-shaped account unticked).
  - A banner: "Connect Google so this link can create a Meet while the app is closed."
  - Saved without Google; the list shows "Research booking link · Copy".
- **Settings → Integrations (web):** "Google Calendar is a two-way copy…". Google: Connect account. Outlook: "Desktop only", with the seeded account listed and Disconnect. CalDAV & ICS: "Desktop only". Email below.
- **As the teammate:** my events, my all-day event and my mirrored event all appear as "Busy". The all-day one is a full-height block. The recurring standup appeared once, not on every weekday. "Busy" popover: "External calendar · read-only · Open". Open shows a broken Detail ("Couldn't load links").
- **Home:** Today widget "6 unfinished from earlier · Move to today", then two rows. Tasks widget "OPEN 11" including Tess's task. Large empty space in the Today card.
- **Load:** the calendar takes ~3 s to settle after navigation. Grid skeletons first, and the Tasks panel says "Nothing to schedule" until tasks arrive.

---

## 6. Ranked lists

### Top 15 limitations

1. No notion of "mine": teammates' tasks on the grid, the strip and Move to today (`lens.ts:114-142`, `strip.ts:36-57`).
2. Mirrored events outside −30/+120 days are deleted every sync (`SYNC:100-106`, `window.ts:16-17`).
3. Sync runs only in an open Calendar page; no server sync; web syncs Google only (`SYNC:158-172`, `RTW:2035-2039`).
4. Write-back is create-only, and Google only (`CPV:479-512`, `PERM0:436-439`).
5. No attendees, organiser, RSVP or invites on events (`FIX:163-199`, `mirror.ts:88-124`).
6. Native repeats edit as a whole series only; no exceptions; the server never expands them (`CPV:514-526`, `BP:252-273`, `PERM:1261-1274`).
7. Due-only tasks, sessions and repeat ghosts don't exist on the grid (`lens.ts:121`).
8. Only Day and Week; no Month, agenda or people view (`lens.ts` `CalendarView`).
9. Settings for working hours, week start and weekends don't exist (`prefs.ts:126-145`; no caller).
10. No per-event or per-calendar time zone (`mirror.ts:24-29`).
11. Custom calendars and sets can't hold or filter events (`CALS`; `perm_sharing_followups.sql:86-103`).
12. Booking: Moduo-only default busy, one window per day, no reschedule, no host view of bookings, collective off (`BL:90`, `BLD:61`, `BLD:498`).
13. Outlook, CalDAV and ICS are desktop-only and read-only; Zoom isn't in Settings (`INT`).
14. Events and blocks can't be reached by keyboard (`GRID:889-972`).
15. Calendar block focus is page-bound and separate from the Focus engine and top-bar timer (`UBF`, `CPV:718`).

### Top 10 code smells

1. **Two calendar models.** `calendar_accounts` (rail) and `calendars` + `calendar_ref` (sharing), plus `calendar_id` text. Three ways to say "which calendar" (`PERM:318-339`, `CALS`, `RAIL`).
2. **`calendar-page-view.tsx` is 1,217 lines** and owns sync, connect returns, deep links, the drag contract, keyboard, the loop, focus, three panel views and five dialogs (`CPV`).
3. **Permission lanes disagree.** Event capture and the grid's edit rights follow **Tasks** (`capture-command.ts:35`, `CPV:148`, `CPV:1076`); the server checks **Calendar** (`calendar_module_permission`). The page gate checks Calendar (`calendar-page.tsx:43-50`).
4. **Bypasses the runtime layer.** `CALS` and `UCM:164` call `supabaseClient` directly; `BL` writes `exposed_slot_links` straight from the component (`BL:306-417`).
5. **Errors swallowed and success claimed:** `CALS:120`, `CALS:133`, `CPV:506-508`, booking cancel (`BP:517-538`) and confirm (`BP:770-784`), the mirror op's `ok` stamp (`FIX:224-226`), the dropped `skipped` count (`RTW:2026-2029`).
6. **Deletion diff against the loaded list**, not the sync window (`SYNC:100-106`).
7. **Its own time formatting** (`ui/time-format.ts`) beside `src/lib/time-format.ts`; durations as raw "60m" (`task-popover.tsx:81`).
8. **Edge function imports app code** (`BP:41-53`). Works on deploy, but the local stack can't boot it.
9. **Busy blocks are fake events** with `sourceAccountId: "busy"` and ids `busy:…` (`UCM:177-195`). Every surface treats them as an external event, hence the broken Detail.
10. **Dead or half-finished seams:**
    - The "+N" popover never built (`GRID:974`).
    - Prefs with no UI (`prefs.ts`).
    - `COLLECTIVE_LINKS_ENABLED` hides only part of the feature (`BL:430-464`).
    - `calendar_public_feed` / `publish_token` with no server or UI.
    - The Google sign-in refresh code is copied in two Edge Functions (`booking-public`, `calendar-google-web`).

---

## 7. Could not verify

- The public `/book` page, live: `booking-public` doesn't boot on the local stack (§5). §1e covers it from code (`BOOK`, `BP`).
- Desktop: the OAuth round-trips, the 1-hour token expiry, CalDAV, the Rust sync. Code only.
- Whether "Move to today" shows its "No room left today." toast (none was visible to the page reader).
- Whether the keyboard check-off bug in the Tasks panel (`TPNL:249-256`) fires in a real browser. Code unchanged since PRIOR.
- TX-5's live booking emails and bell (not on this branch).
- Click coordinates in the browser pane were sometimes off by a row. The two "lost draft" repros came from clicks inside the popover; the code path (`GRID:863` + `QC:164-182`) explains it independently.

---

## 8. Research data created (remove when done)

All on the **local** stack. Workspace **"Calendar replan research"**, id `806bef5f-6d0b-4f12-8b0a-07db6f7d3561`, owned by the seed dev user. Deleting this workspace's rows removes everything below.

| Table | Rows | Notes |
|---|---|---|
| `workspaces` | 1 | the workspace itself |
| `workspace_members` | 2 | dev (owner, added by trigger) + `teammate@moduo.local` (member) |
| `buckets` | 3 | dev Inbox `99195c7f-…`, teammate Inbox `56573f14-…`, "Research shared project" `41e3134c-5e94-4a45-9532-5cc395fc57e9` |
| `tasks` | 16 | 12 named "Research: …" / "Teammate: …", 4 named "Shared: …" |
| `task_time_entries` | 1 | 14 s focus on "Research: write the brief" (`eedd410c-…`) |
| `calendar_events` | 12 | 8 seeded ("Research: …", "Teammate: dentist"), 3 mirrored ("Mirrored: …"), 1 drawn live ("Research: created via New") |
| `calendar_accounts` | 1 | `cce53dc0-37ee-4177-93b2-9d2dbe3b8a22`, provider `microsoft`, "Research seed (Outlook-shaped)" |
| `calendars` | 3 | created by triggers (two Moduo calendars + one integration calendar) |
| `resource_grants` | 4 | default sharing grants from triggers |
| `exposed_slot_links` | 1 | "Research booking link", slug `research-booking-link-qlih`, id `320794f4-bbf4-4350-9af9-a3baf44c3485` |
| `module_activity` | 13 | op logs for the above |
| `entities` | 28 | registry rows for the above |

**Outside the workspace:**
- The e2e helper's teammate user `teammate@moduo.local` (id `17c405d5-ca87-4156-9d77-6e81c04262f1`). Either reused or created, password set to the helper's value, display name "Tess Mate", as `tests/support/local-stack.ts` does.
- Browser localStorage on `127.0.0.1:8092` was cleared of the injected sessions.
- The dev server (port 8092) and the session helper (port 8099) are stopped.
- Seed scripts lived only in the session scratchpad.
