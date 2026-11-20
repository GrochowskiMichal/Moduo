> Raw research report for the Calendar re-plan, 2026-11-21 (branch `t/maciej/calendar-plan`, read at `origin/maciej` = `e566e71ef`). It updates [current-state.md](./current-state.md) (2026-10-10). Nothing here is decided.

# Calendar now: what Mike's rethink landed, and what's still open

**How this was read.** Code at HEAD of `origin/maciej`, `git log` on the calendar paths since 2026-10-25, [specs/calendar-rethink.md](../../../specs/calendar-rethink.md) (CALR-1 … CALR-21b), [docs/decisions/calendar.md](../../../docs/decisions/calendar.md), `CHANGELOG.md`. Nothing was run and no database was touched.

**There is no ledger to check.** `specs/BUILD_ORDER.md` is only a pointer to the Moduo queue, so "landed" below means: the commit is on `origin/maciej`, the decision entry exists, and the code is there. Release status comes from `CHANGELOG.md`. Calendar work shipped in **1.5.0 (10-28), 1.6.0 (10-30), 1.7.0 and 1.7.1 (11-03)** (`CHANGELOG.md:19-99`). No calendar commit landed after 2026-11-03 (`433b7ba2d` is the last).

**Short names used below.**

| Short name | Path |
| --- | --- |
| `A/` | `apps/app/src/features/calendar/` |
| `DEC` | `docs/decisions/calendar.md` |
| `SPEC` | `specs/calendar-rethink.md` |
| `MCP` | `supabase/functions/moduo-mcp/modules/calendar.ts` |
| `CPV` | `A/ui/calendar-page-view.tsx` |
| `REG` | `apps/app/src/lib/hotkeys/registry.ts` |

**The spec is not the whole truth.** Two review rounds after the blocks reversed parts of what had landed:
- **10-30:** narrow-window folding, the Notes view, the draw-to-create popover, "See your week as", and the booking link shown as a panel item (`DEC:15`, `DEC:18`, `DEC:21`, `DEC:24`).
- **11-03:** the "banner for every failed sync" (`DEC:5`).

Section 1 notes each of these.

---

## 1. CALR blocks: what landed

