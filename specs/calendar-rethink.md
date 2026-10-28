# Spec: Calendar rethink (type it, watch it land)

> Status: **Ready to execute** (planned 27 Oct 2026 from the /product-studio draft; product questions answered by mike in /s1) · Owner: mike · Related briefs: `.design/calendar/BRIEF.md`, `.design/calendar/DESIGN_BRIEF.md` · Builds on `specs/calendar.md` (v1) and `specs/permissions.md` §4 (sharing, collective links)
>
> **The prototype is the visual source of truth:** https://claude.ai/artifact/HwMeJz7Laxd2EggEJeSjP6 (Prototype tab: 34 states in the picker; Why tab: decisions, research, before/after; Score tab: every round). This spec names behaviour; for how a state looks, open it in the artifact's state picker.
>
> **Score:** blind jury 7.50 after round 7 (usability 8, craft 7, platform 7, character 8; every code gate 9.5+), against 6.70 for the live module on 27 Oct. The published page is round 7 plus fixes for every confirmed round-7 finding, not yet re-scored. Studio workspace (gitignored): `.lab/studio/calendar-20261027/` (`brief.md`, `holes.md`, `inspiration.md`, `direction.md`, `scores.md`).

## Scope

Rebuild the Calendar module around one idea: **your week on one surface, meetings filled, your work outlined, focus held as a band; type what and when, and watch it land.** It closes the live module's confirmed holes (H1–H20 and K1–K14 in `holes.md`: clock-change hour labels, a failed load that reads as an empty week, Notes ignoring the selection, an uncapped all-day row, drag-only scheduling, events unreachable by keyboard, no Month view, and the rest). It adds the four pieces the designer named on 27 Oct: **sharing your calendar inside the workspace (and seeing it as a teammate does), scheduling links and one-off offers, events in a room / online / both, and connecting accounts and calendars.** It ships the house's calmer visual language from the elevation pass (day headers, the house calendar chip, the focus edge, a now-and-next line).

It stays inside the house shell (three panels, the SH-1 right-panel pattern), the house tokens and `docs/DESIGN_RULES.md`.

**Decided in /s1 (27 Oct):** Google events edit both ways now (moves, times, title, guests, Meet link, privacy, delete save to Google). Focus time is its own calendar item, busy to teammates but **free for booking links** by default. Month view ships. The right panel's "Tasks" view becomes **Plan**. Panels fold at narrow widths **in Calendar only** for now. **All** events take their calendar's tint and hue hairline. Due counts move into the day headers, the zone control into the gutter corner, teammates are off by default, and the period keys become ⌘← / ⌘→. Teammates show as opt-in lanes and while you type their name. Private (P) works on any event you own and sets Google's visibility for Google events. Offer holds last 48 hours and release together. Booking links keep **Google Meet, Zoom and Their choice** (in person and phone are out). New events go to Your calendar; events with outside guests go to your main Google calendar so Google sends the invite (without Google, saved without invites, and the box says so). Microsoft, iCloud and .ics stay view only. Folded in from the open holes: **realtime events (K10), "this occurrence only" (K15), working hours and weekends (K16), custom calendars that hold events (K9).**

## Product behavior & UX

### The concept card

| | |
|---|---|
| Core loop | Open the week (⌘4). Press N, type "Investor prep thu morning 90m": the draft lands on Thursday at the first free 90 minutes; ⇥ hops to the next free time; ↵ adds it. In Plan, pick a task and press S: it lifts to the next free slot that fits its estimate; ⇥ or arrows adjust; ↵ places it (or click a free slot, or drag the row). |
| Signature | The typed box that previews on the grid: words light up as they're read, the draft sits where it will land, ⇥ hops to the next free time. The same draft-and-hop places a task (S) and offers times (O). |
| Other people | Name a teammate in the box and ⇥ finds a time you're both free. O offers free times as one held link. A booking link outlines its open times on your week. Teammates see your week at the level you pick; Preview shows exactly what they see. |
| Motion | Settle: the draft and a moved block settle into place over `--motion-base`; anything a key opens appears at once. |
| 100th use | N opens at the next free time, ⇥ finds room without looking, the all-day lane never buries the hours, nothing moves unless you place it, overdue work waits in one quiet group, never red. |

### Reading the week (artifact states: A normal week, Day view, Month view, A dense week, All-day overflow, Multi-day, Time zones, Long titles, The 1024 × 700 window)

- **Toolbar:** ‹ › (⌘← ⌘→) · Today (T) · range title · the **now-and-next line** ("● Legal review with Tom · until 11:15 AM · then 1:1 with Ana 11:30 AM · ⇧⌘J"; parts drop in that order as the window narrows; it never prints over a neighbour; absent when offline, where "Offline · 2 to sync" takes its place) · calendar set ("All calendars", when the calendars panel is folded) · Day / Week / Month (D W M) · New (N).
- **Day headers:** weekday as an eyebrow over a large date; today in the white pill; the day's due work as one quiet dashed "2 due" beside the date (opens that day's list with Schedule S). All headers share one baseline; a note (the US clock change in a two-zone week) sits under the date without moving it. The time-zone control lives in the corner above the hours (CET; Z adds PT).
- **All-day lane:** at most two rows; a multi-day item is one bar with its length ("2 days"); per day "+N more" opens that day's list under that day; ⇧A expands (Less collapses). Due tasks never live here.
- **Grid:** opens at the working day with now in view; hour labels are wall-clock hours, also in a week with a clock change, and Day, Week and clicks share one geometry. Off-hours and weekends are a quiet wash.
- **Events** are the house calendar chip: the calendar's tinted surface with a hairline in its hue, title then time a step smaller; one-line blocks show title then start time and drop the time before the title truncates; past events dim (and lose the hairline); the selected one gets the ring; private ones carry a lock for you. Focus time is a quiet band with the calendar focus edge (accent while live or selected); your tasks are outlined with a ring. Nothing on the grid is hatched.
- **Overlaps:** events starting within 30 minutes of each other sit side by side (two columns in Week, four in Day), the rest fold into "+N" that opens the list. A later event starting 30+ minutes into an earlier one cascades over it from 25%; the covered card keeps full width above the overlap and shows only what fits (title, then time if room).
- **Now:** the line runs over the grid with its dot; the meeting in progress carries it across faintly with a tick, its title on top, and says "happening now" to screen readers.
- **Overnight** timed events cross midnight: "→ Thu 7:10" on the first day, "from Wed 22:40" on the second.
- **Month:** six weeks; spanning bars under the date row; one-offs before routines; past dimmed everywhere (all-day included); due counts in the date row; "N more" opens the day.
- **Day view:** the free width beside each meeting shows its people, linked notes, one follow-up and where it happens (Meet, place).
- **Narrow windows (Calendar only):** below 1600 px the calendars panel folds; below 1360 px Plan folds too, one side panel at a time; Plan's toggle stays at the bottom right with ⌥3. At 1024 × 700 nothing overlaps or clips.
- **Working hours and weekends:** the calendars ⋯ menu has "Working hours…" (start, end, show weekends, week starts on). The working-day wash, the opening scroll, free-time hops, S and booking links that use "your working hours" all follow it.
- **Time zones:** Z adds a second zone column; the event view says other people's local time ("9–10 AM for Priya (PT)"); the week of a clock change is labelled on its day.

