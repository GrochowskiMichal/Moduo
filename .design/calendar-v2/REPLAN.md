# Calendar v2 — the re-plan

> **Status (2026-10-10): round 1 sent. Waiting on Maciej's answers to C1–C20.**
>
> - **Open calls:** C1–C20, all ❓. Load-bearing: ★ C1 (the ceiling), ★ C2 (the shape), ★ C3 (missed sessions), ★ C6 (connected calendars).
> - **Research lanes:** all six landed and folded in ([`research/`](./research/)): current state (with a live look at the running app), visual audit, early-decisions audit, role journeys, connectivity, competitor structure.
> - **Research data in the shared local database:** the current-state lane seeded a workspace for its live look; [research/current-state.md](./research/current-state.md) §8 lists every row to remove.
> - **Prototype:** [`prototypes/structure.html`](./prototypes/structure.html), keys 1–9 switch frames, V cycles variants.
> - **Waiting on Maciej, outside the calls:** (1) may one line be added to TV-D10's row on the integration branch (§6 #4, one reminders table for tasks and events); (2) is Google's OAuth consent screen still in "Testing" (§6 #14: if so, every Google connection drops after 7 days).
> - **Uncommitted:** nothing.
>
> **Numbering:** Calendar calls are **C1, C2, …**, numbered once and never renumbered. Tasks v3 calls are cited as "Tasks 64", "Tasks default r". The decisions audit's contradiction list uses its own "C1–C19"; in this file those are cited as "audit C1".
>
> Branch `t/maciej/calendar-replan` (cut from `t/maciej/tasks-v3-build` @ b902fd26). Local build mode (BUILD_ORDER's 🟠 box): local Supabase is prod, no pushes to `maciej`/`develop`, no PRs until Maciej says "release". Process: [`docs/agents/module-replan.md`](../../docs/agents/module-replan.md) (on `t/maciej/tasks-v3-build`). North star: [`specs/tasks-v3.md`](../../specs/tasks-v3.md), [`.design/tasks-v3/REPLAN.md`](../tasks-v3/REPLAN.md).

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | What's wrong, and why; what's strong; what Calendar must adopt from Tasks v3 |
| §2 | The proposed shape of Calendar |
| §3 | One product, every role |
| §4 | Each view, today and its target (round 2's work; a sketch here) |
| §5 | The visual north star, applied to Calendar (from the visual audit) |
| §6 | Technical decisions I'm taking, so the designer doesn't have to |
| §7 | What Calendar waits on from the Tasks v3 build |
| §8 | The calls |
| §9 | What happens next |

**Goal (from Maciej, 2026-10-10):** make Calendar complete and pleasant for students, developers, PMs, founders and teams of up to 5, freelancers and agencies, creators, and founder-led sales, so each can run a normal week without Google or Apple Calendar as their daily driver, without Notion Calendar or Fantastical, without a time-blocker (Sunsama, Akiflow, Motion) and without Calendly. Not 1-to-1 copies. The module is done only when it wires into the spine, ships its MCP tools and defines its Home widgets.

**Constraints:** desktop first (minimum window 1024×700); no new top-level routes without Maciej's explicit ask; AI only through MCP.

---

## 1. Diagnosis

### 1.1 The root cause

Calendar was specified on 2026-07-02 for one person:
- "The user is a solo or partner operator: their calendar is half client meetings, half 'the work itself.'" ([BRIEF](../calendar/BRIEF.md) §1)
- "The bar: Maciej uses Morgen daily; Moduo Calendar must feel *at least* Morgen-level." ([DESIGN_BRIEF](../calendar/DESIGN_BRIEF.md), header)

Tasks' root cause was "a solo-planner assumption stored as a column". Calendar's has the same shape: **a solo planner's habit stored as the data model.** Everything that has since been reversed, or must be, fits it:

| What the old plan stored | The solo assumption | What reversed it, or must |
| --- | --- | --- |
| A task block *is* the task row (`scheduled_at` + `duration_minutes`), one placement per task | One person works a task in one sitting | Tasks 25: several work sessions per task (`task_sessions`, TV-D10). The new table needs a person column; that's the tell |
| The block's length *is* the estimate ("deliberate", DESIGN_BRIEF §4) | My estimate is my plan | Tasks default r: a session's length is never the estimate |
| "Took longer" writes the planned span as worked time | Planned = worked, when it's only me | Tasks default r: a planned length never counts as worked time |
| The grid, the strip, the free-time finder and Home's Today widget use every task with a time in the workspace; "Move to today" can move a teammate's task | The workspace is one person's day | Tasks default r: your grid shows only your own work |
| Block focus runs its own clock, inside the Calendar page | One timer, one screen | Tasks one time engine (TV-F6) |
| Week start, working hours and weekends live in Calendar's own settings | One module, one setting | Tasks 76: Time & region, app-wide |
| Repeating events have no time zone; they float in each viewer's local time | Everyone viewing lives in the creator's zone | A shared weekly call between Warsaw and New York must keep its zone |
| The strip rolls unfinished work forward | A solo planner re-plans their own day | Tasks: missed sessions stay put; the task surfaces in Upcoming; nothing moves by itself |
| No people on events: no guests, invitations or replies; "no rebuilt meeting stack" as a permanent anti-goal | A solo operator's meetings are set up in Google anyway | The new goal: drop Google Calendar as the daily driver |

**A second shape** (from the [decisions audit](./research/early-decisions-audit.md) §0): **a boundary stated as a principle, then crossed feature by feature with no model behind it.** "External calendars are read-only, structurally" was crossed three times in October: creating Google events from the web, booking links writing Google events and Zoom meetings, and cancel deleting them. There is still no write model, so a Google event you create in Moduo turns read-only the moment it's saved.

**A special case of the first shape: "the planner's laptop is the server."** Every connected calendar syncs only while someone has the Calendar page open. Outlook, iCloud and ICS credentials live in one Mac's keychain, so they update only while that Mac runs Moduo. That's right for one person on one machine, and wrong for the web, teammates, booking links, Focus's meeting divider and agents ([connectivity](./research/connectivity.md) §0–§1).

**So the re-plan starts from the data shape:** sessions, ownership, people and sync are decided first, and the grid is drawn on top of them.

### 1.2 What is genuinely strong (keep)

**Product:**
- **One truth for tasks.** The calendar shows the task itself, never a copy, so Tasks and Calendar can't drift apart. Sessions keep this: a session belongs to its task.
- **The execution idea.** Complete a task from inside its session; ▶ starts it. No incumbent ships this.
- **Guilt-free by construction.** Never red, never a modal, never a notification for a session that ran out.
- **"Later today" through the free-time finder:** one session moves to the next free gap after now, around meetings, inside working hours, with Undo. It's the honest version of everything "reflow" promised.
- **Moduo works with no account connected** (its own calendars), unlike Morgen.
- **Every event is a spine citizen.** A meeting from Google is linkable to a contact, a note or a task on every device. Source attribution on every event.
- **Sharing is already per person** (the October permissions work): your calendars are private; you share each one as Busy only · Can view · Can edit; a team workspace defaults to Busy only; you can make extra calendars and save sets of calendars.
- **Repeats in plain words** with an echo before saving ("→ weekly on Tue & Thu · 9:00–9:30").
- **Booking links:** one sentence the guest finishes, Meet / Zoom / their choice, up to ten guests, a contact made or matched per booking, cancel links, the outbox emails (live since TX-5), rate limits, connects finished by the signed-in app. Distinctive, and live with real guests.
- **Careful sync engineering:** iCloud/CalDAV and ICS feeds, repeats with moved and cancelled occurrences, time zones that drop an event rather than shift it, a broken feed that never wipes your events.

**Platform:** native events go through server ops with an activity trail; mirrored events register in the search registry; a missing migration never blanks the page.

**The big ideas are right. What's wrong is who it was drawn for.**

### 1.3 What's broken, in five kinds

*From the current-state lane (code + a live look with a second member), the visual audit, the decisions audit, role journeys and connectivity.*

**A · Structure: a calendar without people.**
- An event has no guests, no invitations and no replies; mirrored meetings arrive without their attendees. So nothing links a meeting with Anna to Anna, and the References event card promises "people" it can't fill.
- One placement per task, and the block's length is the estimate.
- No Month view; due-only tasks never appear.
- Teammates' work appears on your grid and your free-time finder treats it as yours.
- Repeating Moduo events can't end on a date and can't change one occurrence.
- **Two "Calendars" lists sit one above the other** and don't talk: connected accounts (show/hide) and the sharing calendars from the permissions work, whose checkboxes look like show/hide but mean "include in a set". Calendars you create can never hold an event. Teammates' Busy can't be hidden.

**B · Trust: things that make people stop believing it** (ranked; [current state](./research/current-state.md) §3):
1. **Teammates' tasks are treated as yours.** Live: "6 unfinished from earlier" included two of Tess's tasks, ticked by default in Review; "Move to today" would have moved them. The MCP roll-forward does the same across the whole workspace.
2. **Past meetings disappear.** Every sync deletes mirrored events older than 30 days (or more than 120 ahead), with their links to contacts and notes.
3. **Clicking inside the new-event popover throws the draft away** (live, twice).
4. **"Synced just now" can be untrue:** it shows the freshest account; the web silently skips Outlook and iCloud; desktop Google and Outlook connections stop about an hour after connecting.
5. **Teammates see your repeating meetings as free** after the first one; booking links make the same mistake.
6. **"Took longer" logs planned time as worked time.**
7. **Two clocks:** block focus ends silently when you leave the page and never shows in the top bar.
8. **Dragging one occurrence moves the whole series, without asking.**
9. **Overlapping events can be unreachable:** "+3" can't be clicked.
10. **"Couldn't save on Google" after Google saved it;** a booking cancel reports success when a step failed.
11. **A teammate's new event appears only when you leave and come back** (no live updates for events).
12. **The same Google event can be mirrored twice.**

**C · Capability gaps for a daily driver** (the [gap map](./research/role-journeys.md) §8 has all 23):
- Can't edit or delete anything from Google, Outlook or iCloud; can't invite anyone; can't answer an invitation.
- **No alert before a meeting.**
- No Month view, no search, no second time zone.
- No "find a time"; teammates' Busy blocks don't say whose.
- No way to set a place on a Moduo event.

**D · Visual seams** ([visual audit](./research/visual-audit.md), §5 below): the shared hover, selection and drop recipes are unused; about nine date formats; every chip truncates its time; faded text below 4.5:1; every Moduo event in the accent colour; red in twelve places.

**E · No way in.**
- On the web only Google connects; Outlook, iCloud and ICS say "Connect from the desktop app".
- Outlook isn't really supported: no Microsoft app is registered, and its connection is read-only.
- The first open is an empty grid.

### 1.4 What Calendar adopts from Tasks v3 (binding unless Maciej agrees to change it)

| Piece | What it means here |
| --- | --- |
| The 3×3 layout (Tasks 48b) | Left = overview and navigation, centre = the grid, right = context; the bottom bar holds the module's tools and each panel's toggle. No rails, strips or extra columns. |
| Visual rules 38–46a | Three readable text levels + one decorative; hover = fill; one selection tint, focus ring, drop target and drag preview; people's words never capitalised; one date/time/duration grammar ("Today · Tomorrow · Mon · Oct 16 · 3:00 PM · 45m · 1h 30m"), nothing truncates; two-initial avatars; density everywhere; one chip and one count language; the accent budget (selection > today/now > done > queued); **text is never rotated** (watch the Month view's day headers and the week's narrow columns). |
| The north-star kit (DS-6) | Toolbar grammar, FilterBar/DisplayMenu, Chip, Avatar, EmptyState, Feed, DateField (the only date UI), PropertyRow, NavRow, GroupHeader, Card. |
| The right panel (SH-1, Tasks 72a) | The title row is a dropdown of Calendar's hand-picked views; a reference opened inside the panel shows as "← item". Calendar registered its old tabs unchanged (Detail · Notes / Tasks, `calendar/panel-views.ts`); the rebuild replaces them (C2). |
| One capture (Tasks 90, 90b) | ⌘⇧K always opens as Task; ⌘4 inside the modal switches it to Event. Calendar's capture type is a provisional one-liner today (`calendar/capture-type.tsx`); the rebuild gives it its own body (C10). |
| References (RF-1) | Calendar defines the event's link, chip, card and hover preview, plus "Private event" and "Deleted event". |
| The `@ # /` grammar and `/today` date chips | In event titles and notes: `@` mentions people and links things, `#` tags, `/` commands. |
| The bottom-bar mode pattern (Tasks 82b) | Selecting several events or sessions shows a short action row with keys, then More. |
| The key map's conventions | ⏎ opens, `e` edits, ⌥⇧ arrows move, ⌘⌫ deletes one, Space completes. Calendar adds its own table in round 2. |
| The notification table | Calendar adds its rows inside the channels Tasks 73 allows: desktop (menu bar) and browser, plus the bell. No email, no feed (C13). |
| Time & region (Tasks 76) | Time zone, week start, 12/24h, date order are app-wide; Calendar's own week-start setting moves there. |
| Motion tokens | Fast ~100 ms, base ~180 ms, slow ~280 ms; four patterns; reduced motion = opacity only; no blur. |
| The state rules | Loading = skeleton; empty teaches one gesture; filtered to nothing says so; offline = read-only from the device copy; read-only hides edit affordances; very large stays fast. |
| The decision-entry format | Who · what · why · rejected, in `docs/decisions/calendar.md`. |

### 1.5 The Tasks contract (specs/tasks-v3.md §18, default r) — honoured, or renegotiated here

| Tasks provides | Calendar's position |
| --- | --- |
| Your own due-only tasks as all-day chips | Honoured. Month (C5) shows them too. |
| Several work sessions per task, each a block | Honoured. Calendar calls them **sessions** (C4). |
| Future repeat occurrences as faint ghosts | Honoured, in Week and Month. |
| Drag from the Calendar's Tasks list to schedule | Honoured; the list's groups are re-expressed on Focus (C2). |
| ▶ on a block = Focus on this, one clock | Honoured; block focus retires (§6 #3). |
| "Took longer" is an adjustment, never a planned length | Honoured (C3). |
| Sessions count as busy for booking links, with a switch per link | Honoured (C9). |
| Teammates' unassigned tasks stay out of your calendar | Honoured. A project's dates can be shown on purpose (C18), and teammates' *time* as Busy (C8). |
| Missed sessions stay put; the task surfaces in Upcoming's Earlier; nothing moves by itself | Honoured. Calendar's "unfinished from earlier" strip is re-expressed on it (C3). |
| Reminders: one table for tasks | **Renegotiate (technical):** one reminders table for tasks *and* events, so meeting alerts and cues share the sender (§6 #4). |

**What Calendar provides to other modules** (contracts, designed for their rebuilds, not today's code):
- **Focus:** "your next event you're attending, within two hours" for the Up next divider (Tasks 64). Needs attendance on events (C7) and fresh sync (C6).
- **References:** the event preview (title · time · people) and its chip.
- **One busy-time answer per person:** events on the calendars they choose, expanded repeats, sessions (per-link switch), bookings. Used by the grid's Busy, "Find a time", booking links and MCP.
- **Contacts (when rebuilt):** "last and next meeting with Anna", from guests matched to contacts (C7).
- **Email (when rebuilt):** answering an invitation that arrives by email, and "an email thread → a meeting" by drag.
- **Time (Tasks 75):** a meeting can become a time entry (C20).
- **Home:** Calendar's widgets (C15).

---

## 2. The proposed shape

```
Top bar (global):   modules · Focus timer · Help · bell · you
┌ Left: overview ─────┬ Centre: the grid ───────────────────────┬ Right: context ──────────┐
│ mini-month          │ Toolbar: October 2026 · range             │ [Details ▾]              │
│ Calendars           │   Search · Display | Day Week Month List |│  about this:             │
│   Moduo · Personal  │   ‹ Today › · New                         │   Details (event,        │
│   Google · Work     │ "2 missed sessions · Review" (only when   │   session, due task,     │
│   iCloud · Family   │   there are some)                         │   booking link)          │
│ People              │ all-day row: events · due chips · ghosts  │  alongside:              │
│   Mike  ☐ busy      │ hours: events · sessions · ghosts ·       │   Tasks (to schedule)    │
│ Booking links       │   teammates' Busy (if ticked) · now line  │   Day (the picked day,   │
│   Intro call · 2    │                                           │   as a list)             │
└─────────────────────┴───────────────────────────────────────────┴──────────────────────────┘
Bottom bar (module tools): ◧ left toggle · Search · Capture · New · right toggle ◨
                           (a multi-select swaps the centre for its action row, Tasks 82b)
```

- **Two kinds of things on the grid**, as today, renamed (C4): **events** (yours, from any calendar) and **sessions** (time you set aside to work on a task). Plus **due chips** in the all-day row, **ghosts** for future repeats, and teammates' **Busy** when you tick them (C8).
- **People are first-class on events** (C7): guests, who's coming, your own reply, and each guest linked to their contact when one exists.
- **Every connected calendar is writable** and stays fresh with your computer off (C6).
- **Booking links stay in the left panel** and show their open times on the grid when selected (C9).

---

## 3. One product, every role

From [research/role-journeys.md](./research/role-journeys.md) (a normal week per role, 23 gaps, sources). **Today no role can drop Google Calendar.** Two reasons cover all seven: it's the only place their week reaches the phone and makes a sound before a meeting, and the only place they can invite people or change a meeting someone else made.

| Role | Would they switch today? | What closes the gap |
| --- | --- | --- |
| **Student** | Not yet: no alerts, no phone, a timetable that can't end at term or skip a week | C13 alerts, C17 repeats, C5 Month, C16 (your plan reaches the phone through Google/iCloud) |
| **Developer** | As a layer on top; the company's Google stays | C6 edit + C7 answer invitations from Moduo, C16 sessions visible to colleagues |
| **PM** | No: the job is moving other people's time | C6, C7, C8 Find a time, C14 zones |
| **Founder / team of 5** | Partly: booking, many accounts, sets and contacts already beat Calendly-lite | C6, C7, C9 collective links, C14 |
| **Freelancer / agency** | Closest | C19 reschedule, C20 meetings as billable time, C16 timeboxes clients can see, C13 |
| **Creator** | Not until Month and a project's dates on a calendar | C5, C18 |
| **Founder-led sales** | Not yet: Calendly's reschedule, reminders and no-shows, and meetings matched to contacts | C19, C7 (attendees → contacts), C12 cues |

**The two themes behind most gaps:**
1. **Moduo can't take part in meetings with other people** (gaps G3, G4, G9, G13): it shows them but can't create them with guests, move them, answer them, or know who's in them → C6, C7, C8.
2. **Moduo's plan stays inside Moduo** (G1, G2, G11): no phone, no alerts, colleagues and outside booking tools see you as free → C13, C16. A Moduo phone app stays out of scope (Tasks 36).

**Outside the target roles:** alerts, invitations, editing, Month, repeat end dates and a place on an event are universal (households, teachers, clinicians). Find a time, project calendars and booking depth are team or client work.

---

## 4. The views — today and their target

*Round 2a's work (view by view, state by state). Round 1 settles which views exist (C5) and the panels (C2).*

---

## 5. The visual north star, applied

From [research/visual-audit.md](./research/visual-audit.md): the live app measured at 1440×900 and 1024×700, dark mode, three densities, plus accent and light-mode spot checks.

**Keep:** the grid's hour height follows density and draws DST days right; account colours go through the tag hue tokens; the toolbar sits on one control rung; core text is readable (12 px titles at 15–19:1); quiet states (dashed elapsed, struck done, nothing red on the grid); the 48b layout already holds; booking is the one surface on the shared recipes.

**What would spread if copied** (the audit's §1 has all 16 with measurements):

| # | Issue | Measurement | Rule |
| --- | --- | --- | --- |
| 1 | None of the shared interaction layer is used; hover comes in 8 styles; the drop target is invisible | Drop column vs its neighbour 1.01:1 | 39 |
| 2 | Selection looks like keyboard focus, and no timed event can take focus | 0 of 13 chips focusable | 39 |
| 3 | Two date formatters, about nine formats for one moment ("60m", "10/11/2026, 3:00:00 PM", a native "15:00" next to "3:00 PM") | — | 41 |
| 4 | Every chip truncates its time, and titles in overlaps get one letter | Week column 106 px at 1440, 51 px at 1024 | 41, 42 |
| 5 | Overlaps cap at three columns at any width; "+N" can't be clicked | A 740 px Day column still hides the fourth | 42 |
| 6 | Faded steps below readable contrast | Past-event time 3.2:1, done title 3.46:1, day number 4.37:1, other-month day 2.73:1 | 38 |
| 7 | Every Moduo event is accent-tinted | 15–17 accent marks on one week | 46 |
| 8 | Density only changes the hour height; in Dense a 15- and a 30-minute event look identical | 22 px both | 44 |
| 9 | About nine chip languages, two property-panel languages (uppercase field labels vs PropertyRow), caps on group headers | — | 40, 45, kit |
| 10 | Red in 12 places, four ways to delete; "Remove account" runs at once with no confirm and no Undo | — | no red; Undo |

**What the rebuild does about it** (C2's layout, plus the kit): a chip that survives narrow columns (title first, the time drops whole when it doesn't fit, two lines when tall enough, overlaps that widen with the column and a "+N" that opens a list); one date grammar from `lib/time-format.ts`; one selection and focus recipe, every chip reachable by keyboard; Moduo's own calendars in a calendar colour, not the accent; three readable text levels for past and done states; density applied to chips, popovers and the mini-month; the kit's PropertyRow, Chip, EmptyState, DateField; no red, and Undo instead of confirms where Tasks does. The quick wins in the audit's §4 fold into the first UI block.

---

## 6. Technical decisions I'm taking

Per the process, these are mine. Each becomes a decision entry (who · what · why · rejected) in `docs/decisions/calendar.md` when the spec lands. Listed so nothing surprises anyone. Evidence: [connectivity](./research/connectivity.md) §2, §4.

1. **Sessions are Tasks' `task_sessions` rows** (TV-D10). Calendar creates, moves, resizes and removes them through Tasks' session ops, with Undo; it never writes `tasks.scheduled_at`. *Rejected:* the Calendar-owned `time_blocks` table from BRIEF §7 (two owners of one fact).
2. **Calendar reads from the shared store** (TV-D11a): tasks, sessions, and (new) calendars and events, with delta sync and Realtime. Provider changes reach clients because the server sync bumps `updated_at`; no client ever calls a provider. *Rejected:* today's separate `useTasksModule` mount and per-page provider fetches.
3. **One clock.** ▶ on a session calls the one time engine (TV-F6); `use-block-focus.ts` is deleted. *Rejected:* keeping a Calendar clock.
4. **One reminders table for tasks and events.** Tasks Assumption #4 names `task_reminders(task_id, …)`; Calendar needs the same sender for meeting alerts (C13) and cues (C12): `reminders(entity_type, entity_id, user_id, at, kind, …)`, created that way by TV-D10. *Rejected:* a second `event_reminders` table and a second sender. **Needs** one line in TV-D10's row before it's built (asked in the status block).
5. **Sync runs on the server, per person.** pg_cron calls a `calendar-sync` Edge Function that pulls only changes per calendar (Google sync tokens, Microsoft delta, CalDAV sync-collection/ETags, ICS polling), one source per run; a service-role op writes the mirror. Connections belong to the person, not the workspace. Google and Microsoft push notifications come later as a nudge. Desktop Google/Outlook connects move to the same web sign-in (the desktop opens the browser); the keychain path and the old `manage-integration` function retire. *Rejected:* desktop-only sync (stale for everyone else); live provider calls from each client.
6. **Writes go through a server op and a write queue**, sent with the provider's version check (ETag / If-Match), with a pending state and a conflict notice. Occurrence rows gain a series id and their original start, so "this event · this and following · all" works for every provider. The unused `is_default_target` becomes each person's default calendar. *Rejected:* client-side provider writes.
7. **Events get a time zone** (an IANA column; null = floating, for all-day and legacy) and **native repeats reuse Tasks' SQL occurrence function** (TV-D8), so every server reader (busy time, reminders, Focus's divider, MCP) expands repeats the same way; the client keeps `rrule` for display, with shared test cases. *Rejected:* client-only expansion (every server reader is wrong today); materialising occurrence rows.
8. **One busy function** returns only (person, start, end): native occurrences + mirrored events + sessions + bookings. Titles can't leak because the function never returns them. Used by the grid, Find a time, booking links and MCP.
9. **Attendees are stored** on events (normalised, with your own reply and who organised it), mirrored from providers and written back through them.
10. **Events join References** (RF-1): a preview resolver (title · time · people · calendar), "Private event", "Deleted event".
11. **Time & region:** Calendar's `user_preferences.calendar.weekStart` migrates into TV-D14's setting; Calendar keeps only its own settings (working hours, calendar colours, visibility, sets).
12. **Every new user-keyed table** (connections, sources, write queue, attendees, reminders) joins `account_erase_workspace_data` and the full export in the block that creates it (Tasks Assumption #26).
13. **Module contract:** every event write is a server op with activity and registry upkeep; MCP tools and Home widgets are defined in round 2b.
14. **Provider readiness, outside code:** Google's consent screen must be published (in "Testing", refresh tokens expire after 7 days); Microsoft needs an app registration with publisher verification, which needs a registered company (today's interim entity is Ringdove). Both are Maciej's dashboard steps when their blocks come.
15. **Block ids** (continue CAL-9… or start a v2 lane): decided at the spec step.

---

## 7. What Calendar waits on from the Tasks v3 build

| Tasks v3 block | What Calendar needs from it |
| --- | --- |
| SH-1 ✅ | The panel registry and the capture registry (landed) |
| DS-6 | The kit Calendar is drawn with |
| TV-D8 | The SQL occurrence function native repeats reuse (§6 #7) |
| TV-D10 | `task_sessions`; the shared reminders table (§6 #4) |
| TV-D11a | The shared store Calendar reads from |
| TV-F6 | The one time engine behind ▶ |
| TV-F8 | Reads Calendar's "next event you're attending" for the Up next divider |
| TV-D12 | Repeat ghosts, the reminder sender, desktop menu bar + browser notifications |
| TV-D14 | Time & region; time entries (C20) |
| RF-1 | References, for the event preview and guests as contacts |
| TV-U12 | The bottom-bar mode pattern for multi-select |
| TV-U14 | The capture body the Event type follows |

Round 3 reconciles in-flight work that touches Calendar: these blocks, collective booking links (PERM-8b), TX-6 (guest reminders, host cancel), Moduo Meet (MEET-*), and the pending booking-connect deploy (PR #304).

---

## 8. The calls

**How to answer:** call numbers with ok / no / notes, as for Tasks. Every call has a recommendation, the alternative I'd reject, and whether people outside the target roles would still want it (Tasks 48a).

### Round 1 · the shape (2026-10-10)

| Status | Calls |
| --- | --- |
| ❓ Open, load-bearing | ★ C1, ★ C2, ★ C3, ★ C6 |
| ❓ Open | C4, C5, C7–C20 |

**★ C1 · The ceiling: Calendar becomes a daily driver, with a line**
- **The tension.** The goal is "run a normal week without Google or Apple Calendar". The ratified ceiling is "Morgen-lite", with a permanent anti-goal: "no rebuilt provider meeting stack (RSVP, time-zone matrices)". A daily driver needs things that anti-goal rules out; the role lane found no role can switch today for exactly that reason (§3).
- **What a daily driver must do in its first week:**
  - show all your calendars in one grid ✅ today;
  - create, edit, move and delete on any of them ◐ (create on Google only);
  - invite people and see who's coming ✗;
  - answer an invitation ✗;
  - alert you before a meeting ✗;
  - join the call in one click ✅;
  - find a time that suits your team ✗;
  - Month and a list view ✗, search ✗, repeats that end or change once ✗, a place on an event ✗, holidays and timetable feeds ◐ (desktop only).
- **The line I recommend:**
  - **In:** two-way on Google, Microsoft and iCloud; guests and replies, sent through the calendar the event lives on; alerts before events; Month and List; search; repeats with an end and "this event / this and following / all"; teammates' busy time and "Find a time" inside the workspace; a second time zone; a place on any event; booking links (we have them).
  - **Out, permanently:** rooms and resources; someone else managing your calendar (assistants, delegation); out-of-office, working location and focus time that declines meetings; meeting polls; an AI that schedules for you (that's your AI, through MCP); free/busy across other companies; sharing a Moduo calendar outside the workspace (put those events on a Google or iCloud calendar and share it there).
  - **Out for now:** a phone app (Tasks 36). C16 gets your plan onto the phone through the calendar apps you already have.
  - **The anti-goal is narrowed, not dropped:** Google and Microsoft send the invitations and collect the replies; Moduo sends its own only for a Moduo-calendar event with outside guests (C7). No time-zone comparison grid.
- *Recommend: yes, this line.* Rejected: keeping Morgen-lite (Google Calendar stays open beside Moduo, the "weakest leg" the product brief warns about, §6); full Google parity (rooms, delegation and out-of-office are large-team needs a team of five pays for in complexity).
- *Outside the target roles?* Yes: this is what anyone with a calendar expects.
- (c) re-decides DESIGN_BRIEF §11's anti-goal and the "Morgen-lite" ceiling in PRODUCT_BRIEF §6.

❓ OK?

**★ C2 · The shape: what each panel holds**
- **Left · overview:**
  - the mini-month;
  - **Calendars**, one list (today there are two, and their checkboxes mean different things), grouped by where they come from (Moduo first, then each connected account), each with its colour and show/hide on hover; every calendar you own can hold events (today a calendar you create can't); teammates' calendars shared with you sit under **Shared with you**; saved sets live in the group's ⋯ menu ("Show set: Work week");
  - **People**: your workspace's members; tick one to see their busy time on your grid, with their avatar (C8);
  - **Booking links**: one row each, with "2" bookings this week; selecting one shows its open times on the grid (C9).
  - Same rules as the Tasks sidebar: no glyphs, sentence-case headers, groups collapse, headers only when a group has something.
- **Centre · the grid:** the Tasks toolbar grammar: "October 2026" and the range · Search · Display | Day · Week · Month · List | ‹ Today › · New. Under it, only when there are some, "2 missed sessions this week · Review" (C3). Then the all-day row and the hours.
- **Right · context**, the title-row dropdown:
  - *about this:* **Details**: the selected event, session, due task or booking link; references inside it open as "← Anna Kowalski";
  - *alongside:* **Tasks**: your work to schedule, grouped Up next (your Focus line-up) · Due this week · No date, with search; rows drag onto the grid. **Day**: the picked day as a list, the default beside Month.
  - Today's "Notes" view goes: linked notes appear in Details' Linked section (References).
- **Bottom bar:** the left toggle · Search · Capture · New · the right toggle; a multi-select swaps the centre for its action row (Tasks 82b).
- **At the minimum window (1024×700)** *(recommendation changed after the visual audit)*: with both panels open the centre gets 440 px, 51 px per day, and only 7.3 hours fit ([visual audit](./research/visual-audit.md) §3). *Recommend:*
  1. **the right panel starts folded below about 1200 px wide**: it's context, not the surface (Tasks 48b); clicking an event still opens its popover, and the bottom-bar toggle (or opening Details) brings the panel back;
  2. **Week shows weekdays only at that size** unless your weekend has something on it;
  3. **the left panel keeps only the mini-month and the calendar list**; creating a calendar or a set moves into the Calendars ⋯ menu;
  4. in the toolbar, "synced 3m ago" moves into the refresh button's tooltip before the range label shortens.
  - My first draft folded the left panel first, to keep the Tasks list beside the week for planning. The audit's measurements and 48b win: planning a week is a bigger-window job, and the Tasks list is one toggle away.
- *Recommend: yes, this shape.* Rejected: booking links in Settings (they're everyday objects for sales and freelancers, and their bookings live on the grid); People as a panel view (overlaying someone's time is about the grid, so it sits with the calendars).
- *Outside the target roles?* Yes.
- Prototype frames 1, 2, 3, 4 and 9 (variants: right folds · left folds · both open).

❓ OK?

**★ C3 · A missed session: one state, one set of fixes, shown where you are**
- **The problem.** Calendar today has its own fix system: a row inside an elapsed block (Done · Later today · Took longer · Remove) and a strip ("3 unfinished from earlier · Move to today · Review", looking back 7 days). Tasks v3 has since decided: a missed session stays where it was, muted; the task shows in Upcoming's Earlier as "missed 2:00 PM"; nothing moves by itself; a late *due date* has its own fixes (Move · Won't do · Break down). Two owners would ship two systems for one fact (audit C1–C3).
- **Recommend:**
  - **One state, "missed":** a session whose time passed while its task is still open **and no later session is planned for it**. An earlier session of a task that has another one coming just reads as past (with its tracked time, if any). Computed once, shown in three places: on the grid (muted, where it was), in Upcoming's Earlier, and in Calendar's quiet line.
  - **One set of fixes, the same wherever a missed session shows** (on hover or selection, never always):
    - **Done**: completes the task;
    - **Move ▾**: Next free time today · Tomorrow · Pick… "Today" always means the next free gap after now, never the same clock time (audit C3);
    - **Took longer**: stretches the session to now; if nothing was tracked during it, offers "Add 40m to time?". Planned time never counts by itself;
    - **Unschedule**: removes the session; the task stays.
  - **The strip becomes one line**, only when there's something: "2 missed sessions this week · Review". Review opens the panel's Tasks view showing the missed ones with tick boxes, and **"Fit 2 into today"** (C11): one gesture, one Undo. Nothing moves until you click.
  - **Finishing a task early frees its future sessions:** "Done · freed 2 sessions · Undo". The time goes back to your day and your booking links.
  - **Late tasks keep their own fixes:** a session is a plan; a due date is a promise. Where a task is both late and missed, both sets show.
- *Recommend: yes.* Rejected: dropping the line and relying on Upcoming alone (Calendar planners lose the batch fix); keeping the 7-day strip as its own list (two lists of the same tasks with different rules).
- *Outside the target roles?* Yes: anyone who plans their day in blocks has missed one.
- (c) re-decides DESIGN_BRIEF §6b–§6c. Prototype frame 5 (variants: on the grid · Review · after Fit).

❓ OK?

**C4 · One name per concept**
- **Event:** anything on the calendar that isn't your work on a task, from any calendar. "Meeting" only in copy, for an event with other people.
- **Session:** time set aside to work on a task. Never "block", "time block" or "task block". "Schedule" makes one.
- **Due:** a task's due date, shown as a **due chip** in the all-day row.
- **Calendar:** a named, coloured set of events. **Account:** a connection (Google, Microsoft, iCloud) that brings calendars. **Set:** a saved choice of calendars to show.
- **Busy:** time someone has taken that you can't see into.
- **Booking link** (the public link) and **booking** (a meeting someone booked through it).
- **Guests** (people on an event) and **reply** (Yes · No · Maybe).
- **Missed:** a session whose time passed with its task open and nothing planned after it. **Late:** a due date that passed (Tasks 23).
- **Retired:** block, lens, the strip, "unfinished from earlier", "Later today" (→ Move ▾ · Next free time today), "Remove" (→ Unschedule), "Detail" (→ Details), "roll forward".
- *Recommend: yes.* *Outside the target roles?* n/a.

❓ OK?

**C5 · Views: Day · Week · Month · List**
- **Day** and **Week** stay; **Month** arrives (Tasks 26). Week is the default the first time; after that, the last one you used.
- **Month** shows all-day events and due chips first, then timed events as one line each ("9:00 AM Standup"), "+3 more" when a day is full; the panel's Day view shows the picked day in full. Sessions show in Day and Week; Display can add them to Month.
- **List** *(changed after the competitor lane)*: the coming days as one scrolling list (events, sessions and due chips, under day headers "Thu · Oct 15"), like Google's Schedule view. Both the competitor lane (an agenda list is something a Google user misses in week one) and the decisions audit (students and sales scan the week as a list, especially on a small window) point here. It's the same word as Tasks' List view: rows, grouped. Prototyped in round 2a.
- **Display** (the Tasks menu) holds: Show weekends · Show declined events · Show due tasks · Show repeats · Days in Week (5 · 7) · Second time zone (C14).
- **Not proposed:** Year (no role needs it weekly; a term or a quarter reads fine in Month).
- *Recommend: yes, four views.* Rejected: Notion Calendar-style "any number of days" (more choice than a week needs); no list (Upcoming lists only tasks, so a week of meetings would have no list anywhere).
- *Outside the target roles?* Yes.
- Prototype frame 3 (Month).

❓ OK?

**★ C6 · Connected calendars: writable everywhere, fresh with your computer off**
- **Today:** Google calendars can be created on from the web, but nothing from Google, Outlook or iCloud can be edited, moved or deleted in Moduo, not even events you made there. Outlook and iCloud connect only from the desktop app and update only while that Mac runs Moduo; every provider updates only while a Calendar page is open somewhere.
- **Recommend:**
  - **every connected calendar is editable in Moduo**, on the web and the desktop, including "this event / this and following / all";
  - **Moduo keeps them current on its servers**, so the web, teammates' Busy, booking links, alerts and Focus's meeting divider are right even with every laptop closed; changes show within about five minutes;
  - **connect any of them from the web**; the desktop opens the same sign-in;
  - **you pick a default calendar** for new events, shown on every create (the "wrong calendar" guard);
  - **while a change is saving** it shows a faint mark; if Google refuses: "Couldn't save to Google · Retry · Keep in Moduo only"; if someone changed it meanwhile: "Changed in Google since you opened it";
  - **past meetings stay**, with their links (today anything older than 30 days is deleted on every sync);
  - **each calendar says honestly when it last updated**, and a broken connection shows Reconnect wherever it appears.
- **Order:** Google first (nearly there), then iCloud and other CalDAV, then Microsoft. Microsoft is last only because it needs an app registration with publisher verification, which needs a registered company.
- **The one choice you'd see (iCloud and other CalDAV):** at connect, two options side by side, neither pre-picked: "Keep it up to date when my Mac is off — your app-specific password is stored encrypted on Moduo's servers" or "Keep my password on this Mac only — updates only while Moduo runs here". Neither is the default because an iCloud app-specific password also opens that person's iCloud mail and contacts, so storing it is a real step up in what Moduo holds ([connectivity](./research/connectivity.md) Q1). ICS feeds (just a link) default to the server. Google and Microsoft use sign-in, so no password is stored.
- *Recommend: yes, all of the above.* Rejected: Google-only write-back (Outlook users keep Outlook open; that's most PMs); keeping desktop-only sync (stale for everyone but you); keychain-only for iCloud with no choice (students on the web and anyone's second device never see their Apple calendar); storing iCloud passwords on the server by default (too much to hold without asking).
- *Outside the target roles?* Yes.
- Evidence: [connectivity](./research/connectivity.md) §0–§4.

❓ OK? And the order (Google → iCloud → Microsoft)?

**C7 · Guests and invitations**
- **Recommend:**
  - an event can have **guests**: workspace members, contacts, or any email;
  - on a Google, Microsoft or iCloud calendar, that provider sends the invitation and collects replies, as if you'd used its own app; replies come back as a ✓ by each name;
  - **invitations you receive** show on your grid in an outline until you reply; Details shows Yes · No · Maybe, sent back through the provider;
  - **guests become links:** a guest who is a contact links the event to that contact, so Anna's hub shows "last met · next meeting"; mirrored meetings keep their attendees for the same reason;
  - on a **Moduo** calendar: workspace members get it in the bell and on their grid, and reply there; **outside guests get a plain email from Moduo with the event attached and Yes · No · Maybe links**, the only invitation Moduo sends itself.
- *Recommend: yes.* Rejected: a full invitation server of our own (reading replies from guests' calendar apps by email; the most work for the smallest group); requiring a connected calendar to invite anyone (students and households without Google couldn't invite at all).
- *Outside the target roles?* Yes.
- Prototype frames 1 (Event open) and 2 (Invitation).

❓ OK?

**C8 · Teammates' time, and "Find a time"**
- **Today:** teammates' calendars shared as Busy only already show as anonymous "Busy" blocks, all of them at once, not saying whose; repeating events count only once and sessions not at all.
- **Recommend:**
  - in the left panel's **People**, tick a teammate to see their Busy on your grid, with their avatar (nothing shows until you tick, so a team of five doesn't fill your week);
  - when you add guests from the workspace, **"Find a time"** shows the next three slots where everyone is free, inside everyone's working hours. Plain arithmetic, never an assistant;
  - their sessions count as Busy (Tasks default d); titles show only where they've shared a calendar as Can view.
- *Recommend: yes.* Rejected: a team availability grid (large-team tooling; five people fit on one week); showing every teammate's Busy by default (today's behaviour: anonymous and crowded).
- *Outside the target roles?* Yes: any two people meeting need it.
- (c) re-decides how the October permissions work (PERM-5) draws teammates' Busy: today every shared calendar shows at once; this makes it opt-in per person.
- Prototype frame 7.

❓ OK?

**C9 · Booking links: where they live, and how they use your time**
- **Recommend:**
  - they stay in the left panel (they're there today); selecting one shows **its open times on the grid** as a faint wash, and its Details (bookings this week, hours, busy calendars, copy link) on the right;
  - a booking shows on the grid like any event, with "Booked via Intro call" in its Details, and lands on your default calendar (C6), so Outlook and iCloud hosts get a real event too;
  - **busy time** = every calendar you check, kept fresh (C6), with repeats counted every week + your sessions (switch per link, "Count my work sessions as busy", on by default; Tasks default d) + other bookings;
  - **collective links** ("a call with me and Mike") use each host's own calendars, then go live (PERM-8b);
  - the sentence page stays.
- *Recommend: yes.* Rejected: moving links to Settings.
- *Outside the target roles?* Yes: anyone who's ever traded "when are you free?" emails.
- Prototype frame 6. More booking depth for client work: C19.

❓ OK?

**C10 · Creating: draw, ⌘N and the Event capture**
- **Recommend:**
  - **Draw on the grid** → a new event with its title being typed and a small popover (time · calendar · guests · repeat · place). A toggle in that popover, **Event · Session**, turns it into a session for a task (pick the task by typing).
  - **⌘N in Calendar** → a new event at the selected time, or the next half hour.
  - **⌘⇧K then ⌘4** → capture as Event: a destination row "Event · Work (Google) ▾", the title with live date words and people ("Lunch with Anna Thu 1pm" → When and a guest), and the pills When · Guests · Repeat · ⋯ More (place or video, notes, alert, time zone).
  - **Dragging a task** from the panel onto the grid makes a session; onto the all-day row sets its due date (Tasks contract).
- Today, clicking any control inside the new-event popover throws the draft away; the rebuild's popover keeps the draft until Esc or an empty click-away.
- *Recommend: yes.* Rejected: a separate "New session" button (one more choice; the toggle and the drag cover it).
- *Outside the target roles?* Yes.
- Prototype frames 7 (the popover) and 8 (capture).

❓ OK?

**C11 · "Fit into today": the one assisted gesture**
- **What:** pick tasks (your Up next, the missed ones in C3, or a selection) and "Fit 3 into today": Moduo places them in today's free time, in your order, inside your working hours, around your events. You see the result on the grid; one Undo puts everything back.
- **It replaces** "Move to today", "Later today" for several, and the old "reflow my day". The morning-plan and evening-shutdown rituals are not built: Focus's "Line up today's scheduled tasks" and Upcoming's Earlier cover those moments (audit question 13).
- **Never:** moving anything by itself, or anything you didn't pick.
- *Recommend: yes.* Rejected: Motion-style automatic scheduling (its top churn reason); none at all (Sunsama and Akiflow users plan this way every morning).
- *Outside the target roles?* Yes.
- Prototype frame 5, variants Review and After Fit.

❓ OK?

**C12 · Cues: "remind me at my next meeting with Anna"** *(Tasks 58, parked until this rebuild)*
- **Recommend: decide it now, for meetings only.**
  - On a task: Remind me ▸ **At my next meeting with…** a person.
  - When an event with that person is next, the task shows in that event's Details under "At this meeting" ("Ask Anna about invoice #14"), and the reminder arrives with the meeting's own alert, through the usual channels.
  - If the meeting moves, the cue moves with it; if it's cancelled, the cue waits for the next one.
  - The other cue triggers (opening a project, a contact or a thread) wait for those modules' rebuilds.
- **Depends on** C7 (guests and mirrored attendees) and C13 (alerts).
- *Recommend: yes, meetings only.* Rejected: parking it again (Calendar owns the trigger); all cue kinds now (their triggers live in modules not yet rebuilt).
- *Outside the target roles?* Yes: "next time I see her, ask about X" is universal; uniquely Moduo, because the calendar knows who's in the meeting.
- Prototype frame 1, variant Event open.

❓ OK?

**C13 · Alerts before events, and Calendar's notification rows**
- **Recommend**, inside Tasks 73's channels (desktop menu bar, browser, bell; no email, no feed):

  | Event | Who hears | Where | When | Turned off by |
  | --- | --- | --- | --- | --- |
  | An event is about to start | You | Desktop / browser | Each calendar has a default alert that new events take (10 min before timed events; none for all-day ones), changeable per event. Events from Google, Microsoft or iCloud keep the alert set there. Solo events alert too: a lecture or a dentist matters as much as a meeting | Per event, and the calendar's default |
  | A session is about to start | Nobody | — | — | Sessions never alert; a task's own reminder (Tasks 24) does that job |
  | You're invited | You | Bell | Grouped by the hour | Settings → Notifications → Invitations |
  | An event you're in changes or is cancelled | You | Bell | At once, quietly | Same |
  | A guest replies | The organiser | Bell | Grouped | Same |
  | Someone books you | You | Bell | At once | The link's own switch |
  | A session ends | Nobody | — | — | — |
  | A session is missed | Nobody | Shown on the grid and in Upcoming | — | — |

- **Booking emails** to the host (live since TX-5) stay: they're confirmations, not reminders, and the host may not have Moduo open. The link's switch turns them off.
- *Recommend: yes.* Rejected: no alerts (the role lane's second biggest gap, all seven roles); email alerts (Tasks 73 dropped email).
- *Outside the target roles?* Yes.

❓ OK?

**C14 · Time zones: a second zone, and events in other zones**
- **Recommend:**
  - Time & region (Tasks 76) decides your zone, as everywhere;
  - every event keeps the zone it was made in, so "9:00 London every Tuesday" stays 9:00 London for a teammate in Warsaw (shown as 10:00);
  - an event in another zone shows both when they differ ("3:00 PM · 9:00 AM New York");
  - Display can add a **second time zone** column beside the hours; creating an event can set its zone (More).
- *Recommend: yes.* Rejected: a world-clock panel (one column covers the common case: a client or co-founder abroad).
- *Outside the target roles?* Yes: anyone with a client or family abroad.
- Prototype frame 1, variant Second time zone.

❓ OK?

**C15 · Home: Calendar's widgets** *(opening call; detail in round 2b)*
- **Recommend:** one **Today** widget: the next 3–4 things on a small timeline with the now line, your next meeting with Join, and "2 missed sessions · Review". The old "strip count + Move to today" goes with C3. Other widgets (a week glance, a booking-links summary) only if round 2 shows a role needs them.
- *Outside the target roles?* Yes.

❓ OK?

**C16 · Your plan, outside Moduo** *(opening call; new, from the role lane's gaps G1, G2, G11)*
- **The gap:** Moduo's plan stays inside Moduo. Sessions and Moduo-calendar events never reach your phone, and colleagues and outside booking tools see you as free during them. A phone app is out of scope (Tasks 36), and the calendar feed was dropped (Tasks round 2c).
- **Recommend:**
  - with a connected calendar, new events go there by default (C6), so your phone's Google or Apple Calendar shows them and alerts you, with no Moduo phone app;
  - **"Show my sessions on Work (Google) as Busy"**, a per-person switch, off by default: each session becomes a private "Busy" event on that calendar, kept in step (moved, removed) by Moduo. Colleagues see you as busy, your phone shows your plan, and outside booking tools respect it;
  - **the same switch for another calendar's events:** "Show Personal (iCloud) on Work (Google) as Busy", so your dentist appointment stops colleagues booking over it without merging accounts (Notion Calendar does this, [competitors](./research/structure-competitors.md));
  - Moduo's own calendars stay inside Moduo.
  - **Depends on C6:** both switches write to a connected calendar, so they come after write-back.
- *Recommend: yes.* Rejected: bringing the calendar feed back (Google refreshes feeds every 12–24 hours and drops their alerts, Tasks round 2c); session titles on your work calendar by default (they'd be visible to your whole company); Reclaim/Motion's "free until the deadline is at risk, then busy" (it moves your availability by itself).
- *Outside the target roles?* Yes: anyone who defends focus time in a company calendar.

❓ OK?

**C17 · Repeats for events: one picker with Tasks** *(opening call; gap G6)*
- **Recommend:** events use Tasks' repeat picker (Tasks 27i): presets, Custom (every n, days, nth weekday, end "until Dec 15" or "after 10 times"), one plain summary line, and the same words in capture. Changing one occurrence asks "This event · This and following · All events" (Tasks says "Just this one · Change the pattern"; events need the middle option because other people's calendars share the series).
- *Recommend: yes.* Rejected: keeping Calendar's own repeat picker (two pickers, two grammars, audit C9).
- *Outside the target roles?* Yes: school timetables, courses, a skipped standup.

❓ OK?

**C18 · What else you can show on your calendar** *(opening call; gap G8 and the "not in any role" list)*
- **Recommend**, each one ticked on in the left panel, off by default, so your grid stays your own work (Tasks default r):
  - **a project:** its tasks' due dates (anyone's) and its section dates, in the project's colour. A creator's content calendar or a PM's release month in Month view, without leaving Calendar;
  - **birthdays** from your contacts (Contacts already stores dates);
  - **public holidays** for your country.
- *Recommend: yes.* Rejected: project calendars as a separate kind of calendar you manage (more structure; the project already holds the dates).
- *Outside the target roles?* Yes for birthdays and holidays (households); projects are team work.

❓ OK?

**C19 · Booking links for client work** *(opening call; gaps G13, G15–G17)*
- **Recommend**, in this order:
  1. **reschedule** (the guest's email and the booking page offer it; the old slot frees itself);
  2. **guest reminders and cancelling from your side** (TX-6, already planned);
  3. **several lengths on one link** (15 · 30 · 45);
  4. **"Offer times"**: drag a few slots on the grid, copy them as a short message with a link that books one; the held slots free themselves once one is booked (Notion Calendar and Vimcal do this);
  5. **mark a no-show** on a past booking, counted on the link;
  6. later: single-use links, round robin ("any of us"), payments.
- *Recommend: yes, 1–5.* Rejected: routing forms and payments now (Calendly's paid tiers; coaches and tutors, not our roles).
- *Outside the target roles?* Client-facing work only (coaches, tutors, recruiters).

❓ OK? Strike any.

**C20 · A meeting can become tracked time** *(opening call; gap G19)*
- **Recommend:** on a past event linked to a task (or a project), **"Add 45m to time"** in its Details logs a time entry (Tasks 75) for you, dated that day, with the event's title as the note. Never automatic. So an agency's client calls reach the client's time report.
- *Recommend: yes.* Rejected: logging every meeting automatically (time tracking must stay what you chose to record, Tasks 63).
- *Outside the target roles?* Billing work (consultants, lawyers, agencies).

❓ OK?

### Consistency pass (round 1)

Checked every call against the others, against Tasks v3, and against the decisions audit's contradiction list:
1. **"Move" means one thing.** On a late task it moves the due date; on a missed session it moves the session; "today" is always the next free gap after now. Kept (C3, audit C2–C3).
2. **"Fit into today" (C11) and "nothing moves by itself" (Tasks).** Fit is a click on tasks you picked, with one Undo. `calendar_roll_forward` and the MCP "roll forward" verb are renamed accordingly (audit C8).
3. **Keys.** Calendar's view keys (D · W · M) only apply on the Calendar page; Tasks' D is Date in a multi-select, so Calendar's multi-select row won't use D. The full table comes in round 2.
4. **The panel's Tasks view (C2)** groups by Up next · Due this week · No date. "Queue", "Today" (committed) and "Backlog" are retired words there (Tasks 61, 53).
5. **Busy (C8), booking links (C9), Find a time and MCP** read the one busy function (§6 #8).
6. **Reminders (C13) and cues (C12)** share one table and one sender (§6 #4).
7. **Invitations (C7) and "no email" (Tasks 73).** Tasks dropped email *reminders to yourself*. An invitation to an outside guest is a message to a third party, like a booking confirmation. Kept, and limited to Moduo-calendar events (provider calendars send their own).
8. **Repeats (C17).** One picker for tasks and events; events add "This and following" because a series is shared with other people's calendars (audit C9).
9. **No red, no rotated text:** Month's day headers are horizontal, missed sessions are muted, not coloured.
10. **Docs that still state reversed decisions** (audit C19: PRODUCT_BRIEF §6, ROADMAP lines 49 and 52, BRIEF §3–4, DESIGN_BRIEF §1/§8/§11, the MCP manifest's "read-only" line) get edited when the spec lands, with a supersession banner on the old spec.

---

## 9. What happens next

1. Maciej answers round 1; answers are recorded under each call, in his words.
2. The remaining lanes (current state, visual audit, competitors) are folded into §1, §5 and the calls; anything that changes a recommendation is re-asked, not slipped in.
3. **Round 2a:** the grid (Day, Week, Month) view by view and state by state: empty, loading, error, read-only, offline, very large; the event and session details; the panel views.
4. **Round 2b:** how Calendar plugs into the shared pieces: its capture type, References previews, MCP tools, notifications, Home widgets; then a gap audit by a separate agent.
5. **Round 3:** in-flight work (the Tasks v3 blocks Calendar depends on, PERM-8b, TX-6, Moduo Meet, PR #304).
6. **The spec** (`specs/calendar-v2.md`, on Fable 5.1), then the doc edits in consistency item 10.

---

## Appendix — evidence

| File | What it holds | Status |
| --- | --- | --- |
| [research/current-state.md](./research/current-state.md) | Calendar today in code and in the running app (seeded workspace, a second member): capability matrix, 15 trust bugs, what Tasks v3 already changed, the research data to remove | landed, folded into §1.3, C2, C6, C10 |
| [research/visual-audit.md](./research/visual-audit.md) | The live app measured against the north-star rules; 16 spreading issues; the 1024×700 verdict; the fix list | landed, folded into §1.3, §5 and C2 |
| [research/early-decisions-audit.md](./research/early-decisions-audit.md) | Every early Calendar decision: keep / adjust / reverse; 19 contradictions; 15 designer questions | landed, folded into §1, C1–C20 and the consistency pass |
| [research/structure-competitors.md](./research/structure-competitors.md) | Views, calendars, people, tasks, booking, write-back and complaints across 20 tools | landed, folded into C5, C16, C19 |
| [research/role-journeys.md](./research/role-journeys.md) | A normal week per role, 23 gaps, who would switch | landed, folded into §3 and C13–C20 |
| [research/connectivity.md](./research/connectivity.md) | Sync, write-back, invitations and free/busy: today per provider, options, sequencing | landed, folded into §1, §6 and C6–C9 |