| Block | Landed? | Commit | Notes |
| --- | --- | --- | --- |
| CALR-1 Grid foundations | ✅ | `4a53df1bc` | Wall-clock hours, cascades, overnight events, house chip (`DEC:77`) |
| CALR-2 Headers, all-day lane, now-and-next | ✅ | `e5cfea79c` | Due-only tasks left the all-day lane and became an "N due" count in the day header (`DEC:60`). See §5 |
| CALR-3 Faults, loading, empty | ✅, then changed | `0c7822735` | 11-03: failed syncs stay quiet for 6 h; the banner now shows only for Reconnect or "didn't load" (`DEC:5`) |
| CALR-4 Keyboard and undo | ✅ | `a8ee7f87a` | One undo stack, grid cursor, ⌘←/⌘→ (`DEC:53`) |
| CALR-4b Event menus | ✅ | `8d0e97b13` | Right-click, ⌃↵ and the panel's ⋯ menu (`DEC:36`) |
| CALR-4c Move any event to another calendar | ❌ open | — | Move works only for a plain one-off Moduo event going to your Google (`A/event-menu.ts:99-131`) |
| CALR-5 Plan and placing tasks | ✅ | `c6c88a560` | "Tasks" view renamed **Plan**; S lifts and places (`DEC:47`) |
| CALR-6 Event data v2 | ✅ | `95ca33614` | New columns in `supabase/migrations/20261027230000_calendar_event_data_v2.sql:23-38` |
| CALR-7 Live events | ✅ | `a5a6d20a6` | Realtime on `calendar_events` (`DEC:71`) |
| CALR-8 Google two-way | ✅ | `eaa785713` | Google is written first, then mirrored back; a refusal rolls the change back (`DEC:68`) |
| CALR-8b Offline outbox | ❌ open | — | `A/ui/offline-line.tsx:5` says the outbox is "a later block". Nothing passes `waiting` (`A/ui/now-next.tsx:145,151`) |
| CALR-9 Composer | ✅, then changed | `b1d4631ee` | 10-30: a click or drag now opens the composer; the quick popover is gone (`DEC:18`) |
| CALR-9b Task prefix, Zoom links, custom `#calendar` | ❌ open | — | Composer kinds are only `event` and `focus` (`A/composer/parse.ts:37`). "Zoom and Teams … links aren't made here yet" (`A/composer/defaults.ts:12`). `#calendar` lists Your calendar and Google only (`A/ui/calendar-composer.tsx:184-191`) |
| CALR-10 Event view | ✅, then changed | `579bb4fea` | 10-30: Notes view removed; links now show as "Linked N" inside Detail (`DEC:15`) |
| CALR-11 One occurrence | ✅ | `421db0e3b`, `b866bccf7` | This event / All events (`DEC:57`) |
| CALR-11b Move a whole Google repeat | ❌ open | — | "A Google series doesn't move in time from here yet" (`A/occurrence-edit.ts:44-55`). `calendar-google-web` has no series action (`supabase/functions/calendar-google-web/index.ts:422-425`) |
| CALR-12 Month and Day prep | ✅ | `1b243cd10` | (`DEC:51`) |
| CALR-13 Narrow windows, zones, working hours | ✅, folding reversed | `4f3258409` | Folding was removed 10-30 (`DEC:15`). Second zone (Z) and the Working hours sheet stay |
| CALR-13b Booking links on your working hours | ❌ open | — | `grep -i 'user_preferences\|working'` over `supabase/functions/booking-public/*.ts` and `supabase/functions/_shared/booking*` finds nothing |
| CALR-14 Focus time | ✅ | `12924703f` | `kind='focus'` items (`DEC:43`) |
| CALR-14b Focus time in Plan | ❌ open | — | No focus-time grouping: `grep -i focus` finds nothing in `A/panel.ts`, and only keyboard-focus code in `A/ui/calendar-tasks-panel.tsx` |
| CALR-15 Sharing and private | ✅ | `fc6673716` | Masked read; P makes an event private (`DEC:62`) |
| CALR-15b Share your calendar sheet | ❌ open | — | Sharing is the generic ShareMenu per calendar, with Busy only / Can view / Can edit (`A/ui/calendar-rail.tsx:84-88,221-238`), not the sheet in the spec |
| CALR-16 Preview and teammates | ✅, then changed | `456de3624` | 10-30: Preview became the glasses toggle only (`DEC:18`) |
| CALR-16b Teammates land on their calendars | ❌ open | — | "Teammates stay on Your calendar (CALR-16 puts them on theirs)" (`A/composer/defaults.ts:13-14`) |
| CALR-17 Booking links in the panel | ✅, then changed | `d8868fb2b` | 10-30: a rail click opens the editor, not a panel item (`DEC:21`). Co-hosts are still switched off (see 6) |
| CALR-18 Guest page details step | ✅ | `8a20f88bf` | |
| CALR-19 Offers with holds | ✅ | `7a8581c51` | (`DEC:30`) |
| CALR-20 Accounts, connect, reconnect | ✅ | `a8a36d14d` + `944f0fc96` | (`DEC:49`) |
| CALR-20b New events go to | ✅ | `8d2041347` | One row per Google event; iCalUID merge (`DEC:32`) |
| CALR-21 MCP, Today widget, the bar | ✅ (not the bar) | `3f4f413dc` | Its jury scored **6.35 vs 7.50** (`SPEC:284`) |
| CALR-21b Clear the bar | ◐ unclear | — | No re-run of the jury recorded (searched commits and `DEC` for "jury"). The Notes-panel severity-3 is gone with the Notes view (`DEC:15`). Whether the cold-load black frame is fixed is not verified: `module-cache.ts` covers coming back to Calendar, not the first load (`DEC:5`) |

**After the blocks:**
- review round 2 (`e4a7933d8`, `81868a9c9`, 10-30);
- one Calendars section in the rail with a color picker (`5c9c13181`);
- booking-link editor, video gating and rail menu (`8be985416`, `e0c3a5465`);
- the event's Activity is its history only (`48d716b6a`, `b53bb8006`);
- **Outlook connects on the web, view only** (`692e8df72`, `DEC:9`);
- desktop token refresh and quiet sync (`28984d42e`);
- rename and delete for your own calendars (`14af9ffeb`, migration `20261103180000`).

**Migrations since 10-25:** 15 `*calendar*` / `*booking*` / integration migrations, from `20261027230000_calendar_event_data_v2.sql` to `20261103180000_calendar_custom_rename_remove.sql`.

