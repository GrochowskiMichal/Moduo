> Raw research report from the Calendar re-plan, 2026-10-10. Nothing here is decided.

# Lane: a normal week per role in Calendar, and the gap map

> Research lane, 2026-10-10, read-only, on `t/maciej/calendar-replan` @ `e6fa89f3`. Same exercise as [`.design/tasks-v3/research/role-journeys.md`](../../tasks-v3/research/role-journeys.md), for Calendar. Evidence tags: **[R]** read in this repo today (file named) · **[V]** official product docs, read this session (most through search summaries of the official page; the Fantastical help page 404'd, so its row comes from the App Store listing summary) · **[F]** reviews, forums, third-party articles · **[M]** from memory, not checked this session · **[I]** inference.

**Reading frame.** "Complete" for a role = *they can run a normal Monday-to-Friday, plus their monthly or term moment, without opening the old tool*. For people inside a company that runs Google Workspace or Microsoft 365 (developer, PM, often the founder), Google or Outlook stays as the place invitations live; for them, "drop Google Calendar" can only mean **stop opening its screen**. That makes editing and answering invitations from Moduo the deciding question for those roles, not importing. For everyone else, it means not needing Google Calendar at all.

Marks: ✅ covered today or by a Tasks v3 decision · ◐ partly · ✗ not covered. A step that only something *planned* would cover (Moduo Meet, TX-6, PERM-8b, the old v2 deferrals) is marked ✗, and the reason names the plan.

---

## 0. What counts as covered

### Today (built)

- **Views:** Week (the default) and Day only (`calendar-toolbar.tsx` has two values). A small month in the left rail, with dots on busy days. No Month, agenda, quarter or year view. [R]
- **Moduo events:** draw on the grid to create; a quick popover with title, time, all-day, calendar and repeat; drag to move, drag the edges to resize; a description; links to contacts, notes and tasks; "New linked note" from the event; an activity trail. [R] `event-detail-panel.tsx`, decisions/calendar.md 2026-07-04
  - Repeats: presets plus plain-English custom rules with a read-back ("every tuesday and thursday at 9"). **Edits always apply to the whole series. A repeat can't end on a date, and one occurrence can't be moved or cancelled.** [R] `repeat-picker.tsx`, `recurrence-nl.ts` (no "until", no exceptions)
  - **No guests and no alerts** on a Moduo event: the event model has neither. A `location` exists, but only bookings and the mirror fill it (with a meeting link); the quick-create popover and the event editor give you no way to set a place or a room. [R] `events.ts` (`CalendarEventPatch` has no location)
  - You can make extra calendars of your own. [R] `calendars-panel.tsx`
- **Capture:** `/event` makes a one-line event from ⌘⇧K (a time gives a one-hour event, a date an all-day one). It's a stand-in until Calendar builds its own capture type. [R] `capture-type.tsx`
- **Other calendars:**
  - **Google** connects and syncs on the web and the desktop. From the web you can also *create* an event in a Google calendar (title, time, description, repeat; **no guests**). It then comes back as a mirrored event and is read-only like the rest. [R] `calendar-google-web/index.ts` (`push` action), decisions/calendar.md 2026-10-01
  - **Outlook, CalDAV** (iCloud, Fastmail, Nextcloud) **and ICS feeds** connect and sync **only from the desktop app**; the web shows what the desktop synced. [R] `integrations-section.tsx`
  - **Every mirrored event is read-only:** no move, edit, delete or reply to an invitation. Mirrored Google and Outlook events keep their meeting link, which shows a Join button. **No list of attendees is mirrored.** [R] `calendar-grid.tsx`, `mirror.ts`
- **Seeing teammates:** your calendars can be shared as Busy only · Can view · Can edit. Workspaces with several members default to busy-only. Teammates' busy-only calendars show on your grid as anonymous "Busy" blocks (whose isn't shown); a calendar shared as Can view shows its full events, labelled "Anna's calendar". You can save sets of calendars. The public busy/ICS link was removed. [R] `calendars-panel.tsx`, `use-calendar-module.ts` (`calendar_busy_blocks`), decisions/permissions.md 2026-10-06
- **Tasks on the calendar:** a scheduled task is a block (one per task today). You can tick it done in the block. When a block's time passes it offers Done · Later today · Took longer · Remove. A strip shows "N unfinished from earlier" with Move to today and Review. Each block has a focus timer. The right panel shows Today, Due soon and Backlog, and you drag tasks from it onto the grid. [R] `specs/calendar.md`
- **Booking links:**
  - Each link has one length, buffers, minimum notice, how far ahead people can book, weekly hours, which calendars count as busy, a note, custom questions and up to ten extra guests.
  - Video is Google Meet, Zoom or the guest's choice. A link can be paused or deleted.
  - The public page is one sentence the guest finishes, in the guest's own time zone.
  - Booking writes a Google event (so Google sends the invitations) or a Moduo event, and creates or matches a **contact linked to the event**. The guest can cancel.
  - Booking emails with an .ics file, and the host's bell, are live on prod since 2026-10-10 (TX-5, PR #349). This branch's BUILD_ORDER still shows TX-5 unticked.
  - **Not built:** rescheduling, cancelling from the host's side, reminders to guests (TX-6, planned), marking a no-show, several lengths on one link, single-use links, round robin, routing, payments. Collective (co-host) links are built but hidden (PERM-8b).
  - [R] `booking/model.ts`, `booking-public/index.ts` (actions: preview, book, cancel), BUILD_ORDER