### Scheduling (states: Typing an event, Typing with Kai, Typing a place, Scheduling a task, Due tasks, Deleted with Undo, Keyboard map)

- **Composer (N, ⌘N):** opens at the next free time (or the grid cursor). Recognised words are highlighted as typed: day words, times and ranges, durations, morning/afternoon/evening, #calendar, @person or "with X and Y", "at <Place>", "the office" / "in person", "on meet / zoom / teams", "focus" and "task" prefixes. The echo reads back day · time · calendar · people, then where (place line, link line), then consequences: a clash leads, with a warning mark ("Overlaps your Lunch with Tom · ⇥ finds the next time you're all free"); each teammate's verdict (free / busy / in focus time); "Saves to Google Calendar and invites Priya from there" or "Lands on Kai's calendar too". ↵ adds (toast with Undo), ⇥ / ⇧⇥ next / previous free time, esc cancels. A day without a time lands at that day's first free time.
- **Defaults:** a Meet link is added only when there are guests and it isn't a meal (lunch, dinner, coffee, drinks, brunch, breakfast); events with outside guests go to your main Google calendar (or the "New events go to" calendar if that's a Google one) so Google sends the invite; events with only teammates stay on Your calendar and land on theirs. Without Google connected, an event with outside guests saves on Your calendar without invites and the echo says "No invite sent: connect Google to invite Priya". #calendar puts an event on any calendar you can edit, custom Moduo calendars included.
- **With a teammate:** naming a teammate shows their busy time as a lane at each day's edge while you type (legend line in the echo), and ⇥ finds a time you're all free.
- **Placing a task (S):** the selected Plan task lifts to the next free slot that fits its estimate (from today, or its due day if earlier); free time shows as a soft wash, outlined only under the pointer; ⇥ next free time, ↑↓ 15 min, ←→ a day, ↵ places, click a free slot places, drag still works. Nothing else moves. The row stays at full contrast while placed.
- **Repeating events:** moving, editing or deleting one occurrence asks "This event / All events" (↵ picks This event); This event changes only that occurrence, in Google too.
- **Google events** behave like your own: every edit saves to Google first and the week shows the result; if Google refuses, the change rolls back with a toast that says why; offline edits wait in "Offline · N to sync".
- **Elsewhere:** an event added or changed on another device, by ⇧⌘K capture, by an assistant through MCP or by a teammate who shares with you appears in the open week within a few seconds, without a reload.
- **Edits by key:** ⌥↑↓ moves 15 min, ⌥←→ a day, ⌥⇧↑↓ changes length, ⌫ deletes; each with an Undo toast and ⌘Z. ⌘C / ⌘V / ⌘D copy, paste (at the cursor or next free time) and duplicate an event. V adds or removes a Meet link, P makes it private, L opens Link.
- **Grid keys:** the grid is one Tab stop; arrows move a 30-minute cursor (a busy slot outlines its event); J / K next / previous event; Space opens the card, or moves into the Event panel when it's already showing; ↵ opens details or a new event at the cursor; ⌃↵ opens the event menu. Single keys (and ⌥1–3) work only when no field has focus. ? opens the keys sheet (with a close button).
- **Right-click** an event: a short menu (Open, Copy, Duplicate, Add a Meet link, Make private, Move to another calendar, Link a person, note or task, Delete) without shortcuts; the ⋯ menu in the Event panel shows the same items with their keys.

### Plan and the event (states: Event detail, Event in a room and on Meet, Right-click an event)