**Open or partial:** 4c, 8b, 9b, 11b, 13b, 14b, 15b, 16b, and 21b (unclear).

---

## 2. Capability matrix: now vs 2026-10-10

| Area | 2026-10-10 | Now | Evidence |
| --- | --- | --- | --- |
| **Views** | Day, Week | Day, Week, **Month**. **No List view** | `A/lens.ts:16` (`"day" \| "week" \| "month"`) |
| **Moduo events** | Create/edit/delete, owner only | Same, plus a custom calendar, place, people, link, private, kind | `DEC:74` |
| **Google** | Create only | **Create, edit, move, delete**, written to Google first. Delete asks to confirm and has no Undo. Moving a whole Google repeat in time: not yet | `DEC:68`, `DEC:53`, `A/occurrence-edit.ts:44-55` |
| **Outlook** | Desktop, view only | **Web and desktop, view only** | `DEC:9`; tile "View only, for now" (`A/ui/calendar-connect-steps.tsx:16`) |
| **iCloud / CalDAV, ICS** | Desktop, view only | Unchanged; the web says "In the Moduo app" | `A/ui/calendar-connect-steps.tsx:17-18,41-43`; `A/hooks/use-calendar-sync.ts:3-4` |
| **Guests** | None | **Outside guests by email from the composer → Google invites them.** People and replies show read-only in Detail: rows with name, email and reply mark, and no add or edit control. Teammates are named but not invited | `A/composer/defaults.ts:5-14`; `A/ui/event-detail-panel.tsx:307`; `A/ui/event-view-rows.tsx:459-477` |
| **RSVP** | None | **Not in Calendar.** Mail's invite card has Accept / Maybe / Decline and "Add to Moduo calendar" (desktop mail engine) | `apps/app/src/features/email/reader/invite-card.tsx:2-3,21-23,76-78` |
| **Alerts before events** | None | **None.** Reminders exist only for tasks (`task_reminders`) and for booking guests (TX-6) | `grep -ril reminder A/` → booking files only; `supabase/migrations/20261010181000_task_sessions_reminders_waiting.sql:84` |
| **Repeats** | Whole series only | This event / All events for Moduo repeats (override rows + exdates), and for Google repeats except moving the whole series in time. **No "this and following". No end date or count** (no `until`/`count` in `A/recurrence-nl.ts`). Calendar keeps its own picker | `DEC:57`; `A/ui/repeat-picker.tsx:1-4` |
| **Time zones** | None | Second zone column (Z, set per device); clock-change notes; week start from Time & region. **No time zone per event.** The server expands repeats in the **owner's** Time & region zone | `A/zones.ts:1-7`; `A/hooks/use-calendar-prefs.ts:65-67`; `supabase/migrations/20261029180000_booking_host_events.sql:27` |
| **Search** | None | **None inside Calendar.** `A/search.ts` only handles `?event=` deep links, and Calendar registers no module search (`grep -rn requestModuleSearch\|onModuleSearch A/` finds nothing), so the bottom bar's Search opens the global palette. Events reach global search through the registry | `A/search.ts:1-6`; `apps/app/src/components/app/global-bottom-bar.tsx:157` |
| **Booking links** | One length, Meet/Zoom/their choice, collective off | Same video choices, now gated on the login; editor in place; open times drawn on the week. **Offers with 48 h holds** (O). Every occurrence of a repeat counts as busy. Work sessions busy by default, focus time free by default. **Collective still off.** No reschedule (only a "rebook" link after a cancel). One length per link | `DEC:21`, `DEC:30`, `DEC:34`; `A/booking/model.ts:69-75`; `A/ui/booking-link-dialog.tsx:55-60`; `supabase/functions/booking-public/index.ts:627-628` |
| **Sharing and private** | Per-calendar grants, Busy only by default | Same grants; **private (P)** masks to "Busy" for everyone; Preview as (glasses). No dedicated Share sheet | `DEC:62`, `DEC:18`; `A/ui/calendar-rail.tsx:221-238` |
| **Teammates** | Every shared calendar's Busy shown at once, anonymous | **"Workspace members"** in the rail; lanes opt-in per person; busy blocks name their owner and expand repeats; teammates named in the composer show their busy time and ⇥ finds a common free slot | `DEC:38`; `A/ui/calendar-rail.tsx:480` |
| **Focus time** | Block focus (page clock) | **Focus time is now a calendar item** (`kind='focus'`): teammates see "Focus time"; free for booking links unless the link ticks it. ▶ on a task block runs the one Focus engine (TV-F6) | `DEC:43`; `A/ui/use-calendar-focus.ts:1-3,63` |
| **Task sessions vs `scheduled_at`** | Block = task row | The grid draws **my own `task_sessions`** (falls back to the task row when a task has none) and moves a session by `updateSession`. **Placing a task (S, drag from Plan, Schedule due) still writes `scheduled_at`**, which the D10 trigger turns into an edit of the shown session or a new first one. So Calendar can't add a second session. Its only `addSession` call is the Undo of Remove (`A/ui/use-calendar-completion-loop.ts:200`). Tasks and MCP can add sessions (`tasks_work_session_add`) | `A/lens.ts:131-190`; `A/ui/use-calendar-task-drag.ts:97-122`; `A/commands/undo.ts:149-162`; `supabase/migrations/20261010181000_task_sessions_reminders_waiting.sql:6-16` |
| **Due-only tasks** | Never shown | **An "N due" count in the day header** that opens the day's list (not all-day chips) | `DEC:60`; `A/lens.ts:201-245`; `CPV:215-218` |
| **Repeat ghosts** | None | **None** | `grep -rn ghost A/` finds only the draw ghost and the placement ghost (`A/ui/calendar-grid.tsx:1008`, `A/ui/placement-layer.tsx:88`) |
| **Sync** | Page-open; −30/+120 days; tombstones outside | **Still page-open** (mount, wake, every 15 min, plus quiet retries at 1/3/10 min). **No server sync** (no cron or `calendar-sync` function). Desktop tokens now refresh. **The −30/+120-day tombstoning is still there** | `A/hooks/use-calendar-sync.ts:5,16,23,118-123`; `A/sync.ts:88-91`; `.claude/rules/calendar.md:13` |
| **Realtime** | Tasks only | **Events live** (CALR-7). Hard deletes reach open apps only on a resync | `DEC:71` |
| **Offline outbox** | None | **None.** The "Offline" line exists; "N to sync" is never fed | `A/ui/offline-line.tsx:5`; `A/ui/now-next.tsx:145,151` |
| **MCP tools** | 8 | **12:** `calendar_list_events`, `_day`, `_create_event`, `_update_event`, `_delete_event`, **`_offer_times`, `_release_offer`, `_who_sees`**, `_schedule_task`, `_move_block`, `_complete_block`, `_roll_forward`. Reads go through the masked read and give one item per occurrence. Writes for a single occurrence are not exposed | `MCP:266-643`; `DEC:27` |
| **Home Today widget** | Strip + Move to today | Adds **now-and-next with Join** (⇧⌘J). **Still** has "N unfinished from earlier · Move to today", week start hard-coded to Monday, default working hours | `apps/app/src/features/dashboard/ui/widgets/calendar-today-widget.tsx:79,100-125,166-176` |
| **References** | No people | Event chip and card with when + "N people" | `apps/app/src/features/spine/references/resolvers.ts:228-266` |
| **Capture (⌘⇧K → Event)** | Provisional one-liner | **Unchanged and provisional**: it still uses the Tasks parser and is gated on the Tasks lane | `A/capture-type.tsx:1-4`; `apps/app/src/features/spine/capture-command.ts:39,163-177` |
| **Mail ↔ Calendar** | — | Mail's Today panel shows today's events (`ae5ba88b1`, 11-04) | commit |

