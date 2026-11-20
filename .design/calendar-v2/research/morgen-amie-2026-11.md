> Raw research report for the Calendar re-plan, 2026-11-21. Nothing here is decided.

# Morgen and Amie, November 2026: feature by feature against Moduo

The designer's benchmarks for Calendar are **Morgen** and **Amie**. This lane checks what each one does in November 2026, how the interactions work step by step, and where Moduo's current and planned Calendar covers them. Other tools come in only where they are clearly better at one thing.

**Builds on, and does not repeat:**
- [`structure-competitors.md`](./structure-competitors.md) (Oct 2026, 20 tools: views, accounts, create, people, tasks, sync, booking, zones, panels, keys);
- [`../../calendar/COMPETITIVE_RESEARCH.md`](../../calendar/COMPETITIVE_RESEARCH.md) (July 2026: the Morgen parity checklist, the Sunsama and Akiflow rituals, the trust spectrum).

**Moduo's side** is read from [`specs/calendar-rethink.md`](../../../specs/calendar-rethink.md) (blocks CALR-1…21b, built late Oct and Nov 2026) and from the open calls C1–C21 in [`../REPLAN.md`](../REPLAN.md) §8, none of them answered yet. In the tables:
- **Built (CALR-n)** means it is in the rethink spec;
- **Proposed (C-n)** means an open call recommends it;
- **Out** means the rethink lists it out of scope.

**Tags** (the same legend as the October file):
- **[V]**: read on the official page, docs or changelog in this session.
- **†**: read through a search summary or a third-party page. Likely, not verified.
- **[F]**: a forum, review site, App Store or Trustpilot review.
- **Unverified**: from memory or not confirmed. Check it in the app before building against it.
- *(competitor-written)* marks pages by a rival (Saner.AI, Carly and ClickUp writing about Morgen or Amie).

**Name clash:** Morgen's AI product is called **Kai**. The rethink spec's sample teammate is also "Kai Ito". In this file, "Kai" always means Morgen's product.

---

## 1. What they are in November 2026

**Morgen** is still the calendar-first time-blocker:
- **Accounts:** one grid over Google, Microsoft 365 / Exchange Online, iCloud, Fastmail and modern CalDAV, with edits written straight back to the source.
- **Tasks:** its own task list plus about ten task integrations (Notion, Todoist, Linear, ClickUp, Microsoft To Do, Google Tasks, Obsidian, Apple Reminders…).
- **Planning:** an **AI Planner** that proposes a 1–7 day plan you approve, and **Frames**, recurring windows that say which kind of task goes where.
- **Booking:** scheduling links, a booking page, and **Open Invites**, which replaced one-time links.
- **Workflows:** buffer time, travel time, and copying personal events to the work calendar.
- **Morgen 4:**
  - **Jan 2026:** left beta, adding routines, task tags, earliest start dates and repeating due dates, and team availability in the sidebar. It **dropped** on-prem Exchange and older CalDAV servers.
  - **28 Oct 2026 (v4.1):** a rebuilt calendar.
- **Price:** one plan, Pro, at $15/month yearly or $30 monthly; Team is $10 or $25 per seat with two seats minimum. There is **no free plan**: a 14-day trial, then the app locks.
- **Kai:** the company also sells Kai, a separate AI executive assistant (email triage, bot-free meeting recording, morning brief) at $20–100 a month. Kai Pro and Ultra include Morgen Pro.
- **MCP:** there is no official Morgen MCP. A user asked for API gaps to be closed in April 2026, and community servers exist.

**Amie** has **pivoted from calendar to AI notetaker**:
- **Positioning:** its homepage now leads with running your workday with AI agents and bot-free meeting notes. The App Store subtitle is still "Joyful productivity", and the app is now named "Amie - Todos, calendar".
- **Calendar and todos are still there** and still get changes in 2026:
  - Apple Reminders two-way sync (Feb 2026);
  - Outlook as a full two-way calendar with Teams links (5 Aug 2026);
  - co-host "joint availability" on booking links (20 Aug 2026);
  - Stripe payments and stock alerts drawn on the grid (27 Aug 2026).
- **Release notes since 2025** are mostly about recording, summaries, action items, integrations (Linear, Notion, Slack, CRMs) and an **official MCP server** (Jul 2026: calendars, contacts, todos and notes, then Gmail search and drafts in Aug 2026).
- **Email:** the 2024 email inbox no longer appears in the docs, which describe only AI drafting that you copy into your own email client. Whether the inbox still ships is **Unverified**.
- **Plans:** Free, Personal, Pro, Business and Enterprise ([V], no prices shown). Third parties give about $20 and $40 a month for Pro and Business on annual billing†.

For a Moduo comparison this means:
- **Morgen** is the benchmark for **planning and connectivity**.
- **Amie** is the benchmark for **joy, todos on the grid, and the meeting-centred loop**.
- **A current Amie user's first week** would first miss bot-free recording and AI summaries, which Moduo deliberately leaves to MCP.