- **Plan panel** (the right panel's "Tasks" view, renamed): From earlier (oldest first, "Due Oct 24", never red, Find time), Due this week (by date), Scheduled, No date; only your tasks; six rows per group, then Show more; / focuses Find a task.
- **Event view** (⌥1, follows the selection; Notes ⌥2 follows it too): title (rename in place); when (change); Join on Meet (primary within 10 minutes of start) and Meeting note; calendar; one line on who sees it ("Kai and Nora see it all · others see “Busy”", or "Private · teammates see Busy"), which opens Sharing; booked through a link (if so); **Where**: place (two lines: name, address) with Map, link (provider, URL) with Copy, "Add a place" / "Add a Meet link" (V) when missing; people with replies (name, role); notes and tasks as two-line rows; description; Link a person, note or task (L).
- **Card** (Space, or a click when the Event panel isn't showing): title, time, calendar, people, place, link, links count, Join / Open / Delete.

### Sharing (states: Share your calendar, Your week as Kai sees it, Kai's and Nora's weeks)

- **Share your calendar** (from the Your calendar row's "Shared", the calendars ⋯ menu, or the event's visibility line): People at Hale & Co with **Busy only / All details** each and a Preview; **Everyone else** with Nothing / Busy only / All details (default Busy only); "Give someone more…"; the two levels explained with your own event ("Tue 5–6 PM: “Busy”" vs the title with Priya and the October update); **calendars in what you share**: Your calendar and Work follow each person's level, Focus time shows as "Focus time", Family "Busy only, for everyone", Holidays "Not shared" (each a menu). Private events show as Busy whatever the level. Tasks never show. "Changes apply as you make them. Nobody gets a notification."
- **Preview as:** your whole week rendered through that person's level and your calendar rules; banner "Your week as Kai Ito sees it · All details · Family shows as busy · private events show as busy · tasks stay with you" with "Change what Kai sees" and Done (esc); the Event view explains each block ("You marked this private, so Kai sees “Busy” whatever the level").
- **Private** (P, the event menu, or the Event view's visibility line) works on any event you own; for a Google event it also sets Google's visibility to private.
- **Shared with you:** teammates listed under "Shared with you · Hale & Co · view only" with their level; off until turned on; then a thin lane in their colour at each day's edge (teammate hues never match your calendars' and never sit side by side), a legend row "Beside your week · Kai Ito all details · …  Hide", a card on click with "Find a time with Kai".

### Booking links and offers (states: Booking link, The booking page a guest finishes, Offering three times)

- **Booking links** in the calendars panel: name, lengths, co-host, Copy on hover; "Offer specific times… O". Opening one shows the **Booking link** view in the right panel: name, URL with Copy (⌘C when no event is selected), Taking bookings, Guest's view; Length (15/30/45/60 chips), When, Lands in, Where (Google Meet / Zoom / Their choice); **Rules**: Busy from (your calendars; Focus time is off by default, so guests can book over it unless you tick it), Hosts (co-host: only times you're all free; they accepted on …), Limits (buffer · notice · per day · ahead), Asks; Booked (who, when); This week (N open times, dashed on the week while the view is open); "Offer specific times instead". Paused links say so.
- **The guest's page** (the house sentence page, decision 2026-10-01): host profile and the link's line; "Let's talk for [30 minutes] on [Wednesday, Oct 28] at [12 PM] [Lisbon time]. I'm [your name], and you can reach me at [your email]." Choice blanks carry a caret and open the tray (suggested times, open days, morning/afternoon/evening); "Not 12 PM? See the other 18 open times"; name, email and the optional question on one step; the button names the next missing thing and ends "Book Wednesday, Oct 28 at 12 PM"; "You'll get an invite from robin@halefounders.co. Move or cancel it from there."
- **Offer specific times (O):** starts at the first free time after the link's notice (Intro call by default; the link's length and where); ↵ adds a time and hops to the next day; ⇥ steps through free gaps; ←→ a day; ⌫ removes the last; the card lists the picks and the message as it will be copied ("Would one of these work? … (Warsaw time). Pick one: moduo.app/book/r/robin-4kq"); "Hold them on your calendar until one is picked (48 hours)"; ⌘C copies the link, ⇧⌘C the times as text. Held times show as dashed "Held · Investor meeting" blocks, count as busy, and release together when one is picked (or "Release holds").

### Accounts (states: Calendar accounts, Connecting Google, Connected, An account needs reconnecting)

- **Calendar accounts** (Settings › Integrations opened in place, from "syncs both ways" on an account group, "Connect a calendar…", or the calendars ⋯ menu): accounts list (provider mark, email, state) and Connect an account…; **Meeting links** (Google Meet ready, Zoom Connect); for the selected account: synced time and Sync now; calendars with **Show in your week** and **Counts as busy for booking links**; what the account does here (changes save to Google and back within a minute; makes Meet links; invites go out from your address, sent by Google); Remove this account… → in-place notice with consequences ("Its calendars and their events leave Moduo. Notes, tasks and people you linked stay, marked “event removed”. Nothing changes in Google.") and Undo; footer "New events go to Your calendar · Moduo".
- **Connect a calendar:** tiles that say the truth: Google (syncs both ways · Meet links), Microsoft 365 or Outlook (view only, for now), iCloud or CalDAV (view only, app-specific password), Subscribe by link (.ics, view only). Google → a consent step that names each permission and why, where events are kept, and what Moduo doesn't read (Back / Continue to Google ↵) → "Finish in your browser" (Open the Google page again / Cancel) → "<email> is connected": pick calendars (show / busy), "Show 2 calendars ↵" → import progress ("Bringing in 214 events, newest first · 62%"; "You can close this; it carries on"); the calendars panel shows the import row.
- **Reconnect:** when Google stops accepting Moduo's access, a banner ("Google stopped accepting Moduo's access to robin.hale@gmail.com. Family shows as of Sunday 6:02 PM, and booking links can't see it until you reconnect." · Reconnect) and the account's group ("Reconnect" in the warning tone); that account's events keep showing with the sync mark; Calendar accounts shows the same notice with Reconnect ↵.

### Fault and empty states (states: First week, Loading, Google Calendar didn't sync, Offline)

- **First week:** "Your week is open" card (low on the grid, closable, esc): the typing example, New event N, Connect Google Calendar, three keys; Plan's own empty state with Capture a task ⇧⌘K.
- **Loading:** the shell paints at once; skeletons in the last known shape (one all-day row; Plan groups 2/5/1/3); the grid does not move when data lands.
- **Sync error:** banner names the account, what is stale and since when, what is current, Try again; the account group says "Not synced · 9:12"; that account's events (timed, one-line and all-day) carry a sync mark and keep full strength; never "Nothing scheduled".
- **Offline:** "Offline · 2 to sync" (opens the list of waiting changes); each waiting change carries the cloud-off mark (different from the stale mark).

## Edge cases