---

## 3. October's trust bugs and calls: where they stand

### 3a. REPLAN §1.3 trust bugs B1–B12

| # | Bug | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Teammates' tasks treated as yours | **Partly fixed.** The grid draws only your sessions; Plan and the due counts are yours only. But the strip and Review, the Home widget's count and Move to today, and the MCP roll-forward still take every open scheduled task you can see | `A/lens.ts:150`; `A/panel.ts:27-28`; `A/strip.ts:41-58` (no owner check); `CPV:718-724`; `calendar-today-widget.tsx:104`; `MCP:643-700` |
| B2 | Past meetings disappear (−30/+120 days) | **Open.** The code comment names it | `A/hooks/use-calendar-sync.ts:118-123`; `A/sync.ts:88-91` |
| B3 | Click inside the new-event popover loses the draft | **Fixed by removal.** The popover is gone; the composer keeps its text | `DEC:18` |
| B4 | "Synced just now" can be untrue | **Partly fixed.** Per-account stale marks after 6 h, Reconnect on revoke, desktop token refresh, Outlook on the web. The toolbar still shows the freshest account, in relative words ("synced 3 min ago"). CalDAV and ICS still skip the web | `DEC:5`; `A/accounts.ts:248-268` |
| B5 | Teammates and booking see repeats as free | **Fixed.** Busy blocks and booking expand every occurrence on the server | `DEC:38`; `3740b2571` |
| B6 | "Took longer" logs the planned length | **Open** | `A/triage.ts:14-21`; `A/ui/use-calendar-completion-loop.ts:163-169` |
| B7 | Two clocks | **Fixed.** ▶ uses the Focus engine; `use-block-focus` is gone | `A/ui/use-calendar-focus.ts:1-3` |
| B8 | Dragging one occurrence moves the series | **Fixed** (asks This event / All events) | `DEC:57`; `A/occurrence-edit.ts:48-55` |
| B9 | "+N" overlaps unreachable | **Fixed.** "+N" opens a list | `A/ui/grid-cards.tsx:117-160` |
| B10 | "Couldn't save on Google" after Google saved; cancel claims success | **Mostly fixed.** Google create uses our own event id and checks Google before falling back (`A/new-event-create.ts:105-160`). Booking cancel now reports the Google drop honestly, but still answers `ok` when the Zoom or release step fails | `supabase/functions/booking-public/index.ts:586-640` |
| B11 | Teammates' new events appear only on return | **Fixed** (realtime) | `DEC:71` |
| B12 | The same Google event mirrored twice | **Fixed for your own logins** (one row per event, iCalUID merge, revive before insert). A Moduo invite that also arrives in your Google stays as two rows | `DEC:32`; `SPEC:231` |