- **Elsewhere:**
  - Home has a Today widget: a timed agenda, what's next, and the strip count with Move to today.
  - The calendar MCP tools are declared (list, day, create, update or delete an event, schedule, move, complete, roll forward). The connector hardening pass (MCP-1) is still open.
  - Settings hold working hours (used only to find gaps), week start and weekends. [R]

### Tasks v3 decided (counts as covered here, not built yet)

Calendar has to deliver these as part of its rebuild:

- **What the grid shows:**
  - Your own due-only tasks as all-day chips.
  - Several work sessions per task, each a block.
  - Future repeat occurrences as faint ghosts.
  - Missed sessions stay where they were, and the task shows under Earlier in Upcoming.
  - Teammates' unassigned tasks stay off your calendar.
- **Working from a block:**
  - Drag from the Calendar's Tasks list to schedule.
  - ▶ on a block = Focus on this, with one clock app-wide.
  - "Took longer" is an adjustment, never the planned length.
  - Focus shows your next meeting as a divider in Up next.
- **Booking:** sessions count as busy for booking links, with a switch per link.
- **Task reminders** come only through the desktop app in the menu bar and opt-in browser notifications. No email and no calendar feed.
- **Settings:** one Time & region (time zone, week start, 12/24h, date order), with one travel prompt when the device's zone changes.
- **Layout and shared pieces:**
  - The 3×3 layout, with the right panel's title row as a view dropdown.
  - One capture: ⌘⇧K, with ⌘1–7 switching the type.
  - References for events. The event chip and card promise "title · time · **people**".
- **Elsewhere in Tasks:**
  - A tracked-time log and a report per project and per client hub, with no rates.
  - Projects with start and target dates, and sections with date ranges. These are Tasks-side and **not** promised on the calendar.
  - MCP writes for tasks.

[R] `specs/tasks-v3.md` §2, §13, §14, §18, §11, §15

### Planned elsewhere (does NOT count)

- **Moduo Meet** (MEET-0a…10, all open). It would add "Add video" to any event and attendee invitation lists.
- **TX-6:** reminders to guests and cancelling from the host's side.
- **PERM-8b:** collective links.
- **The Calendar v1 deferrals** (DESIGN_BRIEF §11): reflowing the day, the morning plan and evening shutdown, writing to Google and Outlook with a default-calendar picker, ⌘K natural-language create, Month and agenda views, editing one occurrence.
- **Cues** ("remind me before my next meeting with Anna", Tasks 58, parked).
- **Mobile** (Tasks 36, out of scope; a calendar feed for the phone was considered and dropped in Tasks round 2c).

---

## 1. Student (replacing Google or Apple Calendar + Todoist)

