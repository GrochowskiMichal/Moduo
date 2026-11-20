> Raw research report from the Calendar re-plan, 2026-10-10. Nothing here is decided.

# How competitors structure a calendar, across the whole category

Lane: competitor structure. It covers 20 tools in four groups:

- **Daily drivers:** Google Calendar, Apple Calendar, Outlook.
- **Power calendars:** Notion Calendar, Fantastical, Amie, Vimcal, Morgen.
- **Time-blockers and planners:** Sunsama, Akiflow, Motion, Reclaim, Structured, Todoist's calendar layout, TickTick's calendar.
- **Booking:** Calendly, Cal.com, SavvyCal, Google appointment schedules, Notion Calendar's availability sharing.

It builds on the July 2026 research in [`../../calendar/COMPETITIVE_RESEARCH.md`](../../calendar/COMPETITIVE_RESEARCH.md), which covered Morgen in depth and the rituals of Sunsama and Akiflow (morning plan, shutdown, rollover, capacity, command bar). Where that file already answers a question, this one points to it instead of repeating it.

**Tags**
- **[V]**: I read it on the official help page, docs or changelog this session.
- **†**: I read it through a search summary or a third-party page, because the official page blocked fetching or rendered by script. Treat † as likely, not verified.
- **[F]**: a forum, feedback board, community post or review.
- **Unverified**: from memory, or I couldn't confirm it. Check it in the app before building against it.
- Pages written by a competitor (for example Morgen or nocal writing about rivals) are marked *(competitor-written)*.

Reddit blocks the research tools, so Reddit complaints come only through review write-ups that quote them (†). I viewed no screenshots.

## TL;DR

- **Everyone has the same skeleton:** Day, Week and Month; an agenda or list; a left sidebar with a mini-month and a list of calendars you can show, hide and colour; one default calendar for new events; drag to create, move and resize; a three-way choice when you edit a repeating event; invites with Yes, No and Maybe; a meeting link with a join button; a reminder before the meeting. A Google Calendar user would miss any of these in the first week.
- **Where tools differ** is around the skeleton: how many accounts sit in one view, how tasks appear on the grid, what happens when a time block ends unfinished, how booking links pick "busy", and how much of the app the keyboard can drive.
- **Tasks on the calendar have split into three ideas:**
  - A due task is an all-day marker: Google, Todoist, Akiflow's small flags.
  - A scheduled task is a block on your real calendar: Sunsama, Akiflow, Morgen, and Google since November 2025.
  - The tool places the blocks for you: Motion, Reclaim.
- **When a block ends unfinished, tools split into three camps:**
  - **Assume it's done:** Reclaim.
  - **Move it forward with a red mark:** Akiflow.
  - **Leave it and let you sort it out:** most others.
- **Write-back is uneven.** Motion writes tasks one way only, Todoist puts tasks in a separate calendar with all-or-nothing sync, Morgen syncs about hourly, and Google refreshes subscribed feeds every 12–24 hours.
- **The loudest complaints:** auto-scheduling that moves things you didn't ask it to move; sync that is slow, one-way or all-or-nothing; booking links that offer times you aren't free.

---

## 1. Views