---

## 2. Feature by feature

**Gap?** has four values:
- **gap**: missing and wanted;
- **non-goal**: missing on purpose;
- **covered**;
- **Moduo ahead**.

### 2a. Accounts and sync

| Feature | Morgen | Amie | Better elsewhere | Moduo today / planned | Gap? |
| --- | --- | --- | --- | --- | --- |
| **Every account in one grid, edits saved back** | Google, Microsoft 365, iCloud, Fastmail, CalDAV. v4 (Jan 2026) **dropped on-prem Exchange and older CalDAV**; v4 also removed the split between local and cloud accounts, so July's "about hourly" sync note may be outdated (**Unverified**) [V] | Google two-way. **Outlook two-way since 5 Aug 2026.** Apple Calendar on macOS since Apr 2024, iOS since Sep 2024 [V] | — | **Built:** Google two-way (CALR-8), offline outbox (CALR-8b), live updates (CALR-7). **Microsoft, iCloud and .ics are view only** (decided 27 Oct). **Proposed:** C6 makes them writable, in the order Google → iCloud → Microsoft | **gap** for Outlook and iCloud users |
| **Calendar sets** | Numbered sets | Not documented | Fantastical switches sets by time or place | **Built:** the "calendar set" control in the toolbar. **Proposed:** C2's saved sets in the ⋯ menu | covered |
| **Copy personal busy time to the work calendar** | "Calendar sync" in Pro (it was a workflow). Retries failures for 3 days (Apr 2025) [V] | None found | Notion Calendar's "Block on calendar" | **Proposed:** C16. Not in the rethink | **gap** |
| **The same meeting reached through two accounts** | v4.0.4 (Feb 2026) merges tasks and routines with an event of the same time and title [V] | Removes duplicates across Google and Apple (Apr 2024) [V] | — | **Built:** shown once, matched on iCalUID (CALR-20b) | covered |
| **Undo** | Common actions, since Feb 2025 [V] | **Unverified** | — | **Built:** every edit, with ⌘Z (CALR-4) | covered |

### 2b. Tasks and planning

| Feature | Morgen | Amie | Better elsewhere | Moduo today / planned | Gap? |
| --- | --- | --- | --- | --- | --- |
| **Tasks from other tools** | About 10 integrations; "All tasks" view (Mar 2025) [V] | Todoist (webhooks, Jul 2026), Notion, Linear, ClickUp (Jan 2026), Apple Reminders two-way (Feb 2026), Things [V] | — | Moduo **is** the task manager: no sync with outside task apps | **non-goal** (a one-time import on switching is a separate question) |
| **Put a task on the grid** | Drag from the task panel; a block "void of color" with a checkbox | Press I for the Inbox, drag a todo onto a slot, or press **H** to schedule. Todos are coloured blocks; **D** marks done [V] | — | **Built:** Plan panel. **S** lifts the task to the next free slot that fits; ⇥, arrows, ↵, click or drag place it (CALR-5) | **Moduo ahead** (keyboard placement) |
| **Several sessions per task** | The Planner splits long tasks (opt-in) [V] | **Unverified** | Reclaim, Sunsama | **Built:** TV-D10 sessions | covered |
| **Plan several tasks at once** | **AI Planner:** pick 1–7 days; it ranks by priority, due date and estimate, fits tasks into Frames and free time, shows a preview with toggles (pad estimates 20%, split long tasks, break frequency); **nothing lands until you approve** [V] | **AI scheduling:** on in Settings, it places unscheduled todos into work-hour gaps with a 15-minute buffer, P1 first, deadlines first, **and reshuffles when plans change** (2024); no approval step is documented [V] | — | **Out:** no in-app AI. **Built:** one task at a time with S. **Proposed:** C11 "Fit N into today" (arithmetic, one Undo). MCP: `calendar_schedule_task` | **gap** for a week, not just today |
| **Frames: typed work windows** | A recurring window with a **task filter** (sources, lists, projects, tags). Free or busy toggle. The Planner fills it; you can also drag tasks in. **Moving a Frame leaves its tasks behind** (their own gotcha) [V, guide Mar 2026] | Per-list "preferred times" for AI scheduling [V] | — | **Built:** focus time (CALR-14) holds *one* task and is free for booking links by default. No windows that take "any task tagged X" | **gap** (moderate) |
| **Routines** | v4 (Jan 2026): recurring blocks at fixed times on the grid [V] | Repeating todos can go on the calendar (Sep 2024) [V] | — | Repeating tasks (Tasks v3) and repeating focus time. **Proposed:** C17, one repeat picker | covered once C17 lands |
| **Conflicts and missed tasks** | **Rescheduling assistant** (Jan 2025) proposes fixes; when a new event clashes with a placed task, one click moves the task; v4 adds rescheduling quick actions [V] | Reshuffles automatically (see above) | Reclaim: "assume done, correct with one gesture" | v1 had elapsed triage and the strip (specs/calendar.md AC8–9). The rethink keeps "From earlier" in Plan and "nothing moves unless you place it". **Proposed:** C3 (one "missed" state and one set of fixes) | **gap** until C3 is decided |
| **Earliest start date** | v4 (Jan 2026) [V] | — | — | Not in `specs/tasks-v3.md` (searched for "earliest" and "start date") | small **gap** (it belongs to Tasks) |
| **Turn an event into a task** | Since Feb 2025 [V] | Email to todo (2024) | — | **L** links a task to an event; no conversion | minor |

