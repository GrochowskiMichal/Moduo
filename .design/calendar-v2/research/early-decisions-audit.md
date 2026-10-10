> Raw research report from the Calendar re-plan, 2026-10-10 (branch t/maciej/calendar-replan). Nothing here is decided.

# Lane 3: audit of the early Calendar decisions (keep, adjust or reverse)

_Read-only audit on `t/maciej/calendar-replan` @ `11f4c7ac`, 2026-10-10. Sources: `docs/decisions/calendar.md` (every entry, 2026-06-24 → 2026-10-08), `.design/calendar/BRIEF.md`, `.design/calendar/DESIGN_BRIEF.md` (§1–§13), `.design/calendar/COMPETITIVE_RESEARCH.md`, `specs/calendar.md` (Assumptions 1–21, Out of scope), `docs/ROADMAP.md` (Wave 2, Q9, Q12, line 74), `docs/PRODUCT_BRIEF.md` §2 and §6, and the code that shipped (`src/features/calendar/`, `supabase/functions/calendar-google-web`, `booking-public`, `_shared/google-calendar.ts`, `_shared/zoom.ts`, `src-tauri/src/commands/calendar.rs` + `caldav.rs`, the calendar, booking and PERM migrations). Judged against the binding Tasks v3 decisions: `specs/tasks-v3.md` §2, §8, §13, §14, §18 and Assumptions 4, 11, 16, 17, 21; `.design/tasks-v3/research/views-list-upcoming.md` §6 and §10 (the Calendar contract, rows 1–10); `.design/tasks-v3/REPLAN.md` calls 25, 26, 27f/g, 58, 64, 72/72a, 73, 76, 90/90b, defaults d and r; `.design/tasks-v3/research/current-state-focus-calendar-home.md` §3–4 for what the code does today._

Verdict key, as in the Tasks audit: **KEEP** (a real strength) · **ADJUST** · **REVERSE** · **OPEN** (needs the designer) · **DONE** (already reversed or shipped; listed as evidence). Cost: S/M/L.