### 3b. Calls C1–C21

**Key:** "as recommended" means it matches October's recommendation; "differently" means built another way (also listed in §5); "not addressed" means nothing in code.

| Call | Status | One line, with evidence |
| --- | --- | --- |
| ★C1 The ceiling | **Partly; differently** | The line Mike drew: Google two-way; Microsoft, iCloud and .ics view only (`SPEC:15`). Alerts, List, search, "this and following" and repeat end dates are not built |
| ★C2 The shape | **Differently** | Left: mini-month, one Calendars section, views, Workspace members, booking links (`DEC:24`). Right: Detail + **Plan** (`A/panel-views.ts:9-13`). No Search/Display/List in the toolbar, no "missed" line. Panels stay as you left them (no folding) |
| ★C3 Missed sessions | **Not addressed; old system kept** | The 7-day strip, Review, Move to today and the in-grid Later · Longer · Remove are all still mounted (`CPV:718-724`; `A/ui/task-block-chip.tsx:8,144`) |
| C4 One name per concept | **Differently** | UI and MCP say "block" (`calendar_move_block`, "Task placed", `task-block-chip`); toasts say "Session moved"; "Plan" replaces "Tasks"; "unfinished from earlier" and roll-forward stay |
| C5 Views | **Partly** | Month ✅; List ✗; no Display menu (Show weekends is in Working hours) |
| ★C6 Connected calendars | **Partly** | Google writable ✅; "New events go to" ✅ (`DEC:32`); honest per-account sync state ✅. Outlook and iCloud writable ✗; server sync ✗; past meetings kept ✗ |
| C7 Guests and invitations | **Partly** | Outside guests through Google ✅; guests' replies show ✅. Answering an invitation in Calendar ✗ (Mail only); Moduo-calendar email invitations ✗; teammates on their own calendars ✗ (16b); guests → contacts ✗ |
| C8 Teammates and Find a time | **As recommended (mostly)** | Opt-in per person, owner named, repeats expanded; "Find a time" is ⇥ in the composer. Teammates' sessions as Busy: not checked in SQL |
| C9 Booking links | **Partly** | Left panel ✅; open times on the grid ✅; sessions busy by default ✅; booking on your default calendar (Google only). Collective ✗ |
| C10 Creating | **Differently** | Click or drag → composer (no Event · Session toggle in a popover); N / ⌥N; capture still provisional; S/F place a task or focus time |
| C11 Fit into today | **Not addressed** | The old Move to today stays (`CPV:722`; `calendar-today-widget.tsx:100-125`); S places one task at a time (`A/place-task.ts:1-4`). `grep -rn -i "fit into\|fit [0-9]" A/` finds no Fit gesture |
| C12 Cues at a meeting | **Not addressed** | `grep -i "next meeting with" A/` finds nothing |
| C13 Alerts | **Not addressed** | No event reminders (§2) |
| C14 Time zones | **Partly** | Second zone ✅; week start from Time & region ✅. Per-event zone ✗ |
| C15 Home widgets | **Partly** | Today gained now-and-next + Join; strip and Move to today remain |
| C16 Your plan outside Moduo | **Not addressed** | Google writes come only from event create, edit and delete (`supabase/functions/calendar-google-web/index.ts:422-425`, actions `events/push/get/update/delete`). Nothing pushes sessions as Busy |
| C17 One repeat picker with Tasks | **Not addressed** | Calendar's own picker (`A/ui/repeat-picker.tsx:1-4`); no "this and following" (`grep -rn following A/` finds nothing); no end date (no `until`/`count` in `A/recurrence-nl.ts`) |
| C18 Projects, birthdays, holidays | **Not addressed** | `grep -rl -i birthday A/` finds nothing; holidays come only as Google's own read-only calendars (`DEC:49`, `read_only`) |
| C19 Booking for client work | **Partly** | Guest reminders and host cancel (TX-6) ✅ (`A/ui/booking-link-dialog.tsx:62`); offers with holds ✅. Reschedule ✗ (`grep -i reschedul supabase/functions/booking-public/` finds nothing); several lengths ✗ (no lengths array in `A/booking/model.ts`); no-show ✗ (`grep -i no.show A/` finds nothing) |
| C20 Meeting → tracked time | **Not addressed** | `logTime` appears only in the old block loop (`A/ui/use-calendar-completion-loop.ts:169`), never in the event panel |
| C21 Quiet hours | **Still open, not addressed** | Calendar sends no alerts of its own to hold (§2 Alerts) |