### 2c. Creating, keyboard, desktop

| Feature | Morgen | Amie | Better elsewhere | Moduo today / planned | Gap? |
| --- | --- | --- | --- | --- | --- |
| **Natural-language create** | Command bar with tokens (July research) | ⌘K and Enter; "Call mom tomorrow 3pm for 30 min" [V] | Fantastical's parser | **Built:** the composer (N): words light up as read, the draft previews on the grid, ⇥ hops to free time (CALR-9) | **Moduo ahead** |
| **Keyboard** | View keys, ⇧-arrows for days (4.1), command bar | Enter, ⌘K, D, H, P, L, I, C, ⌫; "p" makes an event private (Jul 2026) [V] | Fantastical's move-by-key | **Built:** grid cursor, J/K, ⌥ moves and resize, ⌘C/⌘V/⌘D, the keys sheet (CALR-4) | **Moduo ahead** |
| **Global quick-add and the menu bar** | System-wide shortcuts and a macOS menu bar (shows workflow events, Jun 2025) [V] | Menu bar calendar (Personal plan and up), a floating picture-in-picture calendar, ⌥⌃A to open from anywhere (Jul 2024) [V] | Notion Calendar's menu bar with join | **Built:** the now-and-next line in the toolbar, ⇧⌘J, and the Today widget. The desktop app has a menu-bar icon that keeps Moduo running when the window closes (TV-D12, `src-tauri/src/lib.rs`). Nothing shows the next meeting or Join there, and I found no global shortcut in the Rust code. ⇧⌘K capture works in the app | **gap** |
| **Search events** | **Unverified** | Transcript search (⌘F) | Google `/` | Events are in the app's global search through the registry; there's no search inside Calendar ([current-state-2026-11](./current-state-2026-11.md) §2). C1 lists it | small **gap** |
| **Views** | Day, Week, Month, Agenda, N days | Agenda view (Sep 2024), Month, Day and Week | — | **Built:** Day, Week, Month (CALR-12). **Proposed:** List view (C5) | covered once C5 lands |
| **Phone app** | iOS and Android. Reviews say mobile lags desktop, and sync and notifications arrive late [F] | iOS; no Android | — | **Out for now** (Tasks 36). C16 routes your plan to the phone through Google | **non-goal for now** |

### 2d. People, invitations, alerts

| Feature | Morgen | Amie | Better elsewhere | Moduo today / planned | Gap? |
| --- | --- | --- | --- | --- | --- |
| **Alerts before an event** | Native OS notifications; one 2026 review says mobile ones arrive "hours late" [F] | Up to five reminders per event, with presets (2024) [V] | — | **None** in the rethink. **Proposed:** C13 (and C21 for quiet hours) | **gap**, week one |
| **Answer invitations** | **Notification Center for pending invites** (Jan 2025); RSVP fixes in 2026 [V] | Guest editing (2024) | Google: Yes / No / Maybe with a note | **Built:** replies shown by each guest's name (CALR-10); invites go out through Google (CALR-9). **You can't answer an invitation in Calendar.** Mail's invite card has Accept / Maybe / Decline and "Add to Moduo calendar", on the desktop mail engine only ([current-state-2026-11](./current-state-2026-11.md) §2). **Proposed:** C7 | **gap**, week one |
| **Teammates' availability** | v4: from the sidebar (it was only available while creating an event) [V] | Avatars with free and busy (2022 version), team availability | Notion Calendar: `P`, then drag a person onto a slot | **Built:** opt-in lanes, teammates in the composer, ⇥ finds a time when you're all free, sharing levels and Preview as (CALR-15/16) | **Moduo ahead** (Preview as) |
| **Contact context** | v4 "contact availability toggles" [V] | 2022: profiles with birthday, notes, "last met", keep-in-touch reminders (TechCrunch). Now: notes per contact only with a CRM connected (Attio, HubSpot, Pipedrive, Salesforce) [V] | Vimcal's "dossiers" | Contacts is its own module. **Proposed:** C7 (a guest who is a contact links the event, and the contact's hub shows "last met · next meeting"), C12 cues, C18 birthdays | **Moduo ahead** when C7 and C12 land |
| **Travel time and buffers** | Workflows: travel time (Google Maps), buffer time (July research and the October file; † here) | Not supported (App Store review, 2024) [F] | Reclaim, Apple | Buffers on booking links only | **gap** (low) |