| Tool | Views | Default | What Month shows | Tasks in the views | Source |
| --- | --- | --- | --- | --- | --- |
| **Google Calendar** | Day, Week, Month, Year, Schedule, 4 days; the 4-day slot is a custom view, from 2 days to 4 weeks†. Side-by-side calendars work in Day only. | The last view you pick "becomes your default view until you change it". | **Unverified:** timed events as one-line chips with a time, all-day and multi-day events as bars, then a "N more" link. | Due tasks show as all-day items†. Since Nov 2025 a task can also be a timed block†. | [V](https://support.google.com/calendar/answer/37189), [custom range†](https://androidcentral.com/apps-software/how-to-create-a-custom-view-in-google-calendar), [tasks†](https://www.tomsguide.com/computing/mobile-apps/you-can-finally-schedule-tasks-directly-in-google-calendar-heres-how) |
| **Apple Calendar** | Day, Week, Month, Year (⌘1–4). | **Unverified** | iOS 18 adds four Month styles: **Compact** (coloured dots), **Stacked** (thin pills), **Details** (every title) and **List** (the month, with the chosen day's events below). Pinching moves between them†. | Reminders appear with checkboxes in Day and List (iOS 18, 2024)†. | [V](https://support.apple.com/guide/calendar/ical002/mac), [iOS 18†](https://www.idropnews.com/ios-18/everything-new-in-the-calendar-app-in-ios-18/223701/) |
| **Outlook (new)** | Day, Work week, Week, Month. **Split view** puts several calendars side by side; Month got it in mid-2024. **Overlay** stacks them. | **Unverified** | **Unverified** | You drag a To Do task from the My Day pane onto the grid†. | [views†](https://support.microsoft.com/en-au/office/change-how-you-view-your-outlook-calendar-a4e0dfd2-89a1-4770-9197-a3e786f4cd8f), [split in Month†](https://mc.merill.net/message/MC793320), [To Do†](https://support.microsoft.com/en-US/Outlook/calendar/drag-a-task-to-your-calendar-with-to-do-in-outlook) |
| **Notion Calendar** | Day, Week, Month (D/W/M), plus 1–9 days with the number keys or +/−†. Mobile offers 1, 2 or 3 days†. Toggles for weekends, declined events and week numbers†. | **Unverified** | **Unverified** | Items from Notion databases, placed by a date property; you can edit their dates from the calendar†. | [settings†](https://www.notion.com/help/notion-calendar-settings), [keys†](https://matthiasfrank.de/notion-calendar/), [databases†](https://www.notion.com/help/calendars) |
| **Fantastical** | Day, Week, Month, Year, Quarter; a List shows all events or only the chosen day's†. Week and Month length can be changed†. Multiple windows since 4.0.7 (Mar 2025)†. | **Unverified** | **Unverified** | Tasks from Reminders, Todoist or Google Tasks, in a task list (⌘R). | [keys V](https://flexibits.com/fantastical/help/keyboard-shortcuts), [views†](https://flexibits.com/fantastical-ios/help/keyboard-shortcuts), [release notes†](https://flexibits.com/fantastical/releasenotes) |
| **Morgen** | Day, Week, Month, Agenda, 2 weeks, custom N days. | — | — | A scheduled task is a block "void of color with an empty checkbox". | [COMPETITIVE_RESEARCH.md §1–2](../../calendar/COMPETITIVE_RESEARCH.md) |
| **Akiflow** | Day, 2–7 days, Week, Month†. | **Unverified** | **Unverified** | Deadlines appear as "small flags at the top of the calendar", not as fake events†. | [review†](https://thebusinessdive.com/akiflow-review) |
| **Motion** | Week (the default); Day, Month, Agenda†. | Week† | **Unverified** | Auto-scheduled task chunks. | [display options†](https://help.usemotion.com/motion-settings/motion-display-options-dark-mode-start-week-on-task-breaks) |
| **Sunsama** | Day columns of tasks, or a Calendar view; a calendar in the right panel†. I found no Month view (**Unverified**). | **Unverified** | — | Timeboxed tasks are events, coloured by channel. | [V](https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-faqs) |
| **Todoist** (calendar layout) | Week, 3 days or Month on web and desktop; Agenda or Week on mobile. Pro and Business only. | — | Tasks per day; deadlines as chips. | A **"No date" sidebar** that you drag from. Repeating tasks show only the next one unless you switch on "Future occurrences". | [V](https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o) |
| **TickTick** | **Year** (with an activity heatmap, Jan 2026), Month, Week, Agenda, **Multi-day (1–14 days)**, **Multi-week (2–3 weeks, desktop)**†. Hides 00–07 and 21–24 by default†. | **Unverified** | Tasks per day. | An "Arrange Tasks" panel on the right holds undated tasks to drag in†. | [8.0 news†](https://alternativeto.net/news/2026/1/ticktick-8-0-adds-suggested-tasks-improved-yearly-monthly-views-and-customization-options/), [guide†](https://ticktick.com/resources/article/7340680464711024640/calendar-workflows-guide) |
| **Structured** | One day as a vertical timeline (mobile-first)†. | Day | — | Tasks, events and routines on one timeline†. | [App Store†](https://apps.apple.com/app/structured-daily-planner/id1499198946) |

**The pattern**
- Day, Week and Month are universal. Daily drivers, Fantastical and TickTick add Year. Almost everyone has an agenda or list.
- Power and planner tools add an **N-day** view: Notion 1–9 days, Google 2 days to 4 weeks, TickTick 1–14 days, Akiflow 2–7, Todoist 3 days. That's where people plan.
- Week is the usual default. Google keeps whatever you used last.
- Several calendars side by side is an enterprise feature: Google's Day view, Outlook's Split view.

**Outliers**
- **Apple's Month density ladder** (dots → pills → titles → list, by pinching): the only documented answer to "what does Month show".
- **TickTick's Year heatmap** shows activity, not events.
- **Todoist's "Future occurrences" switch** for repeating tasks.

**For the re-plan:** what Moduo's Month shows for tasks, and whether it has an overflow ladder, is open everywhere; nobody documents their "+3 more" rule.

---

## 2. Calendars and accounts

| Tool | Several accounts in one view | Sets or groups | Show, hide, colour | Default for new events, and the choice at creation | Source |
| --- | --- | --- | --- | --- | --- |
| **Google Calendar** | No. The web app shows one Google account at a time; to combine them you share or subscribe calendars†. | None. "Display this only" hides every other calendar†. | Checkbox and colour per calendar under "My calendars" and "Other calendars"†. | **Unverified:** the primary calendar; a calendar picker in the editor. | [merging guide†](https://clickup.com/blog/how-to-combine-work-and-personal-google-calendars/), [display only†](https://workspace.google.com/marketplace/app/display_all_calendars/186156392182) |
| **Apple Calendar** | Yes: iCloud, Google, Exchange and CalDAV (**Unverified** list). | **Calendar groups** (⇧⌘N). | Per calendar (**Unverified**). | Default calendar in Settings (**Unverified**). | [V](https://support.apple.com/guide/calendar/ical002/mac) |
| **Outlook** | Yes in new Outlook (**Unverified**). | **Calendar groups** that combine people, rooms and internet calendars†. | Split or overlay; colour per calendar†. | **Unverified** | [groups†](https://support.microsoft.com/outlook/working-with-multiple-calendars-in-outlook-com) |
| **Notion Calendar** | Yes: several Google accounts, iCloud (app-specific password) and Outlook (since June 2026; desktop and web first)†. | None documented. | An eye icon hides a calendar (struck through); hover to change its colour†. | "Make default calendar" by right-click. **The default can be a Notion database**†. | [manage†](https://www.notion.com/help/manage-your-calendars-and-events), [Outlook†](https://alternativeto.net/news/2026/6/notion-calendar-introduces-outlook-integration-for-unified-event-management/) |
| **Fantastical** | Yes (iCloud, Google, Exchange, Microsoft 365)†. | **Calendar sets** that switch by hand (⌃2–9 on iPad), **at a time of day, when you arrive at or leave a place, or with a Focus mode**†. | Per set. | **Unverified** | [sets†](https://flexibits.com/fantastical/help/calendar-set), [Windows help†](https://flexibits.com/fantastical-windows/help/calendar-sets) |
| **Morgen** | Yes (Google, Microsoft, iCloud, Fastmail, CalDAV). | Numbered calendar sets. | Yes. | A default calendar you can override. | [COMPETITIVE_RESEARCH.md §1](../../calendar/COMPETITIVE_RESEARCH.md) |
| **Sunsama** | Google, Outlook, iCloud†. | Contexts and channels (task side). | Colour by channel or by calendar. | **Tasks go to a private "Sunsama calendar" unless you pick a Google or Outlook calendar as their default.** | [V](https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-faqs) |
| **Motion** | Google and Outlook; iCloud for events only. | — | — | **Tasks go only to the main calendar of a connected account**, never to secondary or shared calendars. | [V](https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/scheduling-models-uni-and-bi-directional-sync), [†](https://help.usemotion.com/settings-and-troubleshooting/motion-settings/show-tasks-on-external-calendars) |
| **Calendly** | Up to 6 calendars on paid plans, 1 on Free. | — | You choose which calendars are checked for conflicts. | **One "add to" calendar for all event types**; you can't set one per event type†. | [connect†](https://calendly.com/help/connect-your-calendar-to-calendly) |

**The pattern**
- Show/hide plus colour per calendar is universal.
- Every tool has one default calendar for new events.
- The daily drivers don't merge accounts well; that gap is why power calendars exist. Notion Calendar, Morgen, Fantastical, Amie and Vimcal all sell "every account in one view".

**Outliers**
- **Fantastical's context-switching sets**: work calendars at the office, home calendars after six.
- **Notion Calendar's database-as-default**: new items can land in a Notion database, not an external calendar.
- **Notion Calendar's "Block on calendar"**: right-click an event and choose "This event" or "All events from {calendar}". It writes a block into another calendar, showing either "busy" or the details, so work colleagues see you're busy without seeing personal events ([V](https://www.notion.com/help/blocking)). Morgen's calendar propagation does the same.

**For the re-plan:** showing "which calendar does this go to" at creation is invisible in most docs. The July research already calls a wrong-target invite an "instant-uninstall" bug.

---

## 3. Create and edit

| Tool | Create | Quick vs full editor | Natural language | Editing a repeating event | Time zone per event | Source |
| --- | --- | --- | --- | --- | --- | --- |
| **Google Calendar** | Click or drag an empty slot. `c` opens the full editor. | A small dialog with a type picker (Event, Task, Out of office, Appointment schedule; Focus time on Workspace)†, then "More options" for the full page (**Unverified** wording). | Gemini adds events from Gmail ([†](https://workspaceupdates.googleblog.com/2025/08/add-events-gmail-calendar-gemini-mobile.html)); no typed natural-language create found. | **Only this event · Following events · All events.** "Following" splits the series into two†. | Yes, plus **separate start and end time zones** (for flights). | [keys V](https://support.google.com/calendar/answer/37034), [zones V](https://support.google.com/calendar/answer/37064), [repeats†](https://it.stonybrook.edu/help/kb/setting-up-a-recurring-repeating-meeting-in-google-calendar), [types†](https://9to5google.com/2024/03/12/google-calendar-event-task/) |
| **Apple Calendar** | ⌘N, double-click or drag. | An inspector panel (⌥⌘I) for details. | **Quick Event** (+): "Soccer Game on Saturday from 11am-1pm". Words like breakfast, lunch and dinner set default times; it remembers past events' locations and guests†. | **Only this event · All future events** (documented for deleting). There's no "all events" choice†. | Only after you turn on "time zone support"†. | [keys V](https://support.apple.com/guide/calendar/ical002/mac), [Quick Event†](https://help.apple.com/calendar/mac/10.11/en.lproj/icl61dcba67d.html), [repeats†](https://support.apple.com/guide/calendar/icl1018/mac), [zones†](https://support.apple.com/guide/calendar/icl26670/mac) |
| **Outlook (new)** | Click the grid (**Unverified**). | **Unverified** | No. | **This event · This and all following events · Series**†. | **Unverified** | [repeats†](https://support.microsoft.com/en-us/office/change-an-appointment-meeting-or-event-29b44f7a-8938-4b99-b98d-3efcf45f7613) |
| **Notion Calendar** | Select a slot and type details; drag across days for a multi-day event. | A detail panel (**Unverified** layout). | **Unverified** | Outlook events: "individual occurrences or all future events". | **Unverified** (zones are covered in §8). | [V](https://www.notion.com/help/manage-your-calendars-and-events) |
| **Fantastical** | ⌘N opens the parser. | The parser line, then details (⌘E). | **The category reference:** autocompletes invitees, places and calendars or task lists; can propose several times at once†. ⌘K switches between event and task. | **Unverified** | "Time zone override"†. | [keys V](https://flexibits.com/fantastical/help/keyboard-shortcuts), [App Store†](https://apps.apple.com/us/app/fantastical-calendar/id718043190?uo=4) |
| **Morgen, Akiflow** | Command bar. | — | Natural language plus tokens (`@` guests, `#` project, `/` calendar…). | — | — | [COMPETITIVE_RESEARCH.md §1, §4](../../calendar/COMPETITIVE_RESEARCH.md) |

**Fantastical's keyboard editing** (Mac, [V](https://flexibits.com/fantastical/help/keyboard-shortcuts)): ⌃⌘← and → move an event a day; ⌃⌘↑ and ↓ move it 15 minutes; ⌃⇧↑ and ↓ move its end 15 minutes. This is the only documented way, in any tool, to move and resize an event without the mouse.

**The pattern**
- Click or drag an empty slot to get a small quick-create, with a way out to a full editor.
- Repeating edits offer three choices (this, this and following, all), except Apple, which drops "all".
- Per-event time zones are standard in Google; elsewhere they're hidden behind a setting.

**Outliers**
- Google's **separate start and end time zones**.
- **Fantastical's natural language with guests and several proposed times.**
- **Fantastical's keyboard nudges.**
- **Apple's meal words** ("lunch" means 12:00).

---

## 4. People

| Tool | Invites and replies | Find a time / free-busy | See a teammate's calendar | Meeting link and join | Before the meeting | Source |
| --- | --- | --- | --- | --- | --- | --- |
| **Google Calendar** | Yes, Yes in a meeting room, Yes joining virtually, No, Maybe†. | **Find a time** lays guests' calendars over yours, up to 20†. **Gemini "Suggested times"**, and a banner offering a new time when several guests decline (Workspace, Feb 2026)†. **"Help me schedule"** in Gmail (Oct 2025) inserts slots into an email; when the recipient picks one, both calendars get the invite. Only two people at launch. | "Search for people" overlays a colleague's calendar temporarily; a new event then invites them†. | Meet link (**Unverified** default). | Default notifications per calendar (**Unverified**). | [Find a time†](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/6466/Google-Using-Find-a-Time-Meet-With-Features-in-Calendar), [RSVP†](https://supportdesk.grcc.edu/TDClient/53/Portal/KB/Article/2013/Google-Calendar-RSVP-Options), [Gemini†](https://www.androidauthority.com/google-calender-gemini-suggesting-meeting-times-3635336), [Help me schedule V](https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html) |
| **Outlook** | Standard. | **Scheduling Assistant**: a free/busy grid with "Suggested times". Business plans only, same organisation only†. | Split or overlay. | Teams (**Unverified**). | **Unverified** | [†](https://supportbee.com/blog/how-to-use-scheduling-assistant-in-outlook) |
| **Apple Calendar** | Standard. | **Availability panel** (⇧⌘A). | — | — | **"Time to leave" alerts** from your location, the event's place and live traffic; none for trips over 3 hours†. | [keys V](https://support.apple.com/guide/calendar/ical002/mac), [travel†](https://support.apple.com/guide/calendar/icl43600/mac) |
| **Notion Calendar** | Right-click to reply, and add a note to your reply. | — | **`P` overlays a teammate; pin them in the sidebar; drag their avatar onto a free slot to invite them**†. `F` starts an instant call†. | Teams for Outlook events [V]; Meet and Zoom†. | **The menu bar** shows your next event, with one-click join†. | [V](https://www.notion.com/help/manage-your-calendars-and-events), [†](https://matthiasfrank.de/notion-calendar/) |
| **Fantastical** | ⇧⌘I shows the invitees it detected. | **Proposals** (meeting polls)†. | — | Zoom, Webex, Meet and Teams in Openings†. | Time-to-leave alerts with AccuWeather MinuteCast†. | [keys V](https://flexibits.com/fantastical/help/keyboard-shortcuts), [†](https://flexibits.com/fantastical/help/openings) |
| **Vimcal** | — | **Group Polls, Group Spreadsheet, Scheduling Assistant, Free Time Finder.** | — | Connects Zoom, Teams and Meet. | **"Social profiles and company dossiers for everyone you meet with."** | [docs V](https://docs.vimcal.com), [home V](https://vimcal.com/) |
| **Amie** | — | Scheduling links show **when "everyone is free"** (Aug 2026). | Team availability. | Native Teams links for Outlook (Aug 2026). | — | [changelog V](https://amie.so/changelog) |

**The pattern**
- Yes/No/Maybe replies, an auto-added meeting link with a join button, and a reminder before the meeting are universal.
- "Find a time" across colleagues is a work-account feature: Google Workspace, Outlook business plans.
- Power calendars make it one key (Notion's `P`) or one menu bar.

**Outliers**
- **Drag a teammate onto a slot to invite them** (Notion Calendar†).
- **Time-to-leave alerts** (Apple, Fantastical).
- **Meeting-prep context about the people** (Vimcal's dossiers; Amie lets you schedule time with a contact).
- **Offer times inside an email; the reply books it** (Gmail's Help me schedule).

---

## 5. Tasks on the calendar

July's research covers Sunsama's and Akiflow's rituals, rollover and capacity, and Morgen's task blocks. This table adds the rest.

| Tool | Due tasks | A task as a block | Several sessions per task | A block that ends unfinished | Planned vs actual | Planning ritual / auto-scheduling | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Google Calendar** | All-day items, unless you set a time ([†](https://www.tomsguide.com/computing/mobile-apps/you-can-finally-schedule-tasks-directly-in-google-calendar-heres-how)). | **Since Nov 2025:** click a slot, choose Task. The block shows you as **busy**, can **auto-decline** clashing meetings and switch on **Do Not Disturb**. The task stays on your list "and get[s] reminded until the task is completed"†. | **Unverified** | **Unverified** | No | No | [blog†](https://workspaceupdates.googleblog.com/2025/11/block-time-for-tasks-google-calendar.html) |
| **Sunsama** | Tasks per day. | A timebox. | **Yes: "working sessions"** across days. | Finishing early shortens the event or deletes later sessions. **Moving a task to a past day removes its future sessions and completes it.** Rollover is covered in July's research. | Yes (see July's research). | Guided daily plan and shutdown. **Auto-schedule** places tasks around events and splits tasks over an hour; hold ⇧X to stop the split†. | [V](https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-faqs), [auto†](https://help.sunsama.com/docs/timeboxing-auto-scheduling) |
| **Akiflow** | Small flags at the top of the calendar†. | Drag a task in; **Time Slots** hold several tasks under a label like "Admin"†. | **Unverified** | **Unfinished tasks move to the next day with a red mark.** A user asked to remove the "shame marker" in 2022 ("I don't even want to look at Akiflow"); the request was closed. A July 2025 change, "Replan undone tasks", suggests slots near the same series or project†. | **Unverified** | Daily ritual (July's research). | [F V](https://akiflow.featurebase.app/p/remove-the-shame-marker-from-tasks-you-didnt-complete-the), [changelog†](https://akiflow.featurebase.app/en/changelog/60-micro-improvements-sparkles) |
| **Motion** | Deadline-driven. | Auto-placed **chunks**: at least 15 minutes, usually at most half the task. | Yes (chunks). | Re-planned automatically. A task scheduled after its deadline shows a red **❗ Past due**. A "hard deadline" task can be scheduled outside your working hours. | **Unverified** | Fully automatic. | [chunks†](https://help.usemotion.com/tasks-events-and-auto-scheduling-101/chunked-tasks-how-and-when-to-use-them), [states†](https://usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types) |
| **Reclaim** | Due dates drive placement. | Auto-placed events. | Yes, with minimum and maximum event lengths (a 6-hour task with 1–2 hour limits becomes four blocks). | **"When time passes for a Task Event, Reclaim assumes the work was done."** To say otherwise you **delete the event** (it gets rescheduled) or **shorten it** (the rest goes into the future). An option reopens a task after N days if you haven't marked it done†. | **Log Work** (done outside the blocks) and **Add Time** (need more). | Automatic, with an **Up Next** stack you order by dragging†. | [V](https://help.reclaim.ai/en/articles/4303610-key-concepts-in-reclaim-tasks), [V](https://help.reclaim.ai/en/articles/4293046), [reopen†](https://help.reclaim.ai/en/articles/6937489-auto-reopen-or-auto-close-tasks-that-are-done-scheduling) |
| **Morgen** | — | A colourless block with a checkbox; you can complete it on the block. | Yes ("schedule more time"). | Nothing happens: *scheduled ≠ due*. | No | AI Planner proposes; you approve. | [COMPETITIVE_RESEARCH.md §2–3](../../calendar/COMPETITIVE_RESEARCH.md) |
| **Todoist** | Deadline chips. | A task with a time and duration. | No | **Unverified** | No | No | [V](https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o) |
| **TickTick** | Per day. | Drag from Arrange Tasks†. | **Unverified** | **Unverified** | Pomodoro (**Unverified**). | No | [†](https://blog.ticktick.com/2018/08/10/arrangetasks4ios/) |
| **Structured** | On the timeline. | On the timeline. | **Unverified** | **"Replan" automatically reschedules missed tasks** (Pro)†. | **Unverified** | "Let Structured AI draft your day"†. | [App Store†](https://apps.apple.com/app/structured-daily-planner/id1499198946) |
| **Amie** | Todos beside events. | Drag a todo onto the timeline. | **Unverified** | **Unverified** | **Unverified** | AI places unscheduled todos into gaps†. | [App Store](https://apps.apple.com/app/id1548277133), [†](https://clickup.com/blog/?p=429053) |
| **Outlook, Apple** | Apple: reminders with checkboxes†. | Outlook: drag a To Do task in†. | No | **Unverified** | No | No | as in §1 |

**Should a task block show you as free or busy to others?**
- **Reclaim** marks task events **Free while there's still room before the deadline, and Busy once only one option is left** ([V](https://help.reclaim.ai/en/articles/4303610-key-concepts-in-reclaim-tasks)).
- **Motion** offers "Show tasks but keep as free" or "Show tasks and mark busy if deadline at risk"†.
- **Google** marks every task block busy, with optional auto-decline†.

**The pattern**
- Due tasks are all-day markers. Scheduled tasks are blocks on the grid that you can tick off.
- Several sessions per task is normal among planners: Sunsama, Motion, Reclaim, Morgen.
- What happens when a block ends unfinished is where tools disagree most:
  - Reclaim assumes the work was done.
  - Akiflow moves the task forward with a red mark.
  - Structured and Motion re-plan automatically.
  - Sunsama rolls tasks over at midnight.
  - Morgen and Google do nothing.

**Outliers**
- **Reclaim's "assume done, correct with one gesture"**: delete the block = didn't do it; shorten it = did less; Log Work = did it elsewhere.
- **Free until the deadline is at risk** (Reclaim, Motion).
- **Sunsama's "drag to a past day completes it."**

---

## 6. Write-back and two-way sync

Depth on connectors lives in the separate connectivity lane. This table covers only what the user sees.

| Tool | What it writes back | How the source calendar is shown | Sync speed and complaints | Source |
| --- | --- | --- | --- | --- |
| **Morgen** | Edits go straight to the source. | Calendar colour. | Background sync about hourly unless refreshed by hand. | [COMPETITIVE_RESEARCH.md §1, §6](../../calendar/COMPETITIVE_RESEARCH.md) |
| **Sunsama** | Timeboxes go to the "Sunsama calendar", or to a Google or Outlook calendar you choose. | "Color by channel", falling back to calendar colour. | **Unverified** | [V](https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-faqs) |
| **Akiflow** | Needs read/write on Google and Outlook; pushes task blocks as events†. | **Unverified** | **Outlook changes took "24+ hours", later 10–15 minutes** (July 2024 request for a force-sync button). Faster sync shipped in changelogs (Feb 2026)†. | [F V](https://akiflow.featurebase.app/p/outlook-calendar-events-take-long-time-to-sync-manual-force), [changelog†](https://akiflow.featurebase.app/changelog/rocket-faster-sync-smoother-calendar-better-experience) |
| **Motion** | **Events: both ways. Tasks: one way only**, into the main Google or Outlook calendar; no iCloud. **Moving a task block in Google changes nothing in Motion.** | Free or busy, by setting. | By design. | [V](https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/scheduling-models-uni-and-bi-directional-sync) |
| **Reclaim** | Writes its own events into your calendar. | Event status (free/busy). | **Unverified** | [V](https://help.reclaim.ai/en/articles/4303610-key-concepts-in-reclaim-tasks) |
| **Todoist** | Tasks with a date and time go into a **separate Todoist calendar** in Google; all-day tasks only if you switch that on; **no way to choose which tasks sync**. Google events show **read-only** in Today and Upcoming. Google only. | A separate calendar. | "Many sync 'issues' turn out to be the integration working exactly as designed"†. | [troubleshoot†](https://www.todoist.com/help/articles/troubleshoot-google-calendar-integration-issues-in-todoist-SsSatVeir), [integration†](https://todoist.com/help/articles/use-the-calendar-integration-rCqwLCt3G) |
| **TickTick** | Two-way with Google, on all platforms†. | Subscribed calendars in the sidebar. | Interval not documented (one old claim: twice a day)†. | [review†](https://upbase.io/blog/?p=8895) |
| **Notion Calendar** | View, edit, reply and schedule on Google, iCloud and Outlook†; Notion database dates both ways†. | Calendar colour. | A reviewer wished "the Notion and Notion Calendar communicated two ways"†. | [†](https://alternativeto.net/news/2026/6/notion-calendar-introduces-outlook-integration-for-unified-event-management/), [Capterra†](https://www.capterra.com/p/186596/Notion/reviews/?page=16) |
| **Amie** | Google both ways. **Outlook became "first-class" with two-way sync on 2026-08-05.** Apple Reminders both ways (Feb 2026). | — | — | [V](https://amie.so/changelog) |
| **Google (subscribed ICS feeds)** | Read-only. | "Other calendars". | **Refreshes every 12–24 hours, with no refresh button**; complaint threads date back to 2013†. | [†](https://usecarly.com/blog/google-calendar-ics-refresh-rate/) |

**The pattern**
- Every planner writes blocks into your real calendar, because colleagues must see them.
- Most keep the *task* data at home: Motion writes tasks one way only, Todoist uses a separate calendar, Sunsama a private one by default.
- The user-visible problems are **delay** (hourly, 24-hour, 12–24-hour feeds), **one-way surprises** (a moved block doesn't move the task) and **all-or-nothing** sync.

**Outlier:** Sunsama's **private calendar by default, real calendar by choice** for task blocks.

---

## 7. Booking links

| Tool | Types | Which calendars count as busy | Buffers and limits | Managing bookings, and how a booking appears | Source |
| --- | --- | --- | --- | --- | --- |
| **Calendly** | One-on-one, group, **collective** (several hosts, one invitee), **round robin** (rotates hosts); one-off meetings; meeting polls. | A "check for conflicts" list: 6 calendars on paid plans, 1 on Free. | Buffers of 5 minutes to 2 hours, before and after; **a maximum per day, week or month**; minimum notice from 15 minutes. | Bookings land in the one "add to" calendar; there's a Meetings page. | [types†](https://calendly.com/help/event-types), [calendars†](https://calendly.com/help/connect-your-calendar-to-calendly), [limits†](https://calendly.com/help/how-to-fine-tune-your-availability-settings) |
| **Cal.com** | Individual, **round robin, collective, managed** (admin templates). | Per-event-type conflict checking, **individual events only**; team events use each host's default. | Buffers; **a total booking time per day or month**; limit how far ahead people can book. | **Unverified** | [team types†](https://cal.com/blog/cal-com-s-team-appointment-types-exploring-collective-round-robin-and-managed-eve), [conflicts†](https://cal.com/help/event-types/eventtype-specific-checking-for-conflicts), [limits†](https://cal.com/blog/mastering-event-level-time-limits-what-lies-beyond-buffer-times) |
| **SavvyCal** | Personal links. | Per-link calendar settings. | Limit on how often people can book. | **The invitee can lay their own calendar over yours**; **ranked availability** shows your preferred times first. | [†](https://savvycal.com/cal-alternative-archive) *(own marketing)* |
| **Google appointment schedules** | **Free:** one booking page. **Premium:** several schedules, payments, email verification, schedules on secondary calendars, up to 20 co-hosts. | "Check calendars for availability"; co-hosts' calendars aren't checked by default. | Buffers; **maximum bookings per day**; how far ahead people can book; minimum notice (4 hours by default). | Bookings "appear on your calendar" next to the schedule. The official comparison page lists email reminders and checking several calendars as **free**; Workspace marketing pages still list them as premium ([†](https://workspace.google.com/intl/en-GB/resources/appointment-scheduling)). The comparison page is newer. | [V](https://support.google.com/calendar/answer/10729749), [plans V](https://support.google.com/calendar/answer/16287038) |
| **Notion Calendar** | **One-off** (drag the times on your grid) and **recurring** (hours per day); single-use links; several bookings per link. | **"Avoid conflicts"** follows new conflicts as they appear. | Booking window (minimum and maximum), expiry date. | **Calendar holds** stay on your grid while a link is open. Invitees reschedule or cancel from the event and give a reason. Shortcut `S`. | [V](https://www.notion.com/help/availability-blocking-and-time-zones) |
| **Vimcal** | **Slots:** drag times on your grid; the text is formatted as you go; send it as text or a link. | — | Up to 5 extra time zones in the text. | **Holds** with a title and colour **disappear when the guest books**, or become events in two clicks. Shortcut `A`†. | [V](https://docs.vimcal.com/most-popular-features/slots) |
| **Fantastical Openings** | Templates. | **A calendar set decides your availability.** | Lead time; how far ahead people can book; a cap on extra guests. | **Approve automatically or by hand**; several conference types to choose from. | [†](https://flexibits.com/fantastical/help/openings) |
| **Outlook "Bookings with me"** | Public and private meeting types. | Your Outlook calendar. | Buffers before and after; custom hours. | **Unverified** | [†](https://support.microsoft.com/office/bookings-with-me-setup-and-sharing-ad2e28c4-4abd-45c7-9439-27a789d254a2) |
| **Amie** | Recurring and one-off links. | **Joint availability** ("everyone is free", Aug 2026). | — | **Stripe payments shown on the calendar grid** (Aug 2026). | [V](https://amie.so/changelog) |

**The pattern**
- Every booking tool has the same knobs: duration, which calendars count as busy, a "write to" calendar, buffers before and after, a cap per day, minimum notice and a booking horizon.
- Team types (round robin, collective) are where Calendly and Cal.com charge.
- Calendar-first tools make you **pick availability by dragging on your own grid** and leave **holds** on it.

**Outliers**
- **Holds that vanish on booking** (Notion Calendar, Vimcal).
- **A calendar set decides availability** (Fantastical).
- **Approve bookings by hand** (Fantastical).
- **The invitee overlays their calendar** (SavvyCal).
- **Total booking hours per day**, not just a count (Cal.com).

---

## 8. Time zones and travel

| Tool | Extra zones | Per-event zone | Temporary "travel" | Travel prompts and travel time | Source |
| --- | --- | --- | --- | --- | --- |
| **Google Calendar** | "A secondary and a tertiary time zone", plus a **world clock** in the sidebar. | Yes, with separate start and end zones. | — | **"Ask to update my primary time zone to current location."** | [V](https://support.google.com/calendar/answer/37064) |
| **Outlook** | Classic: up to 3 labelled columns. New Outlook: more†. Display only. | **Unverified** | — | — | [†](https://nocal.app/help/outlook-calendar/show-a-second-time-zone) |
| **Apple Calendar** | One "view in" zone, once time zone support is on. | Yes, after the same setting. | Switch the view zone. | **Travel time added to the event**, and **time-to-leave** alerts from traffic†. | [zones†](https://support.apple.com/guide/calendar/icl26670/mac), [travel†](https://support.apple.com/guide/calendar/icl43600/mac) |
| **Notion Calendar** | Several, with custom labels; more than four possible. | **Unverified** | **`Z` "travel"**: a zone becomes primary for now; right-click to keep it. | — | [V](https://www.notion.com/help/time-zones) |
| **Vimcal** | Up to 5 extra in Slots. | — | **`Z` "Time Travel"** across the whole calendar; invitees see times in their own zone. | — | [V](https://docs.vimcal.com/most-popular-features/time-travel) |
| **Morgen** | Up to 10 saved. | Yes. | `z` overlay on hover. | **Automated travel time** from Google Maps, with your travel mode and extra buffer; it updates when events move (Morgen Assist)†. | [COMPETITIVE_RESEARCH.md §1](../../calendar/COMPETITIVE_RESEARCH.md), [†](https://www.morgen.so/guides/auto-schedule-travel-time) |
| **Reclaim** | — | — | — | **Automatic travel and "decompression" buffers**; flights get 2 hours before and 1 after; `#needs_travel` forces one†. | [†](https://help.reclaim.ai/en/articles/12304529-auto-schedule-breaks-travel-time-with-buffers) |
| **Fantastical** | Favourite zones†. | "Time zone override"†. | — | Time to leave, with weather†. | [†](https://apps.apple.com/us/app/fantastical-calendar/id718043190?uo=4) |

**The pattern**
- A second zone shown as a column next to the hours, and a time zone per event, are table stakes.
- Travel prompts are rare; only Google asks about it.

**Outliers**
- **"Travel" to a zone for a moment** (the `Z` key in Notion Calendar and Vimcal).
- **Separate start and end zones** (Google).
- **Travel time as a real block** (Morgen, Reclaim, Apple).

---

## 9. What sits beside the grid

| Tool | Left | Right / beside | Detail of an event | How it switches | Source |
| --- | --- | --- | --- | --- | --- |
| **Google Calendar** | Mini-month, "Search for people", My calendars, Other calendars. | A **side panel** of Google apps: Keep, Tasks, Contacts, Maps†. | A small popover, then a full-page editor (**Unverified**). | Icons in the side panel. | [†](https://support.google.com/calendar/answer/106237) |
| **Outlook (new)** | Folders and calendars. | **My Day**, with Calendar and To Do tabs. It replaced classic's To-Do bar, which showed both at once†. | **Unverified** | Tabs. | [†](https://erp.blackboxoperations.com/blog/new-outlook-vs-old-what) |
| **Apple Calendar** | Calendar list. | **Availability panel** (⇧⌘A); an inspector (⌥⌘I). | Inspector. | Keys. | [V](https://support.apple.com/guide/calendar/ical002/mac) |
| **Sunsama** | Mini-month, channels†. | **"The right hand panel secondary view can show your tasks, calendars, integrations or objectives"**, including email from integrations†. | — | A switcher in the panel. | [†](https://help.sunsama.com/docs/workspace-navigation) |
| **TickTick** | Lists. | **Arrange Tasks**: undated tasks sorted by list, tag or priority†. | — | The "…" menu. | [†](https://blog.ticktick.com/2018/08/10/arrangetasks4ios/) |
| **Todoist** | — | **"No date" sidebar.** | — | — | [V](https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o) |
| **Fantastical** | Mini-month and a list of upcoming events (**Unverified**). | **Task list** (⌘R); details (⌘E). | Details. | Keys. | [V](https://flexibits.com/fantastical/help/keyboard-shortcuts) |
| **Notion Calendar** | Calendars, Scheduling (`S`), pinned teammates†. | Event details with **attached Notion pages**; sharing an event shares the page†. | — | — | [†](https://matthiasfrank.de/notion-calendar/) |
| **Vimcal** | — | The Slots panel; **contact dossiers**. | — | — | [V](https://vimcal.com/) |
| **Morgen** | Task panel. | — | — | — | [COMPETITIVE_RESEARCH.md §2](../../calendar/COMPETITIVE_RESEARCH.md) |

**The pattern**
- A task list next to the grid is the planner signature: Todoist "No date", TickTick "Arrange Tasks", Morgen, Akiflow, Fantastical ⌘R, Outlook My Day.
- Daily drivers instead give the right side to app panels (Google) or a tabbed pane (Outlook).

**Outlier: Sunsama's switchable right panel** (tasks · calendar · integrations · objectives). It's the closest match to Moduo's own rule: one right panel, switched from its title row.

---

## 10. Keyboard

| Action | Google [V] | Notion Calendar † | Fantastical (Mac) [V] | Apple (Mac) [V] | Vimcal | TickTick † |
| --- | --- | --- | --- | --- | --- | --- |
| Day / Week / Month | `1`/`d`, `2`/`w`, `3`/`m`; custom `4`/`x`; agenda `5`/`a` | `D`, `W`, `M`; `1`–`9` = number of days | **Unverified** (iPad: ⌘1–4†) | ⌘1–4 (Year = ⌘4) | **Unverified** | `D`/`W`/`M` or `1`/`2`/`3` |
| Next / previous | `j`/`n` next (`k`/`p` previous **Unverified**) | `J`/`K` ([†](https://templatesfornotion.com/blog/notion-calendar-app-tutorial)) | ←/→ month, ⇧←/→ day, ⇧↑/↓ week | ⌘←/→ | **Unverified** | **Unverified** |
| Today | `t` | `T` | ⌘T | ⌘T | **Unverified** | **Unverified** |
| Go to a date | `g` | **Unverified** | **Unverified** | ⇧⌘T | **Unverified** | **Unverified** |
| New event | `c` | **Unverified** | ⌘N (natural language) | ⌘N | **Unverified** | **Unverified** |
| Command menu | — | ⌘K | — | — | ⌘K [V] | — |
| Time zone | — | `Z` [V] | — | — | `Z` [V] | — |
| Share availability | — | `S` [V] | — | — | `A`† | — |
| Overlay a teammate | — | `P` | — | Availability ⇧⌘A | — | — |
| Search · undo · help | `/` · `z` · `?` | — · — · `?` [V] | ⌘F | ⌘F | **Unverified** | — |
| Move or resize an event | — | — | ⌃⌘ arrows; ⌃⇧↑/↓ | — | — | — |

Also:
- **Outlook classic** uses Ctrl+Alt+1/2 and Ctrl+T, and "new Outlook and Outlook on the Web use a simplified keyboard model"†.
- **Morgen and Akiflow** shortcuts are in July's research.

Sources: [Google](https://support.google.com/calendar/answer/37034), [Notion help](https://www.notion.com/help/notion-calendar-keyboard-shortcuts), [Notion keys†](https://matthiasfrank.de/notion-calendar/), [Fantastical](https://flexibits.com/fantastical/help/keyboard-shortcuts), [Apple](https://support.apple.com/guide/calendar/ical002/mac), [Vimcal](https://docs.vimcal.com/most-popular-features/slots), [TickTick†](https://ticktick.com/resources/article/7340680464711024640/calendar-workflows-guide), [Outlook†](https://thesoftwarepro.com/microsoft-outlook-calendar-shortcuts/).

**The pattern**
- Single letters for views (D/W/M) and Today (T) are the shared language of Google, Notion Calendar and TickTick; Apple and Fantastical use ⌘ combinations.
- Power calendars add a command menu (⌘K) and single keys for their best features: time zone travel `Z`, availability `S` (and `A`† in Vimcal), teammate overlay `P`.
- Only Google (`g`) and Apple (⇧⌘T) document a jump-to-date key.

**Outliers**
- **Number keys set how many days you see** (Notion Calendar 1–9).
- **Moving events by keyboard** (Fantastical).

---

## The pattern: what every daily driver has

These are the table stakes a Google Calendar user would miss in their first week.

1. Day, Week, Month, plus an agenda or schedule list; Year in the big three. Google, Apple and Outlook all have Day/Week/Month.
2. Today and next/previous on single keys, plus a jump-to-date. Google `t` `j` `g`; Apple ⌘T ⇧⌘T.
3. Click or drag an empty slot for a quick create, then a full editor; drag to move, drag the edge to resize.
4. An all-day row, multi-day bars, and working hours.
5. Per-calendar show/hide and colour, a default calendar for new events, and a calendar picker when creating.
6. Repeating events with this / this and following / all. Apple has only this / all future.
7. A time zone per event, plus a second zone on the grid (Google, Outlook).
8. Invites with Yes/No/Maybe, a meeting link added automatically with a join button, and notifications before.
9. Seeing colleagues' free/busy and finding a time (Google Find a time, Outlook Scheduling Assistant), at least on work accounts.
10. Subscribing to a feed (holidays, school timetables), even if it's slow.
11. Tasks on the grid. Google has shown due tasks as all-day items for years, and has had timed task blocks since November 2025, so "tasks next to meetings" is no longer a differentiator against Google.
12. A simple booking page. Google's free plan includes one.

What a power-calendar user would also expect: every account in one view, a command menu, natural-language create, a menu-bar "next meeting / join", time zone travel, and drag-to-share availability.

## The outliers worth copying

1. **"Done unless you say otherwise", corrected with one gesture.**
   - **Reclaim** assumes a passed task block was done. You delete it to say "not done" (it gets rescheduled), shorten it to say "did less", and use Log Work for work done elsewhere ([V](https://help.reclaim.ai/en/articles/4303610-key-concepts-in-reclaim-tasks)).
   - **Sunsama:** dragging a task to a past day completes it ([V](https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-faqs)).
   - The opposite is **Akiflow's red mark** on rolled-over tasks, which a user called a "shame marker" ([F](https://akiflow.featurebase.app/p/remove-the-shame-marker-from-tasks-you-didnt-complete-the)).
2. **Task blocks that are free until the deadline is at risk.**
   - **Reclaim** flips them from Free to Busy when only one slot is left ([V](https://help.reclaim.ai/en/articles/4303610-key-concepts-in-reclaim-tasks)).
   - **Motion** lets you choose "mark busy if deadline at risk"†.
   - **Google** goes the other way: always busy, with auto-decline and Do Not Disturb†.
3. **Block across calendars.** **Notion Calendar** writes a "busy" (or detailed) copy of personal events into the work calendar, for one event or a whole calendar ([V](https://www.notion.com/help/blocking)). For founders and freelancers with two accounts, it ends double-booking without merging the accounts.
4. **Drag your availability on the grid, and leave holds that vanish when booked.** Notion Calendar's one-off links ([V](https://www.notion.com/help/availability-blocking-and-time-zones)) and Vimcal's Slots ([V](https://docs.vimcal.com/most-popular-features/slots)) both work this way. Fantastical goes further and lets a **calendar set** decide your availability, with optional **manual approval**†.
5. **Offer times inside an email; the reply books it.** In **Gmail's "Help me schedule"**, the recipient picks a slot and both calendars get the invite ([V](https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html)). Moduo has email and calendar in one app, so it can do this without AI.
6. **A switchable right panel.** **Sunsama's** right panel switches between tasks, calendar, integrations and objectives†, which matches Moduo's right-panel rule.
7. **A Month density ladder.** **Apple's iOS 18** Month moves from dots to pills to titles to a list, by pinching†. It's a documented answer to "how much does Month show".
8. **Context-switching calendar sets.** **Fantastical** switches which calendars show by time of day, place or Focus mode†. It's a lighter version of "work vs personal".

Honourable mentions:
- `Z` time zone travel (Notion Calendar, Vimcal).
- Drag a teammate onto a slot to invite them (Notion Calendar†).
- Total booking hours per day (Cal.com†).
- The invitee overlays their own calendar on the booking page (SavvyCal†).
- A banner suggesting a new time when several guests decline (Google, Workspace†).

## What people complain about

### Daily drivers
- **Google, subscribed feeds:** they "refresh every 12 to 24 hours", there's no refresh button, and the complaint thread dates from 2013 ([†](https://usecarly.com/blog/google-calendar-ics-refresh-rate/)).
- **Google, separate accounts:** work and personal accounts can't be seen in one view without sharing ([†](https://clickup.com/blog/how-to-combine-work-and-personal-google-calendars/)).
- **Google, tasks:** before November 2025, users made "fake meetings" to block time for tasks ([†](https://www.storyboard18.com/amp/digital/google-calendar-introduces-dedicated-task-blocking-feature-to-replace-fake-meetings-84384.htm)).
- **Outlook:** new Outlook still lacks classic features. The To-Do bar became tabs in My Day ([†](https://erp.blackboxoperations.com/blog/new-outlook-vs-old-what)), and users call the forced move "painful" (July 2026, [†](https://windowslatest.com/2026/07/26/microsoft-still-wants-to-force-new-outlook-on-everyone-by-2027-even-as-users-call-it-painful-and-prefer-outlook-classic)). The Scheduling Assistant is business-only ([†](https://supportbee.com/blog/how-to-use-scheduling-assistant-in-outlook)).
- **Apple:** no "meaningful new features to the Calendar app in years" beyond reminders in 2024 ([†](https://tech.yahoo.com/computing/articles/macos-26-tahoe-feature-youre-143015178.html)).

### Power calendars
- **Notion Calendar:** "Notion Calendar is Google only" (HN, Apr 2025, [F](https://news.ycombinator.com/item?id=43695538)). iCloud support exists now; it's unclear whether it did in April 2025 or the commenter missed it. Outlook arrived only in June 2026 ([†](https://alternativeto.net/news/2026/6/notion-calendar-introduces-outlook-integration-for-unified-event-management/)). A reviewer wished Notion and Notion Calendar "communicated two ways" ([F†](https://www.capterra.com/p/186596/Notion/reviews/?page=16)).
- **Fantastical:**
  - Subscription price rises ($39.99 → $56.99 a year) and natural-language input behind a paywall ([F](https://talk.macpowerusers.com/t/why-do-you-consider-40-subscription-to-fantastical-worth-it/21069), [†](https://unstar.app/ar/blog/fantastical-google-apple-outlook-notion-calendar-apps-ranked-2026)).
  - Reported sync delays and time zone bugs (same review†).
- **Amie:** repositioned as an AI notetaker; "the calendar-and-todo app is still in there, but it is not what Amie is priced or marketed as anymore" ([† *(competitor-written)*](https://nocal.app/alternatives/amie)).
- **Morgen:** price ($15–30 a month) and hourly sync ([July research §6](../../calendar/COMPETITIVE_RESEARCH.md)).

### Time-blockers and planners
- **Motion:**
  - "Scheduled tasks directly on top of existing calendar events that were already marked as busy… if I have to supervise the scheduler, it defeats the purpose" (App Store, June 2026).
  - "Moved everything around constantly" (App Store, Feb 2026).
  - "I constantly find myself manually moving tasks around" (r/UseMotion, Oct 2025). All three via a [review round-up†](https://www.usecarly.com/blog/motion-ai-review/).
  - Motion has meanwhile moved upmarket to "AI Employees" ([†](https://sacra.com/c/motion)).
- **Akiflow:**
  - The red "shame marker" ([F](https://akiflow.featurebase.app/p/remove-the-shame-marker-from-tasks-you-didnt-complete-the)).
  - Outlook sync took 24+ hours, later 10–15 minutes ([F](https://akiflow.featurebase.app/p/outlook-calendar-events-take-long-time-to-sync-manual-force)).
  - A full year charged during the trial ([Trustpilot†](https://uk.trustpilot.com/review/akiflow.com?page=7)).
  - No way to turn a task into an event or back ([Capterra†](https://www.capterra.com/p/232035/Akiflow/reviews/?page=2)).
- **Sunsama:** its first price rise in five years, to $20 a month annual or $25 monthly ([† *(competitor-written)*](https://www.morgen.so/es/blog-posts/sunsama-pricing)); manual by design.
- **Reclaim:** "hundreds of tasks that cluttered their calendars" ([G2†](https://g2.com/products/reclaim-ai/reviews_and_filters?page=10)).
- **Todoist:** all-or-nothing sync into a separate calendar, and Google events read-only inside Todoist ([†](https://www.todoist.com/help/articles/troubleshoot-google-calendar-integration-issues-in-todoist-SsSatVeir)).

### Booking
- **Calendly:**
  - Round robin showed **booked or blocked times as available**; invitees got "Sorry, that time is no longer available". It was open for two weeks from 18 Jan 2026, and was worse with 37 hosts than with 12 ([F V](https://community.calendly.com/how-do-i-40/round-robin-events-showing-unavailable-time-slots-as-available-google-calendar-sync-issue-5256)).
  - Rescheduling "ignores host working hours… booking meetings during off hours and on top of other meetings" ([F†](https://community.calendly.com/how-do-i-40/reschedule-ignores-host-working-hours-and-existing-google-calendar-events-5124)).
- **Etiquette:** sending a booking link is "a 'get in line' move" (Sam Lessin, via [Bloks†](https://www.bloks.app/post/calendly-links-etiquette)). SavvyCal's invitee overlay is the category's answer.

### The three loudest, across categories
1. **Scheduling you didn't ask for, and guilt for what you didn't do.** Motion's reshuffles need babysitting, and Akiflow marks missed work in red. (July's research §5.1 already set Moduo's rule: legible, local, reversible.)
2. **Sync that is slow, one-way or all-or-nothing:**
   - Google feeds refresh every 12–24 hours.
   - Akiflow's Outlook sync took 24 hours.
   - Morgen syncs about hourly.
   - Motion writes tasks one way.
   - Todoist syncs all or nothing.
3. **Booking links that offer times you aren't free:** Calendly's round-robin phantom slots and reschedules that ignore working hours.