---

## 4. Keyboard map and panels as built

**Keys** (scope `calendar`, single keys silent in fields; `REG:172-222`):

| Keys | Action |
| --- | --- |
| T · D · W · M | Today · Day · Week · Month |
| ⌘← / ⌘→ | Previous / next period |
| ← → ↑ ↓ | 30-minute grid cursor |
| J / K | Next / previous event |
| Space | Open the card |
| ↵ | Open, or a new event at the cursor |
| ⌃↵ | Event menu |
| N (web also ⌥N) | New event (composer) |
| ⌥↑ / ⌥↓ | 15 min earlier / later |
| ⌥← / ⌥→ | A day earlier / later |
| ⌥⇧↑ / ⌥⇧↓ | Shorter / longer |
| ⌘C · ⌘V · ⌘D | Copy · paste · duplicate the event |
| ⌘Z | Undo |
| ⌫ / Delete | Delete the event |
| V | Add a Meet link |
| L | Link a person, note or task |
| P | Private / public |
| ⇧⌘J | Join the meeting on now |
| Z | Second time zone |
| ⇧A | Every all-day row |
| S | Place the selected Plan task |
| / | Find a task |
| O | Offer specific times |
| ⌥3 | Open Plan while the right panel is closed |
| ? | Keys sheet (reads the registry, `DEC:53`) |

**Gesture keys** (window listeners, not in the registry):
- **Composer:** ⇥ / ⇧⇥ next / previous free time, ↵ add, esc cancel.
- **Lifted task:** ⇥ hop, ↑↓ 15 min, ←→ a day, **F** turns it into focus time, ↵ place, esc let go (`DEC:47`, `DEC:43`).
- **Offer:** ↵ ⇥ ←→ ⌫ ⌘C ⇧⌘C esc (`REG:216`).

**Panels** (`CPV:652-705`):
- **Left (`CalendarRail`):**
  - mini-month;
  - one **Calendars** section: Your calendar and the ones you made, each connected login's calendars; the swatch shows and hides; share is a hover icon; ⋯ has Working hours, Rename/Delete and Share; saved **views** as chips;
  - **Workspace members**, each with a lane toggle and the Preview glasses;
  - **Booking links** as the footer, with a ⋯ / right-click menu.
  - Evidence: `A/ui/calendar-rail.tsx:344,385,480`; `DEC:24`.