### 2e. Booking

| Feature | Morgen | Amie | Better elsewhere | Moduo today / planned | Gap? |
| --- | --- | --- | --- | --- | --- |
| **Booking links** | Scheduling links, public or private, and a **booking page listing them all**†. Links **can't be created in the phone app**; on the phone you can only share them (the v4 guide lists booking on desktop and web)† | Recurring links (Settings) and one-off links (⌘K). Buffers, notice, booking window. **amie.me** domain (Aug 2026) [V] | Calendly, Cal.com for depth | **Built:** the Booking link view, open times on the week, rules, co-hosts (CALR-17), the guest's sentence page (CALR-18), guest reminders and host cancel (TX-6) | covered |
| **Offer a few specific times** | **Open Invites** replace one-time links (guide 2 Mar 2026): highlight windows, copy the link; the invitee books and can **Reschedule** from the event. Holds aren't documented [V] | One-off link: ⌘K, pick times, copy. It expires after booking [V] | Vimcal Slots and Notion Calendar: holds that disappear when booked | **Built:** O with 48-hour holds that release together, copy as a link or as text (CALR-19) | **Moduo ahead** |
| **Several hosts** | Required **and optional** co-hosts (beta, Team plan) [V] | Co-hosts with joint availability (20 Aug 2026) [V] | Calendly and Cal.com round robin | **Built:** co-hosts who accept, only times when all are free (CALR-17). **Out:** round robin | optional co-host is a small **gap** |
| **The guest reschedules** | Yes, on Open Invites [V] | **Unverified** | Calendly | **Not built.** No "rescheduled" email in the TX spec (MEET-4). **Proposed:** C19 #1 | **gap** |
| **Payments** | — | Stripe revenue on the grid (Aug 2026), not paid bookings [V] | Calendly, Cal.com | **Proposed:** C19, "later" | non-goal for now |

### 2f. Meetings, email, AI, price

| Feature | Morgen | Amie | Better elsewhere | Moduo today / planned | Gap? |
| --- | --- | --- | --- | --- | --- |
| **Notes from a meeting** | None in Morgen; **Kai** records without a bot [V] | **The core product now:** bot-free recording, summary, action items by speaker, chapters (Aug 2026), private notes, local Markdown export (Jul 2026), push to Craft, Notion, Linear, CRMs [V] | Notion Calendar puts AI Meeting Notes on events (Outlook since Jul 2026)† | **Built:** Meeting note, and Notes follows the selected event (CALR-10); **L** links notes and tasks. **Out:** in-app AI recording and summaries (MCP only) | **non-goal** (AI); the note-on-event part is covered |
| **Email** | None; Kai triages email [V] | 2024: an inbox (Pro). 2026 docs: AI drafting from notes; MCP reads Gmail. Whether the inbox remains is **Unverified** | Gmail "Help me schedule" | Email is its own module (desktop first) | **Moduo ahead** |
| **MCP / outside AI** | No official server; feature request "Public API gaps for MCP" (Apr 2026, 16 votes, no status) [V] | Official MCP (14 Jul 2026), plus Gmail tools (5 Aug 2026) [V] | — | **Built:** calendar tools including `calendar_offer_times` and `calendar_who_sees` (CALR-21) | **Moduo ahead** of Morgen; level with Amie |
| **Focus timer** | — | Pomodoro in the menu bar (2024) | — | Focus timer (CAL-5; top-bar timer SHELL-96) | covered |
| **Joy and delight** | Praised as polished; support is loved (Trustpilot) [F] | **Its brand:** "Joyful productivity". Entry animations that scale and fade in, a 135-step colour system, collapsible panels†; haptics on mobile [F]; a hidden game behind ⌘K (Apr 2024) [V]; Spotify and health data drawn on the timeline†; a floating picture-in-picture calendar (Jul 2024) [V]; a Product Hunt Golden Kitty for design† | — | The "settle" motion on drafts and moved blocks, the house calendar chip, the composer's words lighting up as they're read (CALR-1, CALR-9). Brand decision 53 limits effects; no novelty layers | Amie's charm is in motion and colour, not features. Moduo's version is the composer's echo |
| **Price** | Pro $15 a month yearly or $30 monthly; Team $10 / $25 per seat, two seats minimum; **no free plan**; locked after the 14-day trial; 30-day refund [V, pricing page 2026-11-21] | Free (25 note credits, unlimited calendars and todos), Personal, Pro, Business, Enterprise [V]; prices about $20 / $40† | — | A free tier plus Pro (Pricing v2) | **Moduo ahead** |