Words used below: a **session** is one planned block of time for a task (Tasks v3's `task_sessions` table: task, person, start, end). **Missed** means a task's last planned session has passed and the task is still open. The **strip** is today's "N unfinished from earlier" line above the grid. The **mirror** is the copy of your Google/Outlook/iCloud events that Moduo keeps in its database so the web app, agents and links can see them.

## 0. The root-cause test

**The hypothesis holds, with one second shape.** Calendar was planned on 2026-07-02 for one person ("The user is a solo or partner operator", BRIEF §1; "The bar: Maciej uses Morgen daily", DESIGN_BRIEF header). Every reversal since, made or still needed, has one of two shapes:

1. **A solo planner's habit stored as the data model** (the Tasks pattern). This covers the loop, the task lens, scope, time and sync.
2. **A boundary stated as a principle, then crossed feature by feature without a model.** "External calendars are read-only, structurally" (DESIGN_BRIEF §8, spec Assumption 4) was crossed three times in October (web Google create, booking's Google and Zoom writes, cancel deletes) with no write-back design behind it. This one is not about solo use. It is about a plan that said "v2" while the code moved on.

A third flavour is a special case of the first: **"the planner's laptop is the server."** Sync runs only while the Calendar page is open, and iCloud/Outlook credentials live only in the connecting Mac's keychain. That is right for one person on one machine and wrong for teams, the web, agents and booking.

| # | Decision (where) | The solo assumption | What replaced it or must |
| --- | --- | --- | --- |
| 1 | A task block **is** the task row; one placement per task (`scheduled_at` on the task) — DESIGN_BRIEF §2, spec A1 | One person plans each task once, in one sitting | `task_sessions` with a `user_id` (Tasks A4, call 25). The person column is the tell |
| 2 | Block length = the task's estimate, "deliberate" — DESIGN_BRIEF §4; a drop writes `durationMinutes \|\| 30` onto the task | The planner's guess is the plan | Session length ≠ estimate; 30 min goes on the session only (contract row 2) |
| 3 | "Took longer" logs the block's planned span as worked time — decision 2026-07-02 (c), CAL-4 (b) | The plan *is* the work, and the person in the block did it | Extend the session to now; time comes only from the clock or "Add time…" (default r, contract row 6) |
| 4 | Grid, strip, gap-finder and Home's Today widget read **every** task in the workspace — `lens.ts`, `strip.ts`, `calendar-page-view.tsx:301, 721` | The workspace has one planner | Your sessions + due chips for tasks assigned to you or in your Inbox; teammates as "Busy" (default r, Call 6, default d). Today "Move to today" can move a teammate's tasks into your gaps |
| 5 | Events and accounts readable by every member — spec A3 "member SELECT" | Everyone in the workspace is the same person | **DONE**: PERM-0 (2026-10-06) made Calendar owner-only; PERM-3…8 added per-calendar sharing with "Busy only" as the default |
| 6 | One always-on "Moduo" calendar; "extra built-in Moduo calendars stay out" — 2026-10-01 | One person, one native calendar | **DONE in data**: the `calendars` table has a Moduo calendar per person plus custom calendars (and `calendar_sets` holds saved sets). The rail still shows one "Moduo" row |
| 7 | Week start, working hours and weekends in Calendar's own prefs — spec A7 | One person, one clock, one module's settings | Time & region for everyone (Tasks A17, call 76) |
| 8 | Repeating events "float" in the viewer's local time; no zone stored — CAL-2 (b) | Everyone viewing an event lives in its creator's zone | Store the event's zone; a shared meeting is anchored to it (call 76's founder pair in two zones) |
| 9 | Sync = desktop foreground + every 15 min, only while `/calendar` is open; iCloud/ICS/Outlook credentials only on the connecting machine — DESIGN_BRIEF §8, spec A17, CAL-8a (g) | The planner's laptop is the server | Server-side sync. Focus's meeting divider (call 64), Home, booking and MCP all read the mirror |
| 10 | Booking busy time = the link owner's checked calendars, applied to every co-host — `booking-public` `busyIntervals` | One host | PERM-8b (per-host busy), already flagged off |
| 11 | Block focus runs its own clock as page state — CAL-5, `use-block-focus.ts` | One timer, one page | One time engine (Tasks A11, contract row 5) |
| 12 | Day-fullness, morning plan and evening shutdown rituals — BRIEF §4 #5, #8 | Personal-discipline aids for one planner | Fullness cut (2026-07-02 d); rituals absorbed by Focus and Upcoming (row 81) |
| 13 | "The user is a solo or partner operator"; "Morgen-lite"; "the bar is Morgen" — BRIEF §1–2, PRODUCT_BRIEF §6 | The founder's own tool is the target | A role-by-role daily-driver bar (§2 D) |

**Second shape, for the record:** read-only "structurally" (§2 C) · the default-target picker "becomes meaningful in v2" yet already ships in quick-create · booking links "fast-follow, not alpha" yet shipped 2026-10-01 · ROADMAP line 52 still says booking links are "not built".

## 1. Keep: what is genuinely strong

- **Tasks and Calendar read the same rows; the calendar is a lens, not a copy.** The *idea* survives sessions untouched: a session is a row of the task, never a copied block, so Tasks and Calendar still cannot drift. Morgen's two-app drift stays our wedge (research §6).
- **Complete the task from inside its block.** One checkbox, the same op as everywhere, the block stays on its day checked and dimmed.
- **The trust rule from research §5.1:** every self-correcting move is legible, local and consented, with Undo. No opaque auto-scheduling (Q12), no modal, no red, no toast or badge when a block passes. All of this matches Tasks §13 ("a passed due date → nobody hears").
- **"Later today" through the gap-finder:** one block moves to the next free gap after now, around meetings and inside working hours, with Undo; with no room it stays put with honest copy. It is the local, consented version of everything "reflow" promised.
- **Moduo works with zero accounts** (native events), unlike Morgen.
- **The mirror plus the spine:** external meetings land in the database, register as entities and link to contacts, notes and tasks on every device. Source attribution on every chip is non-negotiable and done.
- **Correctness work:** real-instant grid math with DST tests; CalDAV/ICS repeats expanded with EXDATE and moved occurrences handled; "drop, never shift" for unknown time zones; one bad event never stalls a sync; an expired feed that returns HTML never wipes your events; a failure on one account never stalls the others.
- **Repeats in words with a plain-English echo before saving** (the echo is the consent).
- **Draw to create**, Enter saves, Esc discards, an empty title leaves nothing behind.
- **Booking links:** the sentence page, guests up to ten, one event per booking mirrored back, the host's live profile, links from fixed origins, the per-host rate limit, connects finished by the signed-in app, Meet / Zoom / "their choice", a contact created per booking (`booking_op_commit` returns `contact_id`).
- **Deploy-gap degradation:** a missing migration never blanks the page.

## 2. The decision table

### A. The lens model (question 1)

**What survives:** "no drift between Tasks and Calendar", because both read the same task and session rows; checkbox completion; done blocks staying on their day. **What must change:** one row = one placement, block length = estimate, the 30-minute default written onto the task, and the scope (everyone's tasks). The 2026-07-02 rejection of BRIEF §7's `time_blocks` table (with block state, "rolled from", reason and actual minutes) stays right: `task_sessions` is the slim version. Session rows hold no state; worked time lives in time entries and completion lives on the task.

| # | Decision | Source | Verdict | Why (one line) | What replaces it |
| --- | --- | --- | --- | --- | --- |
| 1 | A task block IS the task row; no blocks table | spec A1; decision 2026-07-02 (b) | **ADJUST** · L (Tasks D10 builds it) | Zero drift was the point; one row per task was the cost | Sessions are rows *of the task* (lens kept); the grid draws one block per session |
| 2 | One task = one placement; re-dragging moves it | DESIGN_BRIEF §2 | **REVERSE** | A 4-hour task can't span days (agencies, students in crunch week, agents planning a day) | Several sessions per task (call 25); dragging from the panel adds a session |
| 3 | Block length = task estimate ("deliberate") | DESIGN_BRIEF §4; research §2 | **REVERSE** | Resizing a block rewrote the estimate; the estimate feeds pace and day totals | Moving or resizing changes only that session (contract row 4) |
| 4 | 30-minute default written to the task on drop or move | `calendar-page-view.tsx:596–604`, `lens.ts:129` | **REVERSE** · S | It invents an estimate the person never gave | Remaining estimate, else 30 min, saved on the session only (row 2) |
| 5 | Due-only tasks never reach the grid | `lens.ts:121` | **REVERSE** | Students, creators and PMs live on due dates | All-day chip on the due day; a due time is a thin marker, never a block (call 26, row 1) |
| 6 | The grid shows every scheduled task in the workspace | `lens.ts`, page view | **REVERSE** · S | "Move to today" can move a teammate's work | Your sessions + your due chips; teammates' sessions as "Busy" (default r, d) |
| 7 | Done blocks stay on their day, checked and dimmed | DESIGN_BRIEF §2 | **KEEP** | Calm record of the day | Past sessions of a done task stay; future ones: §4 Q3 |
| 8 | Repeat occurrences: not shown | (absent) | **ADJUST** (new, from Tasks 27f) | Calendar is where repeats are planned | Faint ghosts in range; dragging one asks "This one · All future" (27f/g, row 3) |
| 9 | "Drift" and "unfinished from earlier" are one computed state, surfaced twice | DESIGN_BRIEF §2 | **ADJUST** | Right idea, wrong state: with sessions, a passed session is often just a finished stretch of a longer task | One rule in the shared store: a task is *missed* when its last session passed, no later session exists and it's still open (matches Upcoming §6: the row sits at the next session, so only a task with no later session shows "missed") |

### B. The loop (question 2)

**Yes, there is now a second owner of the same fix.** Upcoming's Earlier group (Tasks §8, views §6) already lists missed sessions ("missed 2:00 PM") and late due dates, has "Move all…" (Today · Tomorrow · Next week · Pick…) in its header, and offers Move · Won't do · Break down on each late row. Calendar's strip offers "Move to today" and "Review" for the same tasks, and its in-grid row offers Done · Later today · Took longer · Remove. That is one state, three surfaces and two verb sets. The fix (§3 C1–C2): one verb set and one placement engine, shown in both places.

**What Calendar should keep:** the in-block checkbox, "Later today" through the gap-finder, the quiet in-grid treatment and the "no room today" honesty. **Re-expressed on sessions:** the in-grid row appears only on a **missed** session (the task's last one); earlier sessions of a multi-session task just dim. "Remove" deletes that one session. "Took longer" extends the session. The strip becomes a count of missed tasks ("3 missed · Review") that opens the same list and verbs Upcoming's Earlier uses, with "Move to today" placed by the gap-finder from either surface.

| # | Decision | Source | Verdict | Why | What replaces it |
| --- | --- | --- | --- | --- | --- |
| 10 | Complete from the block's checkbox | DESIGN_BRIEF §6a, AC7 | **KEEP** | The floor every rival has; ours needs no sync-back | Completes the task (status → the project's first Done), not the session |
| 11 | Elapsed triage row on every passed block of an open task | DESIGN_BRIEF §6b, AC8 | **ADJUST** · S | With sessions, every non-final session would nag | Only on a missed session. Verbs below |
| 12 | Done | same | **KEEP** | — | Same as the checkbox |
| 13 | Later today → next fitting gap, else stays in the strip | same; CAL-4 (c) | **KEEP** | User-started and local, so not an "auto-roll" (row 8 holds) | Moves this session; with no room it stays put, muted, "No room today" |
| 14 | Took longer = log the planned span as worked time | decision 2026-07-02 (c); CAL-4 (b) | **REVERSE** · S | Records a plan as work (default r calls it "today's bug") | Extends the session to now; offers "Add 40m to time?" only if nothing was tracked during it (row 6) |
| 15 | Remove = unschedule the task | AC8 | **ADJUST** · S | With sessions it would wipe the whole plan | Removes this session only; the task and its other sessions stay |
| 16 | BRIEF §3's Push · Shrink · Drop | BRIEF §3; PRODUCT_BRIEF §6; ROADMAP ll. 49, 153 | **DONE** | Replaced 2026-07-02 by the four actions | Doc text is stale in three places (§4 Q14) |
| 17 | The strip: 7-day look-back, Move to today + Review | DESIGN_BRIEF §6c, AC9 | **ADJUST** · M | Second owner of Upcoming's Earlier; 7 days vs Upcoming's open-ended Earlier; includes teammates' tasks | One missed list (yours), one verb set, one gap-finder; Calendar shows a count line that opens Review in the panel |
| 18 | "Worked" suppression held in a client-only set, lost on reload | CAL-4 (b) | **REVERSE** | A recorded limit that re-nags after a reload | Gone: an extended session isn't missed |
| 19 | Elapse detection = 30-second client tick | spec A9 | **ADJUST** · S | Fine for drawing; wrong as the source of truth | The missed/late state comes from the shared store (Tasks D9's server late flag) so Upcoming, Home and MCP agree; the tick only redraws |
| 20 | Roll-forward as an op (`calendar.roll_forward`, MCP `calendar_roll_forward`) | BRIEF §4 #3; CAL-7 | **ADJUST** · S | The name collides with "nothing auto-rolls"; it rides `scheduled_at` | "Move missed to today" on sessions, only on a person's or agent's explicit request |
| 21 | Focus timer on a block, its own clock | DESIGN_BRIEF §6d; CAL-5 | **ADJUST** · M (TV-F6) | Two clocks can run on two tasks at once | ▶ on a block = "Focus on this", one clock (Tasks A11, row 5) |
| 22 | No toast, badge or sound at elapse | DESIGN_BRIEF §6b | **KEEP** | Matches Tasks §13 | — |
| 23 | Home Today widget: inline Move to today, default 08–18 hours, no Undo | CAL-7 (b) | **REVERSE** · S | Behaves differently from the page and moves teammates' work | The same verbs with Undo, your working hours (Home round) |

### C. Write-back (question 3)

**"Write-back is v2" no longer holds.** Write-back is already half-built, and the half that exists has no model. What is read-only and what is writable today:

| Provider | Connect from | Reads (sync) | Where sync runs | Create from Moduo | Edit / move / delete from Moduo | Other writes |
| --- | --- | --- | --- | --- | --- | --- |
| **Moduo (native)** | — | — | Database | Yes: grid, quick create, ⌘⇧K `/event` (provisional capture type) | Yes, series only | Booking writes here when Google isn't connected |
| **Google** | Web (`booking-google-connect`, refresh token stored encrypted) and desktop (keychain; `calendar_google_publish_booking_token` copies it up for booking) | Yes | Web: `calendar-google-web` (action `events`) while the Calendar page is open. Desktop: the Rust engine | **Yes**: the quick-create calendar picker lists Google calendars → `calendar-google-web` action `push` → mirrored back (decision 2026-10-01) | **No.** Once mirrored it is an external row: the grid resists drags (`calendar-grid.tsx:484`), the edit op refuses it (`p_native_only`). An event you just made in Moduo becomes read-only in Moduo | `booking-public` creates Google events (Meet, guests as attendees) and deletes them on cancel; live free/busy for availability |
| **Zoom** | Web (`booking-zoom-connect`); desktop opens the browser | — | — | Only by booking | Deleted on booking cancel | — |
| **Outlook / Microsoft 365** | **Desktop only** (Rust OAuth; needs `MODUO_CALENDAR_MICROSOFT_CLIENT_ID`; the app registration is still listed as pending, ROADMAP line 74) | Yes, desktop | The connecting desktop, while the page is open | No | No | — |
| **CalDAV** (iCloud, Fastmail, Nextcloud) | **Desktop only** | Yes, repeats expanded ~4 months ahead | Only the desktop holding the keychain password, while the page is open | No | No ("read-only, structural", spec Out of scope) | — |
| **ICS feeds** | **Desktop only** | Yes | Same | No | No | — |

The rail's code comment "Google calendars are a two-way copy" (`calendar-rail.tsx:217`) overstates it: it is a one-way create plus a read mirror. Also unbuilt: the mirror keeps no attendees, no RSVP state, no organizer and no description beyond the meeting link (`mirror.ts`); events have no alerts (the legacy `reminders` column is unused).

| # | Decision | Source | Verdict | Why | What replaces it |
| --- | --- | --- | --- | --- | --- |
| 24 | External calendars read-only "structurally"; the wrong-calendar invite "structurally impossible in v1" | DESIGN_BRIEF §8; spec A4; CAL-2 (d) | **REVERSE** (already crossed) · M | Google create, booking writes and cancel deletes all write outward | A write model per provider: create, edit, move, delete and respond, through the server, with the target always shown |
| 25 | Two-way write-back + default-target picker are v2 | DESIGN_BRIEF §11 | **ADJUST** · M | The picker ships with "Moduo" hard-coded as the default; created Google events can't be edited | Make Google editable first, or stop offering it as a target (§4 Q4); the default target becomes a per-person setting |
| 26 | Write path = a thin edge-function relay | BRIEF §8 Q | **KEEP** | It is what `calendar-google-web` already is | Extend it with update, delete and respond |
| 27 | Desktop Rust engine is the sync source; web renders only from the database | spec A4 | **ADJUST** | Google already moved to the server; the others didn't | Every provider syncs on the server |
| 28 | Web: "Connect from the desktop app" | DESIGN_BRIEF §8 | **ADJUST** · M | True now only for Outlook, CalDAV and ICS; a web-only student can't connect iCloud | Connect everything from the web (needs 29 and the Microsoft registration) |
| 29 | CalDAV/ICS credentials live only on the connecting machine | spec A17; CAL-8a (g) | **OPEN → recommend REVERSE** · M | No web, no second device, no agents, no booking busy time from iCloud | Server-held encrypted credentials, as Google's token already is (§4 Q6) |
| 30 | Sync cadence: foreground + ~15 min, only while `/calendar` is open | DESIGN_BRIEF §8; `use-calendar-sync.ts:5` | **REVERSE** · M | Focus's meeting divider, Home, booking and MCP `calendar_day` see whatever your last open tab mirrored | Server-side sync on a schedule, plus provider push where offered (Google); the page's "synced 12 min ago" stays |
| 31 | Mirror keeps light metadata; attendee lists stay provider-side | DESIGN_BRIEF §8 | **ADJUST** · M | Call 64 shows the divider "only for events you're attending", and the mirror can't tell; linking meetings to contacts needs the people | Mirror attendees (name, email, response), your own response, organizer, description |
| 31a | Cues "before my next meeting with Anna" parked until Calendar is rebuilt | Tasks call 58 | **OPEN** (depends on 31) | The trigger is Calendar's to provide, and needs to know who a meeting is with | Once attendees are mirrored, Calendar exposes "your next meeting with a person" as a reminder moment (§4 Q15) |
| 32 | Source attribution on every external chip | DESIGN_BRIEF §8 | **KEEP** | The wrong-target guard | — |
| 33 | Removing an account tombstones its events | DESIGN_BRIEF §8 | **KEEP** | — | — |
| 34 | CalDAV write-back stays out | spec Out of scope | **OPEN** | An Apple Calendar user can't drop Apple Calendar if Moduo can't move their iCloud events | Recommend after Google edit works (§4 Q5) |
| 35 | ICS feeds read-only | AC16 | **KEEP** | Feeds are read-only by nature | — |
| 36 | Outlook desktop-only, registration pending | ROADMAP l. 74; `config.rs:61` | **ADJUST** · S (setup) + M | PMs and teams on Microsoft 365 are a target segment | Microsoft OAuth on the server, like Google |
| 37 | Old Google upsert/delete commands deleted; outward write "designed deliberately when it's specced" | CLEAN-1 (b) | **KEEP the reasoning** | It is now specced: this re-plan | The design in 24–31 |
| 38 | Video: Meet / Zoom / "their choice", only connected platforms | 2026-10-02 | **KEEP**, **ADJUST** · S | A daily driver adds a video link to any meeting, not only booked ones | "Add Meet / Zoom" on native and Google events |
| 39 | Join button from the event's location | 2026-10-02 | **KEEP** | — | — |

### D. The ceiling (question 4)

**Does the new goal force invites, RSVP, attendee lists, teammate free/busy and per-event time zones? Mostly yes, but inherited, not rebuilt.** A founder, PM or freelancer can't drop Google Calendar if they can't see who a meeting is with, answer an invite, invite a teammate or a client, or see when a teammate is free. A founder pair in two zones (call 76) can't share a weekly call if repeats float per viewer. What still holds is the *spirit* of "don't rebuild Google's meeting stack": providers send the invites and keep the RSVP truth; Moduo shows and edits through them.

| # | Decision | Source | Verdict | Why | What replaces it |
| --- | --- | --- | --- | --- | --- |
| 40 | "The user is a solo or partner operator" | BRIEF §1 | **REVERSE** (doc) | Contradicts PRODUCT_BRIEF §2 and the v3 roles | Students, developers, PMs, founders and teams ≤5, freelancers/agencies, creators, founder-led sales |
| 41 | "The bar: Maciej uses Morgen daily" | DESIGN_BRIEF header | **ADJUST** (doc) | Morgen stays the bar for the planning surface only | Per role: Google/Apple Calendar (daily driver), Notion Calendar/Fantastical (speed, natural-language create, zones), Sunsama/Akiflow/Motion (planning), Calendly (booking) |
| 42 | Depth ceiling "Morgen-lite" | BRIEF §2; PRODUCT_BRIEF §6 | **REVERSE** (doc) | It will be quoted against invites, Month view and write-back | A quality bar: complete per role; no rooms or resources, no auto-scheduler, no time-zone matrix |
| 43 | Anti-goal: "no rebuilt provider meeting stack (RSVP / timezone matrices)" | DESIGN_BRIEF §11; research §5 | **SPLIT** | Half of it collides with "daily driver" | **Keep out:** our own invite-email system, a multi-zone comparison grid or "time zone assistant", a room finder. **Bring in:** attendees on an event (sent by Google/Microsoft), accept · maybe · decline on invites, your response shown on the chip, an event's own zone |
| 44 | Non-goal: resource booking, rooms, team availability matrices | BRIEF §2 | **ADJUST** | Teams ≤5 need "when are Mike and I both free"; PERM already has a "Busy only" sharing level that nothing draws | Rooms/resources stay out; a teammate's calendar as a "Busy" overlay (default d) is in |
| 45 | Non-goal: live collaborative editing; "changes appear on refresh" | BRIEF §2 | **ADJUST** | Realtime (TV-D5) makes "on refresh" stale | No live cursors; changes arrive live |
| 46 | Non-goal: meeting-scheduling AI / "schedule a 1:1 next week" | BRIEF §2; Q12 | **KEEP** | MCP agents are the AI path | Agents get the session and event tools |
| 47 | Non-goal: two-way task-field sync with external task managers | BRIEF §2 | **KEEP** | We are the task manager | — |
| 48 | Non-goal: recurring-event authoring "rivaling Google Calendar" | BRIEF §2 | **REVERSE** | Tasks 27 already gives RRULE parity and "move just this one" | One repeat picker and one summary line for tasks and events |
| 49 | No opaque auto-scheduling; assistive moves only transparent, local and reversible | Q12; research §5.1 | **KEEP** | The category's top churn cause | — |
| 50 | Repeats float in the viewer's time; no zone on events | CAL-2 (b); `recurrence-expand.ts` | **ADJUST** · M | A shared weekly call lands an hour off for a teammate in weeks when Europe and the US change clocks on different dates | Store the event's zone (from Time & region at creation); show it only when it differs from yours |
| 51 | Times shown in the device's zone | spec edge cases | **ADJUST** · S | Time & region is now the app's clock | Use the Time & region zone and the 12/24h setting; the travel prompt applies |

### E. The rest (question 5)

| # | Decision | Source | Verdict | Why | What replaces it |
| --- | --- | --- | --- | --- | --- |
| 52 | Day-fullness signal cut | decision 2026-07-02 (d) | **KEEP the cut** | Still dishonest while much work is undated | Upcoming's day totals ("3 · ~2h 30m") and Focus's usual pace are the honest versions. BRIEF #5 and ROADMAP l. 160 are stale |
| 53 | Reflow my remaining day (v2) | DESIGN_BRIEF §11; BRIEF #4 | **REVERSE → drop** | A whole-day re-pack fights "nothing auto-rolls" and the "local" rule | "Later today" per session and "Move missed to today"; an agent can propose a plan through MCP |
| 54 | Morning plan + evening shutdown rituals (v2) | DESIGN_BRIEF §11; BRIEF #8 | **REVERSE → absorb** | Focus and Upcoming already do the jobs | Morning = Focus's "Line up today's 3 scheduled tasks" (call 66); evening = Upcoming's Earlier; no ritual screens |
| 55 | ⌘K natural-language create (v2) | DESIGN_BRIEF §1, §11 | **DONE in direction** | Calls 90/90b give one capture with types | ⌘N in Calendar = new event here; ⌘⇧K then ⌘4 = Event. The provisional `/event` line type already exists (`capture-type.tsx`); Calendar replaces its body |
| 56 | Day + Week only; Month and agenda are fast-follows | DESIGN_BRIEF §1, §11 | **REVERSE** (Month) · M; **OPEN** (agenda) | Call 26 puts the Month view in Calendar's rebuild | Month with due chips; agenda vs Upcoming is §4 Q9 |
| 57 | Week view default, remember last used | DESIGN_BRIEF §1 | **KEEP** | — | Per role the first view may differ (Tasks call 34) |
| 58 | Single-occurrence exceptions (v2); edit and delete = the whole series | DESIGN_BRIEF §7c, §11; spec A6 | **REVERSE** · M | Nobody can drop Google Calendar if moving one standup moves them all | This one · This and following · All, for events and repeat tasks alike (27g) |
| 59 | Repeat phrases parsed in-house, echo before saving | spec A5 | **KEEP**, **ADJUST** | Two parsers for one grammar | One parser for capture, task repeats and event repeats |
| 60 | Default-target picker in calendar settings, confirmable per event | BRIEF #6; DESIGN_BRIEF §7a | **ADJUST** | Half-shipped (see 25) | A per-person default target; the picker on every create |
| 61 | Working hours: an invisible bound, used only for gap-finding | DESIGN_BRIEF §1, §10 | **ADJUST** · S | Booking links ask for weekly hours again, per link | One "Working hours" per person: gap-finder, the booking-link default, the teammates' Busy overlay |
| 62 | Calendar's own prefs domain (`user_preferences.calendar`) | spec A7 | **ADJUST** · S | Week start moves to Time & region (Tasks A17) | Keeps per-calendar visibility, colours and show-weekends only |
| 63 | Right-panel switcher built inside Calendar | spec A8; DESIGN_BRIEF §5; CAL-3 (a) | **DONE** | SH-1 replaced it with the panel title dropdown (call 72a) | Calendar registered Detail · Notes / Tasks unchanged (`panel-views.ts`); the rebuild picks its views (§4 Q10) |
| 64 | Panel Tasks view groups: Today (committed, commit order) · Due soon (incl. overdue) · Backlog | DESIGN_BRIEF §5 | **REVERSE** · S | `committed_for` is gone (the Queue became Focus); "Backlog" is now a status category; overdue is now "late" | Focus (Up next) · Missed and late · Due soon · Unscheduled in your projects; Backlog stays out |
| 65 | Left rail: mini-month + one "Moduo" row + accounts | DESIGN_BRIEF §3a; rail | **ADJUST** · S | The `calendars` table already holds your calendar, custom calendars and teammates' shared ones; `calendar_sets` holds saved sets | Rail groups: Yours · Shared with you · Accounts · Sets |
| 66 | Grid keys T ←/→ D W; blocks mouse-only | DESIGN_BRIEF §4 | **ADJUST** · S | Contract row 10 and keymap.md | Focusable blocks, ⌥←/→ a day, ⌥↑/↓ 15 min, `M` Month |
| 67 | Popover first, panel on demand; Detail reuses the task panel | DESIGN_BRIEF §1, §5 | **KEEP** | — | The v3 detail panel (TV-U13) |
| 68 | Overlap layout (3 columns + "+N"), 15/5-minute snapping, density token for the hour height | DESIGN_BRIEF §4; CAL-1 (c) | **KEEP** | — | — |
| 69 | Native events: creation "is the row itself" (no activity row) | AC3 | **REVERSE** · S | Same flaw the Tasks audit found (item 27) | Creation logs like any op |
| 70 | Event ops attributed + entities registration | spec A3 | **KEEP** | — | — |
| 71 | Loop rides Tasks ops on `scheduled_at` (reschedule, unschedule) | spec A2 | **ADJUST** · M | `scheduled_at` is retired at TV-D7 | Session ops: add, move, resize, remove, logged, with Undo (row 10) |
| 72 | MCP: `calendar_schedule_task` / `move_block` / `complete_block` / `roll_forward` on `scheduled_at` | CAL-7 (a) | **ADJUST** · S | Same | Re-cut on sessions; `tasks_create` already takes sessions (Tasks A14) |
| 73 | Permission lane = the Tasks lane | spec A3 | **DONE** | PERM per-calendar sharing replaced it | — |
| 74 | Calendar mounts its own tasks module (full reload + repeat catch-up writes) | current-state §3 (g) | **ADJUST** (planned) | TV-D11a's shared store | — |
| 75 | Client-held Undo; server undo tokens "with v2 reflow" | spec A9 | **KEEP** Undo, drop the tokens | Reflow is dropped (53) | Tasks default a (8 s, ⌘Z) |
| 76 | Event notifications: "invite assigned to you, block rolled forward, reflow applied" | BRIEF §6 | **ADJUST** | Tasks §13 is the one table | "Rolled forward" and "reflow" never notify; add rows for "invited to an event", "an event changed or was cancelled" and an event alert before start (§4 Q7) |
| 77 | Event alerts: none | (absent; legacy `reminders` column unused) | **REVERSE** · M | Every daily-driver calendar alerts before a meeting | Alerts through Tasks' channels: desktop menu bar + browser (call 73) |
| 78 | Booking: sentence page, guests, live profile, one event per booking, soft-delete | 2026-10-01/02 | **KEEP** | — | — |
| 79 | Booking busy time = calendars the host ticks + weekly hours per link | 2026-10-01 | **ADJUST** · S | Default d (work sessions count as busy, switch per link) isn't built: `busyIntervals` reads events, bookings and Google live free/busy only. **Found:** stored rows are read without expanding repeats, so a repeating Moduo event blocks only its first occurrence (Google is covered by the live call) | Sessions as busy with a per-link switch; repeats expanded; working hours as the default |
| 80 | Collective links behind `COLLECTIVE_LINKS_ENABLED = false` | PERM-8b | **KEEP the flag** until PERM-8b | Every co-host is checked against the owner's calendars | Per-host busy (PERM-8b); round-robin is §4 Q11 |
| 81 | Booking links "fast-follow, post-alpha" | ROADMAP Q9, l. 52 | **DONE** | Shipped 2026-10-01 | Doc fix |
| 82 | Fixed email origins + per-host rate limit; connects finished by the app | 2026-10-07, 2026-10-08 | **KEEP** | — | — |
| 83 | Recurring time-blocks not authored on blocks | BRIEF §8 Q | **KEEP** | Recurrence lives on the task | Ghosts + 27g |
| 84 | Focus timer as an app-level store; the chrome chip passive; the tick-counter kept | DF-11, 2026-07-11 | **DONE** | Absorbed by TV-F1's wall-clock engine and the one time engine (Tasks A11) | — |
| 85 | Notes view in Calendar's panel; drag into the editor = a chip, drag onto the hub = a link | NO-7b, 2026-07-04 | **KEEP** | The two gestures are distinct on purpose | Now the registered "Notes" view; References (RF-1) renders the chip |

## 3. Contradictions the new plan must settle

- **C1 · Two owners of missed work.** Calendar's strip (Move to today · Review, 7-day window) vs Upcoming's Earlier (Move all… · per-row Move · Won't do · Break down, no window). *Settle:* one list, one verb set, one placement engine (the gap-finder), one window. Contract row 8 says missed sessions "stay put"; this audit reads that as "nothing moves them automatically", so a person's "Later today" moves the session and the old slot leaves no trace (consistent with "Rescheduled N×" being gone). The planner should confirm that reading.
- **C2 · Two verb sets for one state.** Done · Later today · Took longer · Remove (Calendar) vs Move · Won't do · Break down (Tasks late fixes). *Settle:* which verbs belong to a missed *session* (Later today, Took longer, Remove this session) and which to a late *task* (Move, Won't do, Break down), and show both sets where both apply.
- **C3 · "Move to today" at the same time vs into a gap.** Upcoming drags keep a session's time; a 10:00 session moved to today at 15:00 lands in the past and is missed again. *Settle:* "today" always means the next fitting gap after now.
- **C4 · "Took longer" logs the plan as work** (shipped) vs contract row 6 and default r.
- **C5 · One placement** (lens, `scheduled_at`, MCP verbs, Home widget) vs sessions (call 25, Tasks A4).
- **C6 · Everyone's tasks on your grid** vs default r / Call 6. Today's strip and gap-finder act on teammates' tasks.
- **C7 · Block length = estimate** vs "the estimate no longer doubles as block length" (Tasks §2).
- **C8 · "Nothing auto-rolls"** vs `calendar_roll_forward` and BRIEF's roll-forward op. Explicit requests only, renamed.
- **C9 · Two recurrence engines.** Events: client-side expansion, floating time, series-only edits. Tasks 27: server roll-over, "this one / change the pattern", ghosts on the Calendar, one picker. *Settle:* one picker, one grammar, one exception model; events gain a zone.
- **C10 · Week start and zone.** Calendar prefs vs Time & region (Tasks A17, call 76).
- **C11 · Read-only "structurally"** vs web Google create, booking writes and cancel deletes, with created Google events then read-only in Moduo.
- **C12 · Default target "v2"** vs quick-create already listing Google calendars, defaulting to "Moduo".
- **C13 · ⌘K natural-language create "v2"** vs calls 90/90b (⌘N here, ⌘4 Event in capture; the provisional type exists).
- **C14 · Calendar's own switcher** vs SH-1's registry (done; Calendar's three views are registered unchanged).
- **C15 · "Busy" for teammates** (default d, PERM's default "Busy only" level) vs nothing that draws Busy anywhere, and booking that ignores sessions.
- **C16 · Call 64's divider "only for events you're attending"** vs a mirror that stores no attendance, refreshed only while the Calendar page is open.
- **C17 · The `calendars` and `calendar_sets` tables** (per-person Moduo calendars, custom calendars, sets, sharing) vs the 2026-10-01 entry "extra built-in Moduo calendars stay out" and the rail's single "Moduo" row.
- **C18 · Reminders exist for tasks** (Tasks §13, call 73) **but not for events.** A meeting alert is the most basic daily-driver feature.
- **C19 · Docs that still state reversed decisions:** PRODUCT_BRIEF §6 ("Morgen-lite", "done/push/shrink/drop"), ROADMAP l. 49 (reflow, fullness, rituals in Wave 2's build list), l. 52 (booking "not built"), BRIEF §3–4, DESIGN_BRIEF §1/§8/§11, `ops-manifest.ts` description ("External calendars are read-only").

## 4. Questions only the designer can answer (product terms, with a recommendation)

1. **Where do you fix missed work: Upcoming's Earlier, the Calendar, or both?** _Recommend: both show it, one behaves. Upcoming's Earlier owns the list and the verbs; the Calendar shows "3 missed · Review" above the grid, which opens the same list in the panel. "Move to today" always finds a free gap after now._
2. **A task you planned across three blocks: when the first block passes and the task is still open, should the Calendar ask anything?** _Recommend: no. It dims as worked; only the last passed block of an unfinished task gets the quiet "Later today · Took longer · Remove" row._
3. **You finish a task early. Its blocks on Thursday and Friday: do they disappear?** _Recommend: yes, with "Freed 2 blocks · Undo". The time goes back to your day and to your booking links._
4. **Events you create on a Google calendar from Moduo: should you be able to move, resize and delete them in Moduo?** _Recommend: yes, before anything else in connectivity. Today they turn read-only the moment they're saved, which feels broken. The alternative is to stop offering Google as a create target._
5. **Should Moduo be able to change your iCloud (and other CalDAV) events, not just show them?** _Recommend: yes, after Google editing works. An Apple Calendar user can't switch otherwise._
6. **Would you accept Moduo's server holding your iCloud app password (encrypted, like your Google sign-in today) so your Apple calendar works on the web, on a second Mac, for agents and for booking links?** _Recommend: yes. "Connect from the desktop app" leaves students on the web and every teammate's second device without their meetings._
7. **Meeting alerts: should events remind you before they start, through the same channels as task reminders (desktop menu bar, browser)?** _Recommend: yes. One default ("10 min before", changeable per event and in Settings); a provider's own alerts are respected._
8. **Invites: does "drop Google Calendar" include inviting people to a meeting and answering invites (accept · maybe · decline) from Moduo?** _Recommend: yes, sent through Google/Microsoft so their emails and RSVP stay the truth. No Moduo-made invite emails, no time-zone comparison grid, no room booking._
9. **Month view yes (call 26). An agenda list as well, or is Upcoming the agenda?** _Recommend: Upcoming is the task agenda; the Calendar gets a "Schedule" list (events + sessions + due chips, by day), because students and founder-led sales scan the week as a list on small windows._
10. **Which right-panel views should Calendar offer in its title dropdown?** _Recommend: about this: Details · Notes; alongside: Tasks (the drag source, grouped Focus · Missed and late · Due soon · Unscheduled) · Upcoming. Booking requests only once collective links ship._
11. **Teammates: should you see a teammate's calendar as Busy blocks beside yours, and should booking links offer "any of us" (round-robin) as well as "all of us" (collective)?** _Recommend: Busy overlay yes (PERM's default "Busy only" already allows it); collective first via PERM-8b, round-robin later for founder-led sales._
12. **A weekly call between you in Warsaw and someone in New York: should it stay at the time it was set in the creator's zone (and show "9:00 Warsaw" when that differs from yours)?** _Recommend: yes, every event keeps its zone; you see it only when it differs from yours._
13. **Reflow and the morning/evening rituals: drop them as Calendar features?** _Recommend: drop reflow (one-block "Later today" is the honest version) and let Focus's "Line up today's scheduled tasks" and Upcoming's Earlier be the morning and evening. Day-fullness stays cut._
14. **Approve the doc edits (C19) as one change before the first Calendar block?** _Recommend: yes; four documents state decisions that have since been reversed or shipped._
15. **Cues (Tasks call 58, parked): should the Calendar supply "before my next meeting with Anna" as a moment a reminder can wait for?** _Recommend: yes, once attendees are mirrored (row 31); until then it stays parked._