- **Centre:**
  - toolbar: ‹ › (⌘←/⌘→) · Today · range · now-and-next or Offline · "synced N ago" + refresh · Day/Week/Month (`A/ui/calendar-toolbar.tsx:51-95`);
  - fault banner, then **the old strip** ("N unfinished from earlier · Move to today · Review"), then the views (`CPV:717-726`).
- **Right (`RightPanel`, title dropdown):** **Detail** and **Plan** (`A/panel-views.ts:9-13`), plus pushed items: the O offer card and the booking-link view (`CPV:685-693`).
- **Bottom bar:** the global one only (Search · Quick capture · Create new, `apps/app/src/components/app/global-bottom-bar.tsx:154-171`). Calendar adds no tools and no multi-select mode row.

---

## 5. Where Mike's spec differs from the October re-plan or Tasks v3

Stated neutrally. "Re-plan" means `.design/calendar-v2/REPLAN.md`; "Tasks" means `specs/tasks-v3.md`.

1. **Block vs session.**
   - Re-plan C4: "Session… never 'block'".
   - Built: "task block" in UI code, `calendar_move_block` / `calendar_complete_block` in MCP (`MCP:601,623`), "Session moved" in a toast (`A/ui/use-calendar-task-drag.ts:107`).
2. **Plan vs Tasks / Up next.**
   - Re-plan C2: a "Tasks" view grouped Up next · Due this week · No date.
   - Built (decided by Mike, `SPEC:15`): **Plan**, grouped From earlier · Due this week · Scheduled · No date. There is no Up next (Focus line-up) group (`A/panel.ts:1-4`).
3. **Focus time vs Focus.**
   - Re-plan C1 put "focus time that declines meetings" out.
   - Mike's spec adds "Focus time" as a calendar item (`kind='focus'`), busy to teammates and **free for booking links by default** (`SPEC:15`, `DEC:43`).
   - The word "Focus" now names both Tasks' Focus view and timer and this calendar item.
   - Booking treats sessions (busy by default) and focus time (free by default) differently (`A/booking/model.ts:69-75`).
4. **Missed sessions.**
   - Tasks §7/§18 and re-plan C3: a missed session stays put, shows in Upcoming's Earlier, one set of fixes.
   - Built: the CAL-4 strip and Review, Move to today (also on Home), and in-grid Later · Longer · Remove are kept (`CPV:718-724`, `calendar-today-widget.tsx:167-176`).
   - Plan's "From earlier" is about overdue **due dates**, a separate concept.
5. **Roll-forward MCP verb.**
   - Re-plan consistency #2: rename it, "nothing moves by itself".
   - Built: `calendar_roll_forward` is unchanged. It moves every visible open task from the last 7 days and keeps the clock time in UTC (`MCP:643-700`). `SPEC:244` says the existing tools "stay".
6. **Due-only tasks.**
   - Tasks §18: "your own due-only tasks as all-day chips".
   - CALR-2: a header count "N due" instead; due tasks never sit in the all-day lane (`SPEC:33`, `DEC:60`).
7. **Several sessions per task.**
   - Tasks §18: "your sessions as blocks" (several per task).
   - Re-plan §6 #1: Calendar writes sessions through Tasks' session ops, never `tasks.scheduled_at`.
   - Built: placing writes `scheduled_at` (`A/commands/undo.ts:149-162`); only moving an existing session uses the session op.
8. **"Took longer".**
   - Tasks §18: "an adjustment, never a planned length".
   - Built: it logs the planned length (`A/triage.ts:14-21`).
9. **Repeat ghosts.**
   - Tasks §18: future repeat occurrences as faint ghosts.
   - Built: not drawn.
10. **Sync model.**
    - Re-plan §6 #5 / C6: server sync per person.
    - Mike's spec keeps page-open sync, Google two-way only, and Outlook/iCloud/.ics view only (`SPEC:15`, `SPEC:295`).
11. **Reminders.**
    - Re-plan §6 #4: one reminders table for tasks and events.
    - Built: only `task_reminders`; Mike's spec has no alerts.