### 2g. What users complain about

**Morgen** (Trustpilot 4.5 from 72 reviews [F]; G2 reviews via Saner.AI†, *(competitor-written)*):
- **Price**, with no free plan: one reviewer calls it "absurdly expensive"†, and a legacy-price dispute (May 2025) [F].
- **The phone app** lags the desktop: late notifications (Mar 2026) [F], sync that sometimes needs a manual refresh†, and paying to see your to-dos on the phone†.
- **A feature removed without notice** (Jan 2026) [F]. v4 also dropped on-prem Exchange and older CalDAV servers.
- **Tasks are thin:** no dependencies, no kanban†, and an ask for two-way Asana sync [F].
- **Planning:** the approval step feels tedious to some and the AI "fairly basic" to others†; one user found it overwhelming when many tasks moved to the next day†.

**Amie** (App Store 3.4 from 128 ratings [F]; Product Hunt 4.8†):
- **No Android** and no mobile web, repeated since 2024†.
- **Bugs and sync:** hiccups across devices, a disappearing task, slow cold starts, and a macOS app called "unsustainably laggy"†.
- **Slow, unfocused development** of the calendar: Apple Calendar arrived late and only on paid plans (2024) [F]. Since 2025 the focus has been notes, not the calendar† *(competitor-written)*.
- **Price** for a calendar†; in 2024, email was a Pro-only Google add-on with no IMAP or Exchange [F].
- **Missing basics** (2024): travel time, event colours per account, landscape mode, repeats on iPhone [F].

