# Manual test: landing v6 content pass (`t/maciej/landing-v4`)

This keeps Mike's v5 look (blueprint frame, uppercase hero, ⌘K demo, sticky story, board, MCP chat, MOD+DUO footer) and replaces content that wasn't true or approved.
Surface: **web, localhost only**. Run `PORT=8766 bun scripts/preview-landing.ts`, then open http://127.0.0.1:8766.
⚠ The waitlist forms post to the **production** Supabase. Don't submit test emails.

## Hero
- [ ] Headline reads "FIRE FIVE APPS. / KEEP THE WORK." The subline names email, tasks, notes, calendar and contacts. No mind maps or invoicing.
- [ ] On load, five windows (Mail, Docs, To-do app, Calendar, Contacts) are scattered, and the tab strip says "5 tabs".
- [ ] About 2.4 s later they assemble into Moduo Home. The window has a top tab bar (Home active) and no side rail. The tab strip says "1 tab", and Apps, Logins and Search bars count 05 → 01.
- [ ] The assembled view shows five widgets: Tasks, Calendar, Email, Notes, Contacts. Mindmap is gone.
- [ ] Lines connect the Email row to the task and to the contact, the task to Friday's "Deck · Fri 10:00", and the task to the note.
- [ ] The "Your stack today / With Moduo" toggle still works both ways.

## ⌘K search demo
- [ ] The idle tour types "anna", then "deck", then "friday". The Try chips match.
- [ ] Results only come from People, Tasks, Email, Notes and Events. There are no Deals, Time, Invoices, Goals or Maps.
- [ ] Anna's preview says "linked to Anna, on one page". It never says "nobody logged any of it".

## Module strip
- [ ] The label reads "Five modules · one workspace · one search". The chips only list live things: Home, Tasks, Notes, Calendar, Email, Contacts, Links, One search, Quick capture, Focus timer, 16 widgets, Notion import.

## Story: "One thread through everything."
- [ ] There are six steps: Anna writes / The note finds her / Press T / Hand it to Jamie / Give it a slot / See it all at home.
- [ ] Scrolling through, cards arrive in order: email + contact, note, task, Jamie, Friday block, Home. Each step's line draws, and its label (sender, mentions, spawned from, task line, assigned, scheduled, today, tasks) pulses.
- [ ] In step 2 "@Anna Carter" flies from the note to the contact. In step 3 the T key presses, the subject flies to the task and the task flies to the note. In step 4 the assignee flies to Jamie. In step 5 the task flies to the calendar.
- [ ] The footer counters read "Links N" and "Copied 0". There is no "Tagged by you", no invoice and no "€".
- [ ] Clicking the task's round checkbox strikes it through, and the status says Anna's contact, Jamie and Home all show it.
- [ ] Dragging cards, hover tracing and Reset layout still work.

## Stack tax
- [ ] The receipt lists Notion Plus 10.00, Todoist Pro 5.00, Fantastical Premium 4.75, Superhuman Starter 25.00 and folk Standard 24.00. The 68.75 total is struck through, followed by Moduo Pro $8 and the note with the 1 October 2026 date.

## Make it yours
- [ ] The copy says 16 widgets, four sizes, and that every workspace keeps its own board. There's no store, no installing modules and no recolouring.
- [ ] "Add widget" opens "Add a widget" with no Modules tab. The widgets have real names (Tasks, Needs attention, Habits, Quick capture, Pinned, Notes, Inbox, Today, Countdown, Time tracking, Reconnect, Recently linked, Activity, Pomodoro, Weather, Clock).
- [ ] The widget popover only offers sizes S/M/L/XL plus Remove. The strip shows five module chips with no "+" install chip.
- [ ] The Studio / Personal / Side project switch swaps boards.

## AI
- [ ] The prompts are: what's left before the demo / link Maya's emails to the note / plan Thursday.
- [ ] Tool calls use real MCP tool names (tasks_search, calendar_list_events, email_search, links_create, calendar_day, calendar_schedule_task).
- [ ] The key row reads Tasks · edit, Calendar · edit, Notes · edit, Email · view only. There's no "Draft invoices" or "Send email".

## New sections
- [ ] "What we refuse to build": four struck uppercase lines, each with a short reason.
- [ ] Pricing:
  - Yearly is the default: $0 / $8 / $7.
  - Monthly switches to $0 / $10 / $9.
  - Each plan's "Join the waitlist" opens the waitlist dialog.
  - The private-beta note sits under the cards.
- [ ] FAQ: eight questions, the first one open, and the support@moduo.app link.
- [ ] The nav shows 01–04 (Pricing added). The nav label changes through the sections (On purpose, Pricing, Questions, Early access).

## Close and footer
- [ ] The close copy has no "switch on modules".
- [ ] The footer lede names the five modules. The only email is support@moduo.app. There's no "Switch from" column; it's now Modules.
- [ ] The MOD+DUO wordmark and 3D mark still animate.

## Phone (390 px)
- [ ] No sideways scroll anywhere.
- [ ] The receipt, refuse lines, plan cards and FAQ stack in one column.

## Known gaps
- Social links, checked 1 Oct 2026:
  - LinkedIn (`/company/moduo-app`) exists. It's the Moduo page with Mike listed, but the tagline is out of date.
  - These don't exist: X `@moduoapp`, Product Hunt `/products/moduo`, GitHub `moduo-app` and YouTube `@moduoapp`.
  - The Discord `discord.gg/moduo` invite says "Invite Invalid".
  - Still to fix.
- Privacy, Terms, About, Changelog and Download for Mac are "soon" placeholders, because those pages don't exist yet.
- The calls to action stay on the waitlist (decided: private beta). Assignment is shown as live (it ships before launch).