12. **Panels at narrow widths.**
    - Re-plan C2: fold the right panel below about 1200 px.
    - Mike's spec folded below 1600/1360, then dropped folding altogether (`DEC:15`).
13. **Creating.**
    - Re-plan C10: a draw popover with an Event · Session toggle, and an Event capture body.
    - Built: a typed composer from a click, drag or N; capture still the provisional line.
14. **Sharing levels.**
    - Spec words: Busy only / All details.
    - Built menu: Busy only / Can view / Can edit (`A/ui/calendar-rail.tsx:84-88`).
    - The re-plan's C2 "People" list is now "Workspace members" (`DEC:18`: "teammate" reads "workspace member").
15. **Week start.**
    - Matches Tasks 76: read from Time & region (`A/hooks/use-calendar-prefs.ts:65-67`).
    - The Home widget still hard-codes Monday (`calendar-today-widget.tsx:79`).

---

## 6. Gaps and loose ends visible in code

- **Collective links are off:** `COLLECTIVE_LINKS_ENABLED = false` (`A/ui/booking-link-dialog.tsx:55-60`). The panel already shows hosts and acceptance (`A/ui/booking-link-panel.tsx:130,245`).
- **The offline outbox is not built.** "Offline · N to sync" is never fed (`A/ui/offline-line.tsx:5`; `A/ui/now-next.tsx:145`).
- **Zoom and Teams links from the composer:** "paste its link into the event" (`A/composer/defaults.ts:99-101`).
- **Google repeats can't be moved in time as a series** (`A/occurrence-edit.ts:44-55`). Repeats of Google events are set in Google (`A/ui/event-detail-panel.tsx:283`).
- **Move to another calendar** is limited to plain one-off Moduo events going to your Google (`A/event-menu.ts:99-131`).
- **Outlook, iCloud/CalDAV and ICS are view only.** CalDAV and ICS are desktop only (`A/ui/calendar-connect-steps.tsx:15-18`).
- **Sync** still tombstones mirrored events outside −30/+120 days. A booked meeting moved past +120 days in Google can email its guests a cancellation (`.claude/rules/calendar.md:13`; `A/hooks/use-calendar-sync.ts:118-123`).
- **Account upsert can revive a just-removed account** in a narrow race (`docs/gotchas/calendar.md:14`).
- **The toolbar's sync label** is the freshest account, in relative words (`A/accounts.ts:248-268`). That's against re-plan consistency #11.
- **⌥n mismatch:** the right panel's views are now Detail and Plan, so the panel numbers Plan ⌥2. The page-level key that opens Plan when the panel is closed is ⌥3 (`A/panel-views.ts:9-13`; `REG:202-203`; `A/ui/use-calendar-plan-key.ts:1-3`).
- **The old CAL-4 loop is still live:**
  - `A/strip.ts` (no owner check), `A/triage.ts`, `A/roll-forward.ts`;
  - task popover "Start focus · Later today · Took longer · Remove" (`A/ui/task-popover.tsx:114-122`);
  - the Home widget uses default working hours (`calendar-today-widget.tsx:107-124`).
- **Capture's Event type is provisional,** gated on the Tasks lane (`apps/app/src/features/spine/capture-command.ts:27-39`).
- **Teammate busy items are still fake events** with `busy…` ids (`A/event-menu.ts:25`).
- **No List view, no search in Calendar, no event alerts, no RSVP inside Calendar, no per-event time zone, no "this and following", no repeat end date, no repeat ghosts.**
- **CALR-21b:** no recorded re-run of the jury against 7.50 (`SPEC:284`).
- **Private and focus masking on the live channel:** a known, documented limitation in `DEC:62`; see the decision entry rather than this file.

- **`specs/calendar.md` (v1) still reads "Status: Shipped"** with no pointer to the rethink (`specs/calendar.md:3`). Only its header was read for this report.

**Not verified:**
- what is deployed to prod beyond `CHANGELOG.md`;
- the state of the CALR tasks in the Moduo queue (`bun run queue` not run);
- whether teammates' work sessions count in `calendar_busy_blocks`.

"No calendar commit after 11-03" was checked against `A/`, `apps/app/src/lib/*calendar*`, the book page, the desktop `calendar.rs`/`caldav.rs`, `_shared/google-calendar.ts`, `microsoft-calendar.ts`, `booking-busy.ts`, the calendar and booking functions, and the migrations.