- A week containing a daylight-saving change (Europe 25 Oct; US 1 Nov in a two-zone week).
- An all-day item spanning past the visible range; overnight timed events; an event that started before the range.
- More than two all-day rows; more than two overlapping events; four overlapping in Day view; 61 events in a week; a 30-word title and long names.
- Empty week; no tasks; a task with no estimate (defaults: task 30 min, focus 2 h, meals 60 min).
- One account failing while others sync; a revoked token; offline with queued changes; an import in progress.
- A read-only calendar (holidays, a teammate's): no edit affordances, "View only" lock.
- A private event under each sharing level; a teammate with "Nothing"; Family "Busy only, for everyone" while a person has All details.
- A booking link with no free time this week; a paused link; a co-host who hasn't accepted; a guest in another time zone; the per-day cap reached.
- An offer with no free time left this week; holds expiring after 48 hours; a pick on one hold.
- Composer: a typed time that clashes; a teammate who is busy or in focus time; outside guests on a Moduo calendar; "meet" inside a title ("Meet Mei for coffee" stays a title).
- 1024 × 700 with each panel open; 1920 × 1080 with both.
- Reduced motion (opacity only); keyboard-only through every state.

## Acceptance criteria

Reading the week
- **AC1** — In a week with a clock change, every hour label matches the wall-clock hour, and an event or a click lands on the hour its label shows (H1).
- **AC2** — When one account fails to sync, the banner names it, says what is stale since when and what is current, offers Try again; its events keep showing at full strength with a sync mark; the week never reads "Nothing scheduled" (H2, K11).
- **AC3** — The all-day lane shows at most two rows; a multi-day item is one bar with its length; "+N more" per day opens that day's list under that day; ⇧A expands and Less collapses (H4, H13).
- **AC4** — Loading paints the shell at once with skeletons in the last known shape, and the grid doesn't move when events arrive (H5).
- **AC5** — The week opens at the working day with now in view (H6).
- **AC6** — Day headers show the weekday over a large date on one shared baseline, today in the white pill, and the day's due count beside the date that opens its list with Schedule S.
- **AC7** — Events use the house calendar chip (tint and hue hairline, title then time); one-line blocks drop the time before truncating the title; past events dim; the selected event has the ring (H10, H11, H15).
- **AC8** — Events starting within 30 minutes sit side by side (two columns in Week, four in Day) with "+N" opening the rest; a later event starting 30+ minutes in cascades from 25% and the covered card shows only what fits (H12, K6).
- **AC9** — Overnight events cross midnight with "→ Thu 7:10" / "from Wed 22:40" (K7).
- **AC10** — The now line runs over the grid; the meeting in progress shows it as a faint line and tick with its title readable.
- **AC11** — The toolbar's now-and-next line shows the current meeting, until when, what's next and ⇧⌘J; it drops parts as the window narrows and never overlaps a neighbour.
- **AC12** — Month shows six weeks, spanning bars under the date row, due counts beside the date, past dimmed everywhere, and "N more" opens the day (K1).
- **AC13** — Day view shows each meeting's people, notes, a follow-up and where it happens beside it.
- **AC14** — In Calendar, below 1600 px the calendars panel folds and below 1360 px Plan folds, one side panel open at a time, Plan's toggle at the bottom right; at 1024 × 700 no text overlaps or clips (H14).
- **AC15** — Z adds a second zone; the event shows other people's local time; a clock change in the second zone is labelled on its day (K8).

Scheduling
- **AC16** — N opens the composer at the next free time; recognised words highlight as typed; the draft shows on the grid; ⇥ / ⇧⇥ move it to the next / previous free time; ↵ adds with Undo (K4, H16).
- **AC17** — The composer reads place ("at …", "the office"), meeting link ("on meet / zoom / teams") and teammates ("with Kai and Nora", @kai), and the echo states where, who and what happens; a clash leads with a warning mark.
- **AC18** — A Meet link is added by default only when there are guests and it isn't a meal; outside guests route the event to the main Google calendar and Google sends the invites; without Google the event saves without invites and the box says so.
- **AC19** — Naming a teammate shows their busy time while typing, ⇥ finds a time all named teammates are free, and the echo gives each one's verdict.
- **AC20** — S schedules the selected task into the next free slot that fits its estimate; ⇥, arrows and click place it; drag still works; nothing else moves (K3).
- **AC21** — Delete, move, resize, place and add all show an Undo toast and undo with ⌘Z; there is no delete confirmation (H8, K14).
- **AC22** — The grid is one Tab stop with an arrow-key cursor; J/K, Space, ↵, ⌃↵, ⌥-arrows, ⌘C/⌘V/⌘D, ⌘←/⌘→, V, P, L, O, F, Z, D/W/M, T and ? work as the keys sheet says, and single keys never fire in a field (K2).
- **AC23** — Focus time is a calendar item drawn as a band with the focus edge; it can hold a task, shows to teammates as "Focus time" (busy, never the task), and is free for booking links unless a link ticks it under Busy from (K5).
- **AC24** — Plan lists From earlier (oldest first, dated, never red), Due this week (by date), Scheduled and No date, only your tasks, six rows then Show more; / finds a task (H7, K12).

Event
- **AC25** — The Event view follows the selection and shows calendar, who sees it, where (place with Map, link with Copy), booked-through, people with replies, notes and tasks as two-line rows, and Link (L); Notes follows the selection too (H3, H10).
- **AC26** — Right-click (or ⌃↵) opens a short event menu without shortcuts; ⋯ in the Event panel shows the same items with their keys.

Sharing
- **AC27** — Share your calendar sets Busy only / All details per person and Nothing / Busy only / All details for everyone else, with per-calendar rules; changes apply at once and notify nobody.
- **AC28** — A private event (P) shows as Busy to every teammate whatever their level (title, place, people, link and notes never reach them), carries a lock for you, and for a Google event sets Google's visibility to private.
- **AC29** — Preview renders your week exactly as the chosen teammate sees it, explains each block in the Event view, and Esc leaves.
- **AC30** — Teammates who share with you are listed with their level, off until turned on, then shown as lanes at each day's edge with a legend, Hide, and a card on click.

Booking links and offers
- **AC31** — Opening a booking link shows its settings in the right panel (Where: Meet, Zoom or Their choice) and its open times dashed on the week, which update as the week fills and skip held times; Copy copies its URL.
- **AC32** — A co-host link shows only times all hosts are free and stays paused until the co-host accepts (permissions.md §4e).
- **AC33** — The guest page is the sentence page with carets on choices, "See the other N open times", and one details step ending in "Book <day> at <time>".
- **AC34** — O offers times from after the link's notice; ↵ adds and hops a day; ⌘C / ⇧⌘C copy link / text; held times count as busy and release together when one is picked or after 48 hours.

Accounts
- **AC35** — Calendar accounts shows each account's calendars with Show in your week and Counts as busy for booking links, meeting-link providers, Sync now, and Remove with stated consequences and Undo (K13).
- **AC36** — Connect shows honest provider tiles, a consent step naming each permission and where data lives, a calendar picker and import progress that can be closed.
- **AC37** — A revoked Google connection shows Reconnect in the banner, the account's group and Calendar accounts, names the booking-link risk, and keeps that account's events with the sync mark.

Folded-in holes and two-way Google
- **AC41** — An event can live on any calendar you can edit, custom Moduo calendars included (#calendar or the event's calendar row), and sets and sharing apply to it (K9).
- **AC42** — An event created or changed elsewhere (another device, ⇧⌘K, MCP, a teammate's shared calendar) appears in the open week within a few seconds without a reload (K10).
- **AC43** — Moving, resizing, renaming, re-guesting, adding a Meet link to, making private or deleting a Google event saves to Google first; a refusal rolls back with a reason; offline edits queue and sync when back.
- **AC44** — Changing one occurrence of a repeating event asks "This event / All events", and This event changes only that occurrence, in Moduo and in Google (K15).
- **AC45** — Working hours, show weekends and week start are set from the calendar, and the wash, opening scroll, free-time hops, S and working-hours booking links follow them (K16).
- **AC46** — Assistants can, through MCP, create an event with a place, link or privacy, offer times and read who sees what; every change is attributed to the key.

Quality
- **AC38** — In every declared state: no serious or critical axe rule, every Tab stop visibly focused, every pointer target changes on hover.
- **AC39** — No hardcoded visual values; token conformance (`system`) 9 or higher, the per-label tokens excepted.
- **AC40** — The built module, run through the product lab and the same blind jury, scores at least the prototype's 7.50 with no confirmed severity 3.

## Tests that prove them

App tests run with Rstest (`bun run --cwd apps/app test <path>`), SQL tests in `supabase/tests/*.test.sql` (with the RLS matrix and mutants in CI), edge-function tests next to each function, journeys in `e2e/tests/` through `scripts/agent/e2e.sh`, and the product lab for the quality bar. Paths under `features/` are in `apps/app/src/`.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `features/calendar/grid-layout.test.ts` · "clock-change week keeps wall-clock hours" | AC1 | In the week of 25 Oct every label and event top sits on the hour it names, and a click at "3 PM" saves 3 PM |
| `features/calendar/sync-status.test.ts` · "a failed account is scoped and its events stay" | AC2 | One failing account gives a banner naming it and stale marks on its events, never an empty-week message |
| `features/calendar/allday-lane.test.ts` · "two rows, spans, +N per day" | AC3 | Lanes cap at two rows, a multi-day item is one span, the hidden count per day is right |
| `features/calendar/ui/calendar-skeleton.test.tsx` · "skeleton keeps the last shape" | AC4 | Loading uses the last known all-day rows and Plan group sizes, so the grid doesn't move |
| `features/calendar/hooks/use-calendar-module.window.test.tsx` · "opens at the working day" | AC5 | The first scroll shows the start of working hours (and now, today) |
| `features/calendar/ui/day-header.test.tsx` · "date, today pill, due count on one baseline" | AC6 | Headers render weekday, date and due count; the count opens that day's list |
| `features/calendar/ui/event-chip.test.tsx` · "house chip; title wins over time" | AC7 | Tint and hue hairline from the calendar; a narrow chip drops the time first; past and selected states |
| `features/calendar/grid-layout.test.ts` · "overlaps split, cascade and fold" | AC8 | Starts within 30 min sit side by side (2 in week, 4 in day), 30+ cascade from 25%, the rest fold into +N |
| `features/calendar/grid-layout.test.ts` · "overnight events cross midnight" | AC9 | A 22:40–07:10 event shows on both days with its continuation labels |
| `features/calendar/ui/now-line.test.tsx` · "now line and the live meeting" | AC10 | The line sits over the grid; the live block carries the faint line, tick and "happening now" |
| `features/calendar/ui/now-next.test.tsx` · "now and next drops parts in order" | AC11 | At each width the pill hides then, key and until in order and stays inside its box |
| `features/calendar/month-layout.test.ts` · "month cells, bars and due counts" | AC12 | Six weeks, spans under the date row, due counts beside dates, past dimmed, "N more" |
| `features/calendar/ui/day-prep.test.tsx` · "day view prep" | AC13 | Each meeting shows people, notes, one follow-up and its link in the free width |
| `e2e/tests/calendar-narrow.spec.ts` · "1024 × 700 folds and nothing overlaps" | AC14 | At 1024 × 700 and 1280 × 800 one side panel shows and no toolbar or header text overlaps |
| `features/calendar/zones.test.ts` · "second zone and clock-change label" | AC15 | PT offsets per day, the Sunday change labelled, guests' local time on the event |
| `features/calendar/composer/parse.test.ts` · "reads what and when" | AC16, AC17 | Days, times, durations, #calendar, people, "at …", "the office", "on zoom"; a bare day takes its first free time; "Meet Mei" stays a title |
| `features/calendar/composer/defaults.test.ts` · "Meet only with guests; outside guests to Google" | AC18 | Meals get no link; outside guests route to the main Google calendar; without Google the echo says no invite is sent |
| `features/calendar/free-time.test.ts` · "free for everyone named" | AC19 | ⇥ skips every named teammate's busy blocks; verdicts read free, busy or in focus time |
| `features/calendar/gap-finder.test.ts` · "S finds room for the estimate" | AC20 | A task lifts into the next free slot that fits its estimate; nothing else moves |
| `features/calendar/commands/undo.test.ts` · "every edit undoes" | AC21 | Add, delete, move, resize and place each push one undo step that restores the event exactly |
| `e2e/tests/calendar-keyboard.spec.ts` · "the week by keys alone" | AC22, AC26 | Cursor, J/K, Space, ↵, ⌃↵, ⌥ moves, ⌘C/⌘V/⌘D, ⌘←/⌘→; single keys silent in fields; the right-click menu has no shortcuts |
| `supabase/tests/calendar_focus_item.test.sql` · "focus is busy to teammates, free to links" | AC23 | A focus item reads as "Focus time" to viewers and booking availability skips it unless the link opts in |
| `features/calendar/panel.test.ts` · "Plan groups" | AC24 | Only your tasks; From earlier oldest first; Due this week by date; Scheduled; No date; six then Show more |
| `features/calendar/ui/event-detail.test.tsx` · "event view follows the selection" | AC25 | Selecting another event updates Event and Notes; where, people, notes and tasks are two-line rows |
| `supabase/tests/calendar_share_levels.test.sql` · "levels per person and per calendar" | AC27 | Busy only and All details per member, the everyone default and per-calendar rules return exactly the right rows |
| `supabase/tests/calendar_private_masking.test.sql` · "private is busy for everyone" | AC28 | A private event returns "Busy" with no title, place, people, link or notes to any non-owner, even at All details |
| `features/calendar/share-lens.test.ts` · "preview equals what they get" | AC29 | The preview lens on your rows matches what the masked view returns for that member |
| `supabase/tests/calendar_busy_blocks_owner.test.sql` · "busy blocks name their owner" | AC30 | Teammates' busy blocks carry the owner, only for calendars shared at least as busy |
| `features/calendar/booking/availability.test.ts` · "open times on the week" | AC31, AC32 | Open times match the guest page's, skip holds, skip focus only when ticked, and need every accepted co-host free |
| `features/calendar/booking/sentence.test.ts` · "one details step ends in Book" | AC33 | Name, email and the optional answer on one step; the button names what's next, then "Book <day> at <time>" |
| `supabase/tests/slot_offers.test.sql` · "holds release together" | AC34 | Holds count as busy; a pick books one and releases the rest; 48 hours releases all |
| `features/calendar/accounts.test.ts` · "accounts, picker and remove with undo" | AC35, AC36 | Only picked calendars sync; busy defaults seed new links; remove soft-deletes and Undo restores |
| `supabase/functions/calendar-google-web/index.test.ts` · "a revoked token asks to reconnect" | AC37 | invalid_grant marks the account reauth and keeps its rows; reconnecting clears it |
| `supabase/tests/calendar_custom_calendar_events.test.sql` · "events on custom calendars" | AC41 | Create and move events onto a custom calendar you can edit; its grants apply |
| `features/calendar/realtime.test.ts` · "live events" | AC42 | An insert, update or delete reaches the open store; a reconnect resyncs |
| `supabase/functions/_shared/google-calendar.test.ts` · "patch, delete, Meet and visibility" | AC43 | Patch and delete use the event's own calendar; conferenceData and visibility are sent; a refusal rolls the row back |
| `features/calendar/recurrence-expand.test.ts` · "this event only" | AC44 | An override or exdate changes one occurrence; the series stays; Google gets the instance id |
| `features/calendar/prefs.test.ts` · "working hours drive the week" | AC45 | New hours move the wash, opening scroll and free-time hops and sync to user preferences |
| `supabase/functions/moduo-mcp/modules/calendar.test.ts` · "calendar tools" | AC46 | New fields, offers and who-sees-what work through MCP, attributed to the key |
| Product lab `lab.mjs --screens calendar` + the blind jury | AC38, AC39, AC40 | Every state axe-clean, focus visible, hover on every target, system ≥ 9, jury ≥ 7.50 with no confirmed severity 3 |

## Assumptions & technical decisions

Researched 27 Oct by code recon (`calendar_events`, Google sync, sharing grants, booking, accounts). Each block re-reads the latest function bodies before migrating (`.claude/rules/supabase.md`).

**Data model (Supabase-first; each block migrates what it needs; Tier 2)**
- `calendar_events` gains `is_private boolean not null default false`; `conference_url text` and `conference_provider text` (new vocabulary `CONFERENCE_PROVIDERS`: google_meet, zoom, teams, other); `kind text not null default 'event'` (new `CALENDAR_ITEM_KINDS`: event, focus, hold); `focus_task_id uuid` → tasks; `offer_id uuid` → slot_offers; for repeats `series_id uuid` (an override row points at its series), `original_start timestamptz`, `exdates timestamptz[] not null default '{}'`, and `external_series_id text` for Google's recurringEventId. Vocabularies go in `_shared/contracts/vocabularies.ts` with their CHECKs in the same migration (rule 4). Rejected: a separate v2 events table (doubles the mirror and the RLS).
- **Existing content:** a migration moves meeting URLs out of `location` (the mirror wrote Meet, Zoom and Teams links there) into `conference_url`/`conference_provider`, matching `meeting-link.ts`'s patterns; places stay in `location`. The mirror then writes conferenceData into the new columns. `attendees` keeps its jsonb shape (`[{email, name, status}]`) and is now written by create and update.
- **Ops:** `calendar_op_event_create` and `calendar_op_event_update` gain calendar, place, people, link, privacy, kind and focus task (drop the old signature: no overloads). The `share_event_calendar_ref` trigger keeps an explicit calendar when the actor can edit it (custom calendars, K9). Google events never go through `calendar_op_event_update` (its guard stays native-only): CALR-8 writes them to Google first through `calendar-google-web`, and `calendar_op_mirror_events` stores Google's answer, so a sync can't overwrite an edit and a refusal leaves Moduo untouched; Outlook, CalDAV and .ics stay read-only. `focus_task_id` carries no foreign key (a task purge would otherwise fail on a teammate's focus time); readers resolve it through `can_access`.
- **Private masking:** teammates read others' events through a security-barrier view (`calendar_events_visible`) that returns "Busy" and nulls title, description, place, people and link for private rows, and "Focus time" without the task for focus items, whenever the viewer isn't the owner. Freebusy calendars keep `calendar_busy_blocks`, which now returns the owner too (DROP+CREATE, grants restated, anon revoked).
- **Realtime (K10):** publish `calendar_events` like `20261008223000_tasks_realtime_publication.sql`, and copy `features/tasks/realtime.ts` (one channel per workspace, ref-counted, resync on reconnect). Built in CALR-7: the socket sits behind the runtime port (`calendar.listenLive`); the mirror op skips unchanged rows so a sync doesn't broadcast its whole window; hard deletes reach open apps only on a resync.
- **Google two-way:** `_shared/google-calendar.ts` gains `patchGoogleEvent` (summary, start/end, attendees, visibility, conferenceData via `conferenceDataVersion=1`) and a delete that takes the event's calendar id (it's hard-coded to primary today). `calendar-google-web` gains create (to a target calendar), update and delete actions. A Google edit goes to Google first, then the mirror op stores Google's answer; a refusal rolls the row back with the reason. Offline edits go through the sync kernel's outbox (`lib/sync`) in CALR-8b. "This event" on a Google repeat patches the instance id. The existing `calendar.events` scope allows all of it, so nobody re-consents.
- **Focus item:** `kind = 'focus'` rows on your Moduo calendar, optionally holding a task. Booking availability skips them unless the link opts in (`exposed_slot_links.busy_focus boolean default false`).
- **Offers:** new `slot_offers` (owner, link, title, duration, video provider, hold, expires_at, status from `SLOT_OFFER_STATUSES`: open, booked, released, expired) and `slot_offer_times`. Each held time is a `kind = 'hold'` event, so every availability check already counts it as busy. The guest picks through `booking-public` in an offer mode; the pick releases the rest in the same transaction; expiry releases by a scheduled job (pg_cron if the project has it, otherwise on read). New tables ship RLS and `delete-account` coverage.
- **Booking:** collective links switch on (`COLLECTIVE_LINKS_ENABLED`) with `booking_link_hosts.status` for acceptance. Where stays Meet, Zoom or Their choice, so `location_type` is untouched.
- **Accounts:** `calendar_accounts.status` adds `reauth` (contracts + CHECK), set when Google answers `invalid_grant`, plus `last_error text`. Connect upserts only the picked calendars (`ensureGoogleCalendarAccounts`). Each account calendar gets `busy_default boolean` to seed new links. Remove is a soft delete with a restore op for Undo (desktop clears secrets after the undo window). "New events go to" writes `is_default_target`.
- **Prefs (K16):** `CalendarPrefs` already holds workStartMinute, workEndMinute, weekStartsOn and showWeekends and syncs to `user_preferences.calendar`. The work is the sheet, plus booking-public reading them for links set to "your working hours".

**App and platform**
- The parser is deterministic and local (no model; AI stays MCP-only).
- Period keys move to ⌘← / ⌘→ in `lib/hotkeys/registry.ts` (nothing else uses them); bare arrows belong to the grid cursor.
- Panel folding is Calendar-only, through the shell's collapse API on the Calendar page; the shell doesn't change.
- **No token is added;** every value comes from `tokens.css` (the pink and red labels exist); avatars keep `--label-fill`.
- Tier 2 (drafts and validator) for each block touching `supabase/`: CALR-6, 7, 8, 11, 14, 15, 16, 17, 19, 20.

**Module contract** (`docs/moduo-module-contract.md`)
- **Spine:** links (event ↔ note, task, contact; L), drag (task → grid), @mention (/event in notes, kept), notifications (a booking or a picked offer is one quiet line in the day's digest; sharing notifies nobody), activity (moves, privacy and sharing changes, Google write results, all attributed), tags (unchanged).
- **MCP tools:** `calendar_create_event` and `calendar_update_event` gain place, link, privacy and calendar; new `calendar_offer_times` and `calendar_who_sees` (read). The existing list, day, delete, schedule, move, complete and roll-forward tools stay.
- **Dashboard widget:** the Home Today widget gains the now-and-next line with the join key.

## Execution blocks

Ordered by severity (the live module's severity-3 holes first), then data, then the four additions. Each block is one /s2 session; Tier 2 blocks take the drafts-and-validator path.

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **CALR-1 — Grid foundations** | wall-clock geometry in clock-change weeks, opening at the working day, the house chip on all events, overlaps and cascades, overnight events, the now line | AC1, AC5, AC7, AC8, AC9, AC10 | — |
| 2 | **CALR-2 — Headers, all-day lane, now and next** | day headers with due counts, the two-row lane with +N and ⇧A, the now-and-next line, the zone control in the gutter corner | AC3, AC6, AC11 | CALR-1 |
| 3 | **CALR-3 — Faults, loading, empty** | scoped sync banner and stale marks, skeletons in the last shape, offline marks, the closable first-week card | AC2, AC4 | CALR-1 |
| 4 | **CALR-4 — Keyboard, undo and menus** | grid cursor, J/K, Space, ↵, ⌃↵, ⌥ moves and resize, ⌘C/⌘V/⌘D, ⌘←/⌘→, undo for every edit, the right-click and ⋯ menus, the keys sheet | AC21, AC22, AC26 | CALR-1 |
| 5 | **CALR-5 — Plan and placing tasks** | "Tasks" becomes Plan with four groups, S lift and place, click to place, drag kept | AC20, AC24 | CALR-4 |
| 6 | **CALR-6 — Event data v2** | Tier 2: private, conference, kind, focus task, offer, repeat-exception and series columns; vocabularies; create and update with calendar, place, people, link; custom calendars hold events; meeting URLs moved out of location | AC41 | — |
| 7 | **CALR-7 — Live events** | Tier 2: calendar_events publication and the realtime store | AC42 | CALR-6 |
| 8 | **CALR-8 — Google two-way** | Tier 2: patch, delete by calendar, conferenceData and visibility; create, update and delete actions; Google-first writes with rollback; the mirror stores Google's privacy and guests; Google events editable in the week | AC43 (online) | CALR-6 |
| 8b | **CALR-8b — Calendar offline outbox** | Tier 2: calendar writes (Moduo and Google) made offline wait in a device outbox ("Offline · N to sync"), survive a reload and sync when back, through the sync kernel's `Outbox`/`drainOutbox`; a Google refusal on replay rolls back with its reason (split from CALR-8 on 28 Oct: the calendar module had no device queue at all) | AC43 (offline) | CALR-8, CALR-3 |
| 9 | **CALR-9 — The composer** | the typed box, highlighted tokens, draft on the grid, ⇥ free-time hops, place and link, the Meet and outside-guest defaults, invites via Google | AC16, AC17, AC18 | CALR-4, CALR-6, CALR-8 |
| 10 | **CALR-10 — Event view and where** | Event and Notes follow the selection, the who-sees-it line, Where (place, link, V), people from attendees, two-line rows | AC25 | CALR-6 |
| 11 | **CALR-11 — One occurrence** | Tier 2: "This event / All events", overrides and exdates, Google instance edits | AC44 | CALR-6, CALR-8 |
| 12 | **CALR-12 — Month and Day views** | Month view, Day view prep | AC12, AC13 | CALR-2 |
| 13 | **CALR-13 — Narrow windows, zones, working hours** | Calendar-only folding, Plan's toggle, second zone and clock-change labels, the Working hours sheet | AC14, AC15, AC45 | CALR-2 |
| 14 | **CALR-14 — Focus time** | Tier 2: focus items holding a task, "Focus time" to teammates, free for links unless ticked | AC23 | CALR-5, CALR-6 |
| 15 | **CALR-15 — Sharing and private** | Tier 2: Share your calendar over per-calendar grants, the masked view, private on any event (Google visibility too), the visibility line; live events stay masked too (CALR-7 streams the raw table and `postgres_changes` can't stream a view: the base-table RLS drops others' private rows for teammates, or their events move to a definer-sent per-person topic) | AC27, AC28 | CALR-6, CALR-10 |
| 16 | **CALR-16 — Preview and teammates** | Tier 2: busy blocks with owners, Preview as, shared-with-you lanes and legend, teammates in the composer | AC19, AC29, AC30 | CALR-15, CALR-9 |
| 17 | **CALR-17 — Booking links in the panel** | Tier 2: the Booking link view, open times on the week, co-hosts on, focus opt-in, booked list | AC31, AC32 | CALR-14, CALR-10 |
| 18 | **CALR-18 — Guest page details step** | carets, other open times, one details step, the Book label | AC33 | — |
| 19 | **CALR-19 — Offers with holds** | Tier 2: slot_offers, O and its card, copy as link or text, holds as busy, release on pick or after 48 hours | AC34 | CALR-17, CALR-9 |
| 20 | **CALR-20 — Accounts, connect, reconnect** | Tier 2: Calendar accounts in place, the calendar picker, consent step and import progress, reauth status, remove with Undo, New events go to | AC35, AC36, AC37 | CALR-3, CALR-8 |
| 21 | **CALR-21 — MCP, Today widget and the bar** | MCP fields and tools, the Today widget's now and next, the lab states and journeys below, a jury run against 7.50 | AC38, AC39, AC40, AC46 | CALR-9, CALR-16, CALR-19, CALR-20 |

**The lab config gains** (in `e2e/lab/lab.config.ts`, seeded data only; each block adds its own): states for share, preview-as, teammates on, booking link open, offer in progress, accounts, connect consent (no real OAuth), reconnect, the right-click menu, month, day and a two-zone week; journeys for typing an event with a place, typing with a teammate, placing a task by S, offering three times by keys, copying and duplicating an event, editing one occurrence, previewing as a teammate, opening a booking link and its guest page, and removing an account with Undo. The existing 11 Calendar journeys stay.

**Test this** (each PR): the artifact state of the same name beside the built screen, by keyboard first, then pointer, at 1024 × 700 and 1440 × 900.

## Out of scope

- Opaque auto-scheduling that moves your events (we schedule with you, not at you); in-app AI; a permanent day-fullness meter; MCP proposals as drafts to accept (MCP writes stay attributed ops).
- In-person and phone booking links (decided 27 Oct); panel folding for other modules.
- Team availability matrices and room booking (`BRIEF.md` non-goals); round-robin links.
- Write-back to Outlook or CalDAV; Moduo Calls as a link provider (re-planned in `docs/decisions/meet.md`).
- Light-theme tuning and mobile layouts (house out-of-scope list).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous (AC1–AC46).
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty**: product questions answered by mike on 27 Oct; technical unknowns researched and recorded.
- [x] **Data model is named and Supabase-first**; new columns, tables and migrations identified (CALR-6, 7, 8, 11, 14, 15, 16, 17, 19, 20).
- [x] **Module feature:** spine wiring, MCP tools and the Today widget are listed under *Assumptions & technical decisions*.
- [x] **Execution blocks** are decomposed, sequenced, context-sized and self-contained (21 blocks).
- [x] **Design constraints acknowledged**: tokens-only, shadcn-wrapped primitives, `docs/DESIGN_RULES.md` R1–R13; the artifact is the visual reference.
- [x] **Manual-test surfaces identified**: each block's artifact state, by keyboard then pointer, at 1024 × 700 and 1440 × 900.

**Ready to execute.**

## Open questions

- [ ] (none)
