# Calendar v2 — the re-plan

> **Status (2026-10-10): round 1 sent. Waiting on Maciej's answers to C1–C15.**
>
> - **Open calls:** C1–C15, all ❓. Load-bearing: ★ C1 (the ceiling), ★ C2 (the shape), ★ C3 (missed sessions).
> - **Research lanes:** six, in [`research/`](./research/): current state · visual audit · early-decisions audit · competitor structure · role journeys · connectivity. Their findings are folded into §1, §3, §6 and the calls as they land; the appendix says which have.
> - **Prototype:** [`prototypes/structure.html`](./prototypes/structure.html) (keys 1–9 switch frames, V cycles variants).
> - **Waiting on Maciej, outside the calls:** whether one line may be added to TV-D10's row on the integration branch (§6 #4, reminders shared by tasks and events).
> - **Uncommitted:** nothing.
>
> **Numbering:** Calendar calls are **C1, C2, …**, numbered once and never renumbered. Tasks v3 calls are cited as "Tasks 64", "Tasks default r", so the two plans never collide.
>
> Branch `t/maciej/calendar-replan` (cut from `t/maciej/tasks-v3-build` @ b902fd26). Local build mode (BUILD_ORDER's 🟠 box): local Supabase is prod, no pushes to `maciej`/`develop`, no PRs until Maciej says "release". Process: [`docs/agents/module-replan.md`](../../docs/agents/module-replan.md) (on `t/maciej/tasks-v3-build`). North star: [`specs/tasks-v3.md`](../../specs/tasks-v3.md), [`.design/tasks-v3/REPLAN.md`](../tasks-v3/REPLAN.md).

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | What's wrong, and why; what's strong; what Calendar must adopt from Tasks v3 |
| §2 | The proposed shape of Calendar |
| §3 | One product, every role (filled from the role-journeys lane) |
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

| What the old plan stored | The solo assumption | What reversed it |
| --- | --- | --- |
| A task block *is* the task row (`scheduled_at` + `duration_minutes`), one placement per task | One person works a task in one sitting | Tasks 25: several work sessions per task (`task_sessions`, TV-D10) |
| The block's length *is* the estimate ("deliberate", DESIGN_BRIEF §4) | My estimate is my plan | Tasks default r and the contract: a session's length is never the estimate |
| "Took longer" writes the planned span as worked time | Planned = worked, when it's only me | Tasks default r: a planned length never counts as worked time |
| The grid, the strip and the free-time finder use every task with a time in the workspace; "Move to today" can move a teammate's task | The workspace is one person's day | Tasks default r: your grid shows only your own work |
| Block focus runs its own clock, inside the Calendar page | One timer, one screen | Tasks one time engine (TV-F6) |
| Week start lives in Calendar's own settings | One module, one setting | Tasks 76: Time & region, app-wide |
| The strip rolls unfinished work forward | A solo planner re-plans their own day | Tasks: missed sessions stay put; the task surfaces in Upcoming; nothing rolls by itself |
| Connected calendars are read-only "structurally", write-back "v2" | You live in Morgen; Google is somewhere else | Booking links (2026-10-01) already write to Google, and Google calendars are writable on the web; Outlook and iCloud are still read-only, and only sync from the desktop that connected them |
| No people on events: no guests, invitations or replies; "no rebuilt meeting stack" as a permanent anti-goal | A solo operator's meetings are set up in Google anyway | The new goal: drop Google Calendar as the daily driver; a team of five needs "when are we all free?" |

Sources: [BRIEF](../calendar/BRIEF.md), [DESIGN_BRIEF](../calendar/DESIGN_BRIEF.md) §1–§11, [specs/calendar.md](../../specs/calendar.md) Assumptions 1–21, [docs/decisions/calendar.md](../../docs/decisions/calendar.md), [Tasks current state](../tasks-v3/research/current-state-focus-calendar-home.md) §3–§4, [the Tasks→Calendar contract](../tasks-v3/research/views-list-upcoming.md) §10. The early-decisions lane tests this table decision by decision ([research/early-decisions-audit.md](./research/early-decisions-audit.md)).

**So the re-plan starts from the data shape:** sessions, ownership, people and sync are decided first, and the grid is drawn on top of them.

### 1.2 What is genuinely strong (keep)

**Product:**
- **One truth for tasks.** The calendar shows the task itself, never a copy, so Tasks and Calendar can't drift apart. Sessions keep this: a session belongs to its task.
- **The execution idea.** Complete a task from inside its session; ▶ starts it. No incumbent ships this.
- **Guilt-free by construction.** Never red, never a modal, never a notification for a session that ran out.
- **Every event is a spine citizen.** A meeting from Google is linkable to a contact, a note or a task on every device.
- **Source attribution.** Every event says which calendar it's from.
- **Repeats in plain words** with an echo before saving ("→ weekly on Tue & Thu · 9:00–9:30").
- **Booking links** with a page that's one sentence the guest finishes, video choice (Meet, Zoom, theirs), guests, cancel links, rate limiting and the outbox emails. Distinctive, and live with real guests.
- **Careful sync engineering:** iCloud/CalDAV and ICS feeds, time zones that drop an event rather than shift it, a guard against wiping an account when a feed breaks.
- **Privacy is already per person.** Since the October permissions work, an event is visible to its owner and to people its calendar is shared with; teammates don't see each other's calendars by default.

**Platform:** native events go through server ops with an activity trail; mirrored events register in the search registry; the loop runs on Tasks' own ops.

**The big ideas are right. What's wrong is who it was drawn for.**

### 1.3 What's broken, in five kinds

*Draft from the code read and the Tasks research; the current-state and visual lanes confirm or correct each line.*

**A · Structure: a calendar without people.**
- An event has no guests, no invitations and no replies, so a meeting with Anna isn't linked to Anna unless someone links it by hand.
- One placement per task, and the block's length is the estimate.
- No Month view, so a creator's publishing month or a student's term can't be seen at once.
- Due-only tasks never appear.
- Teammates' work appears on your grid, and your free-time finder treats it as yours.

**B · Trust: things that make people stop believing it.**
- "Took longer" logs planned time as worked time.
- Two clocks: block focus and Focus can run on two tasks at once; leaving the Calendar page ends block focus silently; waking from sleep credits the whole gap.
- "Move to today" can move a teammate's task.
- Outlook and iCloud only update while the desktop that connected them is running, so the web (and anyone else's view) can be hours stale.
- Keyboard check-off in the Tasks panel opens the task instead; blocks on the grid can't be reached by keyboard.

**C · Capability gaps for a daily driver.**
- Can't edit Outlook or iCloud events; can't invite anyone; can't answer an invitation.
- No reminder before a meeting.
- No Month view, no search, no "this event only" for repeats.
- No teammate free time and no "find a time".
- No second time zone.

**D · Visual seams.** Durations read "240m", panel titles truncate (Tasks research); the rest comes from the visual audit ([research/visual-audit.md](./research/visual-audit.md)).

**E · No way in.**
- On the web, only Google connects; Outlook and iCloud say "Connect from the desktop app".
- The first open is an empty grid.
- No import of an existing calendar beyond connecting it.

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
| Teammates' unassigned tasks stay out of your calendar | Honoured, and extended: teammates' *time* can appear as Busy only when you ask (C8). |
| Missed sessions stay put; the task surfaces in Upcoming's Earlier; nothing rolls by itself | Honoured. Calendar's "unfinished from earlier" strip is re-expressed on it (C3). |
| Reminders: one table for tasks | **Renegotiate (technical):** one reminders table for tasks *and* events, so meeting reminders and cues share the sender (§6 #4). |

**What Calendar provides to other modules** (contracts, designed for their rebuilds, not today's code):
- **Focus:** "your next event you're attending, within two hours" for the Up next divider (Tasks 64). Needs to know which events you're attending (C7).
- **References:** the event preview (title · time · people) and its chip.
- **Booking links:** one busy-time answer per person: events on the calendars they choose + sessions (per-link switch).
- **Contacts (when rebuilt):** "last and next meeting with Anna" from guests matched to contacts (C7).
- **Email (when rebuilt):** an invitation email can be answered from Calendar, and "an email thread → a meeting" via drag.
- **Home:** Calendar's widgets (C15).

---

## 2. The proposed shape

```
Top bar (global):   modules · Focus timer · Help · bell · you
┌ Left: overview ─────┬ Centre: the grid ───────────────────────┬ Right: context ──────────┐
│ mini-month          │ Toolbar: October 2026 · range             │ [Details ▾]              │
│ Calendars           │   Search · Display | Day Week Month |     │  about this:             │
│   Moduo · Personal  │   ‹ Today ›                               │   Details (event,        │
│   Google · work@…   │ "3 missed sessions · Review" (only when   │   session, due task,     │
│   iCloud · Family   │   there are some)                         │   booking link)          │
│ People              │ all-day row: events · due chips           │  alongside:              │
│   Mike  ○ show busy │ hours: events · sessions · ghosts ·       │   Tasks (to schedule)    │
│ Booking links       │   teammates' Busy (if shown) · now line   │   Day (the picked day,   │
│   Intro call · 2    │                                           │   as a list)             │
└─────────────────────┴───────────────────────────────────────────┴──────────────────────────┘
Bottom bar (module tools): ◧ left toggle · Search · Capture · New · right toggle ◨
                           (a multi-select swaps the centre for its action row, Tasks 82b)
```

- **Two kinds of things on the grid**, as today, renamed (C4): **events** (yours, from any calendar) and **sessions** (time you set aside to work on a task). Plus **due chips** in the all-day row, **ghosts** for future repeats, and teammates' **Busy** only when you ask (C8).
- **People are first-class on events** (C7): guests, who's coming, your own reply, and each guest linked to their contact when one exists.
- **Every connected calendar is writable** and stays fresh with your computer off (C6).
- **Booking links stay in the left panel** and show their open times on the grid when selected (C9).

---

## 3. One product, every role

*Filled from [research/role-journeys.md](./research/role-journeys.md) when the lane lands: each role's normal week, the gap map, and which call closes each gap.*

---

## 4. The views — today and their target

*Round 2a's work (view by view, state by state). Round 1 settles which views exist (C5) and the panels (C2).*

---

## 5. The visual north star, applied

*Filled from [research/visual-audit.md](./research/visual-audit.md): what would spread if copied, the fix list, and the 1024×700 verdict.*

---

## 6. Technical decisions I'm taking

Per the process, these are mine. Each will become a decision entry (who · what · why · rejected) in `docs/decisions/calendar.md` when the spec lands. Listed so nothing surprises anyone; marked *provisional* where a research lane is still out.

1. **Sessions are Tasks' `task_sessions` rows** (TV-D10). Calendar creates, moves, resizes and removes them through Tasks' session ops, with Undo; it never writes `tasks.scheduled_at`. *Rejected:* the Calendar-owned `time_blocks` table from BRIEF §7 (two owners of one fact).
2. **Calendar reads from the shared store** (TV-D11a): tasks, sessions, and (new) calendars and events, with delta sync and Realtime. *Rejected:* today's separate `useTasksModule` mount on the Calendar page, which reloads every task and runs a writing catch-up on each visit.
3. **One clock.** ▶ on a session calls the one time engine (TV-F6); `use-block-focus.ts` and its page-local timer are deleted. *Rejected:* keeping a Calendar clock.
4. **One reminders table for tasks and events.** Tasks' Assumption #4 names `task_reminders(task_id, …)`; Calendar needs the same sender for "10 minutes before" and for meeting cues (C12, C13). Proposal: `reminders(entity_type, entity_id, user_id, at, kind, …)`, created that way by TV-D10. *Rejected:* a second `event_reminders` table and a second sender. **Needs:** one line added to TV-D10's row before it's built (asked in the reply).
5. **Sync runs on the server for every provider** *(provisional, connectivity lane)*: workers on pg_cron (and provider push where it exists) keep every connected calendar fresh with no desktop running; writes go through the same workers. *Rejected (provisional):* desktop-only sync for Outlook and iCloud (stale for everyone else, and the Focus divider and reminders can't trust it).
6. **Events keep their repeat rule on the event row**, with exception rows for "this event only" changes *(provisional)*. *Rejected (provisional):* expanding every occurrence into rows.
7. **Events join References** (RF-1): a preview resolver for the event (title · time · people · calendar), "Private event" when you can't see it, "Deleted event" when it's gone.
8. **Time & region:** Calendar's `user_preferences.calendar.weekStart` migrates into TV-D14's setting; Calendar keeps only its own settings (working hours for C11, calendar colours and visibility).
9. **Module contract:** every event write is a server op with activity and registry upkeep; MCP tools and Home widgets are defined in round 2b.
10. **Block ids** (continue CAL-9… or start a v2 lane): decided at the spec step.

---

## 7. What Calendar waits on from the Tasks v3 build

| Tasks v3 block | What Calendar needs from it |
| --- | --- |
| SH-1 ✅ | The panel registry and the capture registry (landed) |
| DS-6 | The kit Calendar is drawn with |
| TV-D10 | `task_sessions`; reminders (§6 #4) |
| TV-D11a | The shared store Calendar reads from |
| TV-F6 | The one time engine behind ▶ |
| TV-F8 | Reads Calendar's "next event you're attending" for the Up next divider |
| TV-D12 | Repeat ghosts, the reminder sender, desktop menu bar + browser notifications |
| TV-D14 | Time & region |
| RF-1 | References, for the event preview and guests as contacts |
| TV-U12 | The bottom-bar mode pattern for multi-select |
| TV-U14 | The capture body the Event type follows |

Round 3 reconciles in-flight work that touches Calendar: these blocks, collective booking links (PERM-8b), and the pending booking-connect deploy (PR #304).

---

## 8. The calls

**How to answer:** call numbers with ok / no / notes, as for Tasks. Every call has a recommendation, the alternative I'd reject, and whether people outside the target roles would still want it (Tasks 48a).

### Round 1 · the shape (2026-10-10)

| Status | Calls |
| --- | --- |
| ❓ Open, load-bearing | ★ C1, ★ C2, ★ C3 |
| ❓ Open | C4–C15 |

**★ C1 · The ceiling: Calendar becomes a daily driver, with a line**
- **The tension.** The goal is "run a normal week without Google or Apple Calendar". The ratified ceiling is "Morgen-lite", with a permanent anti-goal: "no rebuilt provider meeting stack (RSVP, time-zone matrices)". A daily driver needs things that anti-goal rules out.
- **What a daily driver must do in its first week** (to be checked against the competitor lane):
  - show all your calendars in one grid ✅ today;
  - create, edit, move and delete on any of them ◐ (Google only);
  - invite people and see who's coming ✗;
  - answer an invitation ✗;
  - remind you before a meeting ✗;
  - join the call in one click ✅;
  - find a time that suits your team ✗;
  - a Month view ✗, search ✗, "this event only" for repeats ✗.
- **The line I recommend:**
  - **In:** two-way on Google, Microsoft and iCloud; guests and replies, sent through the calendar the event lives on; reminders before events; Month; search; "this event / this and following / all"; teammates' busy time and "Find a time" inside the workspace; a second time zone; booking links (we have them).
  - **Out, permanently:** rooms and resources; someone else managing your calendar (assistants, delegation); out-of-office and working location; meeting polls; an AI that schedules for you (that's your AI, through MCP); free/busy across other companies.
  - **The anti-goal is narrowed, not dropped:** we use Google's and Microsoft's own invitations (they send the emails and collect the replies); we don't build our own invitation server.
- *Recommend: yes, this line.* Rejected: keeping Morgen-lite (Google Calendar stays open beside Moduo, which is the "weakest leg" the product brief warns about, §6); full Google parity (rooms, delegation and out-of-office are large-team needs that a team of five pays for in complexity).
- *Outside the target roles?* Yes: this is what anyone with a calendar expects.
- (c) re-decides DESIGN_BRIEF §11's anti-goal and the "Morgen-lite" ceiling in PRODUCT_BRIEF §6.

❓ OK?

**★ C2 · The shape: what each panel holds**
- **Left · overview:**
  - the mini-month;
  - **Calendars**, grouped by where they come from (Moduo first, then each connected account), each with its colour and a show/hide on hover;
  - **People**: your workspace's members; tick one to see their busy time on your grid (C8);
  - **Booking links**: one row each, with "2 this week"; selecting one shows its open times on the grid (C9).
  - Same rules as the Tasks sidebar: no glyphs, sentence-case headers, groups collapse, headers only when a group has something.
- **Centre · the grid:** the Tasks toolbar grammar: "October 2026" and the range · Search · Display | Day · Week · Month | ‹ Today ›. Under it, only when there are some, "3 missed sessions · Review" (C3). Then the all-day row and the hours.
- **Right · context**, the title-row dropdown:
  - *about this:* **Details**: the selected event, session, due task or booking link; references inside it open as "← Anna Kowalski";
  - *alongside:* **Tasks**: your work to schedule, grouped Up next (your Focus line-up) · Due this week · No date, with search; rows drag onto the grid. **Day**: the picked day as a list, the default beside Month.
  - Today's "Notes" view goes: linked notes appear in Details' Linked section (References).
- **Bottom bar:** the left toggle · Search · Capture · New · the right toggle; a multi-select swaps the centre for its action row (Tasks 82b).
- **At the minimum window (1024×700):** both side panels can't fit beside a readable week. *Recommend:* the left panel folds first (the mini-month and calendar list are glanceable; the Tasks list is the planning tool); the bottom-bar toggle brings it back. To be checked against the visual audit's measurements.
- *Recommend: yes, this shape.* Rejected: booking links in Settings (they're everyday objects for sales and freelancers, and their bookings live on the grid); people as a panel view (overlaying someone's time is about the grid, so it sits with the calendars).
- *Outside the target roles?* Yes.
- Prototype frames 1, 2, 3, 4 and 9.

❓ OK?

**★ C3 · A missed session: one state, one set of fixes, shown where you are**
- **The problem.** Calendar today has its own fix system: a row inside an elapsed block (Done · Later today · Took longer · Remove) and a strip ("3 unfinished from earlier · Move to today · Review", looking back 7 days). Tasks v3 has since decided: a missed session stays where it was, muted; the task shows in Upcoming's Earlier as "missed 2:00 PM"; nothing moves by itself. Two owners would ship two systems for one fact.
- **Recommend:**
  - **One state, "missed":** a session whose time passed while its task is still open. Computed once, shown in three places: on the grid (muted, where it was), in Upcoming's Earlier, and in Calendar's quiet line.
  - **One set of fixes, the same wherever a missed session shows** (on hover or selection, never always):
    - **Done**: completes the task;
    - **Move ▾**: Next free time today · Tomorrow · Pick…;
    - **Took longer**: stretches the session to now; if nothing was tracked during it, offers "Add 40m to time?". Planned time never counts by itself;
    - **Unschedule**: removes the session; the task stays.
  - **The strip becomes one line**, only when there's something: "3 missed sessions · Review". Review opens the panel's Tasks view showing the missed ones with tick boxes, and **"Fit 3 into today"** (C11): one gesture, previewed, one Undo. Nothing moves until you click.
  - **Late tasks are different:** a passed *due date* keeps Tasks' own fixes (Move · Won't do · Break down). A session is a plan; a due date is a promise.
- *Recommend: yes.* Rejected: dropping the line and relying on Upcoming alone (Calendar planners lose the batch fix); keeping the 7-day strip as its own list (two lists of the same tasks with different rules).
- *Outside the target roles?* Yes: anyone who plans their day in blocks has missed one.
- (c) re-decides DESIGN_BRIEF §6b–§6c. Prototype frame 5 (variants: on the grid · the line · Review open).

❓ OK?

**C4 · One name per concept**
- **Event:** anything on the calendar that isn't your work on a task, from any calendar. "Meeting" only in copy, for an event with other people.
- **Session:** time set aside to work on a task. Never "block", "time block" or "task block". "Schedule" makes one.
- **Due:** a task's due date, shown as a **due chip** in the all-day row.
- **Calendar:** a named, coloured set of events. **Account:** a connection (Google, Microsoft, iCloud) that brings calendars.
- **Busy:** time someone has taken that you can't see into.
- **Booking link** (the public link) and **booking** (a meeting someone booked through it).
- **Guests** (people on an event) and **reply** (Yes · No · Maybe).
- **Missed:** a session whose time passed with its task open. **Late:** a due date that passed (Tasks 23).
- **Retired:** block, lens, the strip, "unfinished from earlier", "Later today", "Remove" (→ Unschedule), "Detail" (→ Details).
- *Recommend: yes.* *Outside the target roles?* n/a.

❓ OK?

**C5 · Views: Day · Week · Month**
- **Day** and **Week** stay; **Month** arrives (Tasks 26). Week is the default the first time; after that, the last one you used.
- **Month** shows all-day events and due chips as chips, timed events as one line each ("9:00 AM Standup"), "+3 more" when a day is full; the Day view in the panel shows the picked day in full.
- **Display** (the Tasks menu) holds: Show weekends · Show declined events · Show due tasks · Show repeats · Days in Week (5 · 7).
- **Not proposed:** Year (no role needs it weekly; a term or a quarter reads fine in Month), and a separate agenda/list view (Upcoming already lists your tasks by day, and the panel's Day view lists a day's events).
- *Recommend: yes.* Rejected: Notion Calendar-style "any number of days" (more choice than a week needs).
- *Outside the target roles?* Yes.
- Prototype frame 3.

❓ OK?

**C6 · Connected calendars: writable everywhere, fresh with your computer off**
- **Today:** Google calendars are writable on the web. Outlook and iCloud are read-only, connect only from the desktop app, and only update while the desktop that connected them is running.
- **Recommend:**
  - every connected calendar can be edited in Moduo, on the web and the desktop;
  - Moduo keeps them up to date on its servers, so the web, your teammates' Busy view, your reminders and Focus's meeting divider are right even when your laptop is closed;
  - connect any of them from the web too;
  - order: Google (nearly there), then Microsoft, then iCloud and other CalDAV.
- **What you'd feel:** for iCloud and other CalDAV servers, Moduo has to keep your app-specific password, encrypted, on its servers (today it stays in your Mac's keychain). The connect dialog says so in one line. Google and Microsoft use sign-in, so no password is stored.
- *Recommend: yes.* Rejected: Google-only write-back (Outlook users keep Outlook open; that's most PMs); keeping desktop-only sync (stale for everyone but you).
- *Outside the target roles?* Yes.
- *Provisional until the connectivity lane lands* ([research/connectivity.md](./research/connectivity.md)); I'll restate it with its findings.

❓ OK?

**C7 · Guests and invitations**
- **Recommend:**
  - an event can have **guests**: workspace members, contacts, or any email;
  - on a Google or Microsoft calendar, Google or Microsoft send the invitation and collect replies, as if you'd used their app;
  - **invitations you receive** show on your grid in a quieter style until you reply; Details shows Yes · No · Maybe;
  - **guests become links:** a guest who is a contact links the event to that contact, so Anna's hub shows "last met · next meeting";
  - on a **Moduo** calendar, guests who are workspace members see the event in their Moduo calendar and reply there; inviting someone outside the workspace asks you to pick a connected calendar (round 2 settles what happens with none).
- *Recommend: yes.* Rejected: sending our own invitation emails (deliverability and spam risk, and it would duplicate what Google and Microsoft do well).
- *Outside the target roles?* Yes.

❓ OK?

**C8 · Teammates' time, and "Find a time"**
- **Recommend:**
  - in the left panel's **People**, tick a teammate to see their busy time on your grid, shown as "Busy" blocks (never titles, unless their calendar is shared with you);
  - when you add guests from the workspace, **"Find a time"** shows the next three slots where everyone is free, inside everyone's working hours. Plain arithmetic, never an assistant;
  - a teammate's sessions count as Busy (Tasks default d).
- *Recommend: yes.* Rejected: a team availability grid (large-team tooling; five people fit on one week).
- *Outside the target roles?* Yes: any two people meeting need it.
- Prototype frame 7.

❓ OK?

**C9 · Booking links: where they live, and how they use your time**
- **Recommend:**
  - they stay in the left panel (they're there today); selecting one shows **its open times on the grid** as a faint wash, and its Details (settings, upcoming bookings, copy link) on the right;
  - a booking shows on the grid like any event, with "Booked via Intro call" in its Details;
  - **busy time:** your chosen calendars + your sessions, with the per-link switch "Count my work sessions as busy" (Tasks default d), on by default;
  - **collective links** ("a call with me and Mike") use C8's free time, so they finish once C8 lands (PERM-8b);
  - the sentence page stays.
- *Recommend: yes.* Rejected: moving links to Settings.
- *Outside the target roles?* Yes: anyone who's ever traded "when are you free?" emails.
- Prototype frame 6.

❓ OK?

**C10 · Creating: draw, ⌘N and the Event capture**
- **Recommend:**
  - **Draw on the grid** → a new event with its title being typed and a small popover (time · calendar · guests · repeat). A toggle in that popover turns it into a **session for a task** (pick the task by typing).
  - **⌘N in Calendar** → a new event at the selected time, or the next half hour.
  - **⌘⇧K then ⌘4** → capture as Event: a destination row "Event · Personal (Google) ▾", the title with live date words ("Lunch with Anna Thu 1pm"), and the pills When · Guests · Repeat · ⋯ More (place or video link, notes, reminder).
  - **Dragging a task** from the panel onto the grid makes a session; onto the all-day row sets its due date (Tasks contract).
- *Recommend: yes.* Rejected: a separate "New session" button (one more choice; the draw toggle and the drag cover it).
- *Outside the target roles?* Yes.
- Prototype frame 8.

❓ OK?

**C11 · "Fit into today": the one assisted gesture**
- **What:** pick tasks (your Up next, the missed ones in C3, or a selection) and "Fit 3 into today": Moduo places them in today's free time, in your order, inside your working hours, around your events. You see the result on the grid, and one Undo puts everything back.
- **It replaces** "Move to today" and "Later today", and the old "reflow my day" idea.
- **Never:** moving anything by itself, or moving anything you didn't pick.
- *Recommend: yes.* Rejected: Motion-style automatic scheduling (its top churn reason, and it moves things you didn't ask to move); none at all (Sunsama and Akiflow users plan this way every morning).
- *Outside the target roles?* Yes.
- Prototype frame 5, variant Review.

❓ OK?

**C12 · Cues: "remind me at my next meeting with Anna"** *(Tasks 58, parked until this rebuild)*
- **Recommend: decide it now, for meetings only.**
  - On a task: Remind me ▸ **At my next meeting with…** a person.
  - When an event with that person is next on your calendar, the task shows in that event's Details ("Ask Anna: invoice #14"), and the reminder arrives with the meeting's own reminder, through the usual channels (desktop, browser).
  - If the meeting moves, the cue moves with it; if it's cancelled, the cue waits for the next one.
  - The other cue triggers (opening a project, a contact or a thread) wait for those modules' rebuilds.
- *Recommend: yes, meetings only.* Rejected: parking it again (Calendar owns the trigger, and C7's guests make it possible); all cue kinds now (their triggers live in modules not yet rebuilt).
- *Outside the target roles?* Yes: "next time I see her, ask about X" is universal; uniquely Moduo, because the calendar knows who's in the meeting.

❓ OK?

**C13 · Reminders before events, and Calendar's notification rows**
- **Recommend**, inside Tasks 73's channels (desktop menu bar, browser, bell; no email, no feed):

  | Event | Who hears | Where | When | Turned off by |
  | --- | --- | --- | --- | --- |
  | An event is about to start | You | Desktop / browser | 10 min before, by default, for events with other people; none for events with just you | Per event, and a default per calendar |
  | You're invited | You | Bell | Grouped by the hour | Settings → Notifications → Invitations |
  | An event you're in changes or is cancelled | You | Bell | At once, quietly | Same |
  | A guest replies | The organiser | Bell | Grouped | Same |
  | Someone books you | You | Bell | At once | The link's own switch |
  | A session ends | Nobody | — | — | — |
  | A session is missed | Nobody | Shown on the grid and in Upcoming | — | — |

- **Booking emails** to the host (live since TX-5) stay: they're booking confirmations, not reminders, and the host may not have Moduo open. The per-link switch can turn them off.
- *Recommend: yes.* *Outside the target roles?* Yes.

❓ OK?

**C14 · Time zones: a second zone, and events in other zones**
- **Recommend:**
  - Time & region (Tasks 76) decides your zone, as everywhere;
  - Calendar adds an optional **second time zone** column beside the hours (Display);
  - an event made in another zone shows both when they differ ("3:00 PM · 9:00 AM New York");
  - creating an event can set its zone (More).
- *Recommend: yes.* Rejected: a world-clock panel (one column covers the common case: a client or co-founder abroad).
- *Outside the target roles?* Yes: anyone with a client abroad.

❓ OK?

**C15 · Home: Calendar's widgets** *(opening call; detail in round 2b)*
- **Recommend:** one **Today** widget: the next 3–4 things on a small timeline with the now line, your next meeting with Join, and "2 missed sessions · Review". The old "strip count + Move to today" goes with C3. Other widgets (a week glance, a booking-links summary) only if round 2 shows a role needs them.
- *Outside the target roles?* Yes.

❓ OK?

### Consistency pass (round 1)

Checked every call against the others and against Tasks v3:
1. **"Move" means one thing.** In Tasks, Move on a late task changes its due date; in C3, Move on a missed session moves the session. Both move the thing that's late or missed; the menu says where it goes. Kept.
2. **"Fit into today" (C11) and "nothing moves by itself" (Tasks).** Fit is a click on tasks you picked, previewed, with one Undo. Consistent.
3. **Keys.** Calendar's view keys (D · W · M) only apply on the Calendar page; Tasks' D is Date in a multi-select. Calendar's multi-select row (82b) won't use D for Day. The full table comes in round 2.
4. **The panel's Tasks view (C2)** groups by Up next · Due this week · No date. "Queue" and "Backlog" are retired words (Tasks 61, 53).
5. **"Busy" (C8) and booking links (C9)** read one busy-time answer per person (§1.5).
6. **Reminders (C13) and cues (C12)** share one table and one sender (§6 #4).
7. **No red, no rotated text:** Month's day headers are horizontal ("Mon 13"), missed sessions are muted, not coloured.

---

## 9. What happens next

1. Maciej answers round 1; answers are recorded under each call, in his words.
2. The six lanes' findings are folded into §1, §3, §5 and C6; anything that changes a recommendation is re-asked, not slipped in.
3. **Round 2a:** the grid (Day, Week, Month) view by view and state by state: empty, loading, error, read-only, offline, very large; the event and session details; the panel views.
4. **Round 2b:** how Calendar plugs into the shared pieces: its capture type, References previews, MCP tools, notifications, Home widgets; then a gap audit by a separate agent.
5. **Round 3:** in-flight work (the Tasks v3 blocks Calendar depends on, PERM-8b, PR #304).
6. **The spec** (`specs/calendar-v2.md`, on Fable 5.1).

---

## Appendix — evidence

| File | What it holds | Status |
| --- | --- | --- |
| [research/current-state.md](./research/current-state.md) | Calendar today in code and in the running app: capability matrix, trust bugs, what Tasks v3 already changed | running |
| [research/visual-audit.md](./research/visual-audit.md) | Measurements against the north-star rules; the 1024×700 verdict | running |
| [research/early-decisions-audit.md](./research/early-decisions-audit.md) | Every early Calendar decision: keep / adjust / reverse | running |
| [research/structure-competitors.md](./research/structure-competitors.md) | Views, calendars, people, tasks, booking and write-back across 18 tools | running |
| [research/role-journeys.md](./research/role-journeys.md) | A normal week per role, and the gap map | running |
| [research/connectivity.md](./research/connectivity.md) | Sync, write-back, invitations and free/busy: today and options | running |