**Corrections to the older files (with dates):**
- **One-time links:** Morgen's one-time links are now **Open Invites** (guide dated 2 Mar 2026).
- **Kai:** no longer a waitlist. The page offers a free trial with no time limit; Base costs $20, Pro $50 and Ultra $100 a month. Morgen subscribers who subscribed before 15 Oct 2026 get 20% off Kai Pro for life if they buy it before 31 Dec 2026 ([V](https://www.morgen.so/kai)).
- **Trustpilot:** July recorded 4.4 with 26% one-star reviews; today it shows **4.5 from 72 reviews, 4% one-star**, and only 6 reviews in the last 12 months [F].
- **Morgen's prices:** Morgen's own blog posts quote $34 and $19; the pricing page says **$30 and $15**. Use the pricing page.
- **The Amie iOS build** on the App Store is dated "08/06/2025". Whether that means 6 August or 8 June is ambiguous. Its rating is 3.4 from 128 ratings [F].

---

## 3. Interaction details worth copying

Each detail below is tied to a gap from §2.

**3.1 Morgen's Notification Center for invitations** (gap: answering invitations; C7)
1. A Notification Center collects pending meeting invitations (changelog, Jan 2025) [V].
2. It can be cleared in one go and updates as the calendar changes (Feb 2025) [V].
3. Whether each row answers inline (Yes · No · Maybe) is **Unverified**.

*For Moduo:* C7 already proposes outlined invitations and Yes · No · Maybe in Details. Add one place that lists every invitation still waiting for a reply: either a "Waiting for your reply · 3" line above the grid, like C3's missed line, or a group in the bell.

**3.2 Amie's reminders** (gap: alerts; C13)
1. You can add up to five reminders per event (May 2024) [V].
2. Reminder presets are quicker to set (Apr 2024) [V].
3. Where the reminders sit in the editor, and whether defaults come from settings, is **Unverified**.

*For Moduo:* C13's per-calendar default plus a per-event change covers this. **The lesson from Morgen's reviews** is that an alert that arrives late is worse than none ("notifies me hours late", Mar 2026). Treat on-time delivery as part of the feature.

**3.3 Morgen's AI Planner, without the AI** (gap: planning several tasks at once; C11)
1. Choose a range (1–7 days).
2. The tool ranks tasks by priority, due date and estimate.
3. It previews every placement on the grid.
4. Toggles adjust the result: pad estimates, split long tasks, add breaks.
5. You add or drop tasks from the preview.
6. Approve; nothing lands before that.
7. Later, when a new event clashes with a placed task, a notice offers one-click "move it".

*For Moduo:* extend C11 from "Fit N into today" to **"Fit N into this week"**:
- the same arithmetic (your order, working hours, free time);
- the drafts show on the grid as S drafts do;
- ⇥ cycles each draft to its next free slot;
- ↵ places them all, with one Undo.
- **Skip a separate approve screen.** Reviewers call Morgen's approval step "tedious"†; Moduo's draft-on-grid already is the approval.

**3.4 Morgen's Frames** (gap: typed work windows; CALR-14 focus time)
1. Click an empty slot.
2. Switch the item from Event to Frame.
3. Name it ("Deep work").
4. Set a repeat; plain words work ("every second Thursday").
5. Pick the calendar it lives on.
6. Under "Filtered tasks", pick sources, lists, projects and tags.
7. Set it to free or busy.
8. Drag tasks in, or let the Planner fill it.

*For Moduo:* let **focus time take a project or tag** instead of one task. S on a matching task then lands inside the next matching focus time first.
- **Fix Morgen's gotcha:** moving a focus window moves the sessions inside it.
- **Keep CALR-14's default:** free for booking links.

Amie's lighter version, per-list "preferred times", is the minimum.

**3.5 Morgen's "Calendar sync" (propagation)** (gap: personal busy time; C16)
1. Pick a source calendar and a target calendar (pricing page: "copies personal events to your work calendar") [V].
2. Morgen keeps the copies in step, and retries temporary failures for up to 3 days (Apr 2025) [V].
3. Whether you can choose busy-only or with details was not read this session (**Unverified**; Notion Calendar's version offers both, per the October file).

*For Moduo:* C16's two switches are exactly this. Copy the 3-day retry, and say on the account when a copy is failing.

**3.6 Morgen's Open Invites: reschedule and the booked list** (gap: guest reschedule; C19 #1)
1. Create it from the new-event widget: press "Open Invite" instead of Save, so the details carry over.
2. Highlight the windows you offer.
3. Copy & Save the link.
4. The invitee picks a time and confirms with name and email.
5. Either side can **Cancel** from the event's details.
6. The invitee can **Reschedule** to another offered time, and both calendars update.
7. The organiser edits a booked invite and resends it.
8. Invites are listed under **Unused · Booked · Expired**.

*For Moduo:*
- Reschedule from the guest's email and booking page (C19 #1).
- Show Unused, Booked and Expired in the Booking link view. Moduo's O already beats Morgen on holds.

**3.7 Morgen's optional co-host** (gap: several hosts)
1. Open the ⋯ next to a co-host's name.
2. Choose "Fixed co-host, optional".
3. Their calendar no longer limits the times offered, and they're still added to the event.

*For Moduo:* a one-item addition to CALR-17's Hosts rule ("Mike joins if free").

**3.8 Amie's todo loop** (gap: global quick-add; also the joy of the S flow)
1. Press Enter or ⌘K and type the todo in plain words.
2. Press **I** for the Inbox.
3. Press **H** to schedule the todo, or drag it onto a slot.
4. Press **D** to mark it done, P for priority, L for list or label.

Every step is one letter. Moduo's S is already this, and better. **The thing to copy is reach:** ⌥⌃A opens Amie from anywhere on the Mac, and the menu bar shows today and tomorrow.

*For Moduo:* on desktop, a global capture that can make an event, plus a menu-bar "next: Legal review with Tom · 11:30 · Join". This needs a Tauri check; Unverified whether it exists today.

**3.9 Amie's 2024 email draft that knew your calendar** (feeds §5.2)
1. You type "let's meet tomorrow at 4pm" in an email draft.
2. Amie shows your calendar for that slot right there, so you see a clash before sending (TechCrunch, Jan 2024).

Amie's docs no longer show this†. Moduo has both modules and can make it standard.

---

## 4. Things they do that Moduo should deliberately NOT do

Each item names which tool does it.

1. **Auto-scheduling that reshuffles by itself** (Amie).
   - **Amie:** its AI scheduling re-places todos as plans change (May 2024 changelog), and no approval step is documented.
   - Its own fix log includes a bug where scheduled todos overlapped (May 2025).
   - Category-wide, this is the top churn reason (Motion, in the October file).
   - Moduo keeps "nothing moves unless you place it". Batch help is C11: you pick, it previews, one Undo.
2. **A separate approval ritual for every plan** (Morgen). Morgen's approval-first Planner is the right instinct, but reviewers call it tedious†. Moduo's draft-on-grid with ↵ is the approval. Don't add a "Review plan" screen.
3. **Pivoting the calendar into an AI notetaker** (Amie).
   - Amie's calendar and todos still get fixes, but the product, plans and changelog now centre on recording.
   - Its iOS app sits at 3.4 stars, with the last build dated 2025 [F].
   - A competitor-written post describes returning users who expected a calendar and found a notetaker.
   - Moduo's rule (AI only through MCP) avoids this. Recording, if it ever comes, belongs to Meet, not Calendar.
4. **Removing features quietly** (Morgen).
   - Morgen's most damaging recent review is about a removed feature "that I relied on" that was never announced (Trustpilot, Jan 2026).
   - v4 also dropped on-prem Exchange and older CalDAV servers.
   - When Moduo narrows something (for example Outlook view-only), say it in the product, with what to do instead.
5. **Key objects you can't make on the phone** (Morgen). Scheduling links can't be created in the phone app, and reviews say the AI Planner doesn't work on mobile†. Moduo has no phone app yet (Tasks 36). The lesson is for later: when one ships, it should create what it shows.
6. **Locking the app when the trial ends** (Morgen). At day 14 Morgen locks the app until you pay, with no free plan. Paying to see your to-do list on the phone is called a deal-breaker†. Moduo's free tier is the counter.
7. **"This one or all of them?" on every edit of a repeat** (Morgen, mobile). Reviewers find Morgen's mobile prompt repetitive†. Moduo's ↵ already defaults to "This event" (CALR-11). Keep the default fast, and never ask for things that don't repeat.
8. **Drawing non-time data on the grid** (Amie). Amie added Stripe revenue and stock-price alerts as calendar slots (Aug 2026). The grid stays your time and your work. Anything else belongs in Home widgets.
9. **Becoming a "viewing layer" over other task apps** (Morgen). Morgen's integrations are its strength and its complaint ("a viewing layer, not a manager", July research). Moduo owns tasks and shouldn't build two-way Todoist or Notion sync. A one-time import on switching is enough.
10. **Work windows that forget their contents** (Morgen). Moving a Morgen Frame leaves its tasks behind. If 3.4 is built, sessions move with their window.

---

## 5. What only Moduo can do

These ideas use links Moduo already has: event ↔ note, task, contact and email; chat; the L gesture; offers (O); cues (C12). **None needs an in-app model.**
- Moduo assembles the pieces through links.
- Any summarising is the user's own assistant over MCP.

Ranked by how often a 2–5 person agency would use them.

### 5.1 Meeting prep in the Event view, from links

**What it is:** before a meeting, the Event view (CALR-10) gains an **"Before this meeting"** group:
- the last meeting with these people, and its note;
- the latest email thread with any guest;
- open tasks linked to the guests' contacts or to the event;
- the last chat decision that mentions them;
- the people's cues (5.3).

Each row opens with ← to come back. It is nothing more than the existing link graph, filtered by the guests.

**Who attempts it:**

| Who | What it does | How well |
| --- | --- | --- |
| Amie | Notes per contact, but only with a CRM connected [V] | Medium, and behind a CRM |
| Notion Calendar | Attaches a meeting-notes page you write the agenda in; AI uses it later† | Medium; it doesn't pull email or tasks |
| Vimcal | "Dossiers" of public profiles (October file) | Weak: outside data, not your history |
| Outlook Copilot, Fireflies, Mixmax, Wispr | AI briefs from email and past meetings, often emailed in advance† | Strong, but paid, AI and separate tools |
| Morgen | Nothing (Kai has a morning brief) | — |

**Moduo's edge:** the brief is links you can check, not a model's guess. An MCP assistant can summarise the same set on demand.

### 5.2 Scheduling from an email thread

**What it is:** in Moduo Email's compose, **O** (the same offer flow as Calendar's CALR-19):
1. It drops 2–3 free times, with holds, into the reply.
2. The recipient clicks one, and both sides get the event.
3. The event links to the thread and the contact.
4. The holds release.
5. Typing "Thursday 3pm" in a draft shows a quiet free or busy echo beside it (Amie 2024, §3.9).

**Who attempts it:**
- **Gmail "Help me schedule"** (Oct 2025; groups of up to 20 since Mar 2026): needs Gemini on a paid Workspace or AI plan (the October file read the Oct 2025 post; the Mar 2026 change is †).
- **Superhuman's "Share availability"**: help page blocked; †.
- **Amie** did the draft echo in 2024 and no longer documents it.
- **Morgen** has nothing: links are pasted by hand.

**Moduo's edge:** no AI tier needed, and the offer, thread, contact and event are one linked object.

### 5.3 Cues at the next meeting with a person (C12)

**What it is:** on a task, choose "Remind me at my next meeting with Anna". The task then:
- shows in that meeting's Event view under "At this meeting";
- arrives with the meeting's alert;
- follows the meeting if it moves.

**Who attempts it:** nobody, beyond Amie's 2022 keep-in-touch reminders on a contact's profile (TechCrunch), which are time-based, not meeting-based. The calendar knows who's in the meeting and the task manager is the same app, so only Moduo can join the two. It depends on C7 (guests) and C13 (alerts).

### 5.4 The person on the event, the event on the person

**What it is:**
- **On the event:** a guest who is a contact shows their company, "last met Oct 9", open tasks and bookings.
- **On the contact:** the hub shows "next meeting Thu" with Join, and the booking history from booking links (a booking creates or links the contact).
- **For an agency:** a client page sees every call with that client.

**Who attempts it:** Amie only through a CRM; Morgen has availability toggles only; Calendly and Cal.com create CRM records in paid tiers. Moduo has its own Contacts, so it needs no CRM.

### 5.5 After the meeting, in one place

**What it is:** on a past event, the Event view offers:
- **Add 45m to time** (C20), so client calls reach the client's time report;
- **tasks from note lines**: a note line becomes a task linked to the event and the contact, with the owner from the guests;
- a **follow-up email** draft to the guests with the note linked; email's follow-up flag tracks the reply;
- a **post to the client's chat channel**.

**Who attempts it:** Amie turns AI action items into Linear, Reminders or CRM records [V], but the email is copied out to another client. Kai drafts a recap email†. Neither ties it to time tracking or a shared team chat.

**Moduo's edge:** one gesture each, all attributed, and the user's own assistant can do the wording over MCP.

**Also possible, lower priority:**
- A booking makes or links a contact, and puts the guest's answers on the contact.
- Chat's "decisions" show on the meeting where they were made.
- A meeting's linked tasks show the sessions planned before the next one ("prep for the Thursday review").

---

## 6. Sources

All accessed 2026-11-21.

**Morgen**
- Changelog: https://changelog.morgen.so/ [V]
- Pricing: https://www.morgen.so/pricing [V]
- AI Planner: https://www.morgen.so/ai-planner [V]
- Frames guide (2 Mar 2026): https://www.morgen.so/guides/how-to-use-frames [V]
- Open Invites (2 Mar 2026): https://www.morgen.so/guides/create-open-invites [V]
- Multi-person scheduling links (5 Mar 2026): https://www.morgen.so/guides/multi-person-scheduling-links [V]
- Get started with v4 (20 Feb 2026): https://www.morgen.so/guides/get-started-with-morgen-v4 [V]
- "Morgen v4 is coming" (28 Aug 2025): https://morgen.so/blog-posts/morgen-v4-is-coming-whats-new-and-whats-changing [V]
- Smart assist page (German): https://www.morgen.so/de/smart-assist-workflows [V]
- Kai: https://www.morgen.so/kai [V]
- MCP feature request: https://feedback.morgen.so/p/mcp-and-more [V]
- Trustpilot: https://www.trustpilot.com/review/morgen.so [F]
- Saner.AI review, 2 Mar 2026: https://blog.saner.ai/morgen-reviews († *(competitor-written)*; quotes G2, Trustpilot and Medium)
- Scheduling links guide: https://morgen.so/guides/how-to-use-scheduling-links (†, via search)
- Community MCP servers: https://lobehub.com/mcp/k3kaw8pnf7mkmdsmphz27-morgenmcp (†)

**Amie**
- Changelog: https://amie.so/changelog [V]
- Home: https://amie.so/ [V]
- Pricing: https://amie.so/pricing [V]
- Billing and plans: https://amie.so/documentation/account/billing [V]
- Docs index: https://amie.so/docs [V]
- Scheduling links: https://amie.so/documentation/scheduling-links [V]
- Tasks and todos: https://amie.so/documentation/features/tasks [V]
- AI scheduling: https://amie.so/documentation/features/ai-scheduling [V]
- Email: https://amie.so/documentation/email-integration [V]
- Pages: https://amie.so/documentation/features/pages [V]
- App Store: https://apps.apple.com/app/id1548277133 [F]
- TechCrunch, 17 Mar 2022: https://techcrunch.com/2022/03/17/amie-is-a-new-calendar-app-with-a-social-twist (†)
- TechCrunch, 24 Jan 2024: https://techcrunch.com/2024/01/24/amie-brings-your-email-inbox-to-its-calendar-app (†)
- Carly, 30 Jun 2026: https://www.usecarly.com/blog/what-happened-to-amie/ († *(competitor-written)*)
- ClickUp: https://clickup.com/blog/amie-calendar-review/ († *(competitor-written)*)
- Lemcal, 16 Apr 2024: https://lemcal.com/blog/amie-app-review (†)
- Design write-up: https://blakecrosley.com/guides/design/amie (†)
- Pricing round-up (search): https://lifestack.ai/blog/amie-app-pricing (†)

**Elsewhere**
- Gmail "Help me schedule" (Oct 2025): https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html (read as [V] in the October file; not re-read here)
- Gmail "Help me schedule" for groups (Mar 2026): https://workspaceupdates.googleblog.com/2026/03/use-help-me-schedule-in-gmail-to-easily-set-up-a-meeting-time-with-multiple-guests.html (†)
- Google help, suggest times: https://support.google.com/calendar/answer/16865189 (†)
- Notion AI Meeting Notes: https://www.notion.com/help/ai-meeting-notes (†)
- Notion Calendar with Outlook (Jul 2026): https://alternativeto.net/news/2026/7/notion-calendar-integrates-ai-meeting-notes-with-outlook/ (†)
- Fireflies meeting prep: https://guide.fireflies.ai/articles/3878280311-meeting-prep-get-briefed-before-every-meeting (†)
- Mixmax meeting prep (Apr 2026): https://www.mixmax.com/blog/product-releases-meeting-prep-april2026 (†)
- Superhuman "Share availability": https://help.superhuman.com/hc/en-us/articles/38457524200595 (the page returned 403; only its title was seen in search)