**How they use calendars today:**
- **They type in the whole timetable.** Students enter their class timetable at the start of each semester, colour-code exam, presentation and essay days, and plan the week in blocks; a 10-minutes-before reminder on each class is typical ([CWRU](https://case.edu/orientation/orientation-news/more-know/cwru-students-favorite-organization-tool-google-calendar-first-year)) [F].
- **They live in the phone's calendar.** A Southampton survey of 137 students found the phone's calendar, Google Calendar and Outlook were the most-used tools for planning study, and students preferred appointments and reminders over task lists ([Southampton](https://eprints.soton.ac.uk/270912)) [F, 2010].
- **Universities publish timetables as feeds.** Many publish the personal timetable as a subscribable feed (an ICS link) ([UCL](https://www.ucl.ac.uk/srs/timetable-icalendar-subscription), [Kent](https://student.kent.ac.uk/studies/timetabling/icalendar-guidance)) [V].

**Term start (the big moment)**

| Step | Cover | Why |
| --- | --- | --- |
| Subscribe to the university timetable feed | ◐ | ICS feeds work, but **only from the desktop app**, and the feed is read-only. A student on a Chromebook or the web can't add it. |
| …or type the timetable by hand: "Algorithms, every Tue 10:00 until Dec 15, room B2.04" | ✗ | Moduo repeats can't end on a date, and there's no way to set a room. |
| Paste the syllabus into Claude → every deadline becomes a dated task | ◐ | Tasks MCP writes are decided, and due-only tasks become all-day chips (decided). Calendar-side tools exist, but the connector hardening (MCP-1) is still open. |
| Add term start and end, reading week and exam period as all-day events | ✅ | Moduo all-day events. |
| See the whole term month by month | ✗ | No Month view; the rail's mini-month only shows dots. |

**Monday to Friday**

| Step | Cover | Why |
| --- | --- | --- |
| Check today on the phone in bed or between classes | ✗ | No phone app and no feed. Moduo events, sessions and due chips never reach the phone. |
| At the desk, open the week: classes, due chips and study blocks together | ✅ | Week view + feed + due chips (decided) + sessions (decided). |
| Get an alert 10 minutes before class, with the room | ✗ | Events have no alerts. Feed events don't carry the room into Moduo either; the mirror keeps only meeting links. |
| A lecture is cancelled this week | ◐ | A feed updates itself when the university changes it. A Moduo series can't drop one occurrence. |
| Drag "Essay draft" onto Wed 14:00 and again onto Thu 10:00 | ✅ | Drag from the Tasks list (built) + several sessions per task (decided). |
| The study block ends unfinished → Later today, or Move to today from the strip | ✅ | The built loop. |
| ▶ on the block → Pomodoro in Focus | ✅ | Decided (one clock). |
| Group project: find a time with 4 classmates and invite them | ✗ | No invitations. Classmates aren't in the workspace, so not even busy blocks help. |
| "Problem set due Fri 23:59", reminder a day before | ◐ | A due time and a reminder are decided, but the reminder reaches only the laptop and the browser, not the phone. |
| Exam week: count the exams at a glance | ✗ | No Month view. |
| Share the timetable with a parent or partner | ✗ | No public link or feed; sharing works only inside the workspace. |

**Only in Moduo:** the syllabus lands as dated tasks on the same calendar as the classes, and missed study blocks roll forward without guilt.

---

## 2. Developer (replacing Google Calendar + Linear)

**How they use calendars today:**
- **Focus time that declines meetings.** Google Workspace's focus time declines meetings automatically, and working hours and working location tell people when you can't be booked ([focus time](https://support.google.com/calendar/answer/11190973), [working hours](https://support.google.com/calendar/answer/7638168)) [V].
- **On-call shifts as a feed.** On-call shifts come from PagerDuty as a feed you subscribe to (WebCal or iCal), 1 month back and up to 6 months ahead ([PagerDuty](https://support.pagerduty.com/docs/schedules-in-apps)) [V].
- **Meeting load.** Google shows how much of the week went to meetings ("Time insights", [Google](https://support.google.com/calendar/answer/10738043)) [V].
- **Google stays.** The company's Google Workspace is the system of record, so the developer can't leave it [I].

**Monday to Friday**

| Step | Cover | Why |
| --- | --- | --- |
| Daily standup at 9:30 (the manager's Google series): see it, press Join | ✅ | The mirror plus the Join button. |
| Get a 1-minute alert before standup | ✗ | Events have no alerts. |
| Accept the sprint review invitation, decline the all-hands | ✗ | Read-only mirror: no replies to invitations. |
| Block 2 h of focus each morning so nobody books over it | ◐ | Sessions show on the Moduo grid and count as busy for Moduo booking links (decided). Colleagues booking in Google see you as free, and nothing declines meetings for you. |
| Schedule "Review PR · MOD-142" for 30 min after lunch | ✅ | Drag from the Tasks list. |
| ▶ Focus on the block; the timer follows into other screens | ✅ | Decided (one clock, top-bar timer). |
| It overran → Took longer | ✅ | Decided as an adjustment. |
| On-call week from PagerDuty | ◐ | The ICS feed works but only from the desktop app; the shifts show read-only. |
| Pairing session: invite a teammate | ✗ | No invitations. At the busy-only default you see busy time but not whose it is. |
| Cycle edges and release Thursday on the calendar | ◐ | Release day works as a Moduo all-day event. Sections with date ranges (sprints) live in Tasks and aren't promised on the grid. |
| Friday: meetings versus focus this week | ◐ | The time report covers task time only; no meeting-load view. |
| Teammates in another time zone | ◐ | Time & region is one zone (decided); no second column. |

**Every two weeks (cycle planning):** see two cycles ahead at once: ✗ (no Month view; Tasks' Timeline shows project bars, not meetings).

**Only in Moduo:** the PR task, its focus block and its time are one thing; no plugin shuttles blocks between Linear and Google.

---

## 3. PM (replacing Google Calendar or Outlook + Jira or Asana)

**How they use calendars today:**
- **Find a time.** Google's "Find a time" compares up to 50 guests' calendars, and with Gemini it suggests times from availability and working hours ([find a time](https://support.google.com/calendar/answer/6294878), [suggested times](https://support.google.com/calendar/answer/16690875)) [V].
- **Moving other people's time.** The job is mostly moving other people's time: invitations, rescheduling, reading meeting load [I].

**Monday to Friday**

| Step | Cover | Why |
| --- | --- | --- |
| Morning: a week of 6–8 meetings from Google or Outlook | ◐ | Google works on the web. Outlook syncs only through the desktop app. |
| Answer 5 new invitations | ✗ | Read-only mirror. |
| A 1:1 clashes → drag it to 15:00 | ✗ | Mirrored events can't be moved. |
| Book a 45-min review with 5 people next week | ✗ | No find-a-time. At the busy-only default, busy blocks don't say whose; they cover only Moduo members and suggest nothing. |
| Open the stakeholder 1:1 → the agenda note, the contact, open tasks | ✅ | Event Detail: links, the Notes rail, activity. |
| Action items in the meeting note become tasks linked to the event | ✅ | Note checkboxes → tasks (spine). |
| Release day and roadmap dates on the calendar | ◐ | Possible as Moduo all-day events. Project targets and section ranges aren't on the grid (not in the Tasks contract). |
| A 40-min gap → schedule "Write PRD" | ✅ | Drag; the Focus meeting divider is decided. |
| Move just this week's occurrence of the weekly 1:1 | ✗ | Moduo series edit as a whole; Google series are read-only. |
| Alert before the next meeting | ✗ | Events have no alerts. |
| Friday: how much of the week was meetings | ✗ | No meeting-load view. |

**Monthly or quarterly:** the release calendar by month, shared with stakeholders outside the workspace: ✗ (no Month view; no public link).

**Only in Moduo:** the meeting, its note, its action items and the people are linked without anyone copying anything.

---

## 4. Founder / team of up to 5 (replacing Google Calendar + Notion Calendar or Fantastical + Calendly)

**How they use calendars today:**
- **Fantastical:**
  - Can switch the whole calendar to another time zone.
  - Can show a second time zone next to the grid.
  - Keeps favourite zones at hand while creating events.
  - Has calendar sets that switch on by location.
  - Has day, week, month, quarter and year views ([App Store listing](https://apps.apple.com/us/app/fantastical-calendar-tasks/id718043190)) [V].
- **Notion Calendar:**
  - Joins several accounts in one view.
  - Lets you pick open slots and paste them into an email ("Share availability", key S), plus scheduling links ([Notion](https://www.notion.com/help/guides/getting-started-with-notion-calendar)) [V].
- **Calendly:**
  - Collective links (several hosts, one guest) and round robin.
  - Meeting polls.
  - Automatic reminders and follow-ups ([Calendly](https://calendly.com/blog/team-scheduling-options)) [V].

**Monday to Friday**

| Step | Cover | Why |
| --- | --- | --- |
| One week across 2 Google accounts and iCloud | ✅ | Several accounts; iCloud through CalDAV (connected from the desktop). |
| Switch between "Work" and "Everything" | ✅ | Saved calendar sets. |
| Investor intro → send a booking link; the investor books | ✅ | Booking link with Meet or Zoom; the contact is created and linked. |
| An investor emails "send me a few times" → reply with 3 slots | ✗ | No availability snippet or single-use link; you'd copy times by hand. |
| A customer call that needs both founders free | ✗ | Collective links are built but hidden (PERM-8b). |
| Find time for a team planning session | ◐ | Teammates' busy blocks show (busy-only by default), but not whose, and nothing suggests a time. |
| Create the offsite and invite the 4 teammates | ◐ | Put it on a calendar shared as Can view and they see it. No invitations, no replies, and nothing outside Moduo. |
| Travelling to SF: home and SF hours side by side | ◐ | The travel prompt is decided, and the booking page shows the guest's zone. No second-zone column, no override. |
| "Leave now" or 5-min alert before the investor call | ✗ | Events have no alerts. |
| The monthly investor update repeats as a task, with ghosts | ✅ | Decided. |
| Open Anna's contact: when did we last meet, when do we meet next | ◐ | Booked meetings are linked to her. Google invitations aren't, because no attendees are mirrored, and there's no "next meeting" line. |
| Quarterly board meeting with outside board members | ✗ | No invitations. |

**Monthly:** a month of fundraising meetings at a glance: ✗ (no Month view).

**Only in Moduo:** a booked call arrives already tied to the person, the company, the deal's tasks and the email thread.

---

## 5. Freelancer / agency of 2–5 (replacing Google Calendar + Calendly + Toggl or Harvest + Sunsama or Akiflow)

**How they use calendars today:**
- **Toggl turns meetings into time.** Toggl pulls Google and Outlook events in so each becomes a time entry in one click, with billable rates ([Toggl](https://toggl.com/team-size/freelancers)) [V].
- **Sunsama plans the day.** Its daily planning walk-through takes 5–15 minutes, and its timeboxes are written to Google or Outlook so others see you busy ([BrainSensei](https://brainsensei.com/sunsama-review/)) [F].
- **Akiflow does the same with an inbox.** Akiflow also writes blocks to the connected calendar; its mobile app and billing draw the complaints ([Morgen on Akiflow](https://www.morgen.so/blog-posts/akiflow-review)) [F].
- **Calendly reschedules and lets the guest pick a length.** Invitees can reschedule, and one link can offer up to four lengths (paid) ([manage meetings](https://calendly.com/help/how-to-manage-your-meetings), [multiple durations](https://calendly.com/help/how-to-set-up-multiple-durations-for-an-event-type)) [V].

**Monday to Friday**

| Step | Cover | Why |
| --- | --- | --- |
| Monday: tasks across clients, estimates, placed into the week | ✅ | Drag + sessions; the tracked-time log is decided. |
| A guided "plan my day" walk-through, an evening shutdown | ✗ | Deferred (DESIGN_BRIEF §11); still not decided. |
| Booking pages: "Discovery 30m", "Review 60m" | ✅ | One link per meeting type. One link with a choice of lengths isn't there (minor). |
| The client books → contact + event + Meet + emails | ✅ | Built (TX-5 live). |
| The client asks to move the meeting | ✗ | No reschedule (cancel and rebook). Host-side cancel and guest reminders wait for TX-6. |
| Billable block "Acme logo · 2h" with the timer | ✅ | A session with Focus; time goes to the client's report (decided, no rates). |
| Log the 45-min Acme call as Acme time | ✗ | A meeting isn't a task, so it can't carry tracked time. Toggl does it in one click. |
| Clients and outside tools see your timeboxes as busy | ◐ | Moduo booking links count sessions (decided). Nothing writes them to Google, so Calendly or a client's Google invite sees you free. |
| Show only Acme's deadlines and sessions this week | ✗ | No calendar filter by project or client (not decided). |
| Agency: who on the team is free for a client call | ✗ | No round robin; at the busy-only default, busy blocks don't say whose. |
| Alert before the client call, on the phone | ✗ | No event alerts; no phone. |

**Month end:** hours by client as CSV or PDF ✅ (decided). Next month's deliverables by month ✗ (no Month view).

**Only in Moduo:** the client's hub holds the meetings, the work blocks, the hours and the emails without any logging.

---

## 6. Creator (replacing Google Calendar + Notion)

**How they use calendars today:**
- **Notion content calendars.** They're a database seen as a month calendar of publish dates by platform, plus a board by stage. Popular templates sell exactly that month view ([2sync roundup](https://2sync.com/blog/best-content-calendar-templates-notion), [ClickUp roundup](https://clickup.com/blog/notion-calendar-templates/)) [F].
- **Notion's calendar isn't their life calendar.** The pain, from the Tasks lane: that month calendar is separate from where their appointments live (see the Tasks report §1.6) [F].

**Monday to Friday**

| Step | Cover | Why |
| --- | --- | --- |
| Open the month's publishing plan: every video and post by platform | ✗ | No Month view. Due chips (decided) show only in Week and Day. |
| Drag Thursday's video to next Tuesday | ◐ | Dragging a due chip to change its date isn't stated; dragging from the Tasks list schedules a session, not a publish date. |
| Colour publish dates by channel (YouTube · newsletter · shorts) | ✗ | Task chips are deliberately colourless; no colour by project or tag decided. |
| Recording session Tue 10–13 on the "Episode 42" task | ✅ | Sessions (decided). |
| Book the editor for a review call | ✗ | No invitations. A shared calendar works only if the editor is in the workspace. |
| Sponsor call through a booking link; the sponsor's deliverable due date linked to them | ✅ | Booking → contact; a due task linked to the contact. |
| "Publish every Thursday" series | ✅ | Repeat ghosts (decided). |
| The editor sees the team's publishing calendar | ✗ | The calendar shows only *your own* due tasks (decided). No project calendar view. |
| Publish-day nudge | ◐ | Task reminder (decided), laptop and browser only. |

**Monthly:** plan next month's content on a month grid: ✗.

**Only in Moduo:** the pipeline board and the publishing calendar are the same tasks, on the calendar your dentist appointment is on.

---

## 7. Founder-led sales (replacing Google Calendar + Calendly + a light CRM)

**How they use calendars today:**
- **Calendly handles the slips.** The host can reschedule and mark a no-show (the button appears once the start time passes, and can be undone). Paid plans send automatic reminders and "book again" emails to no-shows ([reschedule](https://calendly.com/help/how-to-manage-your-meetings), [no-shows](https://calendly.com/help/how-to-mark-no-shows-for-meetings)) [V].
- **The CRM records how it went.** HubSpot records an outcome per meeting (completed · rescheduled · no show · canceled) next to notes and tasks ([HubSpot](https://knowledge.hubspot.com/meetings-tool/prepare-review-and-follow-up-on-meetings-in-the-sales-workspace)) [V].

**Monday to Friday**

| Step | Cover | Why |
| --- | --- | --- |
| Put the discovery link in outbound emails | ✅ | Booking link. |
| The prospect books → contact created or matched, event linked, Meet, confirmation + .ics | ✅ | Built (TX-5 live). |
| A reminder reaches the prospect 24 h and 1 h before | ✗ | TX-6 (planned). |
| Before the call: open the event → contact, company, last emails, notes | ◐ | Works for booked calls. Meetings that arrived as Google invitations have no attendees in Moduo, so they link only by hand or by suggestion. |
| The prospect doesn't show → mark it, send a rebook link | ✗ | No no-show. |
| The prospect asks to move it | ✗ | No reschedule. Host-side cancel waits for TX-6. |
| After the call: "Send proposal Thu" task linked to the contact; a call note | ✅ | Spine links + Notes rail. |
| "When's my next meeting with Acme?" | ◐ | The hub lists linked events; no "next meeting" line. |
| "Before my next call with Anna, remind me to ask about pricing" | ✗ | Cues are parked (Tasks 58). |
| A second call with the cofounder on it | ✗ | Collective links are hidden (PERM-8b). |
| Alert before each call | ✗ | Events have no alerts. |

**Monthly:** calls booked, held, no-shows: ✗ (no meeting outcomes).

**Only in Moduo:** the booking creates the contact, the meeting, the follow-up task and the email thread as one linked record, with no Zapier.

---

## 8. The gap map

Every ✗ and ◐ above, merged. Roles: **S** student · **D** developer · **P** PM · **F** founder/team · **A** freelancer/agency · **C** creator · **L** founder-led sales. Sorted by how many roles it blocks, then by how often it hurts.

**Status** says where each gap already stands: **by design** (decided out of scope) · **v1 deferral** (Calendar v1 put it off, DESIGN_BRIEF §11) · **owed** (another plan assigned it to this rebuild) · **planned** (a block exists elsewhere) · **parked** · **new** (first named here).

| # | Gap | Roles | How often it hurts | What the replacing tool does today | Status |
| --- | --- | --- | --- | --- | --- |
| G1 | **Nothing on the phone.** Moduo events, sessions and due chips never reach a phone (no app; the feed was dropped in Tasks round 2c). | S D P F A C L (7) | Many times a day | Google, Apple, Fantastical and Notion Calendar phone apps | **By design** (Tasks 36: mobile out of scope; feed dropped round 2c) |
| G2 | **No alerts for events.** Task reminders are decided; event alerts aren't. | S D P F A C L (7) | Before every meeting | Google: alerts per calendar and per event, by phone, browser or email, only if you said yes ([Google](https://support.google.com/calendar/answer/37242)) | **New.** Tension: the v1 brief's "never a notification" (written about the loop) and Tasks' channel call (desktop menu bar + browser only, no email, no feed) limit how an event alert could ever arrive |
| G3 | **No guests or invitations on Moduo events**, and the Google create from the web has no guests | S D P F A C L (7; light for D) | Daily for P, F, L; weekly for the rest | Google and Outlook invitations; Fantastical and Notion Calendar write through to them | **New** for Calendar (v1 anti-goal "no rebuilt meeting stack"); Moduo Meet plans invite lists but no invitations |
| G4 | **Google and Outlook events are read-only.** You can't move, edit, delete or answer them, and a Google event made in Moduo becomes read-only once it syncs back. Outlook, CalDAV and ICS can't be written at all. | D P F A C L, S light (7) | Daily for anyone in a company calendar | Every calendar client edits and answers in place (Morgen, Fantastical, Notion Calendar) [M] | **v1 deferral** (two-way write-back); answering invitations is **new** |
| G5 | **No Month view** (nor agenda, quarter or year) | S D P F A C (6) | Weekly; blocks creators | Google, Apple and Outlook month views; Fantastical day to year; Notion content calendars are month grids | **Owed** (Tasks 26: "Calendar gets a Month view") + v1 fast-follow |
| G6 | **Moduo repeats can't end on a date or change one occurrence** ("until Dec 15", "skip this week") | S D P F A C (6) | Weekly where Moduo events are used; at term start for S | Google, Apple and Outlook: end date or count, "this event / all events" [M] | One occurrence: **v1 deferral**. End date: **new** |
| G7 | **No find-a-time.** At the busy-only default, blocks don't say whose; nothing suggests a time; non-members are invisible. (A calendar shared as Can view shows full events, labelled "Anna's calendar".) | S D P F A (5) | Weekly; daily for P | Google "Find a time" for up to 50 guests + suggested times ([Google](https://support.google.com/calendar/answer/6294878)) | **New** |
| G8 | **Only your own tasks on the calendar.** No calendar for one project or client, no colour by project, tag or channel, and project and section dates aren't on the grid. | D P F A C (5) | Weekly | Notion calendar views per database; Akiflow and Sunsama colour by source [F] | **New**; "your own tasks only" is a Tasks 18 decision |
| G9 | **No attendees on mirrored meetings.** So no automatic link to contacts, no "next or last meeting with Anna", and nothing to prepare a meeting from. The References event card promises "people" it can't fill. | P F A C L (5) | Daily for L; weekly for the rest | HubSpot and CRMs match meetings to contacts by attendee email [V] | **New**; cues **parked** (Tasks 58); meeting prep was "worth exploring" (Tasks 60) |
| G10 | **No time-zone tools beyond one setting.** No second-zone column, no override, no "their time" while creating. | D P F A L (5) | Weekly for travelling or remote people | Fantastical: override, second zone, favourite zones ([listing](https://apps.apple.com/us/app/fantastical-calendar-tasks/id718043190)); Notion Calendar zones | **New** (Tasks 76 decided the one setting + travel prompt) |
| G11 | **Timeboxes are invisible outside Moduo.** Nothing goes to Google, and there's no public busy feed, so colleagues and outside booking tools see you as free. | D P F A (4) | Daily for focus-time defenders | Sunsama and Akiflow write blocks to Google; Google focus time declines meetings by itself | **v1 deferral** (write-back); public busy link removed 2026-10-06 |
| G12 | **Can't share a calendar outside the workspace** (family, stakeholders, a client); the public link was removed | S P F A (4) | Weekly | Google: share with any address, or a public or secret iCal link [M] | Removed 2026-10-06 (nothing served the feed): **new** as a need |
| G13 | **No way to offer a few specific times** (an availability snippet, a single-use link, a meeting poll) | P F A L (4) | Weekly | Notion Calendar "Share availability"; Calendly single-use links and meeting polls ([single-use](https://calendly.com/help/how-to-create-a-single-use-link)) | **New** |
| G14 | **No way to set a place or room on a Moduo event** (the field exists; only bookings and the mirror fill it) | S F A L (4) | Weekly (daily for S) | Every calendar's location field with a map link [M] | **New** |
| G15 | **Thin booking for clients.** No reschedule, no host cancel or guest reminders, no no-show, no lengths to choose from. | F A L (3) | Several times a week for L | Calendly reschedule, no-show, workflows, up to 4 lengths | **Planned** (TX-6: reminders + host cancel); reschedule, no-show and lengths **new** |
| G16 | **No team booking.** Collective links are hidden; no round robin or routing. | F A L (3) | Weekly | Calendly collective, round robin and routing forms | **Planned** (PERM-8b collective); round robin and routing **new** |
| G17 | **No meeting outcomes and no counts** (held · no-show · rescheduled) | F A L (3) | Weekly; monthly review | HubSpot meeting outcomes | **New** |
| G18 | **Outlook, CalDAV and ICS connect and sync only from the desktop app** | S D P (3) | Once (setup), then whenever the desktop is off | Any calendar subscribes from the web or the phone | **v1 choice** (desktop engine; Google moved to the web 2026-10-01) |
| G19 | **Meetings can't become tracked time, and there's no meeting-load view** | D P A (3) | Weekly; month end for A | Toggl turns events into time entries; Google Time insights | **New** |
| G20 | **No guided plan-the-day or shutdown** | A F (2) | Daily for Sunsama users | Sunsama's 5–15 min ritual | **v1 deferral** |
| G21 | **No focus time that declines meetings, no working location or out of office** | D P (2) | Daily for D | Google Workspace focus time and working location | **New** (needs G4's write-back) |
| G22 | **Calendar's own capture isn't built.** `/event` is a one-line stand-in; there's no event type with guests, place and video. | all (◐) | Daily, mildly | Fantastical and Notion Calendar natural-language create | **Owed** (Tasks 90b: Calendar registers its own capture type) |
| G23 | **Calendar MCP tools are declared but the connector pass (MCP-1) is open.** So "syllabus → events" and "book me a slot" through your AI aren't proven. | S F L (◐) | At term start; occasionally | Gemini in Google Calendar suggests times | **Planned** (MCP-1) |

**What groups together.** G3, G4, G9 and G13 are one theme: **Moduo can't take part in meetings with other people**. It shows them but can't create, move, answer or know who's in them. G1, G2 and G11 are another: **Moduo's plan stays inside Moduo** (no phone, no alerts, no outside busy). Most roles hit both themes before anything else.

---

## 9. Would they switch?

- **Student:** not yet. No phone, no alerts, and a timetable that can't end or skip a week keep Google or Apple Calendar in their pocket. Moduo becomes the desk planner beside it, which isn't dropping it.
- **Developer:** as a layer on top, yes; dropping Google, no. Invitations, replies and focus time that declines meetings live in the company's Google, and colleagues can't see Moduo focus blocks.
- **PM:** no. The job is moving other people's time (invite, find a time, reschedule, answer), and every one of those is read-only or missing.
- **Founder / team:** partly. Booking links, many accounts in one view, sets and the contact link can replace Calendly-lite and the viewing side of Notion Calendar or Fantastical. Google stays for invitations, edits, the phone, time zones and collective links.
- **Freelancer / agency:** closest. Booking, sessions, the time report by client and the loop cover the core. Rescheduling, meeting-to-billable time, timeboxes visible to clients, and alerts on the phone keep Calendly, Toggl and Google open.
- **Creator:** not until there's a Month view and a calendar for a project the whole team can see. After that, a strong fit, because the pipeline and the calendar are one truth.
- **Founder-led sales:** not yet. Calendly's reschedule, reminders and no-shows, plus attendee-matched meetings on the contact, are the daily loop. Moduo's booking-to-contact link is the edge they'd switch for.

**Every role still needs Google Calendar somewhere.** No role can drop Google Calendar this week. The two reasons that cover all seven: it's the only place their week reaches the phone and makes a sound before a meeting (G1, G2), and the only place they can invite people or change a meeting someone else made (G3, G4).

---

## 10. People outside these roles: is each gap universal?

| Gap | Universal? | Who else feels it most |
| --- | --- | --- |
| G1 phone · G2 alerts | **Yes.** Everyone with a calendar checks it on the phone and relies on its alert. An old industry survey found 87% used their device's calendar at least daily ([CalConnect, 2006](https://standards.calconnect.org/cc/cc-a0609-2006.html)) [F, dated]. | Households, shift workers, clinicians, anyone away from a desk |
| G3 invitations · G4 read-only | **Yes, for anyone who meets people.** In any company running Google or Microsoft, the calendar *is* the meeting system. | Executive assistants (who also need to manage someone else's calendar, not in any role here), teachers, consultants |
| G5 Month view | **Yes.** Every mainstream calendar has one; families plan school terms and holidays by month. | Parents, event organisers, researchers with month-long milestones |
| G6 repeat end and one-off changes | **Yes.** School timetables, therapy courses, a skipped standup. | Teachers, parents, anyone on a course |
| G14 place | **Yes.** In-person meetings everywhere. | Field work, healthcare, households |
| G12 sharing outside the workspace | **Yes for households**; a "family calendar" is a top reason to use Google Calendar [I]. | Couples, families, an assistant outside the team |
| G10 time zones | Common, not universal | Remote teams, travellers, anyone with family abroad |
| G7 find-a-time | Team-only | Executive assistants, recruiters, ops |
| G8 project calendars and colour | Team or project work | Marketing teams, event planners |
| G9 attendees and contacts | Anyone who meets clients; uniquely Moduo's to win | Consultants, coaches, recruiters |
| G11 outside busy · G21 focus time | Knowledge workers in companies | Anyone defending deep work |
| G13 offer times · G15–G17 booking depth | Client-facing work only | Coaches, tutors, therapists (who add payments and intake forms), recruiters (round robin) |
| G18 desktop-only connect | Anyone who isn't on the desktop app | Web-only and Chromebook users, students first |
| G19 meetings as time | Billing work only | Consultants, lawyers, agencies |
| G20 daily ritual | A niche that loves it | Sunsama and Akiflow users |
| Not in any role above | — | **Holidays and birthdays.** Google adds public holidays and contacts' birthdays by itself [M]; Moduo contacts already store dates (`contacts/dates.ts`, [R]) but nothing puts them on the calendar. **Shift patterns** ("4 on, 4 off") that plain repeat rules can't say. |

---

## Sources

**Official docs [V]:**
- Google Calendar: [notifications](https://support.google.com/calendar/answer/37242) (fetched), [find a time](https://support.google.com/calendar/answer/6294878), [suggested times](https://support.google.com/calendar/answer/16690875), [focus time](https://support.google.com/calendar/answer/11190973), [working hours and location](https://support.google.com/calendar/answer/7638168), [time insights](https://support.google.com/calendar/answer/10738043), [appointment schedules](https://support.google.com/calendar/answer/10729749).
- Calendly: [manage meetings](https://calendly.com/help/how-to-manage-your-meetings), [no-shows](https://calendly.com/help/how-to-mark-no-shows-for-meetings), [team scheduling](https://calendly.com/blog/team-scheduling-options), [multiple durations](https://calendly.com/help/how-to-set-up-multiple-durations-for-an-event-type), [single-use links](https://calendly.com/help/how-to-create-a-single-use-link).
- Others:
  - [Notion Calendar guide](https://www.notion.com/help/guides/getting-started-with-notion-calendar)
  - [Fantastical App Store listing](https://apps.apple.com/us/app/fantastical-calendar-tasks/id718043190) (flexibits.com/fantastical/help/time-zones returned 404)
  - [PagerDuty schedules in apps](https://support.pagerduty.com/docs/schedules-in-apps)
  - [Toggl for freelancers](https://toggl.com/team-size/freelancers)
  - [HubSpot meetings workspace](https://knowledge.hubspot.com/meetings-tool/prepare-review-and-follow-up-on-meetings-in-the-sales-workspace)
  - Timetable feeds: [UCL](https://www.ucl.ac.uk/srs/timetable-icalendar-subscription), [Kent](https://student.kent.ac.uk/studies/timetabling/icalendar-guidance)

**Reviews, articles, studies [F]:**
- Students: [CWRU on Google Calendar](https://case.edu/orientation/orientation-news/more-know/cwru-students-favorite-organization-tool-google-calendar-first-year), [Southampton student survey](https://eprints.soton.ac.uk/270912)
- Planners: [BrainSensei on Sunsama](https://brainsensei.com/sunsama-review/), [Morgen on Akiflow](https://www.morgen.so/blog-posts/akiflow-review)
- Content calendars: [2sync content calendars](https://2sync.com/blog/best-content-calendar-templates-notion), [ClickUp Notion calendar templates](https://clickup.com/blog/notion-calendar-templates/)
- Phone use: [CalConnect 2006 survey](https://standards.calconnect.org/cc/cc-a0609-2006.html)

**Not checked this session [M]:**
- Google's default reminder time.
- Google's public and secret iCal sharing.
- Google's built-in holidays and birthdays.
- Location and "this event / all events" in mainstream clients.
- Write-through behaviour in Morgen, Fantastical and Notion Calendar.

**Repo evidence [R]:**
- Specs and briefs: `specs/calendar.md`, `.design/calendar/DESIGN_BRIEF.md`, `specs/tasks-v3.md` (§2, §11, §13, §14, §15, §18), `.design/tasks-v3/REPLAN.md` (58, round 2c), `specs/moduo-meet.md`, `specs/BUILD_ORDER.md` (MEET-*, TX-6, PERM-8b, MCP-1)
- Decisions and gotchas: `docs/decisions/calendar.md`, `docs/decisions/permissions.md`, `docs/gotchas/calendar.md`
- Calendar code: `src/features/calendar/` (`events.ts`, `booking/model.ts`, `ui/calendar-toolbar.tsx`, `ui/calendar-grid.tsx`, `ui/calendars-panel.tsx`, `hooks/use-calendar-module.ts`, `ui/repeat-picker.tsx`, `recurrence-nl.ts`, `mirror.ts`, `capture-type.tsx`)
- Functions: `supabase/functions/calendar-google-web/index.ts`, `supabase/functions/booking-public/index.ts`
- Elsewhere: `src/features/settings/sections/integrations-section.tsx`, `src/features/contacts/dates.ts`
