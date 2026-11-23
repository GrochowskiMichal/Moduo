# Calendar v2 — the re-plan

> **Status (2026-11-21): round 1b sent: round 1 re-opened after Mike's rethink, with new calls C22–C32. Waiting on Maciej's answers.**
>
> - **What changed since round 1 (Oct 10, never answered):** Mike rebuilt Calendar from 27 Oct ([specs/calendar-rethink.md](../../specs/calendar-rethink.md), 21 blocks landed 28 Oct–3 Nov, releases 1.5.0–1.7.1), then a review round (30 Oct) and Outlook on the web (3 Nov). §1.0 says what that settled. Every old call now carries a **Status 2026-11-21** line: *Settled* (built, nothing Maciej ratified contradicts it), *Built differently (Mike's answer)* (Mike's product call in his 27 Oct /s1, never put to Maciej) or *Open*.
> - **Settled:** C8 (teammates' time, Find a time). Mostly settled: C9 (booking links).
> - **Open, load-bearing:** ★ C1 (the line, narrowed), ★ C3 (missed sessions), ★ C6 (writing to Outlook and iCloud), ★ C7 (invitations), ★ C13 (alerts), ★ C22 (several sessions per task), ★ C23 (focus time), ★ C26 (meeting prep), ★ C28 (scheduling from an email thread), ★ C30 (fresh with your Mac off; past meetings stay).
> - **Open:** C2, C4, C5, C10–C12, C14–C21 (narrowed where Mike built part), C24, C25, C27, C29, C31, C32.
> - **Research:** two new lanes landed: [current-state-2026-11.md](./research/current-state-2026-11.md) (what Mike's rethink shipped, read in code) and [morgen-amie-2026-11.md](./research/morgen-amie-2026-11.md) (the two benchmarks feature by feature, Nov 2026). The six October lanes stay as evidence; where they describe the pre-rethink module, current-state-2026-11 wins.
> - **Baseline critique (/product-studio "criticise"):** blocked. The gateway was fixed on 23 Nov, but the shared local database is five weeks behind the app: it was built on 15 Oct from a prod snapshot, and about 100 later repo migrations are missing or only partly in (all of Mike's rebuild among them). The lab's seed fails on the first Calendar call. Nothing was applied; a clean rebuild vs a rehearsed catch-up is Maciej's call (asked 23 Nov). Until it runs, the last recorded scores are Mike's: built module 6.35 and his prototype 7.50 (blind jury, 28 Oct, before the 30 Oct review round).
> - **Prototype:** [`prototypes/round-1b.html`](./prototypes/round-1b.html) (frames 1–9, V cycles variants; the hard states in its state picker), published as https://claude.ai/artifact/Tjf14nEGtYC6N1AhmyvWpo. October's [`structure.html`](./prototypes/structure.html) is history.
> - **Critic rounds on the round-1b prototype** (three blind critics each; overall = 0.375 usability + 0.3125 craft + 0.1875 platform + 0.125 character, speed not judged on a prototype):
>   | Round | Overall | Usability | Craft | Platform | Character | Gates below 8 | Confirmed severity 3 |
>   | --- | --- | --- | --- | --- | --- | --- | --- |
>   | r1 | 6.56 | 6 | 7 | 6 | 8 | none (a11y 8.5) | planning drafts broke working hours, estimates and due dates; titles broke mid-word in busy weeks and at 1280 |
>   | r2 | 6.75 | 6 | 7 | 7 | 8 | none (all ≥ 9.7) | a dense week still unreadable in narrow lanes; the now-and-next line cut to its name at 1280–1440 |
>   | r3 | 7.13 | 7 | 7 | 7 | 8 | none (a11y 10, system 9.7) | none. Still open at severity 2: a dense week's narrow lanes, the error line's length, two Place buttons, the tab path through all-day chips, run-together event names. The confirmed ones were fixed after r3 and not re-scored |
>   - **The bar (8.0) was not met in three rounds**, the studio's limit. Critics agree on the idea every round ("tasks get their time on the grid, and every meeting brings its context before and after"). Character held at 8 throughout; what holds the rest at 7 is polish the build closes, and evidence a prototype can't give (undo, keyboard journeys, speed).
> - **Waiting on Maciej, outside the calls:** is Google's OAuth consent screen published (not "Testing")? In Testing, every Google connection drops after 7 days (§6 #14).
> - **Uncommitted:** nothing after each round's push.
>
> **Numbering:** Calendar calls are **C1, C2, …**, numbered once and never renumbered; new calls start at C22. Tasks v3 calls are cited as "Tasks 64", "Tasks default r". Mike's rethink blocks are "CALR-n". The decisions audit's contradiction list uses its own "C1–C19"; here those are "audit C1".
>
> Branch `t/maciej/calendar-plan` (from `origin/maciej` @ e566e71e, 2026-11-20). The October branch `t/maciej/calendar-replan` is history. Process: [`docs/agents/module-replan.md`](../../docs/agents/module-replan.md) and [`docs/agents/designer-brief.md`](../../docs/agents/designer-brief.md). North star: [`specs/tasks-v3.md`](../../specs/tasks-v3.md). Foundation: [`specs/calendar-rethink.md`](../../specs/calendar-rethink.md) (Mike's, built).

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | What changed since October (§1.0), the diagnosis, what's strong, what Calendar adopts from Tasks v3, the Tasks contract |
| §2 | The shape: as built, and what round 1b proposes to change |
| §3 | One product, every role |
| §4 | Each view, today and its target (round 2a's work) |
| §5 | The visual north star, applied to Calendar |
| §6 | Technical decisions: mine inside the foundation, and the ones that change Mike's foundation (raised as calls) |
| §7 | In-flight work to reconcile (round 3) |
| §8 | The calls |
| §9 | Cross-module asks (Email) |
| §10 | What happens next |

**Goal (from Maciej, 2026-11-21, his words):** "Rethink Moduo's Calendar module as a product. Bring it up to the standard of the best modern calendar apps, with Morgen and Amie as the main benchmarks for the feature set and how it works: time-blocking, scheduling tasks into the day, booking links, several connected calendars. I never found a calendar that worked well for me; that's part of why Moduo exists. Then go past them using what only Moduo has: the links between modules (tasks, email, contacts, notes, chat)."

**Who decides (2026-11-21):** Maciej decides the feature set, UX, UI and how it feels. Mike owns the systems and rebuilt Calendar from late October; we build on that foundation. A change that would clearly improve performance or reliability is raised as a numbered call in product terms, with its cost (C30).

**The October goal** (2026-10-10, kept as the role lens): students, developers, PMs, founders and teams of up to 5, freelancers and agencies, creators, founder-led sales, each running a normal week without Google or Apple Calendar as the daily driver, without a time-blocker and without Calendly. Since the direction talk (2026-10-21) the **first user is a small agency (2–5 people)**; freelancers and solo users should still get the best experience.

**Constraints:** desktop first (minimum window 1024×700); no new top-level routes without Maciej's explicit ask; AI only through MCP.

---

## 1. Diagnosis

### 1.0 What changed since October (2026-11-21)

*From [research/current-state-2026-11.md](./research/current-state-2026-11.md), read in code at `origin/maciej` e566e71e.*

**Mike's rethink, "type it, watch it land"** ([specs/calendar-rethink.md](../../specs/calendar-rethink.md)): 21 blocks landed between 28 Oct and 3 Nov. In product terms:

| Area | What you get today |
| --- | --- |
| **The grid** | Day, Week and **Month**; wall-clock hours in clock-change weeks; the house calendar chip on every event; overlaps side by side, then "+N" that opens a list; the now line; overnight events; "N due" in each day header; the all-day lane capped at two rows |
| **Creating** | One typed box, the **composer** (N, or a click or drag on the grid): words light up as read, the draft previews on the grid, ⇥ hops to the next free time, people and places are read from the line. The old draw popover is gone |
| **Keyboard** | The grid is one Tab stop with a 30-minute cursor; J/K, Space, ↵, ⌥ moves and resize, ⌘C/⌘V/⌘D, Undo on every edit (⌘Z), V Meet link, P private, L link, O offer, Z second zone, ? keys sheet |
| **Google** | **Two-way**: create, edit, move, delete, all written to Google first; "This event / All events" on repeats. Outside guests are invited through Google |
| **Outlook, iCloud, .ics** | **View only.** Outlook connects on the web too (3 Nov); iCloud and .ics only from the desktop app |
| **Tasks on the calendar** | The right panel's **Plan** (From earlier · Due this week · Scheduled · No date); **S** lifts a task to the next free slot that fits, ⇥ and arrows adjust, ↵ places it |
| **Focus time** | A calendar item of its own (holds one task), shown to teammates as "Focus time", **free for booking links** unless a link ticks it |
| **Sharing** | Per calendar (Busy only · Can view · Can edit); **Private** (P) on any event you own; **Preview as** (the glasses on a member's row); members' busy time as opt-in lanes |
| **Booking** | Links in the rail, edited in place; their open times drawn on the week; **offers** (O): pick a few times, copy as a link or text, 48-hour holds that release together; guest reminders and host cancel (TX-6) |
| **Live** | Events from another device, a teammate or MCP appear within seconds |
| **Accounts** | Connect, pick calendars, reconnect on a revoked login, remove with Undo, "New events go to" |
| **Elsewhere** | 12 MCP tools; Home's Today widget shows now-and-next with Join; Mail's Today panel shows today's events; Mail's invite card answers invitations (desktop mail engine) |

**The 30 Oct review round reversed four of those:** panels no longer fold at narrow widths; the Notes view is gone (Details lists everything linked); the draw popover is gone (a click opens the composer); booking links open in the rail's editor, not the right panel.

**Still open in Mike's plan:** CALR-4c (move any event to another calendar), 8b (offline queue), 9b (composer: task prefix, Zoom links, custom calendars), 11b (move a whole Google repeat), 13b (booking links on your working hours), 14b (focus time in Plan), 15b (the Share sheet), 16b (events landing on teammates' calendars), 21b (re-score after fixes). Round 3 reconciles them (§7).

**Never built:** List view; search inside Calendar; alerts before events; answering an invitation in Calendar; a time zone per event; "this and following"; repeat end dates; repeat ghosts; server-side sync; writing to Outlook or iCloud; collective links (built, switched off).

**October's trust bugs, now** (§1.3 B):
- Fixed: B3 (popover lost the draft), B5 (repeats free to teammates and booking), B7 (two clocks), B8 (one drag moved the series), B9 (+N unreachable), B11 (no live updates); mostly B10 (false "couldn't save") and B12 (doubles).
- **Still open:** **B2** (past meetings older than 30 days are deleted on every sync, with their links) and **B6** ("Took longer" logs planned time as worked time).
- **Partly:** **B1** (the grid and Plan show only your work, but the "unfinished from earlier" strip, Home's Move to today and the MCP roll-forward still take teammates' tasks) and **B4** (honest per account, but the toolbar still says "synced 3 min ago" for the freshest one).

**Where Mike's answers differ from what Maciej ratified in Tasks v3** (each is a call below, not settled):

| Tasks v3 / October | Built | Call |
| --- | --- | --- |
| Several work **sessions** per task (Tasks 25, §18) | Placing a task moves its one placement; Calendar can't add a second session. UI and MCP say "block" | ★ C22, C4 |
| A missed session stays put; one set of fixes; nothing moves by itself (Tasks §7, §18) | The old 7-day strip, Review, Move to today (also on Home) and the MCP roll-forward are kept | ★ C3 |
| "Took longer" never logs a planned length (Tasks default r) | It logs the planned length | ★ C3 |
| Your due-only tasks as all-day chips (Tasks §18) | An "N due" count in the day header | C24 |
| Future repeat occurrences as faint ghosts (Tasks §18) | Not drawn | C17 |
| The panel's list is your Focus line-up first (October C2) | Plan has no Up next group | C25 |
| "Focus" is Tasks' view and timer (Tasks 61–66) | "Focus time" is also a calendar item | ★ C23 |

### 1.1 The root cause

*Written 2026-10-10 about the pre-rethink module. Mike's rethink fixed most of the trust bugs it explains; the solo-planner shape still shows in the open conflicts above (one placement per task, the strip, roll-forward).*

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

*October's list (2026-10-10). §1.0 says which of these Mike's rethink fixed; the rest are open.*

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

| Tasks provides | October's position | Built (Nov 2026) | Now |
| --- | --- | --- | --- |
| Your own due-only tasks as all-day chips | Honoured; Month shows them too | "N due" in the day header instead | C24 |
| Several work sessions per task, each a block | Honoured, called **sessions** | Calendar draws your sessions but placing a task moves its one placement; "block" in the UI | ★ C22, C4 |
| Future repeat occurrences as faint ghosts | Honoured, Week and Month | Not drawn | C17 |
| Drag from the Calendar's task list to schedule | Honoured | Plan: drag, click a free slot, or S | Settled |
| ▶ on a block = Focus on this, one clock | Honoured | ▶ runs the one Focus engine | Settled |
| "Took longer" is an adjustment, never a planned length | Honoured (C3) | Logs the planned length | ★ C3 |
| Sessions count as busy for booking links, with a switch per link | Honoured (C9) | Busy by default, per-link switch | Settled |
| Teammates' unassigned tasks stay out of your calendar | Honoured | Grid and Plan: yours only. The strip, Home's Move to today and MCP roll-forward still take teammates' tasks | ★ C3 |
| Missed sessions stay put; the task shows in Upcoming's Earlier; nothing moves by itself | Honoured (C3) | The old strip, Review and Move to today kept | ★ C3 |
| Reminders: one table for tasks | Renegotiate: tasks *and* events | Only task reminders; no event alerts | ★ C13 (§6 #4) |

**What Calendar provides to other modules** (contracts, designed for their rebuilds, not today's code):
- **Focus:** "your next event you're attending, within two hours" for the Up next divider (Tasks 64). Needs attendance on events (C7) and fresh sync (C6).
- **References:** the event preview (title · time · people) and its chip.
- **One busy-time answer per person:** events on the calendars they choose, expanded repeats, sessions (per-link switch), bookings. Used by the grid's Busy, "Find a time", booking links and MCP.
- **Contacts (when rebuilt):** "last and next meeting with Anna", from guests matched to contacts (C7).
- **Email (being re-planned now, on `t/maciej/email-plan`):** the event model behind Mail's invite card, offered times and booking links inside a reply (C28), today's events for Mail's Today panel, and the booking emails. §9 lists the asks both ways.
- **Chat (decided in the Chat re-plan, CH14, 2026-10-13):** `/event` in a message creates an event linked to the conversation, a References link both ways. On Calendar's side that's the ordinary event card and preview; nothing new is needed.
- **Time (Tasks 75):** a meeting can become a time entry (C20).
- **Home:** Calendar's widgets (C15).

---

## 2. The shape: as built, and what round 1b changes

**As built (Nov 2026; prototype frame 1, variant A):**

```
Top bar (global):   modules · Focus timer · Help · bell · you
┌ Left: the rail ─────┬ Centre ───────────────────────────────────┬ Right: [Detail ▾] ────────┐
│ mini-month          │ ‹ › Today · Nov 23–29 · now-and-next ·    │ Detail: the selected     │
│ Calendars           │   "synced 3 min ago" ⟳ · Day Week Month   │   event (Linked, people, │
│   Your calendar     │ fault banner (only when you must act)     │   where, activity)       │
│   Work (Google)     │ "3 unfinished from earlier · Move to      │ Plan: From earlier ·     │
│   Outlook · view    │   today · Review"                         │   Due this week ·        │
│ views: All · Work   │ day headers with "2 due" · all-day lane   │   Scheduled · No date    │
│ Workspace members   │ hours: events · task blocks · focus time  │ pushed items: an offer,  │
│   Tom  ◻ lane  👓   │   · members' lanes · now line             │   a booking link         │
│ Booking links       │                                           │                          │
└─────────────────────┴───────────────────────────────────────────┴──────────────────────────┘
Bottom bar: the global one only (Search · Quick capture · Create new); Calendar adds no tools.
```

**Drawing notes:** keys shown in the frames are placeholders until round 2's key map (two collide with built keys: ⇧⌘C copies an offer's times as text, and / finds a task in Plan). The dense-week state draws an overlap layout only to test legibility; overlaps stay as built in CALR-1 unless a round-2a call changes them.

**What round 1b proposes to change** (each line is a call; frame 1 variant B draws them together):
- Task work on the grid is **sessions**, several per task (★ C22, C4).
- The strip goes; a quiet "2 missed sessions · Review" line shows only when there are some (★ C3).
- Plan gains **Up next** (your Focus line-up) on top (C25), and planning several tasks at once (C11).
- Due work: chips in the all-day lane, the header count kept, or the count only (C24).
- The **bottom bar** gets Calendar's own tools under 48b: ◧ · Search (inside Calendar, C5) · Today · New · ◨ (C2).
- A meeting's Details gains **Before this meeting** and **After this meeting** (★ C26, C27).
- **Invitations** show outlined until you reply, and you reply from Details (★ C7).
- **Alerts** before events (★ C13), and the desktop menu bar shows your next meeting (C29).
- Connected calendars **stay current with your Mac off** and **past meetings stay** (★ C30); Outlook and iCloud become editable (★ C6).

---

## 3. One product, every role

*Written 2026-10-10. Since then Mike built Month, two-way Google, guests through Google and Find a time (⇥ with members); the rest of each row is still open.*

From [research/role-journeys.md](./research/role-journeys.md) (a normal week per role, 23 gaps, sources). **On 10 Oct no role could drop Google Calendar.** Two reasons cover all seven: it's the only place their week reaches the phone and makes a sound before a meeting, and the only place they can invite people or change a meeting someone else made.

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

*Measured 2026-10-10 on the pre-rethink module. Mike's CALR-1 (the house chip, overlaps, "+N") and CALR-4 (keyboard) fixed issues 2, 4, 5 and 7 below; the baseline critique re-measures the rest.*

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

## 6. Technical decisions

**Re-cut 2026-11-21.** October listed these as mine. Since then Mike rebuilt the foundation, and the brief is to build on it. So the list splits in two: (a) choices inside Mike's foundation, which stay mine; (b) changes to his foundation, which become numbered calls in product terms, with their cost, and a note for Mike in the spec and the PR. Each becomes a decision entry (who · what · why · rejected) when the spec lands.

**(a) Mine, inside the foundation**
1. **Sessions are Tasks' `task_sessions` rows.** Placing a task (S, drag, click) adds or moves a session through Tasks' session ops, never `tasks.scheduled_at`, so a task can have several (C22). *Rejected:* keeping the one-placement write (it blocks a second session).
2. **One clock.** ▶ calls the Focus engine. *Already built.*
3. **One busy answer per person** (events, expanded repeats, sessions, bookings, holds) for the grid, Find a time, booking links and MCP. *Mostly built* (`calendar_busy_blocks`, booking-public); members' sessions as Busy to be checked in SQL.
4. **Attendees** keep their stored shape (`attendees` jsonb) and gain matching to contacts by email (C7, C26).
5. **Events in References** with the preview and chip as built; "Private event" and "Deleted event" checked.
6. **Every new user-keyed table** joins `account_erase_workspace_data` and the export in the block that creates it.
7. **Module contract:** every event write stays a server op with activity; MCP tools and the Home widget in round 2b (C32, C15).
8. **Calendar's week start** already reads Time & region; Home's Today widget is moved onto it.
9. **Block ids:** continue Mike's lane (CALR-22…) or open CAL2-*: decided at the spec step.

**(b) Changes to Mike's foundation, raised as calls**
| What | Why it matters to people | Call |
| --- | --- | --- |
| Sync on Moduo's servers, per account, instead of while a Calendar page is open | Calendars stay current with every laptop closed, so members' busy time, booking links, alerts, Focus's meeting divider and MCP are right | ★ C30 |
| Keep past meetings (today anything older than 30 days is deleted on each sync) | A meeting from last quarter keeps its notes, contact and tasks | ★ C30 |
| One reminders table and sender for tasks and events | Alerts before events (C13) and cues (C12) arrive like task reminders | ★ C13 |
| Writing back to Outlook and iCloud (Mike decided "view only" on 27 Oct) | Outlook and iCloud users can move and edit their meetings | ★ C6 |
| A time zone on each event | A weekly call between Warsaw and New York keeps its hour for both | C14 |
| "This and following" and repeat ends for events | Timetables end at term; a series can change from next week | C17 |

**Outside code:** Google's consent screen must be published (in "Testing", refresh tokens expire after 7 days); writing to Microsoft may need publisher verification, which needs a registered company (today's interim entity is Ringdove). Both are Maciej's dashboard steps when their blocks come.

---

## 7. In-flight work to reconcile (round 3)

Tasks v3 has shipped (released 2026-10-14), so October's "waits on" list is history. Round 3 decides, for each piece of Calendar work still in flight, keep · re-scope · fold into this plan · drop, with effort and order:
- Mike's open CALR blocks: 4c, 8b (offline queue), 9b, 11b, 13b, 14b (focus time in Plan, affected by C23), 15b (the Share sheet), 16b (events landing on members' calendars, affected by C7), 21b (re-score).
- Collective booking links (built, switched off by `COLLECTIVE_LINKS_ENABLED`).
- The old CAL-4 loop still mounted (the strip, Review, Move to today, Later · Longer · Remove, `calendar_roll_forward`), retired or kept by C3.
- Capture's provisional Event type (C10).
- Moduo calls as a booking location (later, `docs/decisions/meet.md`).

---

## 8. The calls

**How to answer:** call numbers with ok / no / notes, as for Tasks. Every call has a recommendation, the alternative I'd reject, and whether people outside the target roles would still want it (Tasks 48a).

### Round 1 · the shape (2026-10-10), re-opened 2026-11-21 as round 1b

| Status | Calls |
| --- | --- |
| ✅ Settled (built) | C8; C9 mostly |
| ❓ Open, load-bearing | ★ C1 (narrowed), ★ C3, ★ C6 (narrowed), ★ C7, ★ C13, ★ C22, ★ C23, ★ C26, ★ C28, ★ C30 |
| ❓ Open | C2 (C2a, C2b), C4, C5, C10, C11, C12, C14–C21, C24, C25, C27, C29, C31, C32 |

**★ C1 · The ceiling: Calendar becomes a daily driver, with a line**

> **Status 2026-11-21: partly answered by Maciej; the line re-asked, narrowed.**
> - **Maciej (2026-11-21, his words):** "Bring it up to the standard of the best modern calendar apps, with Morgen and Amie as the main benchmarks for the feature set and how it works: time-blocking, scheduling tasks into the day, booking links, several connected calendars… Then go past them using what only Moduo has: the links between modules." My reading (not his words): the ceiling is a daily driver at Morgen/Amie level, which retires the "Morgen-lite" ceiling and narrows its anti-goal; this call asks him to confirm the line.
> - **Built since (Mike's answers, 27 Oct):** Google two-way; Microsoft, iCloud and .ics view only; Month; guests through Google; Find a time by ⇥ in the composer.
> - **The question left: is this still the line?**
>   - **In:** everything October listed. That includes writing to Outlook and iCloud (C6), alerts (C13), answering invitations (C7), List and search (C5), repeats that end or change from a date (C17), and a zone per event (C14).
>   - **Out, permanently:** rooms and resources; delegation and assistants; out-of-office and working location; meeting polls; free/busy across other companies; sharing a Moduo calendar outside the workspace; in-app AI planning (MCP does that); bot recording and AI summaries (Amie's new core; MCP only).
>   - **Out for now:** a phone app (C16 reaches the phone through Google or iCloud); syncing tasks with outside task apps (Moduo is the task app).
> - *Recommend: yes, this line.* Rejected: keeping Outlook and iCloud view only for good (Outlook is most agencies' client world; Morgen and now Amie write to it).
> - *Outside the target roles?* Yes.
>
> *October's text follows.*
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

> **Status 2026-11-21: built differently (Mike's answer); two pieces re-asked.**
> - **Settled by what's built:** the left rail as Mike built it (mini-month · one Calendars section with saved views as chips · Workspace members with lanes and Preview · Booking links), which is October's rail under other words; booking links in the rail; panels stay as you left them (no folding, 30 Oct).
> - **Re-asked, C2a · the right panel's views:** built: **Detail · Plan**, plus pushed items (an offer, a booking link). Options: (a) keep the two; (b) add **Day** (the picked day as a list, the default beside Month); (c) add **Prep** for meetings (see C26). *Recommend (a), plus Day only if Month use asks for it in round 2a.* Prep lives inside Detail (C26).
> - **Re-asked, C2b · the bottom bar:** built: the global bar only, against 48b's rule that the bottom bar holds the module's tools and each panel's toggle. Options: (a) ◧ · Search (inside Calendar, C5) · Today · New · ◨, with the multi-select action row (Tasks 82b) swapping in; (b) keep the global bar. *Recommend (a).* Why: every other rebuilt module follows 48b, and Calendar's Search needs a home.
> - Prototype frame 1 (A as built, B proposed).
>
> *October's text follows.*
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
  4. in the toolbar, the sync status ("Updated 10:42 AM") moves into the refresh button's tooltip before the range label shortens.
  - My first draft folded the left panel first, to keep the Tasks list beside the week for planning. The audit's measurements and 48b win: planning a week is a bigger-window job, and the Tasks list is one toggle away.
- *Recommend: yes, this shape.* Rejected: booking links in Settings (they're everyday objects for sales and freelancers, and their bookings live on the grid); People as a panel view (overlaying someone's time is about the grid, so it sits with the calendars).
- *Outside the target roles?* Yes.
- Prototype frames 1, 2, 3, 4 and 9 (variants: right folds · left folds · both open).

❓ OK?

**★ C3 · A missed session: one state, one set of fixes, shown where you are**

> **Status 2026-11-21: open, and in conflict with what's built.** Built: the old 7-day strip ("3 unfinished from earlier · Move to today · Review"), Move to today on Home, the in-grid Later today · Took longer · Remove, and the MCP `calendar_roll_forward`. Three of them still take teammates' tasks, and "Took longer" logs planned time as worked time (trust bugs B1, B6). Tasks v3, ratified by Maciej, says a missed session stays put and nothing moves by itself. October's recommendation below stands, with one addition: **the strip, Move to today and `calendar_roll_forward` retire** (roll-forward becomes the MCP form of "Fit into today", C11), and Plan's **From earlier** lists both, each labelled: overdue due dates ("Due Mon · Nov 23") and missed sessions ("Missed Wed 3:30 PM"); the task row under Scheduled also says "1 missed". *Recommend: yes.* Prototype frame 2.
>
> *October's text follows.*
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

> **Status 2026-11-21: built differently (Mike's answer); re-asked.** Built: "task block" ("Task placed", `calendar_move_block`), "Plan" for the task panel, "Focus time" for a calendar item, "Workspace members" for teammates, "Detail". The question: do October's names hold?
> - **Session** (never block) for time set aside to work on a task: *recommend yes* (Tasks 25 already says sessions; toasts already say "Session moved").
> - **Plan** for the right panel's task list: *recommend keep Mike's word* (it's a verb a calendar owns; "Tasks" would clash with the module).
> - **Details** (plural, as Tasks) instead of "Detail": *recommend yes*, one word app-wide.
> - **Workspace members**: *recommend keep* (decided 30 Oct, app-wide).
> - **Focus time**: see ★ C23.
> - Retired as October listed, plus "unfinished from earlier" and "roll forward".
>
> *October's text follows.*
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

> **Status 2026-11-21: Month settled (built); List, Display and search re-asked.**
> - **List:** the coming days as one scrolling list under day headers ("Thu · Nov 26"), events, sessions and due work as rows. *Recommend yes* (both benchmarks have an agenda view; a week of meetings has no list anywhere in Moduo).
> - **Search inside Calendar:** today Search opens the app-wide palette. *Recommend:* Search in Calendar's bottom bar (C2b) searches events past and future and shows the results as the List view, the query highlighted.
> - **Display:** Show weekends · Show declined · Days in week (5 · 7) · Second time zone, moved out of the Working hours sheet. *Recommend yes.*
> - Prototype frame 8.
>
> *October's text follows.*
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

> **Status 2026-11-21: partly settled; narrowed to writing to Outlook and iCloud.** Built and settled: Google writable from the web and desktop, Google-first with rollback; "New events go to" (the default calendar); honest per-account freshness; Reconnect. **Freshness with your Mac off and past meetings now have their own call, ★ C30.**
> - **The question left:** Mike decided on 27 Oct that Microsoft, iCloud and .ics stay view only. Should Outlook and iCloud become editable (move, change, delete, create, guests), as Google is?
>   - (a) Yes, Outlook first, then iCloud and other CalDAV. Cost: about two blocks each, on Mike's Google pattern (write first, then the mirror stores the answer). Outlook needs a wider Microsoft permission, which every Outlook user re-consents to once, and may need Microsoft's publisher verification, which needs a registered company (today's interim entity is Ringdove; §6).
>   - (b) Outlook only.
>   - (c) Keep view only.
> - *Recommend (a).* Why: Morgen writes to both, and Amie added Outlook two-way in August 2026. An agency's clients live in Outlook, and a calendar you can't edit sends you back to Outlook's own app. Rejected (c): Moduo stays a second calendar for half its users.
> - **iCloud's password choice** (October's last bullet below) stands, only if (a).
> - Prototype frame 9.
>
> *October's text follows.*
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

> **Status 2026-11-21: partly built; ★ load-bearing now.** Built: outside guests from the composer, invited through Google; replies shown read-only in Detail; members named in the composer (not invited: Mike's 16b is open). **Not built:** answering an invitation in Calendar (Mail's invite card can, on the desktop mail engine); adding or removing guests in Detail; an invitation for outside guests on a Moduo calendar; guests linked to contacts.
> - **The question:** take October's recommendation below, with three additions?
>   1. **One invitation, two places:** an invitation you receive is outlined on the grid until you reply, Details has Yes · No · Maybe, and Mail's invite card answers the *same* invitation. Reply in one place and the other shows it. Mail owns how its card looks (§9).
>   2. **"2 invitations waiting · Review"**, a quiet line above the grid only when there are some (Morgen collects pending invitations in one place).
>   3. **Members land on members' calendars** (Mike's 16b): naming a member in the composer invites them, as October's "workspace members reply in the bell".
> - *Recommend: yes, all three.* Rejected: invitations answered only in Mail (Calendar users never see them; the web has no mail engine yet).
> - Prototype frame 5.
>
> *October's text follows.*
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

> **Status 2026-11-21: settled by Mike's build (CALR-16, 30 Oct), matching October's recommendation; Maciej, say if not.** Members are opt-in lanes in the rail, each with their name; repeats count every week; naming members in the composer shows their busy time and ⇥ finds a time when you're all free. To check in the spec: members' sessions count as Busy.
>
> *October's text follows.*
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

> **Status 2026-11-21: mostly settled (built, CALR-17, 30 Oct).** In the rail, edited in place; open times drawn on the week; sessions busy by default with a per-link switch; focus time free by default (C23). Left open: collective links ("a call with me and Tom") are built but switched off (round 3); a booking lands on your default calendar, so Outlook and iCloud hosts get a real event only after C6. Client-work depth is C19.
>
> *October's text follows.*
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

> **Status 2026-11-21: built differently (Mike's answer); the capture type re-asked.** Built: N (web ⌥N), a click or a drag on the grid all open one typed **composer**; the draw popover and October's Event · Session toggle are gone; S places a task; F turns a lifted task into focus time. Settled: the composer is the way to create on the grid.
> - **The question left: ⌘⇧K then ⌘4 (capture as Event)** is still a provisional one-liner on the Tasks parser. Options: (a) the capture's Event type *is* the composer (the same words light up, the same echo "Thu 1:00 PM · Work · with Priya", ↵ adds), so typing an event works the same from any page; (b) its own small form. *Recommend (a).*
> - **And:** "task" at the start of the line ("task write brief thu 2pm") makes a session for a new task (Mike's 9b). *Recommend yes.*
>
> *October's text follows.*
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

> **Status 2026-11-21: open; re-asked with a week option.** Built: S places one task at a time; "Move to today" from the old loop is still there (C3 retires it). Morgen's Planner proposes a 1–7 day plan you approve; one third-party review calls the approval step tedious. The question:
> - (a) **"Fit N into today"** as October proposed;
> - (b) (a) **plus the week**: select tasks in Plan (or the missed ones), choose Today or This week; drafts appear on the grid dashed, in your order, inside working hours, around events; ⇥ moves the selected draft to its next free slot; ↵ places them all with one Undo. The draft on the grid *is* the approval: no separate screen.
> - **What the frames add (after the critics):** a task that doesn't fit shows "Doesn't fit today · next free Fri 4:15 PM" and stays unticked; a placement after the due date is unticked by default and says so; the panel lists Picked and Not picked; one Place N ↵ commits.
> - *Recommend (b).* Why: agencies plan Monday for the week; Sunsama and Morgen users do. Nothing moves without ↵. Rejected: Motion-style automatic re-planning (top churn reason). `calendar_roll_forward` becomes this gesture for MCP.
> - Prototype frame 2, variants B and C.
>
> *October's text follows.*
- **What:** pick tasks (your Up next, the missed ones in C3, or a selection) and "Fit 3 into today": Moduo places them in today's free time, in your order, inside your working hours, around your events. You see the result on the grid; one Undo puts everything back.
- **It replaces** "Move to today", "Later today" for several, and the old "reflow my day". The morning-plan and evening-shutdown rituals are not built: Focus's "Line up today's scheduled tasks" and Upcoming's Earlier cover those moments (audit question 13).
- **Never:** moving anything by itself, or anything you didn't pick.
- *Recommend: yes.* Rejected: Motion-style automatic scheduling (its top churn reason); none at all (Sunsama and Akiflow users plan this way every morning).
- *Outside the target roles?* Yes.
- Prototype frame 5, variants Review and After Fit.

❓ OK?

**C12 · Cues: "remind me at my next meeting with Anna"** *(Tasks 58, parked until this rebuild)*

> **Status 2026-11-21: open, unchanged.** Nothing built. The Morgen/Amie lane found no competitor that does this. It depends on C7 (guests linked to contacts) and C13 (alerts). It now also shows in C26's "Before this meeting". *Recommend: yes, meetings only, as below.*
>
> *October's text follows.*
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

> **Status 2026-11-21: open; ★ load-bearing.** Nothing built: only task reminders and booking guests' reminders exist. Both benchmarks have it, and it's the gap every role names first. The table below stands, with two additions:
> - **On time or not at all:** one 2026 Morgen review says its phone alerts arrive "hours late". An alert that can't arrive within a minute of its time (laptop asleep, browser closed) is dropped, never sent late. Google or iCloud on your phone still alerts you there.
> - **The sender:** one reminders table and sender for tasks and events (§6 b). Cost: about one block on top of Tasks' reminder sender; no new channel.
> - *Recommend: yes.* Prototype frame 6.
>
> *October's text follows.*
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

> **Status 2026-11-21: second zone settled (built, Z, per device); a zone per event re-asked.** Today the server expands repeats in the owner's zone and an event has no zone of its own. **The question:** should an event keep the zone it was made in, so "9:00 London every Tuesday" stays 9:00 London for a member in Warsaw (shown as 10:00), with "3:00 PM · 9:00 AM New York" when they differ? *Recommend yes* (cost: a column and the expansion change, about half a block, Mike's foundation). Rejected: leave it (repeats between zones drift an hour at each clock change).
>
> *October's text follows.*
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

> **Status 2026-11-21: partly built.** Today gained now-and-next with Join (CALR-21). Still there: "N unfinished from earlier · Move to today" (retired by C3), week start hard-coded to Monday and default working hours (fixed as §6 a #8). *Recommend:* as below, with "2 missed sessions · Review" replacing the strip line.
>
> *October's text follows.*
- **Recommend:** one **Today** widget: the next 3–4 things on a small timeline with the now line, your next meeting with Join, and "2 missed sessions · Review". The old "strip count + Move to today" goes with C3. Other widgets (a week glance, a booking-links summary) only if round 2 shows a role needs them.
- *Outside the target roles?* Yes.

❓ OK?

**C16 · Your plan, outside Moduo** *(opening call; new, from the role lane's gaps G1, G2, G11)*

> **Status 2026-11-21: open, unchanged.** Nothing built. Morgen's "calendar sync" (copy personal busy time to the work calendar) is a Pro feature its users value. *Recommend: yes, as below.* It needs C6 for Outlook and iCloud targets; Google works today.
>
> *October's text follows.*
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

> **Status 2026-11-21: open.** Built: "This event / All events" for Moduo and Google repeats. Not built: "This and following", an end date or a count, repeat ghosts for tasks (Tasks §18), one picker shared with Tasks. *Recommend: yes, as below, plus repeat ghosts for your repeating tasks in Week and Month* (a Tasks contract).
>
> *October's text follows.*
- **Recommend:** events use Tasks' repeat picker (Tasks 27i): presets, Custom (every n, days, nth weekday, end "until Dec 15" or "after 10 times"), one plain summary line, and the same words in capture. Changing one occurrence asks "This event · This and following · All events" (Tasks says "Just this one · Change the pattern"; events need the middle option because other people's calendars share the series).
- *Recommend: yes.* Rejected: keeping Calendar's own repeat picker (two pickers, two grammars, audit C9).
- *Outside the target roles?* Yes: school timetables, courses, a skipped standup.

❓ OK?

**C18 · What else you can show on your calendar** *(opening call; gap G8 and the "not in any role" list)*

> **Status 2026-11-21: open, unchanged.** Holidays come only as Google's own read-only calendars today. *Recommend: yes, as below.*
>
> *October's text follows.*
- **Recommend**, each one ticked on in the left panel, off by default, so your grid stays your own work (Tasks default r):
  - **a project:** its tasks' due dates (anyone's) and its section dates, in the project's colour. A creator's content calendar or a PM's release month in Month view, without leaving Calendar;
  - **birthdays** from your contacts (Contacts already stores dates);
  - **public holidays** for your country.
- *Recommend: yes.* Rejected: project calendars as a separate kind of calendar you manage (more structure; the project already holds the dates).
- *Outside the target roles?* Yes for birthdays and holidays (households); projects are team work.

❓ OK?

**C19 · Booking links for client work** *(opening call; gaps G13, G15–G17)*

> **Status 2026-11-21: partly built.** Built: guest reminders and host cancel (TX-6); **offers with holds** (October's item 4, as O). Not built: reschedule, several lengths on one link, no-show. The question, lettered so October's numbers below keep their meaning: (a) reschedule by the guest (October's 1; Morgen's Open Invites and Calendly have it); (b) several lengths on one link (October's 3); (c) mark a no-show (October's 5); (d) optional co-hosts (Morgen's Team plan: "if Tom is free too, add him"). *Recommend a–c now, d with collective links in round 3.* Booking emails for reschedule are shared with Email (§9).
>
> *October's text follows.*
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

> **Status 2026-11-21: open, unchanged.** It now sits in C27's "After this meeting" row. *Recommend yes.*
>
> *October's text follows.*
- **Recommend:** on a past event linked to a task (or a project), **"Add 45m to time"** in its Details logs a time entry (Tasks 75) for you, dated that day, with the event's title as the note. Never automatic. So an agency's client calls reach the client's time report.
- *Recommend: yes.* Rejected: logging every meeting automatically (time tracking must stay what you chose to record, Tasks 63).
- *Outside the target roles?* Billing work (consultants, lawyers, agencies).

❓ OK?

**C21 · Quiet hours and your own alerts** *(opening call; added 2026-10-13 from the Chat re-plan)*

> **Status 2026-11-21: open, unchanged** (depends on C13). *Recommend yes, as below.*
>
> *October's text follows.*
- **Where it comes from:** the Chat re-plan decided quiet hours (CH41): one setting in Time & region (TV-D14) that holds every module's notices during the hours you choose. It left one question to Calendar: do alerts you set for yourself break through?
- **Recommend:** **alerts you set yourself still arrive during quiet hours**: an event's alert (C13), a task reminder (Tasks 24) and a cue (C12). You asked for that moment, often for something early (a 7:00 AM flight, a dentist before work). Everything that comes from other people (invitations, changes, replies, bookings, mentions) waits until quiet hours end, then arrives as one grouped bell entry.
- *Recommend: yes.* Rejected: quiet hours silencing everything (the alert you set for an early meeting would arrive after it started); a per-alert "break through" switch (one more choice on every alert, for a rare case).
- **Note:** this also decides it for task reminders, which Tasks §13 lists as arriving "at its time, on its own"; it keeps that promise.
- *Outside the target roles?* Yes: everyone who sets a morning alarm.

❓ OK?

### Round 1b · new calls (2026-11-21)

*From Mike's rethink (where it differs from Tasks v3), the Morgen/Amie lane and what only Moduo can do. Every call reads on its own; the prototype frame is a pointer.*

**★ C22 · A task can have several sessions, and Calendar makes them**
- **Today:** the grid draws your sessions, but placing a task (S, drag, click a free slot) moves its *one* placement. So you can't put "Halden brand guide · 5h" on Tuesday morning and again on Thursday. The UI calls them blocks.
- **Options:**
  - (a) **Every placement adds a session.** S, drag or a click adds one; the task row in Plan reads "2 sessions · 3h of 5h". Dragging an existing session moves only that one. Unschedule removes one session; the task stays.
  - (b) Keep one placement per task (a second S moves it).
- *Recommend (a).* Why: Tasks v3 decided it (Tasks 25, §18) and the data already holds several sessions. Morgen splits long tasks and Sunsama and Reclaim plan in chunks. Rejected (b): a 5-hour task has to become fake subtasks to be planned.
- **Finishing early frees the rest:** "Done · freed 2 sessions · Undo" (October's C3).
- *Outside the target roles?* Yes: anyone with work longer than a sitting.
- Prototype frame 1 variant B, frame 2.

**★ C23 · Focus time: what it is, beside Tasks' Focus**
- **Today (Mike's answer, 27 Oct):** "Focus time" is a calendar item that holds one task. Members see it as "Focus time" and it counts as busy for them. Booking links can book over it unless a link ticks it. Meanwhile "Focus" is Tasks' view and timer, and ▶ on a session starts it.
- **Options:**
  - (a) **Keep it as built.** Name it as it is: focus time is time you hold for Focus; ▶ on it starts Focus on its task.
  - (b) **(a), and it can hold a project or a tag** instead of one task ("Deep work · Halden rebrand"). When it starts, Focus lines up that project's open tasks by your order, and "Fit into this week" (C11) fills it first. This is Morgen's Frames without its catch (moving a Frame leaves its tasks behind; here they move with it).
  - (c) **No separate item.** Focus is a property of a session ("hold this as focus"); time with no task is an ordinary event.
- *Recommend (b).* Why: it answers Morgen's Frames, the one planning feature Moduo lacks, with what's already built. Rejected (c): it undoes a shipped feature for a naming tidy-up.
- **And booking:** keep Mike's default (links can book over focus time unless the link ticks it), or flip it (links never book over it)? *Recommend keep* the default, because each link already has the switch.
- *Outside the target roles?* Yes: students and developers hold study and deep-work time.
- Prototype frame 3.

**C24 · Due work on the calendar: header counts or chips**
- **Today (Mike's answer, CALR-2):** each day header shows "2 due", which opens that day's list. Due tasks never sit in the all-day lane, which used to bury the hours. Tasks v3 §18 promised "your own due-only tasks as all-day chips".
- **Options:**
  - (a) Keep the **header count** in Day and Week, and show **chips in Month** and in a day's list. Renegotiate Tasks §18 to say so.
  - (b) **Chips in the all-day lane** as promised, inside the two-row cap, plus the header count.
  - (c) The count only, everywhere.
- *Recommend (a).* Why: the count fixed a real problem (an uncapped lane), and Month is where a creator's or a student's due dates are read. Rejected (b): due chips compete with all-day events for two rows.
- **Which frame is which:** frame 1 **B** draws option (b) (and is also the base of every hard state, for drawing only); **C** and **D** (Month) draw option (a).
- *Outside the target roles?* Yes.
- Prototype frame 1 (variants B and C).

**C25 · Plan: what the panel lists**
- **Today:** Plan lists From earlier (overdue due dates) · Due this week · Scheduled · No date, only your tasks, six rows each, then Show more.
- **Options:**
  - (a) Add **Up next** on top (your Focus line-up, Tasks 61), then the four groups as built. A missed session (C3) shows in From earlier with "missed Tue 2:00 PM".
  - (b) Keep the four groups.
- *Recommend (a).* Why: the line-up is what you mean to work on next, so it's what you plan first. October's C2 asked for it; Amie's "Inbox → drag" and Morgen's task panel both start from your own order.
- *Outside the target roles?* Yes.
- Prototype frame 1 variant B.

**★ C26 · Before a meeting: everything you know about these people, in Details**
- **What only Moduo can do.** A meeting with Anna from Halden is already linked, or linkable, to Anna's contact, the email thread about the kickoff, the tasks you owe her, the notes from the last call and the client channel. Competitors need a CRM or paid AI to show any of it.
- **The proposal:** an upcoming meeting's Details gets **Before this meeting**, built only from links, never from a model:
  - for each guest who is a contact: last met, next meeting, the latest email thread with them;
  - open tasks between you and them (assigned to you, linked to them or their project);
  - the note from the last meeting in this series, or the last one with these people;
  - the latest decision in the shared chat channel;
  - cues for this meeting (C12).
  - Each item is a reference that opens in the panel ("← Halden kickoff").
- **Options:**
  - (a) a section in Details, above Linked, shown only when it has something;
  - (b) its own right-panel view, **Prep**, in the title dropdown;
  - (c) only in Day view's free width (built today: people, notes, one follow-up).
- *Recommend (a), and keep (c).* Why: Details is where the meeting already is, and the section hides when empty. Rejected (b): one more view to switch to at the moment you have the least time.
- *Outside the target roles?* Yes: anyone who meets the same people twice.
- Prototype frame 4 (A in Details, B as its own view).

**C27 · After a meeting: one gesture each to carry it forward**
- **The proposal:** a past meeting's Details gets one quiet row, **After this meeting**:
  - **Add 45m to time** (C20), on the linked task or project;
  - **Turn note lines into tasks**: select lines in the meeting note, then one gesture makes them tasks linked to the meeting and its guests;
  - **Draft a follow-up email** to the guests, opening Mail's compose with the thread and the note linked (Email owns the compose; §9);
  - **Post to the channel**: share the note's summary lines into the client's chat channel.
- **Options:** (a) all four; (b) time and tasks only; (c) none, so links stay manual (L).
- *Recommend (a).* Why: the follow-up is where Amie went (as AI). Moduo does it with links, and the person does the writing. Rejected: auto-made tasks or emails (MCP-only AI).
- *Outside the target roles?* Billing and client work mostly; tasks from notes is universal.
- Prototype frame 4 variant C.

**★ C28 · Scheduling from an email thread**
- **What only Moduo can do.** "When are you free next week?" arrives in Mail. In Gmail you need Gemini; in Moduo, Calendar knows your free time and Mail knows the thread.
- **The proposal (Calendar's side):**
  - from a reply, **Offer times** opens Calendar's offer (O) with the thread's people already in it and the times held dashed on your week;
  - **Insert in reply** puts the times and a booking link into the reply;
  - when the guest picks one, the event is made **linked to the thread, the contacts and the offer**, and the holds release;
  - a booking link can be inserted the same way.
- Mail owns the button and the reply; Calendar owns the offer and the event (§9). Frame 7 draws the offer in Calendar's own right panel; inside Mail, Email's call 30 hosts the same offer in Mail's right panel (its "Schedule" view). One offer, two places.
- **Options:** (a) offers and booking links from a reply, linked as above; (b) booking links only; (c) leave it to copy and paste.
- *Recommend (a).* Rejected (c): the links are the point.
- *Outside the target roles?* Yes: anyone who schedules by email.
- Prototype frame 7.

**C29 · The desktop menu bar and a quick add from anywhere**
- **Today:** the desktop app has a menu-bar icon that keeps Moduo running, and it shows nothing.
- **The proposal:** clicking it shows your **next meeting with Join**, the rest of today, and "New event…" (the composer, C10). An alert (C13) comes from the same place.
- **Options:** (a) yes; (b) Join only; (c) leave it.
- *Recommend (a).* Why: Notion Calendar, Amie and Morgen all have a menu-bar calendar, and Moduo already has the icon.
- *Outside the target roles?* Yes.
- Prototype frame 6 variant B.

**★ C30 · Calendars stay current with your Mac off, and past meetings stay** *(a change to Mike's foundation)*
- **Today:**
  - connected calendars update only while a Calendar page is open somewhere: on opening, on waking, every 15 minutes;
  - iCloud and .ics update only on the Mac that connected them;
  - every sync deletes mirrored meetings older than 30 days (or more than 120 ahead), with their links to notes, contacts and tasks.
- **What people feel:** a member's busy time, a booking link's open times, an alert (C13), Focus's "meeting in 20 minutes" and MCP's answers can be stale whenever nobody has Calendar open. Last quarter's client meetings vanish.
- **The proposal:**
  - Moduo's servers keep each connected calendar current (within about five minutes; Google and Microsoft can push changes sooner);
  - meetings stay as far back as you've had the account, with their links.
- **Cost:** about three blocks in Mike's area (a scheduled sync per account, the iCloud password stored encrypted with your consent per October's C6, keeping history). It's the base for C13 alerts, C16 and accurate booking.
- **Options:**
  - (a) both, now;
  - (b) keep past meetings now and server sync later;
  - (c) neither.
- *Recommend (a).* Why: it's the only way alerts and booking links can be trusted. Rejected (c): every feature that runs while you're away stays quietly wrong.
- *Outside the target roles?* Yes.
- **For Mike:** recorded as a foundation change in the spec's assumptions and the PR.
- Prototype frame 9.

**C31 · Travel time and buffers between meetings**
- **Today:** buffers exist on booking links only.
- **The proposal:** an event with a place can add travel time before and after it (you type the minutes, or pick 15 · 30 · 45). The travel shows as a faint band and counts as busy. No maps service.
- **Options:** (a) now; (b) later; (c) never.
- *Recommend (b), later.* Why: Morgen has it and Amie's users asked; agencies mostly meet online. One small block when someone needs it.

**C32 · MCP: what an assistant can do with your calendar** *(opening call; detail in round 2b)*
- **Today:** 12 tools, three of them named after "blocks" and "roll forward".
- **The proposal:**
  - rename to sessions (C4) and to "fit into today or this week" (C11);
  - add answer an invitation (C7), find a time with people (C8), the meeting prep read (C26) and offer times from a thread (C28);
  - every write stays an attributed op you can undo.
- *Recommend: yes.* Amie shipped an official MCP in July 2026; Morgen has none.

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
11. **Past dates and times follow the app-wide grammar** (Chat re-plan CH29c, rule 41): "Today · Yesterday · Mon · Oct 9 · Oct 9, 2025", never "2 hours ago", for any history or "last edited" line. In Calendar that covers the activity feed, "last met" on a contact card and the sync status ("Updated 10:42 AM", not "synced 3 min ago"); §5's date-grammar fix follows it.

---

### Consistency pass (round 1b)

1. **One word per thing, with what's built:** session (C4, C22), Plan (C25), Details, Workspace members, focus time (C23), offer and booking link (C19, C28). "Block", "roll forward" and "unfinished from earlier" retire everywhere, MCP included (C32).
2. **Nothing moves by itself:** C3 retires the strip's Move to today and the MCP roll-forward; C11's drafts land only on ↵; C23 (b)'s focus time fills only when you place.
3. **The quiet lines above the grid** (missed sessions C3, invitations waiting C7) share one row and one look, side by side, each with its own Review, and show only when they have something. A fault takes the toolbar's status slot instead ("Google not updated since 9:12 AM · Try again").
4. **Details grows, in this order:** the event · Before this meeting (C26, upcoming only) · After this meeting (C27, past only) · people · where · Linked · activity.
5. **Calendar's side of the Email seam** is the event, the offer and the invitation state; Mail owns its card, its compose and its Today panel (§9).
6. **Foundation changes** (C6, C13, C14, C17, C30) are raised as calls with costs, never slipped in as "technical".

---

## 9. Cross-module asks (Email)

The Email re-plan runs at the same time on `t/maciej/email-plan` (`.design/email-v4/REPLAN.md`, its §7; calls 30 and 31 are its side of C28 and C7). Calendar owns the event model and its own screens; Email owns how these look and behave inside Mail.

**What Calendar asks of Email:**
1. **Invitations:** Mail's invite card answers the same invitation Calendar shows (Yes · No · Maybe go through the event's provider), and shows the reply already given in Calendar (C7).
2. **Offer times and booking links from a reply:** a button in Mail's reply that opens Calendar's offer with the thread's people, and accepts the inserted text plus link back into the reply (C28).
3. **A follow-up draft from a meeting:** Mail's compose opened from a past meeting with the guests, the thread and the meeting note linked (C27).
4. **Threads link to events:** when a booking or an offer made from a thread becomes an event, the thread shows the event as a reference.

**What Email asks of Calendar** (read from `origin/t/maciej/email-plan` §7, commit a83e602a, 2026-11-21), and Calendar's answer:

| Email's ask | Calendar's answer |
| --- | --- |
| 1. Accept · Maybe · Decline an invitation into the right calendar, return the event, report conflicts with the person's day | Yes: the same invitation state as C7 (Details' Yes · No · Maybe), written through the event's provider; the conflicts are the day's events in that slot (the composer's clash check, already built) |
| 2. Free slots for a range with working hours and buffers, and holds that stay tentative until booked or released | Yes: that is Calendar's offer (O), built with 48-hour holds (CALR-19); Mail's Schedule panel hosts it (C28) |
| 3. List booking links with a short URL each; a booking from a link Mail sent links the event to that email | Yes (C28): the links list is built; the link to the email is new, carried by the offer or link token |
| 4. An event from an email: its people as guests, the subject as title, linked both ways | Yes: the composer prefilled from the email (guests, title), saved with the link (C10, C28) |
| 5. Mail's Today view shows Calendar's day, drawn the way Calendar draws a day | Yes: Calendar provides one compact day component (the List view's day, C5, with now-and-next and Join), the same one Home's Today widget uses (C15) |
| 6. Booking emails open their event, not read as ordinary mail | Agree to Email's middle: ordinary mail, with the event as the first item in the email's link line |

**What Calendar provides to Email:**
1. **Today's events** for Mail's Today panel (built, 4 Nov), moving to the shared compact day component above.
2. **The event behind an invitation**, with its RSVP state and calendar, for Mail's card.
3. **Booking emails** (confirmation, reminder, cancel, reschedule once C19 lands) stay Calendar's content in the transactional templates; Mail shows them as mail with the event first in the link line.

**Open between the two sessions:** none. Email's call 30 (Schedule) and 31 (invites with your day beside them) match C28 and C7; whichever way Maciej answers, the other session follows.

---

## 10. What happens next

1. Maciej answers round 1b; answers are recorded under each call, in his words.
2. The baseline critique runs as soon as the local database is level with the app (Maciej's call, 23 Nov); its holes are folded in, and anything that changes a recommendation is re-asked.
3. **Round 2a:** every view and state (Week, Day, Month, List, Details, Plan, the composer, offers, accounts), with frames for empty, loading, error, offline, long content, the densities, light and dark.
4. **Round 2b:** the shared pieces (capture type, References, MCP tools, notifications, Home widget), then a gap audit by a separate agent.
5. **Round 3:** in-flight work (§7).
6. **The final prototype** through /product-studio's critic loop, then "Turn into spec" (`specs/calendar-v2.md`), with /s1 grilling only the gaps, a frame cited for every UI section, waves of blocks and the Definition-of-Ready gate.

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
| [research/current-state-2026-11.md](./research/current-state-2026-11.md) | What Mike's rethink shipped, read in code (2026-11-21): blocks, capability matrix, B1–B12 and C1–C21 now, keys and panels as built, conflicts | landed, folded into §1.0, §1.5, §2, §6, every Status line |
| [research/morgen-amie-2026-11.md](./research/morgen-amie-2026-11.md) | Morgen and Amie feature by feature (Nov 2026), interactions worth copying, what not to copy, what only Moduo can do | landed, folded into C1, C6, C11, C13, C16, C19, C22–C32 |
